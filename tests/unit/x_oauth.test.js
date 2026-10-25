import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import worker from '../../auth-worker.js';
import { signJwt } from '../../server/auth.js';
import { handleXOauth, normalizeXHandle } from '../../server/x_oauth.js';

const NOW = Date.parse('2026-10-25T16:00:00.000Z');
const SECRET = 'state-secret-state-secret-state-secret';
const JWT_SECRET = 'jwt-secret-jwt-secret-jwt-secret-jwt';

function wallet() {
  return bs58.encode(nacl.sign.keyPair().publicKey);
}

function s256(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function installFetchGuard() {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    throw new Error('live network blocked: ' + url);
  };
  return () => { globalThis.fetch = orig; };
}

function oauthEnv(impl) {
  return {
    X_CLIENT_ID: 'test-client',
    X_CLIENT_SECRET: 'test-secret',
    X_OAUTH_STATE_SECRET: SECRET,
    SUPABASE_JWT_SECRET: JWT_SECRET,
    SUPABASE_URL: 'http://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: impl,
  };
}

function decodePayload(token) {
  const body = String(token || '').split('.')[0];
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
}

function derivedVerifier(nonce) {
  return createHmac('sha256', SECRET).update('pkce:' + nonce).digest('base64url');
}

async function bearer(addr, now = NOW) {
  const signed = await signJwt(JWT_SECRET, addr, now);
  return { authorization: 'Bearer ' + signed.token };
}

function holderWrites(calls) {
  return calls.filter((call) => call.href === 'http://supabase.test/rest/v1/holders');
}

function scriptedFetch(routes) {
  const calls = [];
  const env = oauthEnv(async (url, opts = {}) => {
    const u = new URL(url);
    const body = opts.body == null ? '' : String(opts.body);
    calls.push({
      href: u.origin + u.pathname,
      search: u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      body,
    });
    if (/supabase\.co|mainnet|api\.twitter\.com/i.test(u.hostname)) throw new Error('live network blocked');
    const hit = routes(u, opts, body);
    if (!hit) return Response.json({ message: 'unexpected ' + u.href }, { status: 500 });
    return hit;
  });
  return { env, calls };
}

function xRoutes({ username = 'real_user', tokenStatus = 200, meStatus = 200, writeStatus = 201 } = {}) {
  return (u) => {
    if (u.origin + u.pathname === 'https://api.x.com/2/oauth2/token') {
      if (tokenStatus !== 200) return Response.json({ error: 'bad code' }, { status: tokenStatus });
      return Response.json({ access_token: 'x-access-token', token_type: 'bearer' });
    }
    if (u.origin + u.pathname === 'https://api.x.com/2/users/me') {
      if (meStatus !== 200) return Response.json({ error: 'no user' }, { status: meStatus });
      return Response.json({ data: { id: '99', username } });
    }
    if (u.origin + u.pathname === 'http://supabase.test/rest/v1/holders') {
      if (writeStatus !== 201) return Response.json({ message: 'write failed' }, { status: writeStatus });
      return Response.json([{ ok: true }], { status: 201 });
    }
    return null;
  };
}

async function start(env, addr, now = NOW, queryWallet = '') {
  const url = new URL('http://auth.test/auth/x/start');
  if (queryWallet) url.searchParams.set('wallet', queryWallet);
  const res = await handleXOauth(new Request(url, { headers: await bearer(addr, now) }), env, now);
  const data = await res.json();
  return { res, data };
}

async function runCallback(env, authUrl, now) {
  const callback = new URL('http://auth.test/auth/x/callback');
  callback.searchParams.set('code', 'auth-code');
  callback.searchParams.set('state', new URL(authUrl).searchParams.get('state'));
  callback.searchParams.set('handle', '@attacker');
  callback.searchParams.set('code_verifier', 'attacker-verifier');
  return handleXOauth(new Request(callback), env, now);
}

