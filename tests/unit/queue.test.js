import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { TOKEN_PROGRAM, associatedTokenAddress } from '../../server/chain.js';
import { HOLDER_BATCH, handleRequest, setRpcPause } from '../../server/api.js';
import { signJwt } from '../../server/auth.js';
import { clearHolderBalanceCache, setQueueClock } from '../../server/queue.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SECRET = 'test-secret-traa-75';
const SUPABASE = 'https://supabase.test';
const RPC = 'https://rpc.test';
const CAMP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJ = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MINT = 'Mint111111111111111111111111111111111111111';

function wallet() {
  return bs58.encode(nacl.sign.keyPair().publicKey);
}

function mintAccount(decimals) {
  const data = new Uint8Array(82);
  data[44] = decimals;
  return { value: { owner: TOKEN_PROGRAM, data: [Buffer.from(data).toString('base64'), 'base64'] } };
}

function ownedTokens(mint, amount, decimals) {
  return {
    value: [{
      account: {
        data: { parsed: { info: { mint, tokenAmount: { amount: String(amount), decimals } } } },
      },
    }],
  };
}

function tokenAccount(mint, owner, amount) {
  const data = new Uint8Array(165);
  data.set(bs58.decode(mint), 0);
  data.set(bs58.decode(owner), 32);
  new DataView(data.buffer).setBigUint64(64, BigInt(amount), true);
  return { owner: TOKEN_PROGRAM, lamports: 2039280, data: [Buffer.from(data).toString('base64'), 'base64'] };
}

function matches(row, params) {
  for (const [key, value] of params.entries()) {
    if (key === 'select' || key === 'order') continue;
    if (value.startsWith('eq.')) {
      if (String(row[key] ?? '') !== decodeURIComponent(value.slice(3))) return false;
    } else if (value.startsWith('in.(') && value.endsWith(')')) {
      const items = value.slice(4, -1).split(',').map((item) => decodeURIComponent(item.trim()).replace(/^"|"$/g, ''));
      if (!items.includes(String(row[key] ?? ''))) return false;
    }
  }
  return true;
}

