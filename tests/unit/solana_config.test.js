import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { handleRequest } from '../../server/api.js';
import {
  DEVNET_GENESIS,
  MAINNET_GENESIS,
  TESTNET_GENESIS,
  resolveSolanaConfig,
} from '../../server/network.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SECRET_RPC = 'https://rpc.example.test/v2/KEY-s3cr3t-9f2a';
const PUBLIC_RPC = 'https://open-node.example.test/open';
const UNKNOWN_GENESIS = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';

function address() {
  return bs58.encode(nacl.sign.keyPair().publicKey);
}

// answers: url -> genesis hash, an Error to throw, or null for a JSON-RPC error
function rpcMock(answers) {
  const calls = [];
  async function fetchImpl(url, opts = {}) {
    calls.push({ url, opts });
    const answer = answers[url];
    if (answer instanceof Error) throw answer;
    assert.equal(JSON.parse(opts.body).method, 'getGenesisHash');
    if (answer == null) return Response.json({ jsonrpc: '2.0', id: 1, error: { message: 'node is unhealthy' } });
    return Response.json({ jsonrpc: '2.0', id: 1, result: answer });
  }
  fetchImpl.calls = calls;
  return fetchImpl;
}

function assertNoSecret(value) {
  const text = JSON.stringify(value);
  assert.equal(text.includes('s3cr3t'), false, 'secret leaked: ' + text);
  assert.equal(text.includes('rpc.example.test'), false, 'RPC host leaked: ' + text);
}

test('the network follows the genesis hash of SOLANA_RPC, not the words in its URL', async () => {
  const cases = [
    [MAINNET_GENESIS, { network: 'mainnet-beta', rpc: 'https://api.mainnet-beta.solana.com', explorerCluster: '' }],
    [DEVNET_GENESIS, { network: 'devnet', rpc: 'https://api.devnet.solana.com', explorerCluster: 'devnet' }],
    [TESTNET_GENESIS, { network: 'testnet', rpc: 'https://api.testnet.solana.com', explorerCluster: 'testnet' }],
  ];
  for (const [genesis, expected] of cases) {
    const got = await resolveSolanaConfig({ SOLANA_RPC: SECRET_RPC, fetch: rpcMock({ [SECRET_RPC]: genesis }) });
    assert.deepEqual(got, { ...expected, genesisHash: genesis, error: null });
    assertNoSecret(got);
  }
  const named = 'https://devnet.example.test/v2/KEY-s3cr3t-9f2a';
  const mainnetNamedDevnet = await resolveSolanaConfig({ SOLANA_RPC: named, fetch: rpcMock({ [named]: MAINNET_GENESIS }) });
  assert.equal(mainnetNamedDevnet.network, 'mainnet-beta');
  assert.equal(mainnetNamedDevnet.rpc, 'https://api.mainnet-beta.solana.com');
});

test('the genesis question is a bounded JSON-RPC POST', async () => {
  const fetchImpl = rpcMock({ [SECRET_RPC]: DEVNET_GENESIS });
  await resolveSolanaConfig({ SOLANA_RPC: SECRET_RPC, fetch: fetchImpl });
  assert.equal(fetchImpl.calls.length, 1);
  const { url, opts } = fetchImpl.calls[0];
  assert.equal(url, SECRET_RPC);
  assert.equal(opts.method, 'POST');
  assert.ok(opts.signal, 'a timeout signal is sent so a hung RPC cannot hang /api/config');
});

test('a good answer is remembered and a failure is retried', async () => {
  const answers = { [SECRET_RPC]: new Error('connect ECONNREFUSED ' + SECRET_RPC) };
  const fetchImpl = rpcMock(answers);
  const env = { SOLANA_RPC: SECRET_RPC, fetch: fetchImpl };
  const down = await resolveSolanaConfig(env);
  assert.equal(down.error, 'SOLANA_RPC did not return a genesis hash');
  answers[SECRET_RPC] = MAINNET_GENESIS;
  const up = await resolveSolanaConfig(env);
  assert.equal(up.network, 'mainnet-beta');
  await resolveSolanaConfig(env);
  assert.equal(fetchImpl.calls.length, 2, 'the failure was retried once, the success was cached');
});

