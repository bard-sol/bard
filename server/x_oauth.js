import { b64urlDecode, b64urlEncode, isBase58Address, verifyJwt } from './auth.js';
import { walletInUnpaidScoredCampaign, writeScoreAudit } from './score_api.js';
import { normalizeHandle } from '../scoring.js';

const textEncoder = new TextEncoder();
const STATE_TTL_MS = 10 * 60 * 1000;
const X_AUTHORIZE = 'https://x.com/i/oauth2/authorize';
const X_TOKEN = 'https://api.x.com/2/oauth2/token';
const X_ME = 'https://api.x.com/2/users/me?user.fields=id,username';
const X_TAKEN = 'this X account is already linked to another wallet; unlink it there first';
const DEFAULT_REDIRECT = 'https://bard-x-auth.bardsoltoken.workers.dev/auth/x/callback';

const CORS = {
  'access-control-allow-origin': 'https://bard.is',
  'access-control-allow-headers': 'Content-Type, Authorization',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'cache-control': 'no-store',
};

function json(data, status = 200) {
  return Response.json(data, { status, headers: CORS });
}

function bytesToBinary(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return bin;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(data));
  return new Uint8Array(sig);
}

function stateSecret(env) {
  return env.X_OAUTH_STATE_SECRET || env.SUPABASE_JWT_SECRET || '';
}

function fetcher(env) {
  return env.fetch || fetch;
}

export function normalizeXHandle(value) {
  const raw = String(value || '').trim().replace(/^@+/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(raw)) return null;
  return '@' + raw;
}

function appOrigin(env) {
  const raw = env.BARD_APP_ORIGIN || 'https://bard.is';
  const url = new URL(raw);
  const host = url.hostname;
  const prod = url.protocol === 'https:' && (host === 'bard.is' || host.endsWith('.bard.is'));
  const local = (url.protocol === 'http:' || url.protocol === 'https:') && (host === 'localhost' || host === '127.0.0.1');
  if (!prod && !local) throw new Error('bad app origin');
  return url.origin;
}

function redirectUriOf(env) {
  const url = new URL(env.X_REDIRECT_URI || DEFAULT_REDIRECT);
  if (url.protocol !== 'https:') throw new Error('redirect uri must be https');
  return url.origin + url.pathname;
}

function dashboardUrl(env, params) {
  const url = new URL('/dashboard.html', appOrigin(env));
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function failRedirect(env) {
  try {
    return Response.redirect(dashboardUrl(env, { auth: 'error' }), 302);
  } catch {
    return new Response('x oauth failed', { status: 400, headers: CORS });
  }
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : '';
}

function randomNonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64urlEncode(bytes);
}

async function pkceVerifier(secret, nonce) {
  return b64urlEncode(await hmacSign(secret, 'pkce:' + nonce));
}

async function codeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(verifier));
  return b64urlEncode(new Uint8Array(digest));
}

async function signState(secret, payload) {
  const body = b64urlEncode(textEncoder.encode(JSON.stringify(payload)));
  const sig = b64urlEncode(await hmacSign(secret, body));
  return body + '.' + sig;
}

async function readSigned(secret, token) {
  if (!secret) return { ok: false };
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false };
  const expected = await hmacSign(secret, parts[0]);
  let got;
  try { got = b64urlDecode(parts[1]); } catch { return { ok: false }; }
  if (!timingSafeEqual(expected, got)) return { ok: false };
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0]))); } catch { return { ok: false }; }
  if (!payload || typeof payload !== 'object') return { ok: false };
  return { ok: true, payload };
}

function freshTimestamp(ts, now) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return false;
  if (ts - now > 60 * 1000) return false;
  if (now - ts > STATE_TTL_MS) return false;
  return true;
}

export async function readXState(secret, state, now = Date.now()) {
  const read = await readSigned(secret, state);
  if (!read.ok) return { ok: false };
  const payload = read.payload;
  // typ separates this from an xlink token. The verifier is not stored here.
  if (payload.v !== 1 || payload.typ !== 'xstate' || !isBase58Address(payload.wallet)) return { ok: false };
  if (typeof payload.nonce !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(payload.nonce)) return { ok: false };
  if (!freshTimestamp(payload.ts, now)) return { ok: false };
  return { ok: true, payload };
}

export async function readXLink(secret, token, now = Date.now()) {
  const read = await readSigned(secret, token);
  if (!read.ok) return { ok: false };
  const payload = read.payload;
  if (payload.typ !== 'xlink' || !isBase58Address(payload.wallet)) return { ok: false };
  const handle = normalizeXHandle(payload.handle);
  if (!handle || handle !== payload.handle) return { ok: false };
  const id = String(payload.id == null ? '' : payload.id);
  if (!/^\d{1,32}$/.test(id)) return { ok: false };
  if (!freshTimestamp(payload.ts, now)) return { ok: false };
  return { ok: true, payload: { typ: 'xlink', wallet: payload.wallet, handle, id, ts: payload.ts } };
}

