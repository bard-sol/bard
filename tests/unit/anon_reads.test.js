import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const upFile = '20261025230000_close_anon_wallet_reads.sql';
const downFile = path.join(root, 'supabase', 'migrations', 'down', upFile);

const AUTH_SHIM = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN COALESCE(auth.jwt()->>'sub', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (auth.jwt()->>'sub')::uuid
    ELSE NULL
  END;
$$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
`;

const OPEN_STATUSES = ['proposed', 'awaiting_bard', 'awaiting_team', 'both_signed', 'cosigned'];

async function boot() {
  const migrationsDir = path.join(root, 'supabase', 'migrations');
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(files.includes(upFile));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(AUTH_SHIM);
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(file + ': ' + (err && err.message ? err.message : err));
    }
  }
  return db;
}

async function settle(db) {
  try { await db.exec('ROLLBACK'); } catch { /* autocommit */ }
}

async function withRole(db, role, wallet, fn) {
  const claims = JSON.stringify({ role, wallet: wallet || '', sub: wallet || '' });
  await db.exec('SET ROLE ' + role);
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [claims]);
  try {
    return await fn();
  } finally {
    try {
      await db.exec('RESET ROLE');
    } catch {
      await settle(db);
      await db.exec('RESET ROLE');
    }
    await db.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

async function selectAs(db, role, wallet, sql, params) {
  return withRole(db, role, wallet, async () => {
    try {
      const res = await db.query(sql, params);
      return { rows: res.rows, error: '' };
    } catch (err) {
      await settle(db);
      return { rows: [], error: String(err && err.message ? err.message : err) };
    }
  });
}

function assertClosed(result) {
  if (result.error) assert.match(result.error, /permission denied/);
  else assert.equal(result.rows.length, 0);
}

async function one(db, sql, params) {
  const res = await db.query(sql, params);
  assert.equal(res.rows.length, 1);
  return res.rows[0];
}

async function makeProject(db, wallet, name, ticker) {
  return withRole(db, 'authenticated', wallet, () => one(db, `
    INSERT INTO public.projects (name, ticker, mint, chain, admin_wallet, created_by)
    VALUES ($1, $2, $3, 'solana', $4, $4)
    RETURNING id
  `, [name, ticker, 'mint-' + ticker, wallet]));
}

async function makeCampaign(db, admin, projectId, title) {
  return withRole(db, 'authenticated', admin, () => one(db, `
    INSERT INTO public.campaigns (project_id, title, type, rule_text, reward_mode, access_mode)
    VALUES ($1, $2, 'hold', 'hold', 'fixed', 'open')
    RETURNING id
  `, [projectId, title]));
}

async function hold(db, wallet, handle, via) {
  // x_handle and x_via are service-role columns after the verified-X migration.
  await withRole(db, 'authenticated', wallet, () => db.query(
    `INSERT INTO public.holders (wallet) VALUES ($1)`,
    [wallet]
  ));
  await withRole(db, 'service_role', '', () => db.query(
    `UPDATE public.holders
        SET x_handle = $2,
            x_via = $3,
            x_linked_at = CASE WHEN $3 = 'oauth' THEN now() ELSE NULL END
      WHERE wallet = $1`,
    [wallet, handle, via]
  ));
}

async function join(db, wallet, campaignId, projectId, typed, note) {
  const inserted = await withRole(db, 'authenticated', wallet, () => one(db, `
    INSERT INTO public.campaign_joins (campaign_id, project_id, wallet, x_handle, note)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, note, wallet
  `, [campaignId, projectId, wallet, typed, note]));
  const stored = await one(db, `SELECT x_handle FROM public.campaign_joins WHERE id = $1`, [inserted.id]);
  return { ...inserted, x_handle: stored.x_handle };
}

async function settleRow(db, projectId, campaignId, wallet, status) {
  return withRole(db, 'service_role', '', () => one(db, `
    INSERT INTO public.vault_settlements (project_id, campaign_id, payouts, total, unit, status)
    VALUES ($1, $2, $3::jsonb, 1, 'TOKEN', $4)
    RETURNING id, project_id, status
  `, [projectId, campaignId, JSON.stringify([{ wallet, amount: '1' }]), status]));
}

test('anon cannot read joins, the join feed, or settlements', { timeout: 120000 }, async () => {
  const db = await boot();
  const admin = 'AdminAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const holder = 'HolderH1hhhhhhhhhhhhhhhhhhhhhhhhhhhhh';
  try {
    const project = await makeProject(db, admin, 'Alpha', 'ALP');
    const campaign = await makeCampaign(db, admin, project.id, 'Hold');
    await hold(db, holder, '@verified', 'oauth');
    const row = await join(db, holder, campaign.id, project.id, '@someone', 'private note');
    assert.equal(row.x_handle, '@verified');
    const settlement = await settleRow(db, project.id, campaign.id, holder, 'awaiting_bard');
    const exists = await db.query(`SELECT id FROM public.campaign_joins WHERE id = $1`, [row.id]);
    assert.equal(exists.rows.length, 1);

    const joins = await selectAs(db, 'anon', '', `SELECT wallet, note FROM public.campaign_joins WHERE id = $1`, [row.id]);
    const feed = await selectAs(db, 'anon', '', `SELECT wallet, note FROM public.campaign_join_feed WHERE id = $1`, [row.id]);
    const payouts = await selectAs(db, 'anon', '', `SELECT payouts FROM public.vault_settlements WHERE id = $1`, [settlement.id]);
    assertClosed(joins);
    assertClosed(feed);
    assertClosed(payouts);

    const cols = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'vault_reservations'
    `);
    assert.equal(cols.rows.some((col) => col.column_name === 'wallet'), false);
    await withRole(db, 'service_role', '', () => db.query(`
      INSERT INTO public.vault_reservations (project_id, campaign_id, amount, status)
      VALUES ($1, $2, 1, 'reserved')
    `, [project.id, campaign.id]));
    const reservations = await selectAs(db, 'anon', '', `
      SELECT amount FROM public.vault_reservations WHERE project_id = $1
    `, [project.id]);
    assert.equal(reservations.error, '');
    assert.equal(reservations.rows.length, 1);
  } finally {
    await db.close();
  }
});

