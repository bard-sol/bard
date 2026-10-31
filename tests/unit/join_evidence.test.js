import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

function installFetchGuard() {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    throw new Error('live network blocked: ' + url);
  };
  return () => { globalThis.fetch = orig; };
}

async function boot() {
  const migrationsDir = path.join(root, 'supabase', 'migrations');
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
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

function asRole(db, role, owner) {
  const claims = JSON.stringify({ role, wallet: owner || '', sub: owner || '' });
  return {
    async enter() {
      await db.exec('SET ROLE ' + role);
      await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [claims]);
    },
    async leave() {
      try {
        await db.exec('RESET ROLE');
      } catch {
        await settle(db);
        await db.exec('RESET ROLE');
      }
      await db.query(`SELECT set_config('request.jwt.claims', '', false)`);
    },
  };
}

async function withRole(db, role, owner, fn) {
  const session = asRole(db, role, owner);
  await session.enter();
  try {
    return await fn();
  } finally {
    await session.leave();
  }
}

async function denied(db, sql, params) {
  try {
    await db.query(sql, params);
    return '';
  } catch (err) {
    await settle(db);
    return String(err && err.message ? err.message : err);
  }
}

async function one(db, sql, params) {
  const res = await db.query(sql, params);
  assert.equal(res.rows.length, 1);
  return res.rows[0];
}