function supabaseHeaders(env, prefer) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    accept: 'application/json',
  };
  if (prefer) {
    headers['content-type'] = 'application/json';
    headers.prefer = prefer;
  }
  return headers;
}

async function holdersRequest(env, method, query, body, prefer) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('supabase is not configured');
  const usePrefer = prefer != null ? prefer : (body === undefined ? '' : 'return=representation');
  const res = await fetcher(env)(base + '/rest/v1/holders' + query, {
    method,
    headers: supabaseHeaders(env, usePrefer),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { message: text }; }
  }
  return { res, data };
}

export async function writeVerifiedHandle(env, wallet, handle, xUserId, now = new Date()) {
  if (!isBase58Address(wallet)) throw new Error('invalid wallet');
  const normalized = normalizeXHandle(handle);
  if (!normalized) throw new Error('invalid handle');
  const id = String(xUserId == null ? '' : xUserId);
  if (!/^\d{1,32}$/.test(id)) throw new Error('invalid x user id');
  const { res, data } = await holdersRequest(env, 'POST', '?on_conflict=wallet', {
    wallet,
    x_handle: normalized,
    x_linked_at: now.toISOString(),
    x_via: 'oauth',
    x_user_id: id,
  }, 'resolution=merge-duplicates,return=representation');
  if (res.status === 409 || (data && data.code === '23505')) {
    const err = new Error(X_TAKEN);
    err.status = 409;
    throw err;
  }
  if (!res.ok) throw new Error('holder write failed');
  return { wallet, x_handle: normalized, x_via: 'oauth', x_user_id: id };
}

async function exchangeCode(env, code, verifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUriOf(env),
    code_verifier: verifier,
    client_id: env.X_CLIENT_ID,
  });
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (env.X_CLIENT_SECRET) {
    headers.authorization = 'Basic ' + btoa(bytesToBinary(textEncoder.encode(env.X_CLIENT_ID + ':' + env.X_CLIENT_SECRET)));
  }
  const res = await fetcher(env)(X_TOKEN, { method: 'POST', headers, body: body.toString() });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || typeof data.access_token !== 'string' || !data.access_token) return null;
  return data.access_token;
}

