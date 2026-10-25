import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROJECT = 'proj-1';
const CAMPAIGN = '11111111-1111-4111-8111-111111111111';
const LINKED_AT = '2026-01-01T00:00:00.000Z';

function memoryClient(tables) {
  const writes = [];
  function from(table) {
    const filters = [];
    const state = { op: 'select', payload: null };
    function matches(row) {
      return filters.every(([col, val]) => row[col] === val);
    }
    async function apply() {
      const payload = state.payload ? { ...state.payload } : null;
      writes.push({ table, op: state.op, payload, filters: filters.slice() });
      if (state.op === 'update') {
        for (const row of tables[table] || []) {
          if (matches(row)) Object.assign(row, payload);
        }
        return { error: null };
      }
      if (state.op === 'insert') {
        const row = { ...payload };
        tables[table] = tables[table] || [];
        tables[table].push(row);
        return row;
      }
      return { data: null, error: null };
    }
    const api = {
      select() { return api; },
      eq(col, val) { filters.push([col, val]); return api; },
      limit() { return api; },
      update(payload) { state.op = 'update'; state.payload = payload; return api; },
      insert(payload) { state.op = 'insert'; state.payload = payload; return api; },
      async maybeSingle() {
        const rows = (tables[table] || []).filter(matches);
        return { data: rows[0] ? { ...rows[0] } : null, error: null };
      },
      async single() {
        const saved = await apply();
        return { data: saved, error: null };
      },
      then(resolve, reject) {
        return Promise.resolve().then(apply).then(resolve, reject);
      },
    };
    return api;
  }
  return {
    writes,
    createClient() { return { from }; },
  };
}

function loadPlatform(client, sessionItems) {
  const store = new Map();
  const session = new Map();
  if (sessionItems) {
    for (const [key, value] of Object.entries(sessionItems)) session.set(key, value);
  }
  const sandbox = {
    console,
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
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    localStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); },
      removeItem(key) { store.delete(key); },
    },
    sessionStorage: {
      getItem(key) { return session.has(key) ? session.get(key) : null; },
      setItem(key, value) { session.set(key, String(value)); },
      removeItem(key) { session.delete(key); },
    },
    document: {
      querySelector() { return null; },
      createElement() { return {}; },
      getElementById() { return null; },
      addEventListener() {},
      body: null,
      head: {
        appendChild(el) {
          if (typeof el.onload === 'function') el.onload();
        },
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.supabase = client;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(root, 'platform.js'), 'utf8'), sandbox, { filename: 'platform.js' });
  return sandbox.BardPlatform;
}

function freshTables(wallet, showHandle) {
  return {
    projects: [{ id: PROJECT }],
    campaigns: [{ id: CAMPAIGN, access_mode: 'open', type: 'hold' }],
    project_roster: [],
    campaign_joins: [],
    holders: [{
      wallet,
      x_handle: '@a',
      x_linked_at: LINKED_AT,
      x_via: 'manual',
      show_handle: showHandle,
    }],
  };
}

function holderMutations(writes) {
  return writes.filter((row) => row.table === 'holders' && (row.op === 'update' || row.op === 'insert'));
}

function assertLinkKept(row) {
  assert.equal(row.x_handle, '@a');
  assert.equal(row.x_linked_at, LINKED_AT);
  assert.equal(row.x_via, 'manual');
}

test('needsX is one rule for raid-style campaigns', () => {
  const BP = loadPlatform(memoryClient({ projects: [{ id: 'p' }] }));
  for (const type of ['raid', 'POST', 'reply', 'Social']) assert.equal(BP.needsX(type), true, type);
  for (const type of ['hold', 'refer', 'custom', 'board', 'pool', 'airdrop', '', null]) {
    assert.equal(BP.needsX(type), false, String(type));
  }
});