test('a wallet sees its own joins and not another holder note', { timeout: 120000 }, async () => {
  const db = await boot();
  const admin = 'AdminAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const holderA = 'HolderAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const holderB = 'HolderBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  try {
    const project = await makeProject(db, admin, 'Alpha', 'ALP');
    const campaign = await makeCampaign(db, admin, project.id, 'Hold');
    await join(db, holderA, campaign.id, project.id, '@a', 'note-a');
    await join(db, holderB, campaign.id, project.id, '@b', 'note-b');

    const ownJoins = await selectAs(db, 'authenticated', holderA, `
      SELECT wallet, note FROM public.campaign_joins WHERE campaign_id = $1 ORDER BY wallet
    `, [campaign.id]);
    const ownFeed = await selectAs(db, 'authenticated', holderA, `
      SELECT wallet, note, x_handle FROM public.campaign_join_feed WHERE campaign_id = $1 ORDER BY wallet
    `, [campaign.id]);
    assert.equal(ownJoins.error, '');
    assert.equal(ownFeed.error, '');
    assert.deepEqual(ownJoins.rows.map((row) => row.wallet), [holderA]);
    assert.deepEqual(ownFeed.rows.map((row) => row.wallet), [holderA]);
    assert.equal(ownJoins.rows[0].note, 'note-a');
    const packed = JSON.stringify(ownJoins.rows) + JSON.stringify(ownFeed.rows);
    assert.equal(packed.includes('note-b'), false);
    assert.equal(packed.includes(holderB), false);
  } finally {
    await db.close();
  }
});