test('SOLANA_RPC_PUBLIC is used only when it is on the same network as SOLANA_RPC', async () => {
  const same = await resolveSolanaConfig({
    SOLANA_RPC: SECRET_RPC,
    SOLANA_RPC_PUBLIC: PUBLIC_RPC,
    fetch: rpcMock({ [SECRET_RPC]: MAINNET_GENESIS, [PUBLIC_RPC]: MAINNET_GENESIS }),
  });
  assert.equal(same.rpc, PUBLIC_RPC);
  assert.equal(same.network, 'mainnet-beta');
  assert.equal(same.error, null);
  assertNoSecret(same);

  const other = await resolveSolanaConfig({
    SOLANA_RPC: SECRET_RPC,
    SOLANA_RPC_PUBLIC: PUBLIC_RPC,
    fetch: rpcMock({ [SECRET_RPC]: MAINNET_GENESIS, [PUBLIC_RPC]: DEVNET_GENESIS }),
  });
  assert.equal(other.rpc, null);
  assert.equal(other.error, 'SOLANA_RPC_PUBLIC is on a different Solana network than SOLANA_RPC');
  assertNoSecret(other);

  const dead = await resolveSolanaConfig({
    SOLANA_RPC: SECRET_RPC,
    SOLANA_RPC_PUBLIC: PUBLIC_RPC,
    fetch: rpcMock({ [SECRET_RPC]: MAINNET_GENESIS, [PUBLIC_RPC]: new Error('timeout') }),
  });
  assert.equal(dead.rpc, null);
  assert.equal(dead.error, 'SOLANA_RPC_PUBLIC did not return a genesis hash');

  const notHttp = await resolveSolanaConfig({
    SOLANA_RPC: SECRET_RPC,
    SOLANA_RPC_PUBLIC: 'wss://open-node.example.test',
    fetch: rpcMock({ [SECRET_RPC]: MAINNET_GENESIS }),
  });
  assert.equal(notHttp.rpc, null);
  assert.equal(notHttp.error, 'SOLANA_RPC_PUBLIC is not an http(s) URL');
});

test('an unset or malformed SOLANA_RPC is reported without asking the network', async () => {
  for (const value of [undefined, '', '   ']) {
    const fetchImpl = rpcMock({});
    const got = await resolveSolanaConfig({ SOLANA_RPC: value, fetch: fetchImpl });
    assert.deepEqual(got, { network: null, rpc: null, genesisHash: null, explorerCluster: null, error: 'SOLANA_RPC is not set' });
    assert.equal(fetchImpl.calls.length, 0);
  }
  for (const value of ['not a url', 'ftp://rpc.example.test/KEY-s3cr3t', 'wss://rpc.example.test/KEY-s3cr3t']) {
    const fetchImpl = rpcMock({});
    const got = await resolveSolanaConfig({ SOLANA_RPC: value, fetch: fetchImpl });
    assert.equal(got.error, 'SOLANA_RPC is not an http(s) URL');
    assert.equal(got.rpc, null);
    assertNoSecret(got);
    assert.equal(fetchImpl.calls.length, 0);
  }
});

test('every way the genesis hash can fail gives the same error and leaks nothing', async () => {
  const failures = [
    new Error('connect ECONNREFUSED ' + SECRET_RPC),
    null,
    'html',
    { result: 42 },
  ];
  for (const failure of failures) {
    async function fetchImpl() {
      if (failure instanceof Error) throw failure;
      if (failure === null) return Response.json({ jsonrpc: '2.0', id: 1, error: { message: 'node is unhealthy ' + SECRET_RPC } });
      if (failure === 'html') return new Response('<html>' + SECRET_RPC + '</html>');
      return Response.json(failure);
    }
    const got = await resolveSolanaConfig({ SOLANA_RPC: SECRET_RPC, fetch: fetchImpl });
    assert.equal(got.error, 'SOLANA_RPC did not return a genesis hash');
    assert.equal(got.rpc, null);
    assert.equal(got.network, null);
    assertNoSecret(got);
  }
});