test('a holder can write evidence_url and cannot write qualified or referred_by', { timeout: 120000 }, async () => {
  const restore = installFetchGuard();
  const db = await boot();
  const admin = 'WalletAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const holder = 'HolderCccccccccccccccccccccccccccccccc';
  const stranger = 'StrangerDdddddddddddddddddddddddddddd';
  const referrer = 'ReferrerHhhhhhhhhhhhhhhhhhhhhhhhhhhh';
  try {
    const project = await withRole(db, 'authenticated', admin, () => one(db, `
      INSERT INTO public.projects (name, ticker, mint, chain, admin_wallet, created_by)
      VALUES ('Alpha', 'ALP', 'mint-evidence', 'solana', $1, $1)
      RETURNING id
    `, [admin]));
    const campaign = await withRole(db, 'authenticated', admin, () => one(db, `
      INSERT INTO public.campaigns (project_id, title, type, rule_text)
      VALUES ($1, 'Hold', 'hold', 'hold')
      RETURNING id, status
    `, [project.id]));
    assert.equal(campaign.status, 'draft');
    await withRole(db, 'service_role', '', () => db.query(
      `UPDATE public.campaigns SET status = 'active' WHERE id = $1`,
      [campaign.id]
    ));
    await withRole(db, 'authenticated', holder, () => db.query(
      `INSERT INTO public.holders (wallet) VALUES ($1)`,
      [holder]
    ));
    await withRole(db, 'service_role', '', () => db.query(
      `UPDATE public.holders SET x_handle = '@holder', x_via = 'oauth', x_linked_at = now() WHERE wallet = $1`,
      [holder]
    ));

    const link = 'https://example.com/post';
    const created = await withRole(db, 'authenticated', holder, () => one(db, `
      INSERT INTO public.campaign_joins (campaign_id, project_id, wallet, x_handle, note, evidence_url)
      VALUES ($1, $2, $3, '@typed', 'hello', $4)
      RETURNING id, qualified, status, progress, note, evidence_url, wallet, campaign_id
    `, [campaign.id, project.id, holder, link]));
    assert.equal(created.evidence_url, link);
    assert.equal(created.qualified, false);
    assert.equal(created.note, 'hello');
    assert.equal(created.status, 'approved');
    assert.equal(Number(created.progress), 0);
    assert.equal(created.wallet, holder);
    const stored = await one(db, `
      SELECT referred_by, x_handle FROM public.campaign_joins WHERE id = $1
    `, [created.id]);
    assert.equal(stored.referred_by, null);
    assert.equal(stored.x_handle, '@holder');

    const next = 'https://example.com/next';
    const updated = await withRole(db, 'authenticated', holder, () => one(db, `
      UPDATE public.campaign_joins SET evidence_url = $2 WHERE id = $1
      RETURNING qualified, status, progress, note, evidence_url, wallet, campaign_id
    `, [created.id, next]));
    assert.equal(updated.evidence_url, next);
    assert.equal(updated.qualified, false);
    assert.equal(updated.note, 'hello');
    assert.equal(updated.status, 'approved');
    assert.equal(Number(updated.progress), 0);
    assert.equal(updated.wallet, holder);
    assert.equal(updated.campaign_id, campaign.id);
    const afterUpdate = await one(db, `
      SELECT referred_by, x_handle FROM public.campaign_joins WHERE id = $1
    `, [created.id]);
    assert.equal(afterUpdate.referred_by, null);
    assert.equal(afterUpdate.x_handle, '@holder');

    const qualifyDenied = await withRole(db, 'authenticated', holder, () =>
      denied(db, `UPDATE public.campaign_joins SET qualified = true WHERE id = $1`, [created.id]));
    assert.match(qualifyDenied, /permission denied/i);
    const referDenied = await withRole(db, 'authenticated', holder, () =>
      denied(db, `UPDATE public.campaign_joins SET referred_by = $2 WHERE id = $1`, [created.id, referrer]));
    assert.match(referDenied, /permission denied/i);
    const insertDenied = await withRole(db, 'authenticated', stranger, () =>
      denied(db, `
        INSERT INTO public.campaign_joins (campaign_id, project_id, wallet, referred_by)
        VALUES ($1, $2, $3, $4)
      `, [campaign.id, project.id, stranger, referrer]));
    assert.match(insertDenied, /permission denied/i);
    const strangerCount = await db.query(
      `SELECT count(*)::int AS n FROM public.campaign_joins WHERE wallet = $1`,
      [stranger]
    );
    assert.equal(strangerCount.rows[0].n, 0);

    await withRole(db, 'authenticated', stranger, () => db.query(
      `UPDATE public.campaign_joins SET evidence_url = 'https://evil.example/x' WHERE id = $1`,
      [created.id]
    ));
    const kept = await one(db, `SELECT evidence_url, qualified FROM public.campaign_joins WHERE id = $1`, [created.id]);
    assert.equal(kept.evidence_url, next);
    assert.equal(kept.qualified, false);

    const hidden = await withRole(db, 'authenticated', stranger, () =>
      db.query(`SELECT evidence_url FROM public.campaign_joins WHERE id = $1`, [created.id]));
    assert.equal(hidden.rows.length, 0);
    const anon = await withRole(db, 'anon', '', () =>
      denied(db, `SELECT evidence_url FROM public.campaign_joins WHERE id = $1`, [created.id]));
    assert.match(anon, /permission denied/i);

    const grants = await db.query(`
      SELECT column_name, privilege_type
      FROM information_schema.column_privileges
      WHERE table_schema = 'public' AND table_name = 'campaign_joins' AND grantee = 'authenticated'
    `);
    const updateCols = grants.rows.filter((row) => row.privilege_type === 'UPDATE').map((row) => row.column_name).sort();
    assert.deepEqual(updateCols, ['evidence_url', 'note', 'x_handle']);
    assert.equal(grants.rows.some((row) => row.column_name === 'referred_by'), false);
    assert.equal(grants.rows.some((row) => row.column_name === 'qualified' && row.privilege_type === 'UPDATE'), false);
    const feedCols = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'campaign_join_feed'
        AND column_name IN ('evidence_url', 'referred_by')
    `);
    assert.equal(feedCols.rows.length, 0);

    await db.exec('GRANT UPDATE (referred_by) ON public.campaign_joins TO authenticated');
    await withRole(db, 'authenticated', holder, () => db.query(
      `UPDATE public.campaign_joins SET referred_by = $2 WHERE id = $1`,
      [created.id, referrer]
    ));
    await db.exec('REVOKE UPDATE (referred_by) ON public.campaign_joins FROM authenticated');
    const frozen = await one(db, `SELECT referred_by FROM public.campaign_joins WHERE id = $1`, [created.id]);
    assert.equal(frozen.referred_by, null);

    const tooLong = 'h'.repeat(301);
    const longDenied = await withRole(db, 'authenticated', holder, () =>
      denied(db, `UPDATE public.campaign_joins SET evidence_url = $2 WHERE id = $1`, [created.id, tooLong]));
    assert.match(longDenied, /campaign_joins_evidence_url_len|check/i);

    await withRole(db, 'service_role', '', () => db.query(
      `UPDATE public.campaign_joins SET qualified = true, qualified_at = now(), referred_by = $2 WHERE id = $1`,
      [created.id, referrer]
    ));
    const marked = await one(db, `SELECT qualified, referred_by FROM public.campaign_joins WHERE id = $1`, [created.id]);
    assert.equal(marked.qualified, true);
    assert.equal(marked.referred_by, referrer);

    const down = await readFile(path.join(root, 'supabase/migrations/down/20261027160000_join_evidence.sql'), 'utf8');
    await db.exec(down);
    const gone = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'campaign_joins'
        AND column_name IN ('evidence_url', 'referred_by')
    `);
    assert.equal(gone.rows.length, 0);
    const still = await one(db, `SELECT qualified FROM public.campaign_joins WHERE id = $1`, [created.id]);
    assert.equal(still.qualified, true);
  } finally {
    restore();
    await db.close();
  }
});