async function fetchProfile(env, accessToken) {
  const res = await fetcher(env)(X_ME, {
    headers: { authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const user = data && data.data;
  if (!user || typeof user.username !== 'string') return null;
  const id = String(user.id == null ? '' : user.id);
  if (!/^\d{1,32}$/.test(id)) return null;
  return { id, username: user.username };
}

export async function handleXStart(request, env, now = Date.now()) {
  const secret = stateSecret(env);
  const jwtSecret = env.SUPABASE_JWT_SECRET || '';
  if (!secret || !jwtSecret || !env.X_CLIENT_ID) return json({ error: 'x oauth is not configured' }, 503);
  let redirectUri;
  try { redirectUri = redirectUriOf(env); } catch { return json({ error: 'x oauth is not configured' }, 503); }
  // The wallet comes from the Bard session. A ?wallet= query is ignored.
  const claims = await verifyJwt(jwtSecret, bearerToken(request), now);
  if (!claims) return json({ error: 'sign in required' }, 401);
  const wallet = claims.wallet;
  const nonce = randomNonce();
  const verifier = await pkceVerifier(secret, nonce);
  const challenge = await codeChallenge(verifier);
  const state = await signState(secret, { v: 1, typ: 'xstate', wallet, ts: now, nonce });
  const auth = new URL(X_AUTHORIZE);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('client_id', env.X_CLIENT_ID);
  auth.searchParams.set('redirect_uri', redirectUri);
  auth.searchParams.set('scope', 'tweet.read users.read');
  auth.searchParams.set('state', state);
  auth.searchParams.set('code_challenge', challenge);
  auth.searchParams.set('code_challenge_method', 'S256');
  return json({ authUrl: auth.toString() });
}

function xlinkRedirect(env, token) {
  const url = new URL('/dashboard.html', appOrigin(env));
  // Fragment, not query: the handle must not land in a server log or a Referer.
  url.hash = 'xlink=' + token;
  return Response.redirect(url.toString(), 302);
}

export async function handleXCallback(request, env, now = Date.now()) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code') || '';
  const stateToken = url.searchParams.get('state') || '';
  try {
    const secret = stateSecret(env);
    if (!secret || !env.X_CLIENT_ID) return failRedirect(env);
    const read = await readXState(secret, stateToken, now);
    if (!read.ok || !code) return failRedirect(env);
    const verifier = await pkceVerifier(secret, read.payload.nonce);
    const accessToken = await exchangeCode(env, code, verifier);
    if (!accessToken) return failRedirect(env);
    const profile = await fetchProfile(env, accessToken);
    const handle = normalizeXHandle(profile && profile.username);
    if (!handle || !profile) return failRedirect(env);
    // Do not write here. Whoever approved on X may not own this wallet.
    const xlink = await signState(secret, {
      typ: 'xlink',
      wallet: read.payload.wallet,
      handle,
      id: profile.id,
      ts: now,
    });
    return xlinkRedirect(env, xlink);
  } catch {
    return failRedirect(env);
  }
}

export async function handleXConfirm(request, env, now = Date.now()) {
  const secret = stateSecret(env);
  const jwtSecret = env.SUPABASE_JWT_SECRET || '';
  if (!secret || !jwtSecret || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'x oauth is not configured' }, 503);
  }
  const claims = await verifyJwt(jwtSecret, bearerToken(request), now);
  if (!claims) return json({ error: 'sign in required' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid token' }, 400); }
  const read = await readXLink(secret, body && body.token, now);
  if (!read.ok) return json({ error: 'invalid token' }, 400);
  if (read.payload.wallet !== claims.wallet) return json({ error: 'wallet mismatch' }, 403);
  try {
    const found = await holdersRequest(
      env,
      'GET',
      '?x_user_id=eq.' + encodeURIComponent(read.payload.id) + '&x_via=eq.oauth&select=wallet,x_user_id'
    );
    if (!found.res.ok) return json({ error: 'holder write failed' }, 502);
    const rows = Array.isArray(found.data) ? found.data : [];
    const other = rows.find((row) => row && row.wallet && row.wallet !== claims.wallet);
    if (other) return json({ error: X_TAKEN }, 409);
    const written = await writeVerifiedHandle(env, claims.wallet, read.payload.handle, read.payload.id, new Date(now));
    return json({ ok: true, handle: written.x_handle });
  } catch (err) {
    if (err && err.status === 409) return json({ error: X_TAKEN }, 409);
    return json({ error: 'holder write failed' }, 502);
  }
}

export async function handleXUnlink(request, env, now = Date.now()) {
  const jwtSecret = env.SUPABASE_JWT_SECRET || '';
  if (!jwtSecret || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'x oauth is not configured' }, 503);
  }
  const claims = await verifyJwt(jwtSecret, bearerToken(request), now);
  if (!claims) return json({ error: 'sign in required' }, 401);
  try {
    if (await walletInUnpaidScoredCampaign(env, claims.wallet)) {
      return json({ error: 'unlink this X account after the scored campaign is paid' }, 409);
    }
    const found = await holdersRequest(
      env,
      'GET',
      '?wallet=eq.' + encodeURIComponent(claims.wallet) + '&select=wallet,x_handle,x_via,x_user_id'
    );
    if (!found.res.ok) return json({ error: 'holder write failed' }, 502);
    const row = Array.isArray(found.data) ? found.data[0] : null;
    if (!row) return json({ error: 'holder not found' }, 404);
    const saved = await holdersRequest(env, 'PATCH', '?wallet=eq.' + encodeURIComponent(claims.wallet), {
      x_via: 'unverified',
      x_user_id: null,
    });
    if (!saved.res.ok) return json({ error: 'holder write failed' }, 502);
    await writeScoreAudit(env, {
      campaign_id: null,
      action: 'unlink',
      entity: 'holder',
      before: { x_handle: row.x_handle || null, x_via: row.x_via || null, x_user_id: row.x_user_id || null },
      after: { x_handle: row.x_handle || null, x_via: 'unverified', x_user_id: null },
      reason: 'holder unlinked',
      actor: claims.wallet,
      subject_wallet: claims.wallet,
      subject_handle: normalizeHandle(row.x_handle),
    });
    return json({ ok: true, handle: row.x_handle || null });
  } catch {
    return json({ error: 'holder write failed' }, 502);
  }
}

export async function handleXOauth(request, env, now = Date.now()) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === '/auth/x/start' && method === 'GET') return handleXStart(request, env, now);
  if (url.pathname === '/auth/x/callback' && method === 'GET') return handleXCallback(request, env, now);
  if (url.pathname === '/auth/x/confirm' && method === 'POST') return handleXConfirm(request, env, now);
  if (url.pathname === '/auth/x/unlink' && method === 'POST') return handleXUnlink(request, env, now);
  return new Response('not found', { status: 404, headers: CORS });
}