test('a local simulation is passed through; an unknown remote network is not guessed', async () => {
  for (const local of ['http://127.0.0.1:8899', 'http://localhost:8899', 'http://[::1]:8899', 'http://rpc.localhost:8899']) {
    const got = await resolveSolanaConfig({ SOLANA_RPC: local, fetch: rpcMock({ [local]: UNKNOWN_GENESIS }) });
    assert.equal(got.network, 'custom', local);
    assert.equal(got.rpc, local, local);
    assert.equal(got.explorerCluster, null);
    assert.equal(got.error, null);
  }

  const remote = await resolveSolanaConfig({ SOLANA_RPC: SECRET_RPC, fetch: rpcMock({ [SECRET_RPC]: UNKNOWN_GENESIS }) });
  assert.equal(remote.network, 'custom');
  assert.equal(remote.rpc, null);
  assert.match(remote.error, /does not recognise/);
  assertNoSecret(remote);

  const withPublic = await resolveSolanaConfig({
    SOLANA_RPC: SECRET_RPC,
    SOLANA_RPC_PUBLIC: PUBLIC_RPC,
    fetch: rpcMock({ [SECRET_RPC]: UNKNOWN_GENESIS, [PUBLIC_RPC]: UNKNOWN_GENESIS }),
  });
  assert.equal(withPublic.rpc, PUBLIC_RPC);
  assert.equal(withPublic.error, null);

  const localDevnet = 'http://127.0.0.1:8899';
  const proxied = await resolveSolanaConfig({ SOLANA_RPC: localDevnet, fetch: rpcMock({ [localDevnet]: DEVNET_GENESIS }) });
  assert.equal(proxied.network, 'devnet');
  assert.equal(proxied.rpc, 'https://api.devnet.solana.com');
});

test('GET /api/config sends the browser the same network the worker reads and never SOLANA_RPC', async () => {
  const signer = address();
  for (const [genesis, network, cluster] of [
    [MAINNET_GENESIS, 'mainnet-beta', ''],
    [DEVNET_GENESIS, 'devnet', 'devnet'],
  ]) {
    const env = { SOLANA_RPC: SECRET_RPC, BARD_SIGNER_PUBKEY: signer, fetch: rpcMock({ [SECRET_RPC]: genesis }) };
    const res = await handleRequest(new Request('http://127.0.0.1/api/config'), env);
    assert.equal(res.status, 200);
    const text = await res.text();
    assertNoSecret(text);
    const body = JSON.parse(text);
    assert.equal(body.solana.network, network);
    assert.equal(body.solana.genesisHash, genesis);
    assert.equal(body.solana.explorerCluster, cluster);
    assert.equal(body.solana.error, null);
    assert.equal(body.solana.rpc, network === 'devnet' ? 'https://api.devnet.solana.com' : 'https://api.mainnet-beta.solana.com');
    assert.equal(body.bardSignerPubkey, signer);
    assert.equal(body.signerError, null);
  }
});

test('GET /api/config says why the network is unusable instead of guessing one', async () => {
  const env = { SOLANA_RPC: SECRET_RPC, fetch: rpcMock({ [SECRET_RPC]: new Error('down') }) };
  const res = await handleRequest(new Request('http://127.0.0.1/api/config'), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.solana.rpc, null);
  assert.equal(body.solana.error, 'SOLANA_RPC did not return a genesis hash');
  assertNoSecret(body);
});

const PAGE_ADDRESS = address();
const PAGE_MINT = address();
const DEVNET_PAGE = { network: 'devnet', rpc: 'https://api.devnet.solana.com', explorerCluster: 'devnet', error: null };