function world(spec = {}) {
  const tables = {
    projects: [{
      id: PROJ,
      admin_wallet: spec.admin,
      ticker: 'DEMO',
      mint: spec.projectMint === undefined ? MINT : spec.projectMint,
      vault_mint: spec.vaultMint || '',
      vault_address: spec.vaultAddress || null,
      name: 'Demo',
    }],
    campaigns: [{
      id: spec.campaignId || CAMP,
      project_id: spec.projectId === undefined ? PROJ : spec.projectId,
      type: spec.type || 'hold',
      config: spec.config === undefined ? { minBalance: '1' } : spec.config,
      prize_mint: spec.prizeMint === undefined ? MINT : spec.prizeMint,
      status: 'active',
      title: 'Queue',
    }],
    campaign_joins: spec.joins || [],
    holders: [],
    vault_settlements: [],
  };
  const balances = spec.balances || {};
  const fail = spec.fail || {};
  const limits = { left: spec.rateLimit || 0, status: spec.rateLimitStatus || false };
  const ataOwners = new Map();
  async function ownerOfAta(ata, mint) {
    if (!ataOwners.has(mint + '|' + ata)) {
      const owners = new Set(tables.campaign_joins.map((row) => row.wallet));
      for (const key of [...Object.keys(balances), ...Object.keys(fail)]) owners.add(key.split('|')[0]);
      for (const owner of owners) {
        try { ataOwners.set(mint + '|' + await associatedTokenAddress(owner, mint, TOKEN_PROGRAM), owner); } catch {}
      }
    }
    return ataOwners.get(mint + '|' + ata) || null;
  }
  const rpcLog = [];
  const fetchLog = [];
  const decimals = spec.decimals == null ? 6 : spec.decimals;
  const env = {
    SUPABASE_URL: SUPABASE,
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    SUPABASE_JWT_SECRET: SECRET,
    SOLANA_RPC: RPC,
    fetch: async (url, opts = {}) => {
      const href = String(url);
      fetchLog.push(href);
      if (href.startsWith(RPC)) {
        const body = JSON.parse(opts.body);
        rpcLog.push(body);
        if (body.method === 'getAccountInfo') {
          if (spec.mintMissing) return Response.json({ jsonrpc: '2.0', id: body.id, result: { value: null } });
          return Response.json({ jsonrpc: '2.0', id: body.id, result: mintAccount(decimals) });
        }
        if (body.method === 'getMultipleAccounts') {
          if (limits.left > 0) {
            limits.left -= 1;
            if (limits.status) return new Response('Too Many Requests', { status: 429 });
            return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: 429, message: 'Too many requests for a specific RPC call' } });
          }
          if (body.params[0].length > 100) {
            return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Too many inputs provided; max 100' } });
          }
          const value = [];
          for (const ata of body.params[0]) {
            const owner = await ownerOfAta(ata, MINT);
            const key = owner + '|' + MINT;
            if (owner && fail[key]) value.push(tokenAccount(MINT, wallet(), 1));
            else if (owner && Object.prototype.hasOwnProperty.call(balances, key) && balances[key] != null) value.push(tokenAccount(MINT, owner, balances[key]));
            else value.push(null);
          }
          return Response.json({ jsonrpc: '2.0', id: body.id, result: { context: { slot: 1 }, value } });
        }
        if (body.method === 'getTokenAccountsByOwner') {
          const owner = body.params[0];
          const mint = body.params[1].mint;
          const key = owner + '|' + mint;
          if (fail[key]) return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -1, message: 'rpc failed' } });
          const amount = Object.prototype.hasOwnProperty.call(balances, key) ? balances[key] : null;
          const result = amount == null ? { value: [] } : ownedTokens(mint, amount, decimals);
          return Response.json({ jsonrpc: '2.0', id: body.id, result });
        }
        return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -1, message: 'unknown method' } });
      }
      if (href.startsWith(SUPABASE + '/rest/v1/')) {
        const parsed = new URL(href);
        const table = parsed.pathname.split('/').filter(Boolean).pop();
        const rows = tables[table] || [];
        const method = String(opts.method || 'GET').toUpperCase();
        if (method === 'GET') {
          return Response.json(rows.filter((row) => matches(row, parsed.searchParams)).map((row) => ({ ...row })));
        }
        if (method === 'PATCH') {
          const body = JSON.parse(opts.body || '{}');
          const matched = rows.filter((row) => matches(row, parsed.searchParams));
          matched.forEach((row) => Object.assign(row, body));
          return Response.json(matched.map((row) => ({ ...row })));
        }
        return Response.json({ message: 'bad method' }, { status: 500 });
      }
      throw new Error('unexpected fetch ' + href);
    },
  };
  return { tables, balances, limits, rpcLog, fetchLog, env };
}

function join(id, owner, extra = {}) {
  return {
    id,
    campaign_id: CAMP,
    wallet: owner,
    x_handle: null,
    status: 'approved',
    progress: 0,
    qualified: false,
    evidence_url: null,
    referred_by: null,
    joined_at: '2026-10-01T00:00:00.000Z',
    ...extra,
  };
}

async function tokenFor(owner) {
  return (await signJwt(SECRET, owner)).token;
}

async function call(env, method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await handleRequest(new Request('https://bard.test' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data, cache: res.headers.get('cache-control') };
}

// Holder balance reads: getMultipleAccounts calls, or only the calls that asked for this token account.
function tokenReads(rpcLog, ata) {
  return rpcLog.filter((row) => row.method === 'getMultipleAccounts' && (!ata || row.params[0].includes(ata))).length;
}

async function ataOf(owner) {
  return associatedTokenAddress(owner, MINT, TOKEN_PROGRAM);
}

function installFetchGuard() {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    throw new Error('live network blocked: ' + url);
  };
  return () => { globalThis.fetch = orig; };
}

