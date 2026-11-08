import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCORE_FILE = '20261108120000_score_rule_v1.sql';

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
  globalThis.fetch = async (url) => { throw new Error('live network blocked: ' + url); };
  return () => { globalThis.fetch = orig; };
}

async function migrate(db, files) {
  await db.exec(AUTH_SHIM);
  for (const file of files) {
    const sql = await readFile(path.join(root, 'supabase/migrations', file), 'utf8');
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(file + ': ' + (err && err.message ? err.message : err));
    }
  }
}

async function open(skip = []) {
  const names = (await readdir(path.join(root, 'supabase/migrations')))
    .filter((name) => name.endsWith('.sql') && !skip.includes(name))
    .sort();
  const db = new PGlite({ extensions: { pgcrypto } });
  await migrate(db, names);
  return db;
}

async function settle(db) {
  try { await db.exec('ROLLBACK'); } catch { /* autocommit */ }
}

function asRole(db, role, wallet) {
  const claims = JSON.stringify({ role, wallet: wallet || '', sub: wallet || '' });
  return {
    async enter() {
      await db.exec('SET ROLE ' + role);
      await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [claims]);
    },
    async leave() {
      try { await db.exec('RESET ROLE'); } catch { await settle(db); await db.exec('RESET ROLE'); }
      await db.query(`SELECT set_config('request.jwt.claims', '', false)`);
    },
  };
}