function loadPage({ config, httpOk = true, solanaWeb3 } = {}) {
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    URL,
    Date,
    Math,
    Number,
    String,
    parseInt,
    JSON,
    Object,
    Array,
    Error,
    Promise,
    encodeURIComponent,
    isNaN,
    BigInt,
    Uint8Array,
    Uint32Array,
    DataView,
    TextEncoder,
    fetch: async (url) => {
      if (url !== '/api/config') return { ok: false, json: async () => ({}) };
      if (config === undefined) throw new Error('offline');
      return { ok: httpOk, json: async () => config };
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      querySelector() { return null; },
      createElement() { return {}; },
      getElementById() { return null; },
      addEventListener() {},
      body: null,
      head: { appendChild(el) { if (typeof el.onload === 'function') el.onload(); } },
    },
  };
  const table = { select() { return table; }, limit() { return table; }, then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve); } };
  sandbox.supabase = { createClient() { return { from() { return table; } }; } };
  if (solanaWeb3) sandbox.solanaWeb3 = solanaWeb3;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(root, 'platform.js'), 'utf8'), sandbox, { filename: 'platform.js' });
  return sandbox.BardPlatform;
}

test('the page has no network of its own before Bard sends one', async () => {
  const BP = loadPage({ config: undefined });
  assert.throws(() => BP.getRpc(), /Solana network is not available: .*did not load/);
  await BP.init();
  assert.throws(() => BP.getRpc(), /Solana network is not available: .*did not load/);
  assert.match(BP.getSolanaProblem(), /did not load/);
  assert.equal(BP.explorerUrl('account', PAGE_ADDRESS), '');
  assert.equal(BP.getSolanaConfig().rpc, null);

  const failing = loadPage({ config: { solana: DEVNET_PAGE }, httpOk: false });
  await failing.init();
  assert.throws(() => failing.getRpc(), /did not load/);
});

test('the page takes network, RPC and explorer links from /api/config', async () => {
  const cases = [
    [DEVNET_PAGE, '?cluster=devnet'],
    [{ network: 'mainnet-beta', rpc: 'https://api.mainnet-beta.solana.com', explorerCluster: '', error: null }, ''],
    [{ network: 'testnet', rpc: 'https://api.testnet.solana.com', explorerCluster: 'testnet', error: null }, '?cluster=testnet'],
  ];
  for (const [solana, suffix] of cases) {
    const BP = loadPage({ config: { bardSignerPubkey: '', cutBps: 500, solana } });
    await BP.init();
    assert.equal(BP.getRpc(), solana.rpc);
    assert.equal(BP.getSolanaProblem(), '');
    assert.equal(BP.getSolanaConfig().network, solana.network);
    assert.equal(BP.explorerUrl('account', PAGE_ADDRESS), 'https://solscan.io/account/' + PAGE_ADDRESS + suffix);
    assert.equal(BP.explorerUrl('tx', 'sig/1'), 'https://solscan.io/tx/sig%2F1' + suffix);
    assert.equal(BP.explorerUrl('token', PAGE_MINT), 'https://solscan.io/token/' + PAGE_MINT + suffix);
    assert.equal(BP.explorerUrl('block', PAGE_ADDRESS), '');
    assert.equal(BP.explorerUrl('tx', ''), '');
  }

  const local = loadPage({ config: { solana: { network: 'custom', rpc: 'http://127.0.0.1:8899', explorerCluster: null, error: null } } });
  await local.init();
  assert.equal(local.getRpc(), 'http://127.0.0.1:8899');
  assert.equal(local.explorerUrl('account', PAGE_ADDRESS), '', 'no public explorer knows a local chain');
});