describe('team review queue', { concurrency: 1 }, () => {
  let restore;
  before(() => { restore = installFetchGuard(); });
  after(() => {
    restore();
    setQueueClock(null);
    clearHolderBalanceCache();
  });

  test('hold queue shows balances and never qualifies from the read', async () => {
    clearHolderBalanceCache();
    const admin = wallet();
    const high = wallet();
    const low = wallet();
    const exact = wallet();
    const unread = wallet();
    const rejected = wallet();
    const referrer = wallet();
    const { env, rpcLog, tables } = world({
      admin,
      config: '{"minBalance":"1"}',
      balances: {
        [high + '|' + MINT]: '2000000',
        [low + '|' + MINT]: '999999',
        [exact + '|' + MINT]: '1000000',
      },
      fail: { [unread + '|' + MINT]: true },
      joins: [
        join('10000000-0000-4000-8000-000000000001', low, { joined_at: '2026-10-02T00:00:00.000Z', x_handle: '' }),
        join('10000000-0000-4000-8000-000000000002', high, { joined_at: '2026-10-04T00:00:00.000Z', x_handle: '@high', referred_by: referrer }),
        join('10000000-0000-4000-8000-000000000003', exact, { joined_at: '2026-10-03T00:00:00.000Z', status: 'pending', progress: 4 }),
        join('10000000-0000-4000-8000-000000000004', unread, { joined_at: '2026-10-01T00:00:00.000Z' }),
        join('10000000-0000-4000-8000-000000000005', rejected, { status: 'rejected', joined_at: '2026-10-05T00:00:00.000Z' }),
      ],
    });
    const res = await call(env, 'GET', '/api/campaigns/' + CAMP + '/queue', undefined, await tokenFor(admin));
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.cache, 'no-store');
    assert.deepEqual(Object.keys(res.data).sort(), ['decimals', 'joins']);
    assert.equal(res.data.decimals, 6);
    assert.deepEqual(res.data.joins.map((row) => row.wallet), [high, exact, low, unread]);
    assert.equal(JSON.stringify(res.data).includes(rejected), false);
    assert.equal(JSON.stringify(res.data).includes(referrer), false);
    assert.equal(JSON.stringify(res.data).includes('referred_by'), false);
    const top = res.data.joins[0];
    assert.equal(top.x_handle, '@high');
    assert.equal(top.status, 'approved');
    assert.equal(top.qualified, false);
    assert.deepEqual(Object.keys(top.evidence).sort(), [
      'balance_as_of', 'balance_error', 'balance_raw', 'kind', 'meets_min', 'min_balance_raw', 'post_url', 'referral_count',
    ]);
    assert.equal(top.evidence.kind, 'hold');
    assert.equal(top.evidence.balance_raw, '2000000');
    assert.equal(top.evidence.min_balance_raw, '1000000');
    assert.equal(top.evidence.meets_min, true);
    assert.equal(top.evidence.post_url, null);
    assert.equal(top.evidence.referral_count, null);
    assert.equal(res.data.joins[1].status, 'pending');
    assert.equal(res.data.joins[1].progress, 4);
    assert.equal(res.data.joins[1].evidence.meets_min, true);
    assert.equal(res.data.joins[1].evidence.balance_raw, '1000000');
    assert.equal(res.data.joins[2].x_handle, null);
    assert.equal(res.data.joins[2].evidence.meets_min, false);
    assert.equal(top.evidence.balance_error, null);
    assert.equal(res.data.joins[3].evidence.balance_raw, null);
    assert.equal(res.data.joins[3].evidence.balance_error, 'could not read');
    assert.equal(res.data.joins[3].evidence.meets_min, null);
    assert.equal(tables.campaign_joins.every((row) => row.qualified === false), true);
    assert.equal(tokenReads(rpcLog), 1);
    assert.equal(rpcLog.length, 2);
  });

  test('a cached read is reused for 60s and qualify uses a fresh balance', async () => {
    clearHolderBalanceCache();
    let now = Date.parse('2026-10-27T00:00:00.000Z');
    setQueueClock(() => now);
    const admin = wallet();
    const holder = wallet();
    const holderAta = await ataOf(holder);
    const balances = { [holder + '|' + MINT]: '999999' };
    const { env, rpcLog, tables } = world({
      admin,
      balances,
      joins: [join('10000000-0000-4000-8000-000000000010', holder)],
    });
    const token = await tokenFor(admin);
    const first = await call(env, 'GET', '/api/campaigns/' + CAMP + '/queue', undefined, token);
    assert.equal(first.data.joins[0].evidence.meets_min, false);
    assert.equal(first.data.joins[0].evidence.balance_as_of, '2026-10-27T00:00:00.000Z');
    assert.equal(tokenReads(rpcLog, holderAta), 1);
    balances[holder + '|' + MINT] = '2000000';
    const second = await call(env, 'GET', '/api/campaigns/' + CAMP + '/queue', undefined, token);
    assert.equal(second.data.joins[0].evidence.balance_raw, '999999');
    assert.equal(tokenReads(rpcLog, holderAta), 1);
    const qualified = await call(env, 'POST', '/api/campaigns/' + CAMP + '/qualify-matching', {}, token);
    assert.equal(qualified.status, 200, JSON.stringify(qualified.data));
    assert.deepEqual(qualified.data, { qualified: 1, skipped: 0, unread: 0 });
    assert.equal(qualified.cache, 'no-store');
    assert.equal(tables.campaign_joins[0].qualified, true);
    assert.equal(tables.campaign_joins[0].status, 'approved');
    assert.equal(tokenReads(rpcLog, holderAta), 2);
    const third = await call(env, 'GET', '/api/campaigns/' + CAMP + '/queue', undefined, token);
    assert.equal(third.data.joins[0].evidence.balance_raw, '2000000');
    assert.equal(third.data.joins[0].qualified, true);
    assert.equal(tokenReads(rpcLog, holderAta), 2);
    now += 61000;
    await call(env, 'GET', '/api/campaigns/' + CAMP + '/queue', undefined, token);
    assert.equal(tokenReads(rpcLog, holderAta), 3);
    setQueueClock(null);
  });

  test('qualify matching flips only fresh hold balances at or above the minimum', async () => {
    clearHolderBalanceCache();
    const admin = wallet();
    const high = wallet();
    const exact = wallet();
    const low = wallet();
    const done = wallet();
    const rejected = wallet();
    const { env, rpcLog, tables } = world({
      admin,
      balances: {
        [high + '|' + MINT]: '2000000',
        [exact + '|' + MINT]: '1000000',
        [low + '|' + MINT]: '999999',
        [done + '|' + MINT]: '5000000',
        [rejected + '|' + MINT]: '9000000',
      },
      joins: [
        join('10000000-0000-4000-8000-000000000021', high),
        join('10000000-0000-4000-8000-000000000022', exact),
        join('10000000-0000-4000-8000-000000000023', low),
        join('10000000-0000-4000-8000-000000000024', done, { qualified: true, status: 'approved' }),
        join('10000000-0000-4000-8000-000000000025', rejected, { status: 'rejected', qualified: false }),
      ],
    });
    const token = await tokenFor(admin);
    const res = await call(env, 'POST', '/api/campaigns/' + CAMP + '/qualify-matching', { qualified: true }, token);
    assert.deepEqual(res.data, { qualified: 2, skipped: 2, unread: 0 });
    const byWallet = Object.fromEntries(tables.campaign_joins.map((row) => [row.wallet, row]));
    assert.equal(byWallet[high].qualified, true);
    assert.equal(byWallet[high].status, 'approved');
    assert.equal(byWallet[exact].qualified, true);
    assert.equal(byWallet[low].qualified, false);
    assert.equal(byWallet[done].qualified, true);
    assert.equal(byWallet[rejected].qualified, false);
    assert.equal(byWallet[rejected].status, 'rejected');
    const again = await call(env, 'POST', '/api/campaigns/' + CAMP + '/qualify-matching', undefined, token);
    assert.deepEqual(again.data, { qualified: 0, skipped: 4, unread: 0 });
    assert.equal(tokenReads(rpcLog, await ataOf(rejected)), 0);
  });

  test('raid, refer, and custom never qualify from the button and do not read balances', async () => {
    clearHolderBalanceCache();
    const admin = wallet();
    const holder = wallet();
    const friend = wallet();
    const rejected = wallet();
    for (const type of ['raid', 'refer', 'custom', 'post']) {
      const { env, rpcLog, tables } = world({
        admin,
        type,
        config: { minBalance: '1', targets: 1 },
        joins: [
          join('10000000-0000-4000-8000-000000000031', holder, { evidence_url: ' https://example.com/p ', referred_by: null }),
          join('10000000-0000-4000-8000-000000000032', friend, { referred_by: holder, status: 'pending' }),
          join('10000000-0000-4000-8000-000000000033', rejected, { referred_by: holder, status: 'rejected' }),
        ],
      });
      const token = await tokenFor(admin);
      const queue = await call(env, 'GET', '/api/campaigns/' + CAMP + '/queue', undefined, token);
      assert.equal(queue.status, 200, type + ' ' + JSON.stringify(queue.data));
      assert.equal(tokenReads(rpcLog), 0, type);
      assert.equal(queue.data.joins.length, 2);
      const row = queue.data.joins.find((item) => item.wallet === holder);
      if (type === 'raid') {
        assert.equal(row.evidence.kind, 'raid');
        assert.equal(row.evidence.post_url, 'https://example.com/p');
        assert.equal(row.evidence.meets_min, null);
        assert.equal(row.evidence.balance_raw, null);
      } else if (type === 'refer') {
        assert.equal(row.evidence.kind, 'refer');
        assert.equal(row.evidence.referral_count, 1);
        assert.equal(row.evidence.meets_min, true);
        assert.equal(row.evidence.post_url, null);
      } else {
        assert.equal(row.evidence.kind, 'custom');
        assert.equal(row.evidence.meets_min, null);
        assert.equal(row.evidence.balance_raw, null);
        assert.equal(row.evidence.post_url, null);
        assert.equal(row.evidence.referral_count, null);
      }
      const denied = await call(env, 'POST', '/api/campaigns/' + CAMP + '/qualify-matching', undefined, token);
      assert.equal(denied.status, 400, type);
      assert.equal(denied.data.error, 'qualify matching is only for a hold campaign');
      assert.equal(tokenReads(rpcLog), 0, type);
      assert.equal(tables.campaign_joins.every((item) => item.qualified === false), true);
    }
  });

  test('a refer target that is not an integer leaves meets_min null', async () => {
    clearHolderBalanceCache();
    const admin = wallet();
    const holder = wallet();
    const { env } = world({
      admin,
      type: 'refer',
      config: { targets: '2.5' },
      joins: [join('10000000-0000-4000-8000-000000000041', holder)],
    });
    const res = await call(env, 'GET', '/api/campaigns/' + CAMP + '/queue', undefined, await tokenFor(admin));
    assert.equal(res.data.joins[0].evidence.referral_count, 0);
    assert.equal(res.data.joins[0].evidence.meets_min, null);
  });

  test('a stranger cannot read the queue or qualify, and a bad minimum does not read balances', async () => {
    clearHolderBalanceCache();
    const admin = wallet();
    const stranger = wallet();
    const holder = wallet();
    const { env, rpcLog, fetchLog } = world({
      admin,
      joins: [join('10000000-0000-4000-8000-000000000051', holder)],
      balances: { [holder + '|' + MINT]: '9000000' },
    });
    const missing = await call(env, 'GET', '/api/campaigns/' + CAMP + '/queue');
    assert.equal(missing.status, 401);
    assert.equal(fetchLog.length, 0);
    assert.equal(rpcLog.length, 0);
    const forbidden = await call(env, 'GET', '/api/campaigns/' + CAMP + '/queue', undefined, await tokenFor(stranger));
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.data.error, 'not the project admin');
    assert.equal(rpcLog.length, 0);
    assert.equal(JSON.stringify(forbidden.data).includes(holder), false);
    const badId = await call(env, 'GET', '/api/campaigns/not-a-uuid/queue', undefined, await tokenFor(admin));
    assert.equal(badId.status, 404);
    const qualify = await call(env, 'POST', '/api/campaigns/' + CAMP + '/qualify-matching', undefined, await tokenFor(stranger));
    assert.equal(qualify.status, 403);
    assert.equal(rpcLog.length, 0);
  });

  test('empty, unreadable, and non-numeric hold rules do not qualify anyone', async () => {
    clearHolderBalanceCache();
    const admin = wallet();
    const holder = wallet();
    const empty = world({ admin, joins: [] });
    const none = await call(empty.env, 'POST', '/api/campaigns/' + CAMP + '/qualify-matching', undefined, await tokenFor(admin));
    assert.deepEqual(none.data, { qualified: 0, skipped: 0, unread: 0 });
    assert.equal(empty.rpcLog.length, 0);

    const missingMint = world({
      admin,
      mintMissing: true,
      joins: [join('10000000-0000-4000-8000-000000000061', holder)],
    });
    const unread = await call(missingMint.env, 'POST', '/api/campaigns/' + CAMP + '/qualify-matching', undefined, await tokenFor(admin));
    assert.equal(unread.status, 400);
    assert.equal(unread.data.error, 'could not read the reward token');
    assert.equal(missingMint.tables.campaign_joins[0].qualified, false);

    const fractional = world({
      admin,
      decimals: 0,
      config: { minBalance: '1.5' },
      balances: { [holder + '|' + MINT]: '5' },
      joins: [join('10000000-0000-4000-8000-000000000062', holder)],
    });
    const fit = await call(fractional.env, 'POST', '/api/campaigns/' + CAMP + '/qualify-matching', undefined, await tokenFor(admin));
    assert.equal(fit.status, 400);
    assert.equal(fit.data.error, 'minimum does not fit the reward token');
    assert.equal(fractional.tables.campaign_joins[0].qualified, false);

    const textMin = world({
      admin,
      config: { minBalance: 'lots' },
      balances: { [holder + '|' + MINT]: '5' },
      joins: [join('10000000-0000-4000-8000-000000000063', holder)],
    });
    const badMin = await call(textMin.env, 'POST', '/api/campaigns/' + CAMP + '/qualify-matching', undefined, await tokenFor(admin));
    assert.equal(badMin.status, 400);
    assert.equal(badMin.data.error, 'hold campaign needs a numeric minimum');
    assert.equal(textMin.rpcLog.length, 0);
    const shown = await call(textMin.env, 'GET', '/api/campaigns/' + CAMP + '/queue', undefined, await tokenFor(admin));
    assert.equal(shown.data.joins[0].evidence.balance_raw, '5');
    assert.equal(shown.data.joins[0].evidence.meets_min, null);
    assert.equal(shown.data.joins[0].qualified, false);
  });

  test('one failed balance does not block the holders that can be read', async () => {
    clearHolderBalanceCache();
    const admin = wallet();
    const good = wallet();
    const bad = wallet();
    const { env, tables } = world({
      admin,
      balances: { [good + '|' + MINT]: '1000000' },
      fail: { [bad + '|' + MINT]: true },
      joins: [
        join('10000000-0000-4000-8000-000000000071', good),
        join('10000000-0000-4000-8000-000000000072', bad),
      ],
    });
    const res = await call(env, 'POST', '/api/campaigns/' + CAMP + '/qualify-matching', undefined, await tokenFor(admin));
    assert.deepEqual(res.data, { qualified: 1, skipped: 1, unread: 1 });
    assert.equal(tables.campaign_joins.find((row) => row.wallet === good).qualified, true);
    assert.equal(tables.campaign_joins.find((row) => row.wallet === bad).qualified, false);
  });

  test('60 holders cost one mint read and one batched balance read, not two calls each', async () => {
    clearHolderBalanceCache();
    const admin = wallet();
    const holders = Array.from({ length: 60 }, () => wallet());
    const balances = {};
    holders.forEach((owner, i) => {
      if (i % 3 !== 2) balances[owner + '|' + MINT] = String(i % 3 === 0 ? 2000000 : 500000);
    });
    const { env, rpcLog, fetchLog, tables } = world({
      admin,
      balances,
      joins: holders.map((owner, i) => join('20000000-0000-4000-8000-' + String(i).padStart(12, '0'), owner)),
    });
    const token = await tokenFor(admin);
    const res = await call(env, 'GET', '/api/campaigns/' + CAMP + '/queue', undefined, token);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(rpcLog.map((row) => row.method), ['getAccountInfo', 'getMultipleAccounts']);
    assert.equal(rpcLog[1].params[0].length, 60);
    assert.ok(fetchLog.length < 50, 'subrequests ' + fetchLog.length);
    const byWallet = Object.fromEntries(res.data.joins.map((row) => [row.wallet, row.evidence]));
    holders.forEach((owner, i) => {
      const ev = byWallet[owner];
      const want = i % 3 === 0 ? '2000000' : (i % 3 === 1 ? '500000' : '0');
      assert.equal(ev.balance_raw, want, 'holder ' + i);
      assert.equal(ev.balance_error, null);
      assert.equal(ev.meets_min, i % 3 === 0);
    });
    const qualified = await call(env, 'POST', '/api/campaigns/' + CAMP + '/qualify-matching', undefined, token);
    assert.deepEqual(qualified.data, { qualified: 20, skipped: 40, unread: 0 });
    assert.equal(rpcLog.length, 4);
    assert.equal(tables.campaign_joins.filter((row) => row.qualified === true).length, 20);
  });

  test('250 holders are read 100 accounts per call', async () => {
    clearHolderBalanceCache();
    const admin = wallet();
    const holders = Array.from({ length: 250 }, () => wallet());
    const balances = Object.fromEntries(holders.map((owner, i) => [owner + '|' + MINT, String(i + 1)]));
    const { env, rpcLog } = world({
      admin,
      balances,
      joins: holders.map((owner, i) => join('30000000-0000-4000-8000-' + String(i).padStart(12, '0'), owner)),
    });
    const res = await call(env, 'GET', '/api/campaigns/' + CAMP + '/queue', undefined, await tokenFor(admin));
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(HOLDER_BATCH, 100);
    assert.deepEqual(rpcLog.map((row) => row.method), ['getAccountInfo', 'getMultipleAccounts', 'getMultipleAccounts', 'getMultipleAccounts']);
    assert.deepEqual(rpcLog.slice(1).map((row) => row.params[0].length), [100, 100, 50]);
    const byWallet = Object.fromEntries(res.data.joins.map((row) => [row.wallet, row.evidence.balance_raw]));
    holders.forEach((owner, i) => assert.equal(byWallet[owner], String(i + 1)));
  });

  test('a rate-limited read is retried once, then shown as could not read and never cached', async () => {
    clearHolderBalanceCache();
    const pauses = [];
    setRpcPause(async (ms) => { pauses.push(ms); });
    try {
      const admin = wallet();
      const a = wallet();
      const b = wallet();
      const { env, rpcLog, limits, tables } = world({
        admin,
        rateLimit: 1,
        balances: { [a + '|' + MINT]: '3000000', [b + '|' + MINT]: '4000000' },
        joins: [
          join('10000000-0000-4000-8000-000000000081', a),
          join('10000000-0000-4000-8000-000000000082', b),
          join('10000000-0000-4000-8000-000000000083', 'not-a-wallet'),
        ],
      });
      const token = await tokenFor(admin);
      const once = await call(env, 'GET', '/api/campaigns/' + CAMP + '/queue', undefined, token);
      assert.deepEqual(pauses, [500]);
      assert.equal(tokenReads(rpcLog), 2);
      const first = Object.fromEntries(once.data.joins.map((row) => [row.wallet, row.evidence]));
      assert.equal(first[a].balance_raw, '3000000');
      assert.equal(first[b].balance_raw, '4000000');
      assert.equal(first['not-a-wallet'].balance_raw, null);
      assert.equal(first['not-a-wallet'].balance_error, 'not a wallet address');

      clearHolderBalanceCache();
      limits.left = 2;
      limits.status = true;
      const limited = await call(env, 'GET', '/api/campaigns/' + CAMP + '/queue', undefined, token);
      assert.equal(limited.status, 200, JSON.stringify(limited.data));
      assert.equal(limited.data.decimals, 6);
      for (const row of limited.data.joins.filter((item) => item.wallet !== 'not-a-wallet')) {
        assert.equal(row.evidence.balance_raw, null);
        assert.equal(row.evidence.balance_as_of, null);
        assert.equal(row.evidence.balance_error, 'could not read');
        assert.equal(row.evidence.meets_min, null);
      }
      const retried = await call(env, 'GET', '/api/campaigns/' + CAMP + '/queue', undefined, token);
      const second = Object.fromEntries(retried.data.joins.map((row) => [row.wallet, row.evidence]));
      assert.equal(second[a].balance_raw, '3000000');
      assert.equal(second[a].balance_error, null);

      limits.left = 2;
      limits.status = false;
      const skipped = await call(env, 'POST', '/api/campaigns/' + CAMP + '/qualify-matching', undefined, token);
      assert.deepEqual(skipped.data, { qualified: 0, skipped: 3, unread: 3 });
      assert.equal(tables.campaign_joins.every((row) => row.qualified === false), true);
      const done = await call(env, 'POST', '/api/campaigns/' + CAMP + '/qualify-matching', undefined, token);
      assert.deepEqual(done.data, { qualified: 2, skipped: 1, unread: 1 });
    } finally {
      setRpcPause(null);
    }
  });

  test('a holder can set a referrer only when that wallet already joined', async () => {
    clearHolderBalanceCache();
    const admin = wallet();
    const holder = wallet();
    const referrer = wallet();
    const stranger = wallet();
    const rejected = wallet();
    const { env, tables, rpcLog } = world({
      admin,
      type: 'refer',
      config: {},
      joins: [
        join('10000000-0000-4000-8000-000000000081', holder),
        join('10000000-0000-4000-8000-000000000082', referrer),
        join('10000000-0000-4000-8000-000000000083', rejected, { status: 'rejected' }),
      ],
    });
    const self = await call(env, 'POST', '/api/campaigns/' + CAMP + '/referred-by', { referrer: holder }, await tokenFor(holder));
    assert.equal(self.status, 400);
    assert.equal(self.data.error, 'a wallet cannot refer itself');
    const missing = await call(env, 'POST', '/api/campaigns/' + CAMP + '/referred-by', { referrer: 'nope' }, await tokenFor(holder));
    assert.equal(missing.status, 400);
    const absent = await call(env, 'POST', '/api/campaigns/' + CAMP + '/referred-by', { referrer: stranger }, await tokenFor(holder));
    assert.equal(absent.status, 400);
    assert.equal(absent.data.error, 'referrer has no join in this campaign');
    const blocked = await call(env, 'POST', '/api/campaigns/' + CAMP + '/referred-by', { referrer: rejected }, await tokenFor(holder));
    assert.equal(blocked.status, 400);
    const set = await call(env, 'POST', '/api/campaigns/' + CAMP + '/referred-by', { referrer }, await tokenFor(holder));
    assert.equal(set.status, 200, JSON.stringify(set.data));
    assert.equal(tables.campaign_joins.find((row) => row.wallet === holder).referred_by, referrer);
    assert.equal(tables.campaign_joins.find((row) => row.wallet === referrer).referred_by, null);
    const same = await call(env, 'POST', '/api/campaigns/' + CAMP + '/referred-by', { referrer }, await tokenFor(holder));
    assert.equal(same.status, 200);
    const changed = await call(env, 'POST', '/api/campaigns/' + CAMP + '/referred-by', { referrer: admin }, await tokenFor(holder));
    assert.equal(changed.status, 400);
    assert.equal(changed.data.error, 'referral already set');
    assert.equal(rpcLog.length, 0);
    const noJoin = await call(env, 'POST', '/api/campaigns/' + CAMP + '/referred-by', { referrer }, await tokenFor(stranger));
    assert.equal(noJoin.status, 404);
  });

  test('the public campaign state does not carry a full wallet or the review link', async () => {
    clearHolderBalanceCache();
    const admin = wallet();
    const holder = wallet();
    const { env } = world({
      admin,
      joins: [join('10000000-0000-4000-8000-000000000091', holder, { evidence_url: 'evidence-secret', qualified: true })],
    });
    const state = await call(env, 'GET', '/api/campaigns/' + CAMP + '/state');
    assert.equal(state.status, 200, JSON.stringify(state.data));
    const text = JSON.stringify(state.data);
    assert.equal(text.includes(holder), false);
    assert.equal(text.includes('evidence-secret'), false);
    assert.equal(text.includes('referred_by'), false);
    const queue = await call(env, 'GET', '/api/campaigns/' + CAMP + '/queue', undefined, await tokenFor(admin));
    assert.equal(JSON.stringify(queue.data).includes(holder), true);
  });
});

