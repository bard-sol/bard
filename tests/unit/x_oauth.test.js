import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import worker from '../../auth-worker.js';
import { handleXOauth, normalizeXHandle } from '../../server/x_oauth.js';

const NOW = Date.parse('2026-10-25T16:00:00.000Z');
const SECRET = 'state-secret-state-secret-state-secret';

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
    SUPABASE_URL: 'http://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: impl,
  };
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

async function start(env, addr, now = NOW) {
  const res = await handleXOauth(new Request('http://auth.test/auth/x/start?wallet=' + encodeURIComponent(addr)), env, now);
  const data = await res.json();
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

test('the auth callback writes the X username with the service key and ignores the query handle', async () => {
  const restore = installFetchGuard();
  try {
    const addr = wallet();
    const { env, calls } = scriptedFetch(xRoutes());
    const started = await start(env, addr);
    assert.equal(started.res.status, 200);
    assert.equal(started.res.headers.get('access-control-allow-origin'), 'https://bard.is');
    assert.equal(calls.length, 0);
    const authUrl = new URL(started.data.authUrl);
    assert.equal(authUrl.origin, 'https://x.com');
    assert.equal(authUrl.pathname, '/i/oauth2/authorize');
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authUrl.searchParams.get('code_challenge'), s256(started.data.codeVerifier));
    assert.equal(authUrl.searchParams.get('redirect_uri'), 'https://bard-auth.bardsoltoken.workers.dev/auth/x/callback');
    assert.equal(authUrl.searchParams.get('client_id'), 'test-client');

    const callback = new URL('http://auth.test/auth/x/callback');
    callback.searchParams.set('code', 'auth-code');
    callback.searchParams.set('state', authUrl.searchParams.get('state'));
    callback.searchParams.set('handle', '@attacker');
    callback.searchParams.set('code_verifier', 'attacker-verifier');
    const res = await handleXOauth(new Request(callback), env, NOW + 60 * 1000);
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get('location'));
    assert.equal(loc.origin, 'https://bard.is');
    assert.equal(loc.pathname, '/dashboard.html');
    assert.equal(loc.searchParams.get('auth'), 'success');
    assert.equal(loc.searchParams.get('handle'), '@real_user');
    assert.equal(loc.searchParams.get('wallet'), addr);

    const token = calls.find((call) => call.href === 'https://api.x.com/2/oauth2/token');
    const me = calls.find((call) => call.href === 'https://api.x.com/2/users/me');
    const write = calls.find((call) => call.href === 'http://supabase.test/rest/v1/holders');
    assert.equal(token.method, 'POST');
    assert.match(token.headers.authorization, /^Basic /);
    assert.equal(token.headers.authorization.includes('service-role-test'), false);
    const form = new URLSearchParams(token.body);
    assert.equal(form.get('code'), 'auth-code');
    assert.equal(form.get('code_verifier'), started.data.codeVerifier);
    assert.equal(form.get('code_verifier') === 'attacker-verifier', false);
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(me.headers.authorization, 'Bearer x-access-token');
    assert.equal(write.method, 'POST');
    assert.equal(write.search, '?on_conflict=wallet');
    assert.equal(write.headers.authorization, 'Bearer service-role-test');
    assert.equal(write.headers.apikey, 'service-role-test');
    assert.match(write.headers.prefer, /resolution=merge-duplicates/);
    const row = JSON.parse(write.body);
    assert.deepEqual(Object.keys(row).sort(), ['wallet', 'x_handle', 'x_linked_at', 'x_via']);
    assert.equal(row.wallet, addr);
    assert.equal(row.x_handle, '@real_user');
    assert.equal(row.x_via, 'oauth');
    assert.equal(row.x_linked_at, new Date(NOW + 60 * 1000).toISOString());
    assert.equal(JSON.stringify(row).includes('@attacker'), false);
    assert.equal(JSON.stringify(row).includes('x-access-token'), false);
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
    assert.equal(badWallet.status, 400);

    const expiredFetch = scriptedFetch(xRoutes());
    const expiredStart = await start(expiredFetch.env, addr, NOW - 11 * 60 * 1000);
    const expiredUrl = new URL(expiredStart.data.authUrl);
    const expiredCallback = new URL('http://auth.test/auth/x/callback');
    expiredCallback.searchParams.set('code', 'auth-code');
    expiredCallback.searchParams.set('state', expiredUrl.searchParams.get('state'));
    const expired = await handleXOauth(new Request(expiredCallback), expiredFetch.env, NOW);
    assert.equal(expired.status, 302);
    assert.equal(new URL(expired.headers.get('location')).searchParams.get('auth'), 'error');
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
    assert.equal(new URL(tampered.headers.get('location')).searchParams.get('auth'), 'error');
    assert.equal(tamperFetch.calls.some((call) => call.href.endsWith('/holders')), false);

    const badName = scriptedFetch(xRoutes({ username: 'not a handle' }));
    const named = await start(badName.env, addr);
    const nameCallback = new URL('http://auth.test/auth/x/callback');
    nameCallback.searchParams.set('code', 'auth-code');
    nameCallback.searchParams.set('state', new URL(named.data.authUrl).searchParams.get('state'));
    const rejected = await handleXOauth(new Request(nameCallback), badName.env, NOW);
    assert.equal(new URL(rejected.headers.get('location')).searchParams.get('auth'), 'error');
    assert.equal(badName.calls.some((call) => call.href.endsWith('/holders')), false);

    const failedWrite = scriptedFetch(xRoutes({ writeStatus: 500 }));
    const wrote = await start(failedWrite.env, addr);
    const writeCallback = new URL('http://auth.test/auth/x/callback');
    writeCallback.searchParams.set('code', 'auth-code');
    writeCallback.searchParams.set('state', new URL(wrote.data.authUrl).searchParams.get('state'));
    const failed = await handleXOauth(new Request(writeCallback), failedWrite.env, NOW);
    assert.equal(new URL(failed.headers.get('location')).searchParams.get('auth'), 'error');

    const viaWorker = await worker.fetch(new Request('http://auth.test/nope'), oauthEnv(async () => {
      throw new Error('fetch should not run');
    }));
    assert.equal(viaWorker.status, 404);
  } finally {
    restore();
  }
});