test('a network problem from the server blocks RPC use and keeps the reason', async () => {
  const reason = 'SOLANA_RPC_PUBLIC is on a different Solana network than SOLANA_RPC';
  const BP = loadPage({ config: { solana: { network: 'mainnet-beta', rpc: null, explorerCluster: '', error: reason } } });
  await BP.init();
  assert.throws(() => BP.getRpc(), new RegExp('Solana network is not available: ' + reason));
  assert.equal(BP.getSolanaProblem(), 'Solana network is not available: ' + reason);

  const noBlock = loadPage({ config: { bardSignerPubkey: address(), cutBps: 500 } });
  await noBlock.init();
  assert.throws(() => noBlock.getRpc(), /Bard did not send Solana network settings/);

  const noRpc = loadPage({ config: { solana: { network: 'devnet', rpc: 'ftp://nope', explorerCluster: 'devnet', error: null } } });
  await noRpc.init();
  assert.throws(() => noRpc.getRpc(), /Bard did not send a Solana RPC/);
});

test('the signer problem from /api/config reaches the page and the signer stays blank', async () => {
  const message = 'bard signer must not be the cut wallet: BARD_SIGNER_PUBKEY equals BARD_CUT_WALLET';
  const broken = loadPage({ config: { bardSignerPubkey: '', signerError: message, cutBps: 500, solana: DEVNET_PAGE } });
  await broken.init();
  assert.equal(broken.getVaultBardMember(), '');
  assert.equal(broken.getSignerProblem(), message);

  const signer = address();
  const healthy = loadPage({ config: { bardSignerPubkey: signer, signerError: null, cutBps: 500, solana: DEVNET_PAGE } });
  await healthy.init();
  assert.equal(healthy.getVaultBardMember(), signer);
  assert.equal(healthy.getSignerProblem(), '');
});

test('on-chain reads connect to the RPC the server chose', async () => {
  const seen = [];
  class Connection {
    constructor(rpc, commitment) { seen.push([rpc, commitment]); }
    async getParsedAccountInfo() { return { value: null }; }
    async getParsedTokenAccountsByOwner() { return { value: [] }; }
    async getBalance() { return 0; }
  }
  class PublicKey { constructor(value) { this.value = value; } }
  const web3 = { Connection, PublicKey };

  const BP = loadPage({ config: { solana: DEVNET_PAGE }, solanaWeb3: web3 });
  await BP.init();
  const info = await BP.fetchVaultOnchain(PAGE_ADDRESS, PAGE_MINT);
  assert.deepEqual(seen, [['https://api.devnet.solana.com', 'confirmed']]);
  assert.equal(info.solscan, 'https://solscan.io/account/' + PAGE_ADDRESS + '?cluster=devnet');

  seen.length = 0;
  const blocked = loadPage({ config: { solana: { network: null, rpc: null, explorerCluster: null, error: 'SOLANA_RPC is not set' } }, solanaWeb3: web3 });
  await blocked.init();
  await assert.rejects(blocked.fetchVaultOnchain(PAGE_ADDRESS, PAGE_MINT), /Solana network is not available: SOLANA_RPC is not set/);
  assert.deepEqual(seen, [], 'no connection is opened without a server-provided RPC');
});

test('no served page or script picks a cluster or an RPC of its own', () => {
  const served = ['platform.js', 'admin_app.js', 'admin.html', 'dashboard.html', 'campaign.html', 'explore.html', 'index.html'];
  const forbidden = [
    'api.devnet.solana.com',
    'api.mainnet-beta.solana.com',
    'api.testnet.solana.com',
    'publicnode.com',
    'cluster=devnet',
  ];
  for (const file of served) {
    const text = readFileSync(path.join(root, file), 'utf8');
    for (const needle of forbidden) assert.equal(text.includes(needle), false, file + ' contains ' + needle);
    if (file !== 'platform.js') {
      assert.equal(text.includes('solscan.io'), false, file + ' must use BardPlatform.explorerUrl');
    }
  }
  const platform = readFileSync(path.join(root, 'platform.js'), 'utf8');
  assert.equal(platform.match(/\bConnection\(/g).length, 1, 'one place opens a Solana connection');
  assert.match(platform, /new global\.solanaWeb3\.Connection\(getRpc\(\)/);
  const toolkit = readFileSync(path.join(root, 'vault-src/src/index.js'), 'utf8');
  assert.match(toolkit, /new Connection\(String\(rpc\)/, 'the vault toolkit connects to the rpc it is given');
});