function xlinkFrom(res) {
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  assert.equal(loc.origin, 'https://bard.is');
  assert.equal(loc.pathname, '/dashboard.html');
  assert.equal(loc.search, '');
  assert.equal(loc.hash.startsWith('#xlink='), true);
  const token = new URLSearchParams(loc.hash.slice(1)).get('xlink');
  assert.ok(token);
  return { loc, token };
}

function assertError(res) {
  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('location'));
  assert.equal(loc.searchParams.get('auth'), 'error');
  assert.equal(loc.hash, '');
  return loc;
}

async function confirm(env, addr, token, now) {
  const headers = await bearer(addr, now);
  headers['content-type'] = 'application/json';
  const res = await handleXOauth(new Request('http://auth.test/auth/x/confirm', {
    method: 'POST',
    headers,
    body: JSON.stringify({ token }),
  }), env, now);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { res, data };
}

test('normalizeXHandle accepts an X username and rejects anything else', () => {
  assert.equal(normalizeXHandle('real_user'), '@real_user');
  assert.equal(normalizeXHandle('@Real_User'), '@Real_User');
  assert.equal(normalizeXHandle('has space'), null);
  assert.equal(normalizeXHandle('abcdefghijklmnop'), null);
  assert.equal(normalizeXHandle(''), null);
  assert.equal(normalizeXHandle('@'), null);
});

test('start requires the wallet JWT and ignores the query wallet', async () => {
  const restore = installFetchGuard();
  try {
    const addrA = wallet();
    const addrB = wallet();
    const { env, calls } = scriptedFetch(xRoutes());
    const none = await handleXOauth(new Request('http://auth.test/auth/x/start?wallet=' + addrA), env, NOW);
    assert.equal(none.status, 401);
    const bad = await handleXOauth(new Request('http://auth.test/auth/x/start', {
      headers: { authorization: 'Bearer not-a-jwt' },
    }), env, NOW);
    assert.equal(bad.status, 401);
    const wrongKey = await signJwt(SECRET, addrA, NOW);
    const wrong = await handleXOauth(new Request('http://auth.test/auth/x/start', {
      headers: { authorization: 'Bearer ' + wrongKey.token },
    }), env, NOW);
    assert.equal(wrong.status, 401);
    assert.equal(calls.length, 0);

    const started = await start(env, addrA, NOW, addrB);
    assert.equal(started.res.status, 200);
    assert.equal(started.res.headers.get('access-control-allow-origin'), 'https://bard.is');
    assert.deepEqual(Object.keys(started.data), ['authUrl']);
    const authUrl = new URL(started.data.authUrl);
    assert.equal(authUrl.origin, 'https://x.com');
    assert.equal(authUrl.pathname, '/i/oauth2/authorize');
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authUrl.searchParams.get('scope'), 'tweet.read users.read');
    assert.equal(authUrl.searchParams.get('redirect_uri'), 'https://bard-x-auth.bardsoltoken.workers.dev/auth/x/callback');
    assert.equal(authUrl.searchParams.get('client_id'), 'test-client');
    const state = decodePayload(authUrl.searchParams.get('state'));
    assert.equal(state.typ, 'xstate');
    assert.equal(state.wallet, addrA);
    assert.equal(state.wallet === addrB, false);
    assert.equal(state.cv, undefined);
    const verifier = derivedVerifier(state.nonce);
    assert.equal(authUrl.searchParams.get('code_challenge'), s256(verifier));
    assert.equal(JSON.stringify(state).includes(verifier), false);
    assert.equal(JSON.stringify(started.data).includes(verifier), false);
  } finally {
    restore();
  }
});

