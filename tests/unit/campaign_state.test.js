import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { handleRequest, readVaultTokenRaw, rewriteCampaignRequest } from '../../server/api.js';
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from '../../server/chain.js';
import { buildCampaignState, shortWallet } from '../../server/campaign_state.js';
import { sha256Hex } from '../../server/settlement.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-01-03T00:00:00.000Z');
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function installFetchGuard() {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    throw new Error('live network blocked: ' + url);
  };
  return () => { globalThis.fetch = orig; }
}

function keypair() {
  const pair = nacl.sign.keyPair();
  return bs58.encode(pair.publicKey);
}

function mintAccount(decimals, owner) {
  const bytes = new Uint8Array(82);
  bytes[44] = decimals;
  return {
    value: {
      lamports: 2_000_000_000,
      owner,
      data: [Buffer.from(bytes).toString('base64'), 'base64'],
    },
  };
}

function tokenAccount(mint, amount, decimals) {
  return {
    account: {
      data: {
        parsed: {
          info: {
            mint,
            tokenAmount: { amount: String(amount), decimals },
          },
        },
      },
    },
  };
}

function createEnv(opts = {}) {
  const tables = {
    projects: opts.projects || [],
    campaigns: opts.campaigns || [],
    campaign_joins: opts.joins || [],
    vault_settlements: opts.settlements || [],
    holders: opts.holders || [],
  };
  const rpcCalls = [];
  const accounts = opts.accounts || {};
  const tokenAccounts = opts.tokenAccounts || {};
  const env = {
    SUPABASE_URL: 'http://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    SOLANA_RPC: opts.rpc || 'http://rpc.test/solana',
    BARD_CUT_BPS: '9999',
    BARD_CUT_WALLET: keypair(),
    fetch: async (url, requestOpts = {}) => {
      const u = new URL(url);
      if (/supabase\.co|mainnet|publicnode/i.test(u.hostname)) throw new Error('live network blocked');
      if (u.hostname === 'rpc.test') {
        const payload = JSON.parse(requestOpts.body);
        rpcCalls.push(payload.method);
        if (payload.method === 'getBalance') throw new Error('SOL balance must not be read');
        if (payload.method === 'getAccountInfo') {
          return Response.json({ jsonrpc: '2.0', id: 1, result: accounts[payload.params[0]] || { value: null } });
        }
        if (payload.method === 'getTokenAccountsByOwner') {
          const mint = payload.params[1] && payload.params[1].mint;
          const key = payload.params[0] + '|' + mint;
          return Response.json({ jsonrpc: '2.0', id: 1, result: tokenAccounts[key] || { value: [] } });
        }
        return Response.json({ jsonrpc: '2.0', id: 1, error: { message: 'unknown rpc ' + payload.method } });
      }
      const table = u.pathname.replace(/^\/rest\/v1\//, '');
      const rows = tables[table];
      if (!rows) return Response.json({ message: 'missing ' + table }, { status: 500 });
      const filters = [];
      for (const [key, value] of u.searchParams) {
        if (key === 'select' || key === 'on_conflict') continue;
        const dot = value.indexOf('.');
        filters.push({ key, op: value.slice(0, dot), val: value.slice(dot + 1) });
      }
      const matches = (row) => filters.every((filter) => {
        const got = row[filter.key] == null ? '' : String(row[filter.key]);
        if (filter.op === 'eq') return got === filter.val;
        if (filter.op === 'in') {
          const inner = filter.val.replace(/^\(/, '').replace(/\)$/, '');
          const parts = inner.length ? inner.split(',').map((part) => part.trim().replace(/^"|"$/g, '')) : [];
          return parts.includes(got);
        }
        return false;
      });
      if ((requestOpts.method || 'GET') === 'GET') return Response.json(rows.filter(matches));
      return Response.json({ message: 'bad method' }, { status: 500 });
    },
  };
  return { env, rpcCalls, tables };
}

function campaignRow(extra = {}) {
  return {
    id: CID,
    project_id: PID,
    title: 'Hold the line',
    type: 'hold',
    rule_text: 'Hold the named token',
    reward_mode: 'fixed',
    access_mode: 'open',
    status: 'active',
    reward: '500',
    reward_unit: 'SOL',
    duration_days: 7,
    created_at: '2026-01-01T00:00:00.000Z',
    draw_count: 0,
    ...extra,
  };
}

function projectRow(mint, vault, extra = {}) {
  return {
    id: PID,
    name: 'Demo',
    ticker: 'BARD',
    mint,
    vault_mint: null,
    vault_address: vault,
    vault_status: 'verified',
    admin_wallet: extra.admin_wallet || keypair(),
    ...extra,
  };
}

function loadPlatform() {
  const code = readFileSync(path.join(root, 'platform.js'), 'utf8');
  const sandbox = {
    console, URL, Date, Math, Number, String, parseInt, JSON, Object, Array, Error, Promise,
    encodeURIComponent, isNaN, BigInt, Uint8Array, Uint32Array, DataView, TextEncoder,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'platform.js' });
  return sandbox.BardPlatform;
}

