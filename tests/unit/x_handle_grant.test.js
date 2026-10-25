import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { buildCampaignState } from '../../server/campaign_state.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATION = '20261025210000_holders_x_oauth_only.sql';

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
  const names = await readdir(migrationsDir);
  const files = names.filter((name) => name.endsWith('.sql')).sort();
  assert.equal(files.includes(MIGRATION), true);
  assert.equal(files.some((name) => name.includes('down')), false);
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(AUTH_SHIM);
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    await db.exec(sql);
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
    try { await db.exec('RESET ROLE'); } catch { await settle(db); await db.exec('RESET ROLE'); }
    await db.query(`SELECT set_config('request.jwt.claims', '', false)`);
  }
}

async function denied(db, role, wallet, sql, params) {
  try {
    await withRole(db, role, wallet, () => db.query(sql, params));
    return '';
  } catch (err) {
    await settle(db);
    return String(err && err.message ? err.message : err);
  }
}

test('authenticated cannot write x_handle or x_via; service_role can', { timeout: 120000 }, async () => {
  const restore = installFetchGuard();
  const db = await boot();
  const owner = 'HolderXoauth1111111111111111111111111';
  try {
    const insertHandle = await denied(db, 'authenticated', owner,
      `INSERT INTO public.holders (wallet, x_handle) VALUES ($1, '@stranger')`, [owner]);
    assert.match(insertHandle, /permission denied/i);
    const insertVia = await denied(db, 'authenticated', owner,
      `INSERT INTO public.holders (wallet, x_via) VALUES ($1, 'oauth')`, [owner]);
    assert.match(insertVia, /permission denied/i);

    await withRole(db, 'authenticated', owner, () => db.query(
      `INSERT INTO public.holders (wallet) VALUES ($1)`,
      [owner]
    ));
    const updateHandle = await denied(db, 'authenticated', owner,
      `UPDATE public.holders SET x_handle = '@stranger' WHERE wallet = $1`, [owner]);
    assert.match(updateHandle, /permission denied/i);
    const updateVia = await denied(db, 'authenticated', owner,
      `UPDATE public.holders SET x_via = 'oauth' WHERE wallet = $1`, [owner]);
    assert.match(updateVia, /permission denied/i);
    const updateLinked = await denied(db, 'authenticated', owner,
      `UPDATE public.holders SET x_linked_at = now() WHERE wallet = $1`, [owner]);
    assert.match(updateLinked, /permission denied/i);

    await withRole(db, 'authenticated', owner, () => db.query(
      `UPDATE public.holders SET show_handle = true WHERE wallet = $1`,
      [owner]
    ));
    const before = await db.query(`SELECT x_handle, x_via, show_handle FROM public.holders WHERE wallet = $1`, [owner]);
    assert.equal(before.rows[0].x_handle, null);
    assert.equal(before.rows[0].x_via, null);
    assert.equal(before.rows[0].show_handle, true);

    await withRole(db, 'service_role', '', () => db.query(
      `UPDATE public.holders SET x_handle = '@real', x_via = 'oauth', x_linked_at = now() WHERE wallet = $1`,
      [owner]
    ));
    const written = await db.query(`SELECT x_handle, x_via, show_handle FROM public.holders WHERE wallet = $1`, [owner]);
    assert.equal(written.rows[0].x_handle, '@real');
    assert.equal(written.rows[0].x_via, 'oauth');
    assert.equal(written.rows[0].show_handle, true);

    const stillDenied = await denied(db, 'authenticated', owner,
      `UPDATE public.holders SET x_handle = '@stranger', x_via = 'manual' WHERE wallet = $1`, [owner]);
    assert.match(stillDenied, /permission denied/i);
    const kept = await db.query(`SELECT x_handle, x_via FROM public.holders WHERE wallet = $1`, [owner]);
    assert.equal(kept.rows[0].x_handle, '@real');
    assert.equal(kept.rows[0].x_via, 'oauth');

    const downPath = path.join(root, 'supabase', 'migrations', 'down', MIGRATION);
    const down = await readFile(downPath, 'utf8');
    assert.match(down, /GRANT INSERT \(x_handle, x_linked_at, x_via\) ON public\.holders TO authenticated/);
    assert.match(down, /GRANT UPDATE \(x_handle, x_linked_at, x_via\) ON public\.holders TO authenticated/);
    await db.exec(down);
    await withRole(db, 'authenticated', owner, () => db.query(
      `UPDATE public.holders SET x_handle = '@rolled', x_via = 'manual' WHERE wallet = $1`,
      [owner]
    ));
    const rolled = await db.query(`SELECT wallet, x_handle, x_via FROM public.holders WHERE wallet = $1`, [owner]);
    assert.equal(rolled.rows[0].wallet, owner);
    assert.equal(rolled.rows[0].x_handle, '@rolled');
    assert.equal(rolled.rows[0].x_via, 'manual');
  } finally {
    restore();
    await db.close();
  }
});