test('the callback does not write, and confirm writes only for the same wallet', async () => {
  const restore = installFetchGuard();
  try {
    const addrA = wallet();
    const addrB = wallet();
    const when = NOW + 60 * 1000;
    const { env, calls } = scriptedFetch(xRoutes());
    const started = await start(env, addrA, NOW, addrB);
    const stateToken = new URL(started.data.authUrl).searchParams.get('state');
    const res = await runCallback(env, started.data.authUrl, when);
    const linked = xlinkFrom(res);
    const xlink = decodePayload(linked.token);
    assert.equal(xlink.typ, 'xlink');
    assert.equal(xlink.wallet, addrA);
    assert.equal(xlink.handle, '@real_user');
    assert.equal(holderWrites(calls).length, 0);

    const naked = await handleXOauth(new Request('http://auth.test/auth/x/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: linked.token }),
    }), env, when);
    assert.equal(naked.status, 401);
    const other = await confirm(env, addrB, linked.token, when);
    assert.equal(other.res.status, 403);
    const asLink = await confirm(env, addrA, stateToken, when);
    assert.equal(asLink.res.status, 400);
    assert.equal(holderWrites(calls).length, 0);

    const callback = new URL('http://auth.test/auth/x/callback');
    callback.searchParams.set('code', 'auth-code');
    callback.searchParams.set('state', linked.token);
    const reused = await handleXOauth(new Request(callback), env, when);
    assertError(reused);
    assert.equal(holderWrites(calls).length, 0);

    const right = await confirm(env, addrA, linked.token, when);
    assert.equal(right.res.status, 200);
    assert.equal(right.data.handle, '@real_user');
    const token = calls.find((call) => call.href === 'https://api.x.com/2/oauth2/token');
    const me = calls.find((call) => call.href === 'https://api.x.com/2/users/me');
    const write = holderWrites(calls);
    assert.equal(write.length, 1);
    assert.equal(token.method, 'POST');
    assert.match(token.headers.authorization, /^Basic /);
    assert.equal(token.headers.authorization.includes('service-role-test'), false);
    const form = new URLSearchParams(token.body);
    assert.equal(form.get('code'), 'auth-code');
    assert.equal(form.get('code_verifier'), derivedVerifier(decodePayload(stateToken).nonce));
    assert.equal(form.get('code_verifier') === 'attacker-verifier', false);
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(me.headers.authorization, 'Bearer x-access-token');
    assert.equal(write[0].method, 'POST');
    assert.equal(write[0].search, '?on_conflict=wallet');
    assert.equal(write[0].headers.authorization, 'Bearer service-role-test');
    assert.equal(write[0].headers.apikey, 'service-role-test');
    assert.match(write[0].headers.prefer, /resolution=merge-duplicates/);
    const row = JSON.parse(write[0].body);
    assert.deepEqual(Object.keys(row).sort(), ['wallet', 'x_handle', 'x_linked_at', 'x_via']);
    assert.equal(row.wallet, addrA);
    assert.equal(row.x_handle, '@real_user');
    assert.equal(row.x_via, 'oauth');
    assert.equal(row.x_linked_at, new Date(when).toISOString());
    assert.equal(JSON.stringify(row).includes('@attacker'), false);
    assert.equal(JSON.stringify(row).includes('x-access-token'), false);
    assert.equal(row.wallet === addrB, false);
  } finally {
    restore();
  }
});