test('joining from the page keeps the linked X handle', async () => {
  const wallet = 'HolderWa11et11111111111111111111111111111';

  const tickedTables = freshTables(wallet, false);
  const ticked = memoryClient(tickedTables);
  const on = loadPlatform(ticked);
  const before = await on.getHolder(wallet);
  assert.equal(before.x_handle, '@a');
  await on.joinCampaign(PROJECT, CAMPAIGN, wallet, before.x_handle, true);
  const shown = holderMutations(ticked.writes);
  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0].payload, { show_handle: true });
  assertLinkKept(tickedTables.holders[0]);
  assert.equal(tickedTables.holders[0].show_handle, true);
  const join = ticked.writes.find((item) => item.table === 'campaign_joins' && item.op === 'insert');
  assert.equal(join.payload.x_handle, '@a');

  const untickedTables = freshTables(wallet, true);
  const unticked = memoryClient(untickedTables);
  const off = loadPlatform(unticked);
  await off.joinCampaign(PROJECT, CAMPAIGN, wallet, '@a', false);
  const hidden = holderMutations(unticked.writes);
  assert.equal(hidden.length, 1);
  assert.deepEqual(hidden[0].payload, { show_handle: false });
  assertLinkKept(untickedTables.holders[0]);
  assert.equal(untickedTables.holders[0].show_handle, false);

  // The reported bug passed null for the handle. That call must not clear the link either.
  const nullTables = freshTables(wallet, false);
  const nullClient = memoryClient(nullTables);
  const page = loadPlatform(nullClient);
  await page.joinCampaign(PROJECT, CAMPAIGN, wallet, null, true);
  assert.deepEqual(holderMutations(nullClient.writes)[0].payload, { show_handle: true });
  assertLinkKept(nullTables.holders[0]);
  assert.equal(nullTables.holders[0].show_handle, true);
});

test('dashboard holder writes do not send x_handle, x_linked_at, or x_via', async () => {
  const wallet = 'DashWa11et111111111111111111111111111111';
  const tables = freshTables(wallet, true);
  const client = memoryClient(tables);
  const BP = loadPlatform(client);
  await BP.upsertHolder(wallet, '@b', 'oauth');
  assert.equal(holderMutations(client.writes).length, 0);
  assertLinkKept(tables.holders[0]);
  assert.equal(tables.holders[0].show_handle, true);

  const fresh = {
    projects: [{ id: PROJECT }],
    campaigns: [],
    project_roster: [],
    campaign_joins: [],
    holders: [],
  };
  const created = memoryClient(fresh);
  const blank = loadPlatform(created);
  await blank.upsertHolder(wallet, '@spoof', 'oauth', true);
  const inserted = holderMutations(created.writes);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].op, 'insert');
  assert.deepEqual(inserted[0].payload, { wallet, show_handle: true });
  assert.equal(Object.hasOwn(inserted[0].payload, 'x_handle'), false);
  assert.equal(Object.hasOwn(inserted[0].payload, 'x_via'), false);
  assert.equal(Object.hasOwn(inserted[0].payload, 'x_linked_at'), false);

  const mark = client.writes.length;
  await BP.joinCampaign(PROJECT, CAMPAIGN, wallet, '@b');
  assert.equal(holderMutations(client.writes.slice(mark)).length, 0);
  assertLinkKept(tables.holders[0]);
  assert.equal(tables.holders[0].show_handle, true);
});

test('only an oauth handle counts as linked when the row came from the database', () => {
  const BP = loadPlatform(memoryClient({ projects: [{ id: 'p' }] }));
  assert.equal(BP.linkedXHandle({ x_handle: '@a', x_via: 'manual', x_linked_at: LINKED_AT }), null);
  assert.equal(BP.linkedXHandle({ x_handle: '@a', x_via: 'oauth', x_linked_at: LINKED_AT }), '@a');
  assert.equal(BP.linkedXHandle({ x_handle: '@local', x_via: null, x_linked_at: null }), '@local');
  assert.equal(BP.linkedXHandle({ x_handle: '@old', x_via: null, x_linked_at: LINKED_AT }), null);
  assert.equal(BP.linkedXHandle(null), null);
});

test('supabase mode does not treat an empty x_via as a linked handle', async () => {
  const BP = loadPlatform(memoryClient({ projects: [{ id: 'p' }] }));
  await BP.init();
  assert.equal(BP.getMode(), 'supabase');
  assert.equal(BP.linkedXHandle({ x_handle: '@local', x_via: null, x_linked_at: null }), null);
  assert.equal(BP.linkedXHandle({ x_handle: '@old', x_via: 'unverified', x_linked_at: LINKED_AT }), null);
  assert.equal(BP.linkedXHandle({ x_handle: '@a', x_via: 'oauth', x_linked_at: LINKED_AT }), '@a');
});

test('getSessionToken returns the saved Bard session', async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sessionWallet = 'Wallet111111111111111111111111111111111';
  const BP = loadPlatform(memoryClient({ projects: [{ id: 'p' }] }), {
    bard_session: JSON.stringify({ token: 'jwt-token', wallet: sessionWallet, exp }),
  });
  await BP.init();
  assert.equal(BP.getSessionToken(), 'jwt-token');
  assert.equal(BP.getSessionWallet(), sessionWallet);
});
