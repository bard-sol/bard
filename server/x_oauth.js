import { b64urlDecode, b64urlEncode, isBase58Address, verifyJwt } from './auth.js';

const textEncoder = new TextEncoder();
const STATE_TTL_MS = 10 * 60 * 1000;
const X_AUTHORIZE = 'https://x.com/i/oauth2/authorize';
const X_TOKEN = 'https://api.x.com/2/oauth2/token';
const X_ME = 'https://api.x.com/2/users/me?user.fields=username';
const DEFAULT_REDIRECT = 'https://bard-auth.bardsoltoken.workers.dev/auth/x/callback';

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
  if (!freshTimestamp(payload.ts, now)) return { ok: false };
  return { ok: true, payload: { typ: 'xlink', wallet: payload.wallet, handle, ts: payload.ts } };
}

export async function writeVerifiedHandle(env, wallet, handle, now = new Date()) {
  if (!isBase58Address(wallet)) throw new Error('invalid wallet');
  const normalized = normalizeXHandle(handle);
  if (!normalized) throw new Error('invalid handle');
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('supabase is not configured');
  const res = await fetcher(env)(base + '/rest/v1/holders?on_conflict=wallet', {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      accept: 'application/json',
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      wallet,
      x_handle: normalized,
      x_linked_at: now.toISOString(),
      x_via: 'oauth',
    }),
  });
  if (!res.ok) throw new Error('holder write failed');
  return { wallet, x_handle: normalized, x_via: 'oauth' };
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

async function fetchUsername(env, accessToken) {
  const res = await fetcher(env)(X_ME, {
    headers: { authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const username = data && data.data && data.data.username;
  return typeof username === 'string' ? username : null;
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
    const username = await fetchUsername(env, accessToken);
    const handle = normalizeXHandle(username);
    if (!handle) return failRedirect(env);
    // Do not write here. Whoever approved on X may not own this wallet.
    const xlink = await signState(secret, {
      typ: 'xlink',
      wallet: read.payload.wallet,
      handle,
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
    const written = await writeVerifiedHandle(env, claims.wallet, read.payload.handle, new Date(now));
    return json({ ok: true, handle: written.x_handle });
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
  return new Response('not found', { status: 404, headers: CORS });
}
