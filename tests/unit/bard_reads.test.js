import assert from 'node:assert/strict';
import { test } from 'node:test';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { signJwt } from '../../server/auth.js';
import { handleRequest } from '../../server/api.js';

// RLS lets only a project's admin read vault_settlements and vault_settlement_batches. The Bard
// signer co-signs every vault and reads them through these two worker routes (TRAA-2434).

const SECRET = 'test-secret-test-secret-test-secret';
const wallet = () => bs58.encode(nacl.sign.keyPair().publicKey);

function createEnv(signer) {
  const tables = { projects: [], vault_settlements: [], vault_settlement_batches: [] };
  const reads = [];
  const env = {
    SUPABASE_URL: 'http://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    SUPABASE_JWT_SECRET: SECRET,
    BARD_SIGNER_PUBKEY: signer,
    SOLANA_RPC: 'http://rpc.test/solana',
    fetch: async (url, opts = {}) => {
      const u = new URL(url);
      if (u.hostname !== 'supabase.test' || (opts.method || 'GET') !== 'GET') throw new Error('unexpected ' + opts.method + ' ' + url);
      const table = u.pathname.replace(/^\/rest\/v1\//, '');
      reads.push({ table, query: u.search, auth: opts.headers && (opts.headers.authorization || opts.headers.Authorization) });
      const filters = [];
      for (const [key, value] of u.searchParams) {
        if (key === 'select' || key === 'order') continue;
        const dot = value.indexOf('.');
        filters.push({ key, op: value.slice(0, dot), val: value.slice(dot + 1) });
      }
      const rows = (tables[table] || []).filter((row) => filters.every((f) => {
        const got = row[f.key] == null ? '' : String(row[f.key]);
        if (f.op === 'eq') return got === f.val;
        if (f.op === 'in') return f.val.replace(/^\(|\)$/g, '').split(',').includes(got);
        throw new Error('unsupported filter ' + f.op);
      }));
      return Response.json(rows);
    },
  };
  return { env, tables, reads };
}

async function get(env, path, who) {
  const headers = {};
  if (who) headers.authorization = 'Bearer ' + (await signJwt(SECRET, who)).token;
  const res = await handleRequest(new Request('http://127.0.0.1' + path, { method: 'GET', headers }), env);
  return { status: res.status, data: await res.json() };
}

function seed() {
  const signer = wallet();
  const admin = wallet();
  const stranger = wallet();
  const { env, tables, reads } = createEnv(signer);
  tables.projects.push({ id: 'p1', admin_wallet: admin }, { id: 'p2', admin_wallet: stranger });
  tables.vault_settlements.push(
    { id: 's1', project_id: 'p1', campaign_id: 'c1', status: 'awaiting_bard' },
    { id: 's0', project_id: 'p1', campaign_id: 'c1', status: 'cancelled' },
    { id: 's2', project_id: 'p2', campaign_id: 'c2', status: 'executed' },
    { id: 's3', project_id: 'p2', campaign_id: 'c3', status: 'both_signed' },
  );
  tables.vault_settlement_batches.push(
    { id: 'b0', settlement_id: 's1', batch: 0, tx_index: '4', team_signed: true, bard_signed: false },
    { id: 'b1', settlement_id: 's1', batch: 1, tx_index: '5', team_signed: true, bard_signed: false },
    { id: 'b9', settlement_id: 's3', batch: 0, tx_index: '9', team_signed: true, bard_signed: true },
  );
  return { env, reads, signer, admin, stranger };
}

test('the batch rows of a payout are read by its project admin and the Bard signer only', async () => {
  const { env, reads, signer, admin, stranger } = seed();
  assert.equal((await get(env, '/api/settlements/s1/batches')).status, 401);
  const refused = await get(env, '/api/settlements/s1/batches', stranger);
  assert.equal(refused.status, 403);
  assert.match(refused.data.error, /not the project admin/);
  assert.equal((await get(env, '/api/settlements/nope/batches', admin)).status, 404);
  for (const who of [admin, signer]) {
    const res = await get(env, '/api/settlements/s1/batches', who);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.batches.map((b) => [b.batch, b.tx_index]), [[0, '4'], [1, '5']]);
  }
  // The batch query is bound to the settlement named in the path and ordered by batch.
  const batchReads = reads.filter((r) => r.table === 'vault_settlement_batches');
  assert.ok(batchReads.every((r) => r.query.includes('settlement_id=eq.s1') && r.query.includes('order=batch.asc')));
});

test('the Bard signer reads one campaign\'s payouts or every open one; nobody else does', async () => {
  const { env, signer, admin, stranger } = seed();
  assert.equal((await get(env, '/api/bard/settlements?campaignId=c1')).status, 401);
  for (const who of [admin, stranger]) {
    const res = await get(env, '/api/bard/settlements?campaignId=c1', who);
    assert.equal(res.status, 403);
    assert.match(res.data.error, /not the Bard signer/);
  }
  const one = await get(env, '/api/bard/settlements?campaignId=c1', signer);
  assert.equal(one.status, 200);
  assert.deepEqual(one.data.settlements.map((s) => s.id).sort(), ['s0', 's1']);
  const open = await get(env, '/api/bard/settlements?open=1', signer);
  assert.equal(open.status, 200);
  assert.deepEqual(open.data.settlements.map((s) => s.id).sort(), ['s1', 's3']);
  const neither = await get(env, '/api/bard/settlements', signer);
  assert.equal(neither.status, 400);
});

test('with no Bard signer configured the Bard reads refuse everyone', async () => {
  const { env, admin } = seed();
  env.BARD_SIGNER_PUBKEY = '';
  assert.equal((await get(env, '/api/bard/settlements?open=1', admin)).status, 403);
  const batches = await get(env, '/api/settlements/s1/batches', admin);
  assert.equal(batches.status, 200, 'the admin still reads its own batches');
});