test('a project admin sees that project only', { timeout: 120000 }, async () => {
  const db = await boot();
  const adminP = 'AdminPppppppppppppppppppppppppppppppppp';
  const adminQ = 'AdminQqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
  const holder = 'HolderH1hhhhhhhhhhhhhhhhhhhhhhhhhhhhh';
  try {
    const projectP = await makeProject(db, adminP, 'Alpha', 'ALP');
    const projectQ = await makeProject(db, adminQ, 'Beta', 'BET');
    const campP = await makeCampaign(db, adminP, projectP.id, 'Hold P');
    const campQ = await makeCampaign(db, adminQ, projectQ.id, 'Hold Q');
    await join(db, holder, campP.id, projectP.id, '@h', 'note-p');
    await join(db, holder, campQ.id, projectQ.id, '@h', 'note-q');
    await settleRow(db, projectP.id, campP.id, holder, 'awaiting_bard');
    await settleRow(db, projectQ.id, campQ.id, holder, 'proposed');

    const joinsP = await selectAs(db, 'authenticated', adminP, `
      SELECT note, project_id FROM public.campaign_joins ORDER BY note
    `);
    const feedP = await selectAs(db, 'authenticated', adminP, `
      SELECT note FROM public.campaign_join_feed ORDER BY note
    `);
    const payP = await selectAs(db, 'authenticated', adminP, `
      SELECT project_id FROM public.vault_settlements
    `);
    assert.deepEqual(joinsP.rows.map((row) => row.note), ['note-p']);
    assert.deepEqual(feedP.rows.map((row) => row.note), ['note-p']);
    assert.deepEqual(payP.rows.map((row) => row.project_id), [projectP.id]);
    assert.equal(JSON.stringify(joinsP.rows).includes('note-q'), false);
    assert.equal(JSON.stringify(payP.rows).includes(projectQ.id), false);

    const joinsQ = await selectAs(db, 'authenticated', adminQ, `
      SELECT note FROM public.campaign_joins
    `);
    const payQ = await selectAs(db, 'authenticated', adminQ, `
      SELECT project_id FROM public.vault_settlements
    `);
    assert.deepEqual(joinsQ.rows.map((row) => row.note), ['note-q']);
    assert.deepEqual(payQ.rows.map((row) => row.project_id), [projectQ.id]);
  } finally {
    await db.close();
  }
});

test('a holder insert stores the verified x handle or null', { timeout: 120000 }, async () => {
  const db = await boot();
  const admin = 'AdminAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const verified = 'HolderVvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv';
  const plain = 'HolderNnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn';
  try {
    const project = await makeProject(db, admin, 'Alpha', 'ALP');
    const campaign = await makeCampaign(db, admin, project.id, 'Hold');
    await hold(db, verified, '@real', 'oauth');
    await hold(db, plain, '@typed', 'manual');

    const stamped = await join(db, verified, campaign.id, project.id, '@someone', 'hi');
    assert.equal(stamped.x_handle, '@real');
    const stored = await one(db, `SELECT x_handle FROM public.campaign_joins WHERE id = $1`, [stamped.id]);
    assert.equal(stored.x_handle, '@real');

    const empty = await join(db, plain, campaign.id, project.id, '@someone', 'nope');
    assert.equal(empty.x_handle, null);
    const storedEmpty = await one(db, `SELECT x_handle FROM public.campaign_joins WHERE id = $1`, [empty.id]);
    assert.equal(storedEmpty.x_handle, null);

    const rewritten = await withRole(db, 'authenticated', verified, () => one(db, `
      UPDATE public.campaign_joins SET x_handle = '@someone', note = 'still'
      WHERE id = $1
      RETURNING note
    `, [stamped.id]));
    assert.equal(rewritten.note, 'still');
    const kept = await one(db, `SELECT x_handle FROM public.campaign_joins WHERE id = $1`, [stamped.id]);
    assert.equal(kept.x_handle, '@real');

    const worker = await withRole(db, 'service_role', '', () => one(db, `
      INSERT INTO public.campaign_joins (campaign_id, project_id, wallet, x_handle, note)
      VALUES ($1, $2, 'WorkerWallet111111111111111111111111', '@from-worker', 'svc')
      RETURNING x_handle
    `, [campaign.id, project.id]));
    assert.equal(worker.x_handle, '@from-worker');
  } finally {
    await db.close();
  }
});

