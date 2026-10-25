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
  return () => { globalThis.fetch = orig; }
}

async function boot() {
  const migrationsDir = path.join(root, 'supabase', 'migrations');
  const names = await readdir(migrationsDir);
  const files = names.filter((name) => name.endsWith('.sql')).sort();
  assert.equal(files.includes('20261025180000_holders_show_handle.sql'), true);
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

test('holders.show_handle defaults off, is owner-writable, and the down migration drops it', { timeout: 120000 }, async () => {
  const restore = installFetchGuard();
  const db = await boot();
  const owner = 'HolderShowHandle111111111111111111111';
  const stranger = 'StrangerShowHandle22222222222222222';
  try {
    const column = await db.query(`
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'holders' AND column_name = 'show_handle'
    `);
    assert.equal(column.rows.length, 1);
    assert.equal(column.rows[0].is_nullable, 'NO');
    assert.match(String(column.rows[0].column_default), /false/);

    await db.query(`INSERT INTO public.holders (wallet) VALUES ($1)`, [owner + '-default']);
    const fallback = await db.query(`SELECT show_handle FROM public.holders WHERE wallet = $1`, [owner + '-default']);
    assert.equal(fallback.rows[0].show_handle, false);
    let nullWrite = '';
    try {
      await db.query(`UPDATE public.holders SET show_handle = NULL WHERE wallet = $1`, [owner + '-default']);
    } catch (err) {
      await settle(db);
      nullWrite = String(err && err.message ? err.message : err);
    }
    assert.match(nullWrite, /not-null|null value/i);

    await withRole(db, 'authenticated', owner, () => db.query(
      `INSERT INTO public.holders (wallet, x_handle, show_handle) VALUES ($1, '@me', true)`,
      [owner]
    ));
    const opted = await db.query(`SELECT show_handle, x_handle FROM public.holders WHERE wallet = $1`, [owner]);
    assert.equal(opted.rows[0].show_handle, true);
    assert.equal(opted.rows[0].x_handle, '@me');

    await withRole(db, 'authenticated', owner, () => db.query(
      `UPDATE public.holders SET show_handle = false WHERE wallet = $1`,
      [owner]
    ));
    await withRole(db, 'authenticated', owner, () => db.query(
      `UPDATE public.holders SET show_handle = true WHERE wallet = $1`,
      [owner]
    ));

    const anon = await denied(db, 'anon', owner,
      `INSERT INTO public.holders (wallet, show_handle) VALUES ('anon-wallet-show', true)`);
    assert.match(anon, /permission denied/i);

    await withRole(db, 'authenticated', stranger, () => db.query(
      `UPDATE public.holders SET show_handle = false WHERE wallet = $1`,
      [owner]
    ));
    const kept = await db.query(`SELECT show_handle FROM public.holders WHERE wallet = $1`, [owner]);
    assert.equal(kept.rows[0].show_handle, true);
    const hidden = await withRole(db, 'authenticated', stranger, () =>
      db.query(`SELECT show_handle FROM public.holders WHERE wallet = $1`, [owner]));
    assert.equal(hidden.rows.length, 0);

    const down = await readFile(path.join(root, 'supabase', 'migrations', 'down', '20261025180000_holders_show_handle.sql'), 'utf8');
    assert.match(down, /DROP COLUMN IF EXISTS show_handle/);
    await db.exec(down);
    const gone = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'holders' AND column_name = 'show_handle'
    `);
    assert.equal(gone.rows.length, 0);
    const still = await db.query(`SELECT x_handle FROM public.holders WHERE wallet = $1`, [owner]);
    assert.equal(still.rows[0].x_handle, '@me');
  } finally {
    restore();
    await db.close();
  }
});