test('readVaultTokenRaw counts only the named mint', async () => {
  const restore = installFetchGuard();
  try {
    const mint = keypair();
    const other = keypair();
    const vault = keypair();
    const { env, rpcCalls } = createEnv({
      accounts: { [mint]: mintAccount(6, TOKEN_PROGRAM) },
      tokenAccounts: {
        [vault + '|' + mint]: {
          value: [
            tokenAccount(mint, '10', 6),
            tokenAccount(mint, '15', 6),
            tokenAccount(other, '999', 9),
          ],
        },
      },
    });
    const summed = await readVaultTokenRaw(env, vault, mint);
    assert.equal(summed.raw, '25');
    assert.equal(summed.decimals, 6);
    assert.equal(summed.tokenProgram, TOKEN_PROGRAM);
    assert.deepEqual(rpcCalls, ['getAccountInfo', 'getTokenAccountsByOwner']);

    const emptyEnv = createEnv({
      accounts: { [mint]: mintAccount(6, TOKEN_PROGRAM) },
      tokenAccounts: { [vault + '|' + mint]: { value: [] } },
    });
    const empty = await readVaultTokenRaw(emptyEnv.env, vault, mint);
    assert.equal(empty.raw, '0');
    assert.equal(empty.decimals, 6);

    const oneEnv = createEnv({
      accounts: { [mint]: mintAccount(6, TOKEN_PROGRAM) },
      tokenAccounts: { [vault + '|' + mint]: { value: [tokenAccount(mint, '42', 6)] } },
    });
    assert.equal((await readVaultTokenRaw(oneEnv.env, vault, mint)).raw, '42');

    const big = '100000000000000000000';
    const bigEnv = createEnv({
      accounts: { [mint]: mintAccount(9, TOKEN_2022_PROGRAM) },
      tokenAccounts: {
        [vault + '|' + mint]: { value: [tokenAccount(mint, big, 9), tokenAccount(mint, '1', 9)] },
      },
    });
    const token2022 = await readVaultTokenRaw(bigEnv.env, vault, mint);
    assert.equal(token2022.raw, (BigInt(big) + 1n).toString());
    assert.equal(token2022.decimals, 9);
    assert.equal(token2022.tokenProgram, TOKEN_2022_PROGRAM);
  } finally {
    restore();
  }
});

