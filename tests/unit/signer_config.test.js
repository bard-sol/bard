import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { handleRequest } from '../../server/api.js';
import { FEE_TREASURY } from '../../server/chain.js';
import { signerConfigProblem } from '../../server/config.js';
import { readVarsSections, run } from '../../scripts/check-signer-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FEE_MESSAGE = 'bard signer must not be the fee treasury: BARD_SIGNER_PUBKEY equals FEE_TREASURY';
const CUT_MESSAGE = 'bard signer must not be the cut wallet: BARD_SIGNER_PUBKEY equals BARD_CUT_WALLET';

function address() {
  return bs58.encode(nacl.sign.keyPair().publicKey);
}

test('signerConfigProblem names the exact mistake and lets safe or unset signers through', () => {
  const signer = address();
  const cut = address();
  assert.equal(signerConfigProblem({}), null);
  assert.equal(signerConfigProblem({ BARD_SIGNER_PUBKEY: '   ' }), null);
  assert.equal(signerConfigProblem({ BARD_SIGNER_PUBKEY: signer }), null);
  assert.equal(signerConfigProblem({ BARD_SIGNER_PUBKEY: signer, BARD_CUT_WALLET: cut }), null);
  assert.equal(signerConfigProblem({ BARD_SIGNER_PUBKEY: FEE_TREASURY }), FEE_MESSAGE);
  assert.equal(signerConfigProblem({ BARD_SIGNER_PUBKEY: ' ' + FEE_TREASURY + ' ' }), FEE_MESSAGE);
  assert.equal(signerConfigProblem({ BARD_SIGNER_PUBKEY: FEE_TREASURY, BARD_CUT_WALLET: cut }), FEE_MESSAGE, 'the fee treasury stays forbidden when the cut wallet moves');
  assert.equal(signerConfigProblem({ BARD_SIGNER_PUBKEY: cut, BARD_CUT_WALLET: cut }), CUT_MESSAGE);
  assert.equal(signerConfigProblem({ BARD_SIGNER_PUBKEY: 'not-an-address' }), 'BARD_SIGNER_PUBKEY is not a valid Solana address');
});