async function withRole(db, role, wallet, fn) {
  const session = asRole(db, role, wallet);
  await session.enter();
  try { return await fn(); } finally { await session.leave(); }
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

test('score tables are service-only and duplicate oauth handles are unverified', { timeout: 120000 }, async () => {
  const restore = installFetchGuard();
  const db = await open();
  const admin = 'AdminWallet11111111111111111111111111';
  const holder = 'HolderWallet1111111111111111111111111';
  try {
    const anonWrite = await withRole(db, 'anon', '', () =>
      denied(db, `INSERT INTO public.score_accounts (campaign_id, handle) VALUES (gen_random_uuid(), 'nope')`));
    assert.match(anonWrite, /permission denied/);
    const authWrite = await withRole(db, 'authenticated', holder, () =>
      denied(db, `INSERT INTO public.score_accounts (campaign_id, handle) VALUES (gen_random_uuid(), 'nope')`));
    assert.match(authWrite, /permission denied/);
    const authAudit = await withRole(db, 'authenticated', holder, () =>
      denied(db, `UPDATE public.score_audit SET reason = 'x'`));
    assert.match(authAudit, /permission denied/);

    const grants = await db.query(`
      SELECT
        has_table_privilege('service_role', 'public.score_audit', 'INSERT') AS svc_insert,
        has_table_privilege('service_role', 'public.score_audit', 'UPDATE') AS svc_update,
        has_table_privilege('service_role', 'public.score_audit', 'DELETE') AS svc_delete,
        has_table_privilege('authenticated', 'public.score_audit', 'UPDATE') AS auth_update,
        has_table_privilege('anon', 'public.score_audit', 'DELETE') AS anon_delete
    `);
    assert.equal(grants.rows[0].svc_insert, true);
    assert.equal(grants.rows[0].svc_update, true);
    assert.equal(grants.rows[0].svc_delete, true);
    assert.equal(grants.rows[0].auth_update, false);
    assert.equal(grants.rows[0].anon_delete, false);

    const project = await withRole(db, 'service_role', '', () => one(db, `
      INSERT INTO public.projects (name, ticker, mint, chain, admin_wallet, created_by)
      VALUES ('Alpha', 'ALP', 'mint', 'solana', $1, $1)
      RETURNING id
    `, [admin]));
    const scored = await withRole(db, 'service_role', '', () => one(db, `
      INSERT INTO public.campaigns (project_id, title, type, rule_text, status, config)
      VALUES ($1, 'Scored', 'hold', 'rule', 'active', '{"scoreRule":{"version":"bard-score-v1","bestN":5}}'::jsonb)
      RETURNING id, config
    `, [project.id]));
    assert.equal(scored.config.scoreRule.version, 'bard-score-v1');
    const plain = await withRole(db, 'service_role', '', () => one(db, `
      INSERT INTO public.campaigns (project_id, title, type, rule_text, status)
      VALUES ($1, 'Plain', 'hold', 'rule', 'active')
      RETURNING id
    `, [project.id]));

    await withRole(db, 'service_role', '', () => db.query(`
      INSERT INTO public.score_accounts (campaign_id, handle, x_created_on, followers, following, entered_by)
      VALUES ($1, 'honest', '2025-04-28', 800, 300, $2)
    `, [scored.id, admin]));

    const noConsent = await withRole(db, 'authenticated', holder, () => denied(db, `
      INSERT INTO public.campaign_joins (campaign_id, project_id, wallet, joined_at)
      VALUES ($1, $2, $3, now())
    `, [scored.id, project.id, holder]));
    assert.match(noConsent, /join needs score consent/);

    const consented = await withRole(db, 'authenticated', holder, () => one(db, `
      INSERT INTO public.campaign_joins (
        campaign_id, project_id, wallet, joined_at, handle_consent_at, handle_consent_version
      ) VALUES ($1, $2, $3, now(), now(), 'bard-score-v1')
      RETURNING id
    `, [scored.id, project.id, holder]));
    const storedJoin = await withRole(db, 'service_role', '', () => one(db, `
      SELECT score_milli, score_override, handle_consent_version
      FROM public.campaign_joins WHERE id = $1
    `, [consented.id]));
    assert.equal(storedJoin.score_milli, null);
    assert.equal(storedJoin.score_override, null);
    assert.equal(storedJoin.handle_consent_version, 'bard-score-v1');

    const plainJoin = await withRole(db, 'authenticated', holder, () => one(db, `
      INSERT INTO public.campaign_joins (campaign_id, project_id, wallet, joined_at)
      VALUES ($1, $2, $3, now())
      RETURNING id
    `, [plain.id, project.id, holder]));
    assert.ok(plainJoin.id);

    const stripped = await withRole(db, 'authenticated', admin, () => one(db, `
      INSERT INTO public.campaigns (project_id, title, type, rule_text, status, config)
      VALUES ($1, 'Client', 'hold', 'rule', 'active', '{"scoreRule":{"version":"bard-score-v1"},"note":"keep"}'::jsonb)
      RETURNING config
    `, [project.id]));
    assert.equal(stripped.config.scoreRule, undefined);
    assert.equal(stripped.config.note, 'keep');

    const frozenService = await withRole(db, 'service_role', '', () => denied(db, `
      UPDATE public.campaigns SET config = config || '{"scoreRule":{"version":"other"}}'::jsonb WHERE id = $1
    `, [scored.id]));
    assert.match(frozenService, /score rule is frozen/);
    const frozenAdmin = await withRole(db, 'authenticated', admin, () => denied(db, `
      UPDATE public.campaigns SET config = '{"scoreRule":{"bestN":1}}'::jsonb WHERE id = $1
    `, [scored.id]));
    assert.match(frozenAdmin, /score rule is frozen/);

    const down = await readFile(path.join(root, 'supabase/migrations/down', SCORE_FILE), 'utf8');
    await db.exec(down);
    const gone = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'score_accounts'
    `);
    assert.equal(gone.rows.length, 0);
  } finally {
    restore();
    await db.close();
  }
});

test('migration unverifies only oauth handles that sit on two wallets', { timeout: 120000 }, async () => {
  const restore = installFetchGuard();
  const db = await open([SCORE_FILE]);
  try {
    await withRole(db, 'service_role', '', () => db.query(`
      INSERT INTO public.holders (wallet, x_handle, x_via) VALUES
        ('w1', '@Same', 'oauth'),
        ('w2', '@same', 'oauth'),
        ('w3', '@only', 'oauth'),
        ('w4', '@manual', 'manual')
    `));
    const sql = await readFile(path.join(root, 'supabase/migrations', SCORE_FILE), 'utf8');
    await db.exec(sql);
    const rows = await db.query(`SELECT wallet, x_handle, x_via, x_user_id FROM public.holders ORDER BY wallet`);
    const by = Object.fromEntries(rows.rows.map((row) => [row.wallet, row]));
    assert.equal(by.w1.x_via, 'unverified');
    assert.equal(by.w1.x_handle, '@Same');
    assert.equal(by.w1.x_user_id, null);
    assert.equal(by.w2.x_via, 'unverified');
    assert.equal(by.w2.x_handle, '@same');
    assert.equal(by.w3.x_via, 'oauth');
    assert.equal(by.w3.x_user_id, null);
    assert.equal(by.w4.x_via, 'manual');
    assert.equal(by.w4.x_handle, '@manual');
    const snap = await db.query(`SELECT count(*)::int AS n FROM public.holders_x_user_20261108`);
    assert.equal(snap.rows[0].n, 4);

    await withRole(db, 'service_role', '', () => db.query(`
      UPDATE public.holders SET x_user_id = '42' WHERE wallet = 'w3'
    `));
    const clash = await withRole(db, 'service_role', '', () => denied(db, `
      INSERT INTO public.holders (wallet, x_handle, x_via, x_user_id)
      VALUES ('w5', '@other', 'oauth', '42')
    `));
    assert.match(clash, /duplicate|unique/i);

    const down = await readFile(path.join(root, 'supabase/migrations/down', SCORE_FILE), 'utf8');
    await db.exec(down);
    const restored = await db.query(`SELECT wallet, x_via FROM public.holders ORDER BY wallet`);
    const via = Object.fromEntries(restored.rows.map((row) => [row.wallet, row.x_via]));
    assert.equal(via.w1, 'oauth');
    assert.equal(via.w2, 'oauth');
    assert.equal(via.w3, 'oauth');
    assert.equal(via.w4, 'manual');
  } finally {
    restore();
    await db.close();
  }
});