test('qualified is not written from a balance except the admin button', async () => {
  const serverDir = path.join(root, 'server');
  const names = (await readdir(serverDir)).filter((name) => name.endsWith('.js'));
  const hits = [];
  for (const name of names) {
    const text = await readFile(path.join(serverDir, name), 'utf8');
    const found = text.match(/qualified\s*:\s*true/g) || [];
    for (let i = 0; i < found.length; i += 1) hits.push(name);
  }
  assert.deepEqual(hits.sort(), ['api.js', 'api.js', 'campaign_state.js', 'queue.js']);
  const state = await readFile(path.join(serverDir, 'campaign_state.js'), 'utf8');
  assert.equal(state.includes('PATCH'), false);
  assert.equal(/qualified\s*=\s*true/.test(state), false);
  const queue = await readFile(path.join(serverDir, 'queue.js'), 'utf8');
  assert.equal(/scheduled\s*[:(]/.test(queue), false);
  assert.equal(/\bcrons\b/.test(queue), false);
  assert.equal(/set(?:Interval|Timeout)\s*\(/.test(queue), false);
  assert.equal(/twitter|x\.com|api\.x\.com/i.test(queue), false);
  assert.equal(/fetch\s*\(/.test(queue), false);
  const up = await readFile(path.join(root, 'supabase/migrations/20261027160000_join_evidence.sql'), 'utf8');
  const down = await readFile(path.join(root, 'supabase/migrations/down/20261027160000_join_evidence.sql'), 'utf8');
  assert.match(up, /after copying/);
  assert.match(up, /public\.campaign_joins/);
  assert.match(down, /DROP COLUMN IF EXISTS evidence_url/);
  assert.match(down, /DROP COLUMN IF EXISTS referred_by/);
  assert.equal(/UPDATE\s+public\.campaign_joins\s+SET\s+qualified/i.test(down), false);
});