function postRoutesInSource() {
  const source = readFileSync(path.join(root, 'server/api.js'), 'utf8');
  const router = source.slice(source.indexOf('export async function handleRequest'));
  const routes = [];
  for (const match of router.matchAll(/path === '([^']+)' && method === 'POST'/g)) routes.push(match[1]);
  for (const match of router.matchAll(/const (\w+) = path\.match\(\/\^(.+?)\$\/\);\s*\n\s*if \(\1 && method === 'POST'\)/g)) {
    routes.push(match[2].replace(/\(\[\^\/\]\+\)/g, 'x1').replace(/\\\//g, '/'));
  }
  return routes;
}

const GUARDED_POST_ROUTES = [
  '/api/campaigns',
  '/api/projects/x1/vault',
  '/api/vault/bard-sign',
  '/api/vault/reserve',
  '/api/settlements/propose',
  '/api/settlements/x1/team-signed',
  '/api/settlements/x1/team-sign',
  '/api/settlements/x1/bard-signed',
  '/api/settlements/x1/executed',
  '/api/settlements/x1/execute',
];

const OPEN_POST_ROUTES = [
  '/api/auth/nonce',
  '/api/auth/verify',
  '/api/projects',
  '/api/joins/status',
  '/api/joins/progress',
  '/api/joins/qualify',
  '/api/campaigns/x1/draw/commit',
  '/api/campaigns/x1/draw/finalize',
];

function blockedEnv(extra) {
  const calls = [];
  return {
    calls,
    env: {
      SUPABASE_URL: 'http://supabase.test',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
      SUPABASE_JWT_SECRET: 'test-secret-test-secret-test-secret',
      SOLANA_RPC: 'http://rpc.test/solana',
      ...extra,
      fetch: async (url) => {
        calls.push(String(url));
        throw new Error('no network in this test');
      },
    },
  };
}

function post(route) {
  return new Request('http://127.0.0.1' + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
}

test('every POST route is classified as signer-guarded or open, so a new route cannot skip the decision', () => {
  assert.deepEqual(postRoutesInSource().sort(), [...GUARDED_POST_ROUTES, ...OPEN_POST_ROUTES].sort());
});

test('every vault-link and settlement route refuses a signer that equals the fee treasury', async () => {
  for (const route of GUARDED_POST_ROUTES) {
    const { env, calls } = blockedEnv({ BARD_SIGNER_PUBKEY: FEE_TREASURY });
    const res = await handleRequest(post(route), env);
    assert.equal(res.status, 500, route);
    assert.deepEqual(await res.json(), { error: FEE_MESSAGE }, route);
    assert.deepEqual(calls, [], route + ' touched the network before refusing');
  }
});

test('every vault-link and settlement route refuses a signer that equals the cut wallet', async () => {
  const cutWallet = address();
  for (const route of GUARDED_POST_ROUTES) {
    const { env, calls } = blockedEnv({ BARD_SIGNER_PUBKEY: cutWallet, BARD_CUT_WALLET: cutWallet });
    const res = await handleRequest(post(route), env);
    assert.equal(res.status, 500, route);
    assert.deepEqual(await res.json(), { error: CUT_MESSAGE }, route);
    assert.deepEqual(calls, [], route + ' touched the network before refusing');
  }
});

test('a malformed signer is refused on the same routes', async () => {
  for (const route of GUARDED_POST_ROUTES) {
    const { env } = blockedEnv({ BARD_SIGNER_PUBKEY: 'not-an-address' });
    const res = await handleRequest(post(route), env);
    assert.equal(res.status, 500, route);
    assert.deepEqual(await res.json(), { error: 'BARD_SIGNER_PUBKEY is not a valid Solana address' }, route);
  }
});

test('a safe signer reaches the normal sign-in check on the guarded routes', async () => {
  for (const route of GUARDED_POST_ROUTES) {
    const { env } = blockedEnv({ BARD_SIGNER_PUBKEY: address(), BARD_CUT_WALLET: address() });
    const res = await handleRequest(post(route), env);
    assert.equal(res.status, 401, route);
  }
});

test('routes that move no vault money keep working with an unsafe signer', async () => {
  for (const route of OPEN_POST_ROUTES) {
    const { env } = blockedEnv({ BARD_SIGNER_PUBKEY: FEE_TREASURY });
    const res = await handleRequest(post(route), env);
    const body = await res.json();
    assert.equal(String(body.error || '').includes('BARD_SIGNER_PUBKEY'), false, route + ' was blocked by the signer guard');
  }
  const { env } = blockedEnv({ BARD_SIGNER_PUBKEY: FEE_TREASURY });
  const verify = await handleRequest(new Request('http://127.0.0.1/api/settlements/x1/verify'), env);
  assert.equal(String((await verify.json()).error || '').includes('BARD_SIGNER_PUBKEY'), false, 'public proof stays readable');
});

test('GET /api/config blanks an unsafe signer and says why', async () => {
  const cut = address();
  for (const [extra, message] of [
    [{ BARD_SIGNER_PUBKEY: FEE_TREASURY }, FEE_MESSAGE],
    [{ BARD_SIGNER_PUBKEY: cut, BARD_CUT_WALLET: cut }, CUT_MESSAGE],
  ]) {
    const { env } = blockedEnv(extra);
    const res = await handleRequest(new Request('http://127.0.0.1/api/config'), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.bardSignerPubkey, '');
    assert.equal(body.signerError, message);
    assert.equal(body.cutBps, 500);
  }
  const signer = address();
  const { env } = blockedEnv({ BARD_SIGNER_PUBKEY: signer });
  const ok = await (await handleRequest(new Request('http://127.0.0.1/api/config'), env)).json();
  assert.equal(ok.bardSignerPubkey, signer);
  assert.equal(ok.signerError, null);
  const unset = await (await handleRequest(new Request('http://127.0.0.1/api/config'), blockedEnv({}).env)).json();
  assert.equal(unset.bardSignerPubkey, '');
  assert.equal(unset.signerError, null, 'an unset signer is the waiting state, not a misconfiguration');
});

const TOML = [
  'name = "bard"',
  '[assets]',
  'directory = "."',
  '',
  '[vars]',
  'A = "one" # comment',
  "B = 'two'",
  'C = 500',
  '"QUOTED-KEY" = "q\\"uote"',
  '',
  '[[kv_namespaces]]',
  'binding = "KV"',
  '',
  '[env.staging.vars]',
  'A = "staging"',
  '',
  '[env.staging]',
  'route = "x"',
].join('\n');

test('readVarsSections reads [vars] and [env.*.vars] and nothing else', () => {
  assert.deepEqual(readVarsSections(TOML), {
    vars: { A: 'one', B: 'two', C: '500', 'QUOTED-KEY': 'q"uote' },
    'env.staging.vars': { A: 'staging' },
  });
  assert.deepEqual(readVarsSections('name = "x"\r\n[vars]\r\nA = "1"\r\n'), { vars: { A: '1' } });
  assert.deepEqual(readVarsSections('name = "x"'), {});
});

test('readVarsSections refuses shapes it cannot read, so the check cannot pass by accident', () => {
  assert.throws(() => readVarsSections('vars = { BARD_SIGNER_PUBKEY = "x" }'), /inline table/);
  assert.throws(() => readVarsSections('[env.production]\nvars = { A = "1" }'), /inline table/);
  assert.throws(() => readVarsSections('vars.A = "1"'), /inline table/);
  assert.throws(() => readVarsSections('[vars]\nA = ["x"]'), /arrays and inline tables/);
  assert.throws(() => readVarsSections('[vars]\nA = "oops'), /unterminated/);
  assert.throws(() => readVarsSections('[vars]\nA = """x"""'), /multi-line/);
  assert.throws(() => readVarsSections('[vars]\nA = "x" trailing'), /unexpected text/);
  assert.throws(() => readVarsSections('[vars]\nthis is not toml'), /cannot read this line/);
  assert.throws(() => readVarsSections('[vars\nA = "1"'), /unrecognised table header/);
});

async function check({ toml = '[vars]\nBARD_CUT_BPS = "500"\n', env = {}, argv = [], fetchImpl, readText } = {}) {
  const lines = [];
  const code = await run({ argv, env, fetchImpl, readText: readText || (() => toml), log: (line) => lines.push(line) });
  return { code, out: lines.join('\n') };
}

test('check:signer fails on wrangler.toml when the signer is the fee treasury or the cut wallet', async () => {
  const cut = address();
  const fee = await check({ toml: '[vars]\nBARD_SIGNER_PUBKEY = "' + FEE_TREASURY + '"\n' });
  assert.equal(fee.code, 1);
  assert.match(fee.out, /FAIL wrangler\.toml \[vars\]: bard signer must not be the fee treasury/);

  const sameCut = await check({ toml: '[vars]\nBARD_CUT_WALLET = "' + cut + '"\nBARD_SIGNER_PUBKEY = "' + cut + '"\n' });
  assert.equal(sameCut.code, 1);
  assert.match(sameCut.out, /bard signer must not be the cut wallet/);

  const staging = await check({ toml: '[vars]\nA = "1"\n[env.staging.vars]\nBARD_SIGNER_PUBKEY = "' + FEE_TREASURY + '"\n' });
  assert.equal(staging.code, 1);
  assert.match(staging.out, /FAIL wrangler\.toml \[env\.staging\.vars\]/);
  assert.match(staging.out, /ok .*\[vars\]/);
});

test('check:signer passes a safe signer and an unset one, and reports invalid cut settings', async () => {
  const signer = address();
  const safe = await check({ toml: '[vars]\nBARD_SIGNER_PUBKEY = "' + signer + '"\n' });
  assert.equal(safe.code, 0);
  assert.match(safe.out, new RegExp('ok   .*signer ' + signer + ' differs from the fee treasury'));
  assert.match(safe.out, /signer config is safe/);

  const unset = await check();
  assert.equal(unset.code, 0);
  assert.match(unset.out, /BARD_SIGNER_PUBKEY is not set here/);

  const noVars = await check({ toml: 'name = "bard"\n' });
  assert.equal(noVars.code, 0);

  const badBps = await check({ toml: '[vars]\nBARD_CUT_BPS = "20000"\n' });
  assert.equal(badBps.code, 1);
  assert.match(badBps.out, /BARD_CUT_BPS is invalid/);

  const badWallet = await check({ toml: '[vars]\nBARD_CUT_WALLET = "nope"\n' });
  assert.equal(badWallet.code, 1);
  assert.match(badWallet.out, /BARD_CUT_WALLET is invalid/);
});

test('check:signer checks a value before it becomes a Cloudflare secret', async () => {
  const unsafe = await check({ env: { BARD_SIGNER_PUBKEY: FEE_TREASURY } });
  assert.equal(unsafe.code, 1);
  assert.match(unsafe.out, /with environment overrides\): bard signer must not be the fee treasury/);

  const cut = address();
  const movedCut = await check({ env: { BARD_SIGNER_PUBKEY: cut, BARD_CUT_WALLET: cut } });
  assert.equal(movedCut.code, 1);
  assert.match(movedCut.out, /bard signer must not be the cut wallet/);

  const safe = await check({ env: { BARD_SIGNER_PUBKEY: address() }, argv: ['--require-signer'] });
  assert.equal(safe.code, 0);

  const missing = await check({ argv: ['--require-signer'] });
  assert.equal(missing.code, 1);
  assert.match(missing.out, /BARD_SIGNER_PUBKEY is not set/);

  const blankEnv = await check({ env: { BARD_SIGNER_PUBKEY: '   ' }, argv: ['--require-signer'] });
  assert.equal(blankEnv.code, 1, 'a blank variable is not a signer');
});

test('check:signer fails closed when wrangler.toml cannot be read', async () => {
  const inline = await check({ toml: 'vars = { BARD_SIGNER_PUBKEY = "' + FEE_TREASURY + '" }\n' });
  assert.equal(inline.code, 1);
  assert.match(inline.out, /FAIL cannot read wrangler\.toml: .*inline table/);

  const missing = await check({ readText: () => { throw new Error('ENOENT'); } });
  assert.equal(missing.code, 1);
  assert.match(missing.out, /cannot read wrangler\.toml: ENOENT/);
});

test('check:signer rejects bad arguments with exit 2', async () => {
  for (const argv of [['--nope'], ['--url'], ['--url', 'ftp://bard.example.test'], ['--expect-network', 'devnet'], ['--url', 'https://bard.example.test', '--expect-network', 'mars']]) {
    const result = await check({ argv });
    assert.equal(result.code, 2, argv.join(' '));
    assert.match(result.out, /usage: check-signer-config/);
  }
});

function liveConfig(over) {
  return {
    bardSignerPubkey: address(),
    signerError: null,
    cutBps: 500,
    cutWallet: FEE_TREASURY,
    solana: { network: 'mainnet-beta', rpc: 'https://api.mainnet-beta.solana.com', genesisHash: 'x', explorerCluster: '', error: null },
    ...over,
  };
}

function liveFetch(body, status = 200) {
  const seen = [];
  async function fetchImpl(url) {
    seen.push(url);
    if (body instanceof Error) throw body;
    return typeof body === 'string' ? new Response(body, { status }) : Response.json(body, { status });
  }
  fetchImpl.seen = seen;
  return fetchImpl;
}

test('check:signer --url reads the live config and compares the network', async () => {
  const fetchImpl = liveFetch(liveConfig());
  const good = await check({ argv: ['--url', 'https://bard.example.test/some/page', '--require-signer', '--expect-network', 'mainnet-beta'], fetchImpl });
  assert.equal(good.code, 0, good.out);
  assert.deepEqual(fetchImpl.seen, ['https://bard.example.test/api/config']);
  assert.match(good.out, /the worker and the browser use mainnet-beta/);

  const wrongNetwork = await check({ argv: ['--url=https://bard.example.test', '--expect-network=devnet'], fetchImpl: liveFetch(liveConfig()) });
  assert.equal(wrongNetwork.code, 1);
  assert.match(wrongNetwork.out, /the worker reads mainnet-beta but devnet was expected/);

  const workerRefuses = await check({ argv: ['--url', 'https://bard.example.test'], fetchImpl: liveFetch(liveConfig({ bardSignerPubkey: '', signerError: FEE_MESSAGE })) });
  assert.equal(workerRefuses.code, 1);
  assert.match(workerRefuses.out, new RegExp('FAIL https://bard\\.example\\.test/api/config: ' + FEE_MESSAGE));

  const oldWorker = await check({ argv: ['--url', 'https://bard.example.test'], fetchImpl: liveFetch(liveConfig({ bardSignerPubkey: FEE_TREASURY })) });
  assert.equal(oldWorker.code, 1, 'the live signer is re-checked even when the worker did not flag it');
  assert.match(oldWorker.out, /bard signer must not be the fee treasury/);

  const noNetwork = await check({ argv: ['--url', 'https://bard.example.test'], fetchImpl: liveFetch(liveConfig({ solana: { network: null, rpc: null, error: 'SOLANA_RPC is not set' } })) });
  assert.equal(noNetwork.code, 1);
  assert.match(noNetwork.out, /solana network unusable: SOLANA_RPC is not set/);

  const missingBlock = await check({ argv: ['--url', 'https://bard.example.test'], fetchImpl: liveFetch(liveConfig({ solana: undefined })) });
  assert.equal(missingBlock.code, 1);
  assert.match(missingBlock.out, /no solana network in the response/);
});

test('check:signer --url handles an unset live signer and an unreachable worker', async () => {
  const waiting = await check({ argv: ['--url', 'https://bard.example.test'], fetchImpl: liveFetch(liveConfig({ bardSignerPubkey: '' })) });
  assert.equal(waiting.code, 0);
  assert.match(waiting.out, /BARD_SIGNER_PUBKEY is not set \(the sign step waits\)/);

  const required = await check({ argv: ['--url', 'https://bard.example.test', '--require-signer'], fetchImpl: liveFetch(liveConfig({ bardSignerPubkey: '' })) });
  assert.equal(required.code, 1);
  assert.equal(required.out.match(/FAIL/g).length, 1, 'wrangler.toml not holding the secret is not a second failure');

  for (const fetchImpl of [liveFetch({}, 500), liveFetch(new Error('ECONNREFUSED')), liveFetch('<html>')]) {
    const down = await check({ argv: ['--url', 'https://bard.example.test'], fetchImpl });
    assert.equal(down.code, 1);
    assert.match(down.out, /FAIL https:\/\/bard\.example\.test\/api\/config (answered HTTP 500|could not be read)/);
  }
});

test('this repository passes check:signer as committed', async () => {
  const result = await run({ env: {}, log: () => {} });
  assert.equal(result, 0);
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['check:signer'], 'node scripts/check-signer-config.mjs');
});

test('the command line entry exits non-zero for an unsafe signer', () => {
  const script = path.join(root, 'scripts/check-signer-config.mjs');
  const unsafe = spawnSync(process.execPath, [script], { cwd: root, env: { ...process.env, BARD_SIGNER_PUBKEY: FEE_TREASURY }, encoding: 'utf8' });
  assert.equal(unsafe.status, 1);
  assert.match(unsafe.stdout, /FAIL .*bard signer must not be the fee treasury/);
  const safe = spawnSync(process.execPath, [script, '--require-signer'], { cwd: root, env: { ...process.env, BARD_SIGNER_PUBKEY: address(), BARD_CUT_WALLET: '' }, encoding: 'utf8' });
  assert.equal(safe.status, 0, safe.stdout + safe.stderr);
});