test('campaign state matches the public shape for every payout sentence and clock', async () => {
  const restore = installFetchGuard();
  try {
    const mint = keypair();
    const vault = keypair();
    const holderA = keypair();
    const holderB = keypair();
    const rejected = keypair();
    const admin = keypair();
    const released = 'released';
    const signature = '1'.repeat(87);

    async function build(campaignExtra, opts = {}) {
      const { env, rpcCalls } = createEnv({
        rpc: opts.rpc,
        campaigns: [campaignRow(campaignExtra)],
        projects: [projectRow(mint, vault, { admin_wallet: admin, ...(opts.project || {}) })],
        joins: opts.joins || [],
        settlements: opts.settlements || [],
        holders: opts.holders || [],
        accounts: { [mint]: mintAccount(6, TOKEN_PROGRAM) },
        tokenAccounts: opts.tokenAccounts || {
          [vault + '|' + mint]: { value: [tokenAccount(mint, '1500000', 6)] },
        },
      });
      const body = await buildCampaignState(env, CID, opts.now || NOW, opts.reader || readVaultTokenRaw);
      return { body, rpcCalls, env };
    }

    const fixed = await build({});
    assert.deepEqual(Object.keys(fixed.body), ['as_of', 'campaign', 'clock', 'prize', 'vault', 'counts', 'board', 'settlement', 'links']);
    assert.deepEqual(Object.keys(fixed.body.campaign), ['id', 'title', 'type', 'rule_text', 'reward_mode', 'access_mode', 'status', 'project']);
    assert.deepEqual(Object.keys(fixed.body.clock), ['state', 'starts_at', 'ends_at', 'no_end', 'ends_at_source', 'server_time']);
    assert.deepEqual(Object.keys(fixed.body.prize), ['mint', 'symbol', 'decimals', 'locked', 'prize_raw', 'locked_raw', 'cut_bps', 'cut_raw', 'who_gets_paid', 'who_gets_paid_text']);
    assert.deepEqual(Object.keys(fixed.body.vault), ['address', 'explorer_url', 'balance_raw', 'balance_as_of', 'below_locked']);
    assert.deepEqual(Object.keys(fixed.body.counts), ['joined', 'qualified', 'paid']);
    assert.equal(fixed.body.prize.who_gets_paid, 'everyone');
    assert.equal(fixed.body.prize.who_gets_paid_text, 'every qualified holder gets 500 BARD');
    assert.equal(fixed.body.prize.mint, mint);
    assert.equal(fixed.body.prize.decimals, 6);
    assert.equal(fixed.body.prize.locked, false);
    assert.equal(fixed.body.vault.balance_raw, '1500000');
    assert.equal(fixed.body.vault.address, vault);
    assert.equal(fixed.body.vault.explorer_url, 'https://solscan.io/account/' + vault);
    assert.equal(fixed.body.clock.state, 'live');
    assert.equal(fixed.body.clock.ends_at, '2026-01-08T00:00:00.000Z');
    assert.equal(fixed.body.clock.no_end, false);
    assert.equal(fixed.body.clock.ends_at_source, 'derived');
    assert.equal(fixed.body.links.page, '/c/' + CID);
    assert.equal(fixed.body.links.receipt, null);
    assert.equal(JSON.stringify(fixed.body).includes(admin), false);
    assert.equal(/\bSOL\b/.test(JSON.stringify(fixed.body)), false);

    const modes = [
      ['pool', 'pool', 'pool split among the qualified'],
      ['top3', 'top3', 'top 3 by progress: 50 / 30 / 20'],
      ['growing', 'growing', 'growing pool to the top holder'],
    ];
    for (const [mode, who, text] of modes) {
      const built = await build({ reward_mode: mode });
      assert.equal(built.body.prize.who_gets_paid, who);
      assert.equal(built.body.prize.who_gets_paid_text, text);
    }
    const draw = await build({ draw_count: 4, reward_mode: 'fixed' });
    assert.equal(draw.body.prize.who_gets_paid, 'draw');
    assert.equal(draw.body.prize.who_gets_paid_text, 'draw of 4 from the qualified, seed committed to a Solana slot');

    const open = await build({ duration_days: 0 });
    assert.equal(open.body.clock.no_end, true);
    assert.equal(open.body.clock.ends_at, null);
    assert.equal(open.body.clock.state, 'live');
    const growing = await build({ reward_mode: 'growing', duration_days: 7 });
    assert.equal(growing.body.clock.no_end, true);
    assert.equal(growing.body.clock.ends_at, null);
    const ended = await build({ status: 'ended' });
    assert.equal(ended.body.clock.state, 'ended');
    const upcoming = await build({}, { now: new Date('2025-12-01T00:00:00.000Z') });
    assert.equal(upcoming.body.clock.state, 'upcoming');

    const fakePaid = await build({}, {
      settlements: [{ id: 'set-1', campaign_id: CID, status: 'executed', tx_signature: released, executed_at: '2026-01-02T00:00:00.000Z', payouts: [{ wallet: holderA, progress: 1 }] }],
    });
    assert.equal(fakePaid.body.clock.state, 'live');
    assert.equal(fakePaid.body.links.receipt, null);
    assert.equal(fakePaid.body.counts.paid, 1);
    assert.equal(fakePaid.body.settlement.tx_signature, released);

    const paid = await build({}, {
      settlements: [{ id: 'set-2', campaign_id: CID, status: 'executed', tx_signature: signature, executed_at: '2026-01-02T00:00:00.000Z', payouts: [{ wallet: holderB, progress: 1 }, { wallet: holderA, progress: 9 }] }],
    });
    assert.equal(paid.body.clock.state, 'paid');
    assert.equal(paid.body.links.receipt, '/c/' + CID + '/receipt');
    assert.equal(paid.body.counts.paid, 2);
    assert.deepEqual(paid.body.board.map((row) => row.wallet_hash), [sha256Hex(holderB), sha256Hex(holderA)]);
    assert.equal(Object.hasOwn(paid.body.settlement, 'payouts'), false);

    const statusPaid = await build({ status: 'paid' });
    assert.equal(statusPaid.body.clock.state, 'paid');
    assert.equal(statusPaid.body.links.receipt, null);

    const devnet = await build({}, { rpc: 'http://rpc.test/devnet' });
    assert.equal(devnet.body.vault.explorer_url, 'https://solscan.io/account/' + vault + '?cluster=devnet');

    const prizeMint = keypair();
    const named = await build({ prize_mint: prizeMint }, {
      accounts: undefined,
      reader: async (_env, address, asked) => {
        assert.equal(address, vault);
        assert.equal(asked, prizeMint);
        return { raw: '7', decimals: 0, tokenProgram: TOKEN_PROGRAM };
      },
    });
    assert.equal(named.body.prize.mint, prizeMint);
    assert.equal(named.body.vault.balance_raw, '7');
    assert.equal(named.body.prize.decimals, 0);

    const joins = [
      { campaign_id: CID, wallet: holderA, qualified: false, status: 'approved', progress: 2 },
      { campaign_id: CID, wallet: holderB, qualified: true, status: 'approved', progress: 1 },
      { campaign_id: CID, wallet: rejected, qualified: true, status: 'rejected', progress: 99 },
    ];
    const board = await build({}, {
      joins,
      holders: [
        { wallet: holderA, x_handle: '@hidden', show_handle: false },
        { wallet: holderB, x_handle: '@shown', show_handle: true },
        { wallet: rejected, x_handle: '@nope', show_handle: true },
      ],
    });
    assert.equal(board.body.counts.joined, 2);
    assert.equal(board.body.counts.qualified, 1);
    assert.equal(board.body.counts.paid, 0);
    assert.deepEqual(board.body.board.map((row) => row.wallet_hash), [sha256Hex(holderB), sha256Hex(holderA)]);
    assert.equal(board.body.board[0].handle, '@shown');
    assert.equal(board.body.board[1].handle, null);
    assert.equal(board.body.board[0].wallet_short, shortWallet(holderB));
    assert.equal(board.body.board[0].wallet_hash, createHash('sha256').update(holderB).digest('hex'));
    const dumped = JSON.stringify(board.body);
    for (const secret of [holderA, holderB, rejected, admin]) assert.equal(dumped.includes(secret), false);
    const allowed = new Set([mint, vault]);
    const seen = [];
    const visit = (value) => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
          assert.equal(['admin_wallet', 'reward_unit', 'payouts', 'x_handle', 'cut_wallet'].includes(key), false, key);
          if (typeof item === 'string' && BASE58.test(item)) seen.push(item);
          visit(item);
        }
      }
    };
    visit(board.body);
    for (const item of seen) assert.equal(allowed.has(item), true, item);

    const locked = await build({
      prize_raw: '1500000',
      locked_raw: '2000000',
      cut_bps: 250,
      cut_raw: '500000',
    }, {
      tokenAccounts: { [vault + '|' + mint]: { value: [tokenAccount(mint, '1000000', 6)] } },
    });
    assert.equal(locked.body.prize.locked, true);
    assert.equal(locked.body.prize.prize_raw, '1500000');
    assert.equal(locked.body.prize.locked_raw, '2000000');
    assert.equal(locked.body.prize.cut_bps, 250);
    assert.equal(locked.body.prize.cut_raw, '500000');
    assert.equal(locked.body.vault.below_locked, true);
    assert.equal(locked.body.vault.balance_raw, '1000000');

    const absent = await build({ prize_raw: null, locked_raw: null, cut_bps: null, cut_raw: null });
    assert.equal(absent.body.prize.locked, false);
    assert.equal(absent.body.prize.prize_raw, null);
    assert.equal(absent.body.prize.locked_raw, null);
    assert.equal(absent.body.prize.cut_bps, null);
    assert.equal(absent.body.prize.cut_raw, null);
    assert.equal(absent.body.vault.below_locked, null);

    const zeroCut = await build({ prize_raw: '1', locked_raw: '1', cut_bps: 0, cut_raw: '0' });
    assert.equal(zeroCut.body.prize.cut_bps, 0);
    assert.equal(zeroCut.body.prize.locked, true);

    const unverified = await build({}, { project: { vault_status: 'linked' } });
    assert.equal(unverified.body.vault.address, null);
    assert.equal(unverified.body.vault.explorer_url, null);
    assert.equal(unverified.body.vault.balance_raw, '1500000');
  } finally {
    restore();
  }
});