test('the down file restores anon reads of joins and settlements', { timeout: 120000 }, async () => {
  const db = await boot();
  const admin = 'AdminAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const holder = 'HolderH1hhhhhhhhhhhhhhhhhhhhhhhhhhhhh';
  try {
    const header = readFileSync(path.join(root, 'supabase', 'migrations', upFile), 'utf8');
    assert.match(header, /Back up public\.campaign_joins and public\.vault_settlements grants and policies/);
    const project = await makeProject(db, admin, 'Alpha', 'ALP');
    const campaign = await makeCampaign(db, admin, project.id, 'Hold');
    const row = await join(db, holder, campaign.id, project.id, '@someone', 'private note');
    const settlement = await settleRow(db, project.id, campaign.id, holder, 'proposed');
    const closed = await selectAs(db, 'anon', '', `SELECT wallet FROM public.campaign_joins WHERE id = $1`, [row.id]);
    assertClosed(closed);

    await db.exec(readFileSync(downFile, 'utf8'));

    const joins = await withRole(db, 'anon', '', () =>
      one(db, `SELECT wallet, note FROM public.campaign_joins WHERE id = $1`, [row.id]));
    assert.equal(joins.wallet, holder);
    assert.equal(joins.note, 'private note');
    const feed = await withRole(db, 'anon', '', () =>
      one(db, `SELECT wallet, note FROM public.campaign_join_feed WHERE id = $1`, [row.id]));
    assert.equal(feed.wallet, holder);
    assert.equal(feed.note, 'private note');
    const payout = await withRole(db, 'anon', '', () =>
      one(db, `SELECT payouts FROM public.vault_settlements WHERE id = $1`, [settlement.id]));
    assert.equal(payout.payouts[0].wallet, holder);

    const policies = await db.query(`
      SELECT c.relname AS table, p.polname AS name
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('campaign_joins', 'vault_settlements')
        AND p.polname LIKE '%read%'
    `);
    const names = policies.rows.map((row) => row.table + '.' + row.name).sort();
    assert.deepEqual(names, [
      'campaign_joins.campaign_joins_public_read',
      'vault_settlements.vault_settlements_public_read',
    ]);
  } finally {
    await db.close();
  }
});

function loadPlatform(fetchImpl) {
  const code = readFileSync(path.join(root, 'platform.js'), 'utf8');
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
    fetch: fetchImpl,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'platform.js' });
  return sandbox.BardPlatform;
}

test('the dashboard browse leaderboard uses the campaign state route', async () => {
  const wallet = 'HolderAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const hash = createHash('sha256').update(wallet).digest('hex');
  const calls = [];
  const BP = loadPlatform(async (url) => {
    calls.push(String(url));
    assert.equal(String(url).includes('campaign_join_feed'), false);
    assert.equal(String(url).includes('supabase'), false);
    return {
      ok: true,
      json: async () => ({
        board: [{
          rank: 1,
          wallet_short: 'Hold…aaaa',
          wallet_hash: hash,
          handle: null,
          progress: 4,
          qualified: true,
          wallet,
          note: 'do not show',
        }],
      }),
    };
  });
  const rows = await BP.loadPublicBoard('11111111-1111-4111-8111-111111111111');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/campaigns\/11111111-1111-4111-8111-111111111111\/state$/);
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'wallet'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'note'), false);
  assert.equal(rows[0].wallet_short, 'Hold…aaaa');
  const line = BP.publicBoardRow(rows[0], wallet);
  assert.equal(line.you, true);
  assert.equal(line.label, 'You · Hold…aaaa');
  assert.equal(line.label.includes('do not show'), false);
  assert.equal(line.label.includes(wallet), false);

  const dashboard = readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  const start = dashboard.indexOf('async function fillBoard');
  const end = dashboard.indexOf('function closeMenu');
  assert.ok(start > 0 && end > start);
  const fillBoard = dashboard.slice(start, end);
  assert.match(fillBoard, /loadPublicBoard/);
  assert.match(fillBoard, /publicBoardRow/);
  assert.equal(fillBoard.includes('listJoinsForCampaign'), false);
  assert.equal(fillBoard.includes('campaign_join_feed'), false);
  assert.equal(fillBoard.includes('.from('), false);
  assert.equal(dashboard.includes('listJoinsForCampaign'), false);
});