const PUBLISH_CAMPAIGN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PUBLISH_PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function bootBeforeOauthMigration() {
  const migrationsDir = path.join(root, 'supabase', 'migrations');
  const names = await readdir(migrationsDir);
  const files = names.filter((name) => name.endsWith('.sql')).sort();
  const cut = files.indexOf(MIGRATION);
  assert.ok(cut > 0);
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(AUTH_SHIM);
  for (const file of files.slice(0, cut)) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    await db.exec(sql);
  }
  return db;
}

async function publishedHandle(row) {
  const env = {
    SUPABASE_URL: 'http://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/campaigns')) {
        return Response.json([{
          id: PUBLISH_CAMPAIGN,
          project_id: PUBLISH_PROJECT,
          title: 'Old',
          type: 'hold',
          status: 'active',
        }]);
      }
      if (u.pathname.endsWith('/projects')) {
        return Response.json([{ id: PUBLISH_PROJECT, name: 'Old', ticker: 'OLD' }]);
      }
      if (u.pathname.endsWith('/campaign_joins')) {
        return Response.json([{ wallet: row.wallet, qualified: true, status: 'approved', progress: 1 }]);
      }
      if (u.pathname.endsWith('/vault_settlements')) return Response.json([]);
      if (u.pathname.endsWith('/holders')) return Response.json([row]);
      return Response.json({ message: 'missing ' + u.pathname }, { status: 500 });
    },
  };
  const body = await buildCampaignState(env, PUBLISH_CAMPAIGN, new Date('2026-10-25T00:00:00.000Z'), async () => {
    throw new Error('vault should not be read');
  });
  assert.equal(body.board.length, 1);
  return body;
}

test('an existing oauth row becomes unverified and the down file restores it', { timeout: 120000 }, async () => {
  const restore = installFetchGuard();
  const db = await bootBeforeOauthMigration();
  const owner = 'OldOauth111111111111111111111111111111';
  const typed = 'OldManual11111111111111111111111111111';
  try {
    await db.query(
      `INSERT INTO public.holders (wallet, x_handle, x_via, show_handle) VALUES ($1, '@old', 'oauth', true)`,
      [owner]
    );
    await db.query(
      `INSERT INTO public.holders (wallet, x_handle, x_via, show_handle) VALUES ($1, '@typed', 'manual', true)`,
      [typed]
    );
    const migration = await readFile(path.join(root, 'supabase', 'migrations', MIGRATION), 'utf8');
    await db.exec(migration);

    const row = await db.query(
      `SELECT wallet, x_handle, x_via, show_handle FROM public.holders WHERE wallet = $1`,
      [owner]
    );
    assert.equal(row.rows[0].x_handle, '@old');
    assert.equal(row.rows[0].x_via, 'unverified');
    assert.equal(row.rows[0].show_handle, true);
    const kept = await db.query(`SELECT x_via FROM public.holders WHERE wallet = $1`, [typed]);
    assert.equal(kept.rows[0].x_via, 'manual');
    const snap = await db.query(
      `SELECT wallet, x_via FROM public.holders_x_via_20261025 ORDER BY wallet`
    );
    assert.deepEqual(snap.rows, [{ wallet: owner, x_via: 'oauth' }]);
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const grant = await db.query(
          `SELECT has_table_privilege($1, 'public.holders_x_via_20261025', $2) AS ok`,
          [role, priv]
        );
        assert.equal(grant.rows[0].ok, false, role + ' ' + priv);
      }
    }
    const hidden = await publishedHandle(row.rows[0]);
    assert.equal(hidden.board[0].handle, null);
    assert.equal(JSON.stringify(hidden).includes('@old'), false);

    const downPath = path.join(root, 'supabase', 'migrations', 'down', MIGRATION);
    const down = await readFile(downPath, 'utf8');
    assert.match(down, /UPDATE public\.holders AS h/);
    assert.match(down, /DROP TABLE IF EXISTS public\.holders_x_via_20261025/);
    await db.exec(down);
    const restored = await db.query(
      `SELECT wallet, x_handle, x_via, show_handle FROM public.holders WHERE wallet = $1`,
      [owner]
    );
    assert.equal(restored.rows[0].x_handle, '@old');
    assert.equal(restored.rows[0].x_via, 'oauth');
    assert.equal(restored.rows[0].show_handle, true);
    const stillManual = await db.query(`SELECT x_via FROM public.holders WHERE wallet = $1`, [typed]);
    assert.equal(stillManual.rows[0].x_via, 'manual');
    const gone = await db.query(`SELECT to_regclass('public.holders_x_via_20261025') AS name`);
    assert.equal(gone.rows[0].name, null);
    const shown = await publishedHandle(restored.rows[0]);
    assert.equal(shown.board[0].handle, '@old');
  } finally {
    restore();
    await db.close();
  }
});