test('the board caps at 200 and drops rejected joins', async () => {
  const restore = installFetchGuard();
  try {
    const mint = keypair();
    const vault = keypair();
    const joins = [];
    for (let i = 0; i < 201; i += 1) {
      joins.push({
        campaign_id: CID,
        wallet: ('W' + String(i).padStart(31, 'a')),
        qualified: i === 5,
        status: 'approved',
        progress: i,
      });
    }
    const rejected = 'R' + 'b'.repeat(31);
    joins.push({ campaign_id: CID, wallet: rejected, qualified: true, status: 'rejected', progress: 999 });
    const { env } = createEnv({
      campaigns: [campaignRow()],
      projects: [projectRow(mint, vault)],
      joins,
    });
    const body = await buildCampaignState(env, CID, NOW, async () => ({ raw: '0', decimals: 6, tokenProgram: TOKEN_PROGRAM }));
    assert.equal(body.counts.joined, 201);
    assert.equal(body.counts.qualified, 1);
    assert.equal(body.board.length, 200);
    assert.equal(body.board[0].wallet_hash, sha256Hex('W' + String(5).padStart(31, 'a')));
    assert.equal(JSON.stringify(body).includes(rejected), false);
    assert.equal(JSON.stringify(body).includes('W' + String(0).padStart(31, 'a')), false);
  } finally {
    restore();
  }
});

