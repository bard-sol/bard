import assert from 'node:assert/strict';
import { test } from 'node:test';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createNonce, readNonce, signInMessage, signJwt, verifyJwt, SIGNIN_DOMAIN } from '../../server/auth.js';
import { handleRequest } from '../../server/api.js';

const SECRET = 'test-secret-test-secret-test-secret';

function installFetchGuard() {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const host = String(url);
    if (/supabase\.co|mainnet|solana-rpc\.publicnode/i.test(host)) {
      throw new Error('live network blocked: ' + host);
    }
    throw new Error('unexpected fetch: ' + host);
  };
  return () => { globalThis.fetch = orig; };
}

function keypair() {
  const pair = nacl.sign.keyPair();
  return { publicKey: bs58.encode(pair.publicKey), secretKey: pair.secretKey };
}

function sign(message, secretKey) {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), secretKey));
}

function memoryEnv() {
  const nonces = new Set();
  const calls = [];
  const env = {
    SUPABASE_URL: 'http://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    SUPABASE_JWT_SECRET: SECRET,
    BARD_SIGNER_PUBKEY: 'BardSigner11111111111111111111111111111111',
    fetch: async (url, opts = {}) => {
      const u = new URL(url);
      calls.push(u.hostname + u.pathname);
      if (/\.supabase\.co$|mainnet/i.test(u.hostname)) throw new Error('live network blocked');
      if (u.pathname.startsWith('/rest/v1/auth_nonces') && opts.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      if (u.pathname.startsWith('/rest/v1/auth_nonces') && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        if (nonces.has(body.jti)) {
          return Response.json({ code: '23505', message: 'duplicate' }, { status: 409 });
        }
        nonces.add(body.jti);
        return Response.json([body]);
      }
      return Response.json({ message: 'missing ' + u.pathname }, { status: 500 });
    },
  };
  return { env, nonces, calls };
}

async function post(env, path, body) {
  const res = await handleRequest(new Request('http://127.0.0.1' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), env);
  const data = await res.json();
  return { status: res.status, data };
}

test('nonce rejects reuse, expiry, a wrong domain and a wrong signature', async () => {
  const restore = installFetchGuard();
  try {
    const wallet = keypair();
    const fresh = await createNonce(SECRET, wallet.publicKey, Date.now());
    assert.equal(fresh.domain, SIGNIN_DOMAIN);
    assert.ok(fresh.payload.exp - fresh.payload.iat <= 5 * 60 * 1000);
    const message = signInMessage({
      domain: SIGNIN_DOMAIN,
      wallet: wallet.publicKey,
      nonce: fresh.nonce,
      issuedAt: fresh.issuedAt,
    });
    const signature = sign(message, wallet.secretKey);
    const { env, calls } = memoryEnv();

    const ok = await post(env, '/api/auth/verify', {
      wallet: wallet.publicKey,
      nonce: fresh.nonce,
      issuedAt: fresh.issuedAt,
      signature,
      domain: SIGNIN_DOMAIN,
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.wallet, wallet.publicKey);
    const claims = await verifyJwt(SECRET, ok.data.token, fresh.payload.iat);
    assert.equal(claims.role, 'authenticated');
    assert.equal(claims.sub, wallet.publicKey);
    assert.equal(claims.wallet, wallet.publicKey);
    assert.ok(claims.exp - claims.iat <= 60 * 60);
    assert.ok(calls.every((hit) => !/supabase\.co|mainnet/.test(hit)));

    const reused = await post(env, '/api/auth/verify', {
      wallet: wallet.publicKey,
      nonce: fresh.nonce,
      issuedAt: fresh.issuedAt,
      signature,
      domain: SIGNIN_DOMAIN,
    });
    assert.equal(reused.status, 400);
    assert.equal(reused.data.error, 'nonce already used');

    const expiredNonce = await createNonce(SECRET, wallet.publicKey, Date.now() - 6 * 60 * 1000);
    const expired = await post(env, '/api/auth/verify', {
      wallet: wallet.publicKey,
      nonce: expiredNonce.nonce,
      issuedAt: expiredNonce.issuedAt,
      signature: sign(expiredNonce.message, wallet.secretKey),
    });
    assert.equal(expired.status, 400);
    assert.equal(expired.data.error, 'nonce expired');

    const other = await createNonce(SECRET, wallet.publicKey);
    const wrongDomain = await post(env, '/api/auth/verify', {
      wallet: wallet.publicKey,
      nonce: other.nonce,
      issuedAt: other.issuedAt,
      signature: sign(other.message, wallet.secretKey),
      domain: 'evil.example',
    });
    assert.equal(wrongDomain.status, 400);
    assert.equal(wrongDomain.data.error, 'wrong domain');

    const badSig = await post(env, '/api/auth/verify', {
      wallet: wallet.publicKey,
      nonce: other.nonce,
      issuedAt: other.issuedAt,
      signature: sign('not the sign-in message', wallet.secretKey),
      domain: SIGNIN_DOMAIN,
    });
    assert.equal(badSig.status, 400);
    assert.equal(badSig.data.error, 'bad signature');

    const stale = await readNonce(SECRET, expiredNonce.nonce, Date.now());
    assert.equal(stale.ok, false);
    const jwt = await signJwt(SECRET, wallet.publicKey);
    assert.equal((await verifyJwt(SECRET, jwt.token, Date.now() + 2 * 60 * 60 * 1000)), null);
  } finally {
    restore();
  }
});