test('a bad state, a bad username, or a failed X exchange does not write a handle', async () => {
  const restore = installFetchGuard();
  try {
    const addr = wallet();
    const missing = oauthEnv(async () => {
      throw new Error('fetch should not run');
    });
    delete missing.X_CLIENT_ID;
    const unconfigured = await handleXOauth(new Request('http://auth.test/auth/x/start?wallet=' + addr), missing, NOW);
    assert.equal(unconfigured.status, 503);

    const badWallet = await handleXOauth(new Request('http://auth.test/auth/x/start?wallet=not-a-wallet'), oauthEnv(async () => {
      throw new Error('fetch should not run');
    }), NOW);
    assert.equal(badWallet.status, 401);

    const expiredFetch = scriptedFetch(xRoutes());
    const expiredStart = await start(expiredFetch.env, addr, NOW - 11 * 60 * 1000);
    const expiredUrl = new URL(expiredStart.data.authUrl);
    const expiredCallback = new URL('http://auth.test/auth/x/callback');
    expiredCallback.searchParams.set('code', 'auth-code');
    expiredCallback.searchParams.set('state', expiredUrl.searchParams.get('state'));
    const expired = await handleXOauth(new Request(expiredCallback), expiredFetch.env, NOW);
    assertError(expired);
    assert.equal(expiredFetch.calls.length, 0);

    const tamperFetch = scriptedFetch(xRoutes());
    const tamperStart = await start(tamperFetch.env, addr);
    const state = new URL(tamperStart.data.authUrl).searchParams.get('state');
    const flipped = state.slice(0, -1) + (state.endsWith('a') ? 'b' : 'a');
    const tamperCallback = new URL('http://auth.test/auth/x/callback');
    tamperCallback.searchParams.set('code', 'auth-code');
    tamperCallback.searchParams.set('state', flipped);
    tamperCallback.searchParams.set('handle', '@attacker');
    const tampered = await handleXOauth(new Request(tamperCallback), tamperFetch.env, NOW);
    assertError(tampered);
    assert.equal(tamperFetch.calls.some((call) => call.href.endsWith('/holders')), false);

    const badName = scriptedFetch(xRoutes({ username: 'not a handle' }));
    const named = await start(badName.env, addr);
    const nameCallback = new URL('http://auth.test/auth/x/callback');
    nameCallback.searchParams.set('code', 'auth-code');
    nameCallback.searchParams.set('state', new URL(named.data.authUrl).searchParams.get('state'));
    const rejected = await handleXOauth(new Request(nameCallback), badName.env, NOW);
    assertError(rejected);
    assert.equal(badName.calls.some((call) => call.href.endsWith('/holders')), false);

    const failedWrite = scriptedFetch(xRoutes({ writeStatus: 500 }));
    const wrote = await start(failedWrite.env, addr);
    const failedCallback = await runCallback(failedWrite.env, wrote.data.authUrl, NOW);
    assert.equal(holderWrites(failedWrite.calls).length, 0);
    const failedLink = xlinkFrom(failedCallback);
    const failed = await confirm(failedWrite.env, addr, failedLink.token, NOW);
    assert.equal(failed.res.status, 502);
    assert.equal(failed.data.ok, undefined);

    const viaWorker = await worker.fetch(new Request('http://auth.test/nope'), oauthEnv(async () => {
      throw new Error('fetch should not run');
    }));
    assert.equal(viaWorker.status, 404);

    const lateFetch = scriptedFetch(xRoutes());
    const lateStart = await start(lateFetch.env, addr, NOW);
    const lateCallback = await runCallback(lateFetch.env, lateStart.data.authUrl, NOW);
    const lateLink = xlinkFrom(lateCallback);
    const late = await confirm(lateFetch.env, addr, lateLink.token, NOW + 11 * 60 * 1000);
    assert.equal(late.res.status, 400);
    assert.equal(holderWrites(lateFetch.calls).length, 0);
  } finally {
    restore();
  }
});

test('the dashboard sends the session token and confirms the fragment', () => {
  const html = readFileSync(new URL('../../dashboard.html', import.meta.url), 'utf8');
  const platform = readFileSync(new URL('../../platform.js', import.meta.url), 'utf8');
  assert.match(platform, /getSessionToken: function \(\) \{ return sessionToken; \}/);
  assert.match(html, /BardPlatform\.getSessionToken\(\)/);
  assert.match(html, /Authorization: 'Bearer ' \+ token/);
  assert.match(html, /Authorization: 'Bearer ' \+ session/);
  assert.match(html, /\/auth\/x\/confirm/);
  assert.match(html, /xlinkTokenFromHash/);
  assert.equal(html.includes('bard_cv'), false);
  assert.equal(html.includes('/auth/x/start?wallet='), false);
  assert.equal(html.includes("params.get('handle')"), false);
});