test('a second state read within 60s makes no RPC call', async () => {
  const restore = installFetchGuard();
  try {
    const mint = keypair();
    const vault = keypair();
    const store = new Map();
    const { env, rpcCalls } = createEnv({
      campaigns: [campaignRow()],
      projects: [projectRow(mint, vault)],
      accounts: { [mint]: mintAccount(6, TOKEN_PROGRAM) },
      tokenAccounts: { [vault + '|' + mint]: { value: [] } },
    });
    env.caches = {
      default: {
        async match(req) {
          const hit = store.get(req.url);
          if (!hit) return undefined;
          return new Response(hit.body, { status: hit.status, headers: hit.headers });
        },
        async put(req, res) {
          const headers = {};
          res.headers.forEach((value, key) => { headers[key] = value; });
          store.set(req.url, { body: await res.text(), status: res.status, headers });
        },
      },
    };
    const path = '/api/campaigns/' + CID + '/state';
    const first = await handleRequest(new Request('http://127.0.0.1' + path), env);
    const firstBody = await first.json();
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=30');
    assert.equal(firstBody.vault.balance_raw, '0');
    const afterFirst = rpcCalls.length;
    assert.ok(afterFirst >= 2);
    const second = await handleRequest(new Request('http://127.0.0.1' + path), env);
    assert.equal(second.status, 200);
    assert.equal(rpcCalls.length, afterFirst);
    assert.equal((await second.json()).vault.balance_raw, '0');

    const config = await handleRequest(new Request('http://127.0.0.1/api/config'), env);
    assert.equal(config.headers.get('cache-control'), 'no-store');

    const missing = await handleRequest(new Request('http://127.0.0.1/api/campaigns/cccccccc-cccc-4ccc-8ccc-cccccccccccc/state'), env);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('cache-control'), 'no-store');
    assert.equal(store.has('http://127.0.0.1/api/campaigns/cccccccc-cccc-4ccc-8ccc-cccccccccccc/state'), false);

    const bad = await handleRequest(new Request('http://127.0.0.1/api/campaigns/not-a-uuid/state'), env);
    assert.equal(bad.status, 404);

    const queryStore = new Map();
    env.caches = {
      default: {
        async match(req) {
          const hit = queryStore.get(req.url);
          if (!hit) return undefined;
          return new Response(hit.body, { status: hit.status, headers: hit.headers });
        },
        async put(req, res) {
          const headers = {};
          res.headers.forEach((value, key) => { headers[key] = value; });
          queryStore.set(req.url, { body: await res.text(), status: res.status, headers });
        },
      },
    };
    const withQuery = await handleRequest(new Request('http://127.0.0.1' + path + '?x=1'), env);
    assert.equal(withQuery.status, 200);
    const afterQuery = rpcCalls.length;
    assert.ok(afterQuery > afterFirst);
    const otherQuery = await handleRequest(new Request('http://127.0.0.1' + path + '?x=2'), env);
    assert.equal(otherQuery.status, 200);
    assert.equal(rpcCalls.length, afterQuery);
    assert.equal((await otherQuery.json()).vault.balance_raw, '0');
    assert.deepEqual([...queryStore.keys()], ['http://127.0.0.1' + path]);
  } finally {
    restore();
  }
});

