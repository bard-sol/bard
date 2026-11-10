import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyHost, createWorld, PROD_SUPABASE_URL } from '../../vault-src/sim/lib/world.mjs';
import { makeRng } from '../../vault-src/sim/lib/rng.mjs';
import { buildWhere, parseList, RestError } from '../../vault-src/sim/lib/postgrest.mjs';
import { FEE_TREASURY } from '../../server/chain.js';

// The launch simulation (TRAA-2319) must never reach production or mainnet, never sign with the
// fee wallet, and must replay exactly from a seed. These pin the pieces that promise that.

test('the sim network guard allows loopback and devnet only', () => {
  for (const url of ['http://127.0.0.1:8787/api/config', 'http://localhost:9/x', 'https://api.devnet.solana.com']) {
    assert.equal(classifyHost(url).ok, true, url);
  }
  for (const url of [
    PROD_SUPABASE_URL + '/rest/v1/projects',
    'https://abc.supabase.co',
    'https://api.mainnet-beta.solana.com',
    'https://mainnet.helius-rpc.com/?api-key=x',
    'https://api.testnet.solana.com',
    'http://api.devnet.solana.com',
    'https://127.0.0.1/',
    'https://bard.is/api/config',
    'https://api.x.com/2/users/me',
    'not a url',
  ]) {
    assert.equal(classifyHost(url).ok, false, url);
  }
  assert.match(PROD_SUPABASE_URL, /supabase\.co$/);
});

test('the sim refuses to start with the fee wallet as the Bard signer', async () => {
  const chain = { name: 'local', rpcFetch: async () => new Response('{}'), close: async () => {} };
  await assert.rejects(createWorld({ chain, bardWallet: FEE_TREASURY }), /signer guard/);
  const cut = '6ySHLyMmvzWPbuTLysdarmfMFSoCSwZfgvsmKCjGe6rG';
  await assert.rejects(createWorld({ chain, bardWallet: cut, cutWallet: cut }), /signer guard/);
});

test('a seed replays the same choices and a different seed does not', () => {
  const draw = (seed) => {
    const rng = makeRng(seed, 'scenario');
    return [rng.int(1, 1000), rng.pick(['a', 'b', 'c', 'd']), rng.shuffle([1, 2, 3, 4, 5, 6]).join(''), Buffer.from(rng.seedBytes('holder-01')).toString('hex')];
  };
  assert.deepEqual(draw('t1'), draw('t1'));
  assert.notDeepEqual(draw('t1'), draw('t2'));
  assert.notDeepEqual(makeRng('t1', 'a').int(0, 1e9), makeRng('t1', 'b').int(0, 1e9));
});

test('the PostgREST shim binds filter values and refuses syntax it does not model', () => {
  assert.deepEqual(parseList('(a,"b,c",d)'), ['a', 'b,c', 'd']);
  const params = [];
  const where = buildWhere(new URLSearchParams('select=*&wallet=eq.x\'; drop table projects;--&status=in.(a,b)&qualified=is.true&order=wallet.asc'), params);
  assert.equal(where, ' WHERE "wallet" = $1 AND "status" IN ($2, $3) AND "qualified" IS TRUE');
  assert.deepEqual(params, ["x'; drop table projects;--", 'a', 'b']);
  assert.throws(() => buildWhere(new URLSearchParams('or=(a.eq.1,b.eq.2)'), []), RestError);
  assert.throws(() => buildWhere(new URLSearchParams('"x"=eq.1'), []), RestError);
  assert.throws(() => buildWhere(new URLSearchParams('a=fts.word'), []), RestError);
});