test('the co-sign inbox and the admin queue load for their signer and admin', { timeout: 120000 }, async () => {
  const db = await boot();
  const admin = 'AdminAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const other = 'AdminQqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
  const holder = 'HolderH1hhhhhhhhhhhhhhhhhhhhhhhhhhhhh';
  const bard = 'BardSigner11111111111111111111111111111';
  try {
    const project = await makeProject(db, admin, 'Alpha', 'ALP');
    const foreign = await makeProject(db, other, 'Beta', 'BET');
    const campaign = await makeCampaign(db, admin, project.id, 'Hold');
    const foreignCamp = await makeCampaign(db, other, foreign.id, 'Other');
    await join(db, holder, campaign.id, project.id, '@h', 'queue note');
    await join(db, holder, foreignCamp.id, foreign.id, '@h', 'other note');
    const mine = await settleRow(db, project.id, campaign.id, holder, 'awaiting_bard');
    await withRole(db, 'service_role', '', () => db.query(
      `UPDATE public.vault_settlements SET cosigned_wallet = $2 WHERE id = $1`,
      [mine.id, admin]
    ));
    await settleRow(db, foreign.id, foreignCamp.id, holder, 'awaiting_team');

    const openSql = `
      SELECT id, project_id, payouts FROM public.vault_settlements
      WHERE status = ANY($1::text[])
      ORDER BY proposed_at DESC
    `;
    const queueSql = `
      SELECT wallet, note, x_handle FROM public.campaign_join_feed
      WHERE campaign_id = $1
      ORDER BY joined_at DESC
    `;
    const campaignSql = `
      SELECT id, project_id FROM public.vault_settlements
      WHERE campaign_id = $1
      ORDER BY proposed_at DESC
    `;

    const inbox = await selectAs(db, 'authenticated', admin, openSql, [OPEN_STATUSES]);
    assert.equal(inbox.error, '');
    assert.deepEqual(inbox.rows.map((row) => row.project_id), [project.id]);
    assert.equal(inbox.rows[0].payouts[0].wallet, holder);

    const queue = await selectAs(db, 'authenticated', admin, queueSql, [campaign.id]);
    assert.equal(queue.error, '');
    assert.equal(queue.rows.length, 1);
    assert.equal(queue.rows[0].wallet, holder);
    assert.equal(queue.rows[0].note, 'queue note');

    const settleBox = await selectAs(db, 'authenticated', admin, campaignSql, [campaign.id]);
    assert.equal(settleBox.rows.length, 1);

    const bardInbox = await selectAs(db, 'authenticated', bard, openSql, [OPEN_STATUSES]);
    assert.equal(bardInbox.error, '');
    assert.equal(bardInbox.rows.length, 0);
    const bardQueue = await selectAs(db, 'authenticated', bard, queueSql, [campaign.id]);
    assert.equal(bardQueue.rows.length, 0);

    const worker = await selectAs(db, 'service_role', '', openSql, [OPEN_STATUSES]);
    assert.equal(worker.error, '');
    assert.equal(worker.rows.length, 2);

    const adminSrc = readFileSync(path.join(root, 'admin_app.js'), 'utf8');
    assert.match(adminSrc, /BardPlatform\.listOpenSettlements/);
    assert.match(adminSrc, /BardPlatform\.listJoinsForCampaign/);
    assert.match(adminSrc, /BardPlatform\.listSettlements/);
  } finally {
    await db.close();
  }
});