test('campaign paths rewrite to the static page and keep the request url for api calls', () => {
  const id = CID;
  const page = new Request('http://127.0.0.1/c/' + id);
  const rewritten = rewriteCampaignRequest(page);
  assert.equal(new URL(rewritten.url).pathname, '/campaign.html');
  assert.equal(new URL(page.url).pathname, '/c/' + id);
  const receipt = rewriteCampaignRequest(new Request('http://127.0.0.1/c/' + id + '/receipt'));
  assert.equal(new URL(receipt.url).pathname, '/receipt.html');
  const other = new Request('http://127.0.0.1/c/not-a-uuid');
  assert.equal(rewriteCampaignRequest(other), other);
  const worker = readFileSync(path.join(root, 'worker.js'), 'utf8');
  assert.match(worker, /handleRequest\(request, env\)/);
  assert.match(worker, /rewriteCampaignRequest\(request\)/);
  assert.match(worker, /response\.status >= 300 && response\.status < 400/);
});

test('public copy and the page file follow the no-wallet rules', () => {
  const BP = loadPlatform();
  assert.equal(BP.shortWallet(''), '—');
  assert.equal(BP.shortWallet('short'), 'short');
  assert.equal(BP.shortWallet('1234567890'), '1234…7890');
  assert.equal(BP.sha256Hex('abc'), createHash('sha256').update('abc').digest('hex'));
  assert.equal(BP.clockText({ state: 'live', ends_at: '2026-01-08T00:00:00.000Z', no_end: false }), 'ends 8 Jan 2026');
  assert.equal(BP.clockText({ state: 'live', no_end: true, ends_at: null }), 'no end set');
  assert.equal(BP.clockText({ state: 'ended', ends_at: '2026-01-08T00:00:00.000Z' }), 'ended 8 Jan 2026, the team is reviewing');
  assert.equal(BP.clockText({ state: 'paid' }), 'paid');

  const locked = BP.campaignPublicCopy({
    prize: { locked: true, prize_raw: '1500000', locked_raw: '2000000', decimals: 6, symbol: 'BARD', cut_bps: 250, who_gets_paid_text: 'pool split among the qualified' },
    vault: { address: 'vault', balance_raw: '1000000', below_locked: true, explorer_url: 'https://solscan.io/account/vault' },
    clock: { state: 'live', ends_at: '2026-01-08T00:00:00.000Z', no_end: false },
    counts: { qualified: 3 },
  });
  assert.equal(locked.headline, 'Prize for holders: 1.5 BARD');
  assert.equal(locked.detail, 'Locked in a two-key vault: 2 BARD · vault balance now 1 BARD');
  assert.equal(locked.cut, 'Bard takes 2.5% of payouts');
  assert.equal(locked.warning, 'The vault holds less than the locked total right now.');
  assert.equal(locked.qualified, 'Qualified: 3');

  const zeroCut = BP.campaignPublicCopy({
    prize: { locked: true, prize_raw: '5', locked_raw: '5', decimals: 0, symbol: 'BARD', cut_bps: 0 },
    vault: { address: 'vault', balance_raw: '5', below_locked: false },
    clock: { state: 'live', no_end: true },
    counts: { qualified: 0 },
  });
  assert.equal(zeroCut.cut, 'Bard takes 0% of payouts');
  assert.equal(zeroCut.headline, 'Prize for holders: 5 BARD');

  const open = BP.campaignPublicCopy({
    prize: { locked: false, symbol: 'BARD', decimals: 6, mint: 'MintAddress1234' },
    vault: { address: 'VaultAddress1', balance_raw: '1500000', below_locked: null },
    clock: { state: 'live', no_end: true },
    counts: {},
  });
  assert.equal(open.headline, 'In the vault now: 1.5 BARD');
  assert.equal(open.cut, '');
  assert.equal(open.detail, '');

  const none = BP.campaignPublicCopy({
    prize: { locked: false, symbol: 'BARD', decimals: 6 },
    vault: { address: null, balance_raw: '1' },
    clock: { state: 'upcoming', starts_at: '2026-02-01T00:00:00.000Z' },
    counts: { qualified: 0 },
  });
  assert.equal(none.headline, 'No verified vault yet');
  assert.equal(none.clock, 'starts 1 Feb 2026');

  const page = readFileSync(path.join(root, 'campaign.html'), 'utf8');
  assert.match(page, /Not joined · progress 0 · not qualified · not paid/);
  assert.match(page, /Connect to join/);
  assert.match(page, /show my X handle on the public page/);
  assert.match(page, /id="show-handle" type="checkbox"/);
  assert.equal(/<input[^>]*id="show-handle"[^>]*\schecked/.test(page), false);
  assert.equal(page.includes('SOL'), false);
  assert.equal(page.toLowerCase().includes('price'), false);
  assert.equal(page.toLowerCase().includes('claim'), false);
  const explore = readFileSync(path.join(root, 'explore.html'), 'utf8');
  assert.match(explore, /href="\/c\/' \+ encodeURIComponent\(c\.id\)/);
  const dashboard = readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  assert.match(dashboard, /id="detail-public"/);
  assert.match(dashboard, /BardPlatform\.shortWallet/);
  assert.equal(dashboard.includes('var X_TYPES'), false);
  assert.match(dashboard, /BardPlatform\.needsX\(type\)/);
  assert.match(page, /BardPlatform\.needsX\(state\.campaign && state\.campaign\.type\)/);
  assert.match(page, /This campaign needs a linked X account/);
  assert.match(page, /Link it on the dashboard/);
  assert.equal(page.includes('wallet, null, show'), false);
  assert.match(page, /linkedHandle \|\| null, show/);
  const admin = readFileSync(path.join(root, 'admin_app.js'), 'utf8');
  assert.match(admin, /BardPlatform\.shortWallet/);
  assert.equal(admin.includes("a.slice(0,4)"), false);
});
