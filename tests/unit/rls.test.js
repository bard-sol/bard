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
  const archiveDir = path.join(root, 'supabase', 'archive');
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  assert.equal(files.some((name) => name.startsWith('20260321')), false);
  const archived = (await readdir(archiveDir)).filter((name) => name.endsWith('.sql')).sort();
  assert.deepEqual(archived, [
    '20260321000000_clear_all_member_data.sql',
    '20260321120000_clear_all_data.sql',
    '20260321130000_fix_points_log_schema.sql',
  ]);
  assert.ok(files.includes('20261024130000_m2_identity_rls.sql'));

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

function asRole(db, role, wallet) {
  const claims = JSON.stringify({ role, wallet: wallet || '', sub: wallet || '' });
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

async function withRole(db, role, wallet, fn) {
  const session = asRole(db, role, wallet);
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

test('RLS isolates two wallets and blocks privileged columns', { timeout: 120000 }, async () => {
  const restore = installFetchGuard();
  const db = await boot();
  const walletA = 'WalletAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const walletB = 'WalletBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const holder = 'HolderCccccccccccccccccccccccccccccccc';
  const stranger = 'StrangerDdddddddddddddddddddddddddddd';
  const blocked = 'BlockedEeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const trusted = 'TrustedFfffffffffffffffffffffffffffff';
  try {
    const policies = await db.query(`
      SELECT c.relname AS table, p.polname AS name
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
    `);
    const names = policies.rows.map((row) => row.name);
    for (const old of ['projects_select', 'projects_insert', 'campaigns_insert', 'holders_select', 'fee_payments_insert', 'vault_settlements_update']) {
      assert.equal(names.includes(old), false, old);
    }
    assert.ok(names.includes('projects_public_read'));
    assert.ok(names.includes('campaign_joins_own_update'));

    const project = await withRole(db, 'authenticated', walletA, () => one(db, `
      INSERT INTO public.projects (name, ticker, mint, chain, admin_wallet, created_by)
      VALUES ('Alpha', 'ALP', 'mint-a', 'solana', $1, $1)
      RETURNING id, name, plan, fee_paid, vault_status, admin_wallet
    `, [walletA]));
    assert.equal(project.plan, 'free');
    assert.equal(project.fee_paid, false);
    assert.equal(project.vault_status, 'none');
    assert.equal(project.admin_wallet, walletA);

    const planDenied = await withRole(db, 'authenticated', walletA, () =>
      denied(db, `UPDATE public.projects SET plan = 'pro' WHERE id = $1`, [project.id]));
    assert.match(planDenied, /permission denied/);

    await withRole(db, 'service_role', '', () => db.query(
      `UPDATE public.projects SET plan = 'starter', fee_paid = true, vault_address = 'vault', vault_status = 'linked' WHERE id = $1`,
      [project.id]
    ));

    await db.exec('GRANT UPDATE (plan, fee_paid, vault_address, vault_status) ON public.projects TO authenticated');
    await withRole(db, 'authenticated', walletA, () => db.query(
      `UPDATE public.projects SET name = 'Alpha renamed', plan = 'pro', fee_paid = false, vault_address = 'stolen', vault_status = 'none' WHERE id = $1`,
      [project.id]
    ));
    await db.exec('REVOKE UPDATE (plan, fee_paid, vault_address, vault_status) ON public.projects FROM authenticated');
    const kept = await one(db, `SELECT name, plan, fee_paid, vault_address, vault_status FROM public.projects WHERE id = $1`, [project.id]);
    assert.equal(kept.name, 'Alpha renamed');
    assert.equal(kept.plan, 'starter');
    assert.equal(kept.fee_paid, true);
    assert.equal(kept.vault_address, 'vault');
    assert.equal(kept.vault_status, 'linked');

    await withRole(db, 'authenticated', walletB, () => db.query(
      `UPDATE public.projects SET name = 'hacked' WHERE id = $1`,
      [project.id]
    ));
    const afterB = await one(db, `SELECT name, admin_wallet FROM public.projects WHERE id = $1`, [project.id]);
    assert.equal(afterB.name, 'Alpha renamed');
    assert.equal(afterB.admin_wallet, walletA);

    const rewritten = await withRole(db, 'authenticated', walletB, () => one(db, `
      INSERT INTO public.projects (name, ticker, mint, chain, admin_wallet, created_by)
      VALUES ('Stolen', 'STL', 'mint-stolen', 'solana', $1, $2)
      RETURNING admin_wallet, created_by, plan
    `, [walletA, walletB]));
    assert.equal(rewritten.admin_wallet, walletB);
    assert.equal(rewritten.created_by, walletB);
    assert.equal(rewritten.plan, 'free');

    const own = await withRole(db, 'authenticated', walletB, () => one(db, `
      INSERT INTO public.projects (name, ticker, mint, chain, admin_wallet, created_by)
      VALUES ('Beta', 'BET', 'mint-b', 'solana', $1, $1)
      RETURNING id, admin_wallet, plan
    `, [walletB]));
    assert.equal(own.admin_wallet, walletB);
    assert.equal(own.plan, 'free');

    const campaign = await withRole(db, 'authenticated', walletA, () => one(db, `
      INSERT INTO public.campaigns (project_id, title, type, rule_text, reward_mode, access_mode)
      VALUES ($1, 'Public raid', 'raid', 'reply', 'fixed', 'open')
      RETURNING id, fee_paid, settled_count, status
    `, [project.id]));
    assert.equal(campaign.fee_paid, false);
    assert.equal(Number(campaign.settled_count), 0);
    assert.equal(campaign.status, 'active');

    await db.exec('GRANT INSERT (fee_paid, settled_count) ON public.campaigns TO authenticated');
    const forced = await withRole(db, 'authenticated', walletA, () => one(db, `
      INSERT INTO public.campaigns (project_id, title, type, rule_text, fee_paid, settled_count, access_mode)
      VALUES ($1, 'Approval raid', 'raid', 'wait', true, 4, 'approval')
      RETURNING id, fee_paid, settled_count
    `, [project.id]));
    await db.exec('REVOKE INSERT (fee_paid, settled_count) ON public.campaigns FROM authenticated');
    assert.equal(forced.fee_paid, false);
    assert.equal(Number(forced.settled_count), 0);

    const stolenCampaign = await withRole(db, 'authenticated', walletB, () =>
      denied(db, `
        INSERT INTO public.campaigns (project_id, title, type, rule_text)
        VALUES ($1, 'Stolen', 'raid', 'no')
      `, [project.id]));
    assert.match(stolenCampaign, /row-level security/);

    await withRole(db, 'authenticated', walletA, () => db.query(
      `UPDATE public.campaigns SET title = 'Public raid renamed', draw_seed = 'seed-a' WHERE id = $1`,
      [campaign.id]
    ));
    await withRole(db, 'authenticated', walletB, () => db.query(
      `UPDATE public.campaigns SET title = 'hacked', draw_seed = 'seed-b' WHERE id = $1`,
      [campaign.id]
    ));
    const campRow = await one(db, `SELECT title, draw_seed, fee_paid FROM public.campaigns WHERE id = $1`, [campaign.id]);
    assert.equal(campRow.title, 'Public raid renamed');
    assert.equal(campRow.draw_seed, 'seed-a');
    assert.equal(campRow.fee_paid, false);

    const vested = await withRole(db, 'service_role', '', () =>
      denied(db, `UPDATE public.campaigns SET reward_mode = 'vested' WHERE id = $1`, [campaign.id]));
    assert.match(vested, /campaigns_reward_mode_chk|check constraint/i);
    const social = await withRole(db, 'service_role', '', () =>
      denied(db, `UPDATE public.campaigns SET type = 'social' WHERE id = $1`, [campaign.id]));
    assert.match(social, /campaigns_type_chk|check constraint/i);

    await withRole(db, 'authenticated', walletA, () => db.query(
      `INSERT INTO public.project_roster (project_id, wallet, role, note) VALUES ($1, $2, 'trusted', 'friend')`,
      [project.id, trusted]
    ));
    await withRole(db, 'authenticated', walletA, () => db.query(
      `UPDATE public.project_roster SET role = 'whale', note = 'bigger' WHERE project_id = $1 AND wallet = $2`,
      [project.id, trusted]
    ));
    await withRole(db, 'authenticated', walletB, () => db.query(
      `UPDATE public.project_roster SET role = 'blocked' WHERE project_id = $1 AND wallet = $2`,
      [project.id, trusted]
    ));
    const roster = await one(db, `SELECT role, note FROM public.project_roster WHERE project_id = $1 AND wallet = $2`, [project.id, trusted]);
    assert.equal(roster.role, 'whale');
    assert.equal(roster.note, 'bigger');
    const rosterSteal = await withRole(db, 'authenticated', walletB, () =>
      denied(db, `INSERT INTO public.project_roster (project_id, wallet, role) VALUES ($1, $2, 'blocked')`, [project.id, holder]));
    assert.match(rosterSteal, /row-level security/);
    await withRole(db, 'authenticated', walletA, () => db.query(
      `INSERT INTO public.project_roster (project_id, wallet, role) VALUES ($1, $2, 'blocked')`,
      [project.id, blocked]
    ));

    await withRole(db, 'authenticated', walletA, () => db.query(
      `INSERT INTO public.vault_reservations (project_id, campaign_id, amount, status) VALUES ($1, $2, 5, 'reserved')`,
      [project.id, campaign.id]
    ));
    await withRole(db, 'authenticated', walletB, () => db.query(
      `UPDATE public.vault_reservations SET amount = 99 WHERE project_id = $1`,
      [project.id]
    ));
    const reserved = await one(db, `SELECT amount, status FROM public.vault_reservations WHERE project_id = $1`, [project.id]);
    assert.equal(Number(reserved.amount), 5);
    assert.equal(reserved.status, 'reserved');

    const settlement = await withRole(db, 'authenticated', walletA, () => one(db, `
      INSERT INTO public.vault_settlements (project_id, campaign_id, payouts, total, unit, payout_hash)
      VALUES ($1, $2, '[]'::jsonb, 1, 'TOKEN', 'hash-a')
      RETURNING id, status, team_signed, bard_signed, tx_signature
    `, [project.id, campaign.id]));
    assert.equal(settlement.status, 'proposed');
    assert.equal(settlement.team_signed, false);
    assert.equal(settlement.bard_signed, false);
    assert.equal(settlement.tx_signature, null);

    await db.exec('GRANT UPDATE (status, team_signed, tx_signature) ON public.vault_settlements TO authenticated');
    await withRole(db, 'authenticated', walletA, () => db.query(
      `UPDATE public.vault_settlements SET total = 2, status = 'executed', team_signed = true, tx_signature = 'forged' WHERE id = $1`,
      [settlement.id]
    ));
    await db.exec('REVOKE UPDATE (status, team_signed, tx_signature) ON public.vault_settlements FROM authenticated');
    const stillProposed = await one(db, `SELECT total, status, team_signed, tx_signature FROM public.vault_settlements WHERE id = $1`, [settlement.id]);
    assert.equal(Number(stillProposed.total), 2);
    assert.equal(stillProposed.status, 'proposed');
    assert.equal(stillProposed.team_signed, false);
    assert.equal(stillProposed.tx_signature, null);

    await withRole(db, 'authenticated', walletB, () => db.query(
      `UPDATE public.vault_settlements SET total = 50 WHERE id = $1`,
      [settlement.id]
    ));
    const totalKept = await one(db, `SELECT total FROM public.vault_settlements WHERE id = $1`, [settlement.id]);
    assert.equal(Number(totalKept.total), 2);

    await withRole(db, 'service_role', '', () => db.query(
      `UPDATE public.vault_settlements SET team_signed = true, status = 'awaiting_bard', bard_signed = false WHERE id = $1`,
      [settlement.id]
    ));
    const signed = await one(db, `SELECT status, team_signed FROM public.vault_settlements WHERE id = $1`, [settlement.id]);
    assert.equal(signed.status, 'awaiting_bard');
    assert.equal(signed.team_signed, true);
    const badStatus = await withRole(db, 'service_role', '', () =>
      denied(db, `UPDATE public.vault_settlements SET status = 'nope' WHERE id = $1`, [settlement.id]));
    assert.match(badStatus, /vault_settlements_status_chk|check constraint/i);

    await withRole(db, 'authenticated', holder, () => db.query(
      `INSERT INTO public.holders (wallet, x_handle, x_via) VALUES ($1, '@holder', 'x')`,
      [holder]
    ));
    await withRole(db, 'authenticated', holder, () => db.query(
      `UPDATE public.holders SET x_handle = '@holder2' WHERE wallet = $1`,
      [holder]
    ));
    const holderRead = await withRole(db, 'authenticated', holder, () =>
      one(db, `SELECT x_handle FROM public.holders WHERE wallet = $1`, [holder]));
    assert.equal(holderRead.x_handle, '@holder2');
    const hiddenFromB = await withRole(db, 'authenticated', walletB, () =>
      db.query(`SELECT wallet, x_handle FROM public.holders WHERE wallet = $1`, [holder]));
    assert.equal(hiddenFromB.rows.length, 0);

    const join = await withRole(db, 'authenticated', holder, () => one(db, `
      INSERT INTO public.campaign_joins (campaign_id, project_id, wallet, x_handle, note)
      VALUES ($1, $2, $3, '@holder2', 'hello')
      RETURNING id, status, qualified, progress, note
    `, [campaign.id, project.id, holder]));
    assert.equal(join.status, 'approved');
    assert.equal(join.qualified, false);
    assert.equal(Number(join.progress), 0);
    assert.equal(join.note, 'hello');

    const qualifyDenied = await withRole(db, 'authenticated', holder, () =>
      denied(db, `UPDATE public.campaign_joins SET qualified = true, progress = 9, status = 'rejected' WHERE id = $1`, [join.id]));
    assert.match(qualifyDenied, /permission denied/);
    const unchanged = await one(db, `SELECT qualified, progress, status, note FROM public.campaign_joins WHERE id = $1`, [join.id]);
    assert.equal(unchanged.qualified, false);
    assert.equal(Number(unchanged.progress), 0);
    assert.equal(unchanged.status, 'approved');

    await db.exec('GRANT UPDATE (qualified, progress, status) ON public.campaign_joins TO authenticated');
    await withRole(db, 'authenticated', holder, () => db.query(
      `UPDATE public.campaign_joins SET qualified = true, progress = 9, status = 'rejected', note = 'edited' WHERE id = $1`,
      [join.id]
    ));
    await db.exec('REVOKE UPDATE (qualified, progress, status) ON public.campaign_joins FROM authenticated');
    const guarded = await one(db, `SELECT qualified, progress, status, note FROM public.campaign_joins WHERE id = $1`, [join.id]);
    assert.equal(guarded.qualified, false);
    assert.equal(Number(guarded.progress), 0);
    assert.equal(guarded.status, 'approved');
    assert.equal(guarded.note, 'edited');

    const handleCol = await withRole(db, 'authenticated', walletB, () =>
      denied(db, `SELECT x_handle FROM public.campaign_joins WHERE id = $1`, [join.id]));
    assert.match(handleCol, /permission denied/);
    const publicCols = await withRole(db, 'anon', '', () =>
      one(db, `SELECT wallet, status FROM public.campaign_joins WHERE id = $1`, [join.id]));
    assert.equal(publicCols.wallet, holder);
    assert.equal(publicCols.status, 'approved');

    const anonFeed = await withRole(db, 'anon', '', () =>
      one(db, `SELECT wallet, x_handle FROM public.campaign_join_feed WHERE id = $1`, [join.id]));
    assert.equal(anonFeed.x_handle, null);
    const bFeed = await withRole(db, 'authenticated', walletB, () =>
      one(db, `SELECT x_handle FROM public.campaign_join_feed WHERE id = $1`, [join.id]));
    assert.equal(bFeed.x_handle, null);
    const selfFeed = await withRole(db, 'authenticated', holder, () =>
      one(db, `SELECT x_handle FROM public.campaign_join_feed WHERE id = $1`, [join.id]));
    assert.equal(selfFeed.x_handle, '@holder2');
    const adminFeed = await withRole(db, 'authenticated', walletA, () =>
      one(db, `SELECT x_handle FROM public.campaign_join_feed WHERE id = $1`, [join.id]));
    assert.equal(adminFeed.x_handle, '@holder2');
    const adminHolder = await withRole(db, 'authenticated', walletA, () =>
      one(db, `SELECT x_handle FROM public.holders WHERE wallet = $1`, [holder]));
    assert.equal(adminHolder.x_handle, '@holder2');
    const strangerRows = await withRole(db, 'authenticated', stranger, () =>
      db.query(`SELECT wallet FROM public.holders WHERE wallet = $1`, [holder]));
    assert.equal(strangerRows.rows.length, 0);

    const pending = await withRole(db, 'authenticated', stranger, () => one(db, `
      INSERT INTO public.campaign_joins (campaign_id, project_id, wallet, note)
      VALUES ($1, $2, $3, 'please')
      RETURNING status, qualified
    `, [forced.id, project.id, stranger]));
    assert.equal(pending.status, 'pending');
    assert.equal(pending.qualified, false);
    const trustedJoin = await withRole(db, 'authenticated', trusted, () => one(db, `
      INSERT INTO public.campaign_joins (campaign_id, project_id, wallet)
      VALUES ($1, $2, $3)
      RETURNING status
    `, [forced.id, project.id, trusted]));
    assert.equal(trustedJoin.status, 'approved');
    const blockedJoin = await withRole(db, 'authenticated', blocked, () =>
      denied(db, `
        INSERT INTO public.campaign_joins (campaign_id, project_id, wallet)
        VALUES ($1, $2, $3)
      `, [campaign.id, project.id, blocked]));
    assert.match(blockedJoin, /wallet is blocked/);

    const claimDenied = await withRole(db, 'authenticated', walletA, () =>
      denied(db, `
        INSERT INTO public.platform_claims (campaign_id, project_id, wallet)
        VALUES ($1, $2, $3)
      `, [campaign.id, project.id, holder]));
    assert.match(claimDenied, /permission denied/);
    await withRole(db, 'service_role', '', () => db.query(`
      INSERT INTO public.platform_claims (campaign_id, project_id, wallet, settled)
      VALUES ($1, $2, $3, true)
    `, [campaign.id, project.id, holder]));
    const claimVisible = await withRole(db, 'authenticated', holder, () =>
      db.query(`SELECT wallet FROM public.platform_claims WHERE wallet = $1`, [holder]));
    assert.equal(claimVisible.rows.length, 1);
    const claimHidden = await withRole(db, 'authenticated', walletB, () =>
      db.query(`SELECT wallet FROM public.platform_claims WHERE wallet = $1`, [holder]));
    assert.equal(claimHidden.rows.length, 0);
    const claimAdmin = await withRole(db, 'authenticated', walletA, () =>
      db.query(`SELECT wallet FROM public.platform_claims WHERE wallet = $1`, [holder]));
    assert.equal(claimAdmin.rows.length, 1);

    await withRole(db, 'service_role', '', () => db.query(`
      UPDATE public.campaign_joins SET qualified = true, progress = 3, status = 'approved' WHERE id = $1
    `, [join.id]));
    const qualified = await one(db, `SELECT qualified, progress, status FROM public.campaign_joins WHERE id = $1`, [join.id]);
    assert.equal(qualified.qualified, true);
    assert.equal(Number(qualified.progress), 3);
    assert.equal(qualified.status, 'approved');

    const feeDenied = await withRole(db, 'authenticated', walletA, () =>
      denied(db, `
        INSERT INTO public.fee_payments (kind, amount_sol, payer_wallet, status)
        VALUES ('starter', 1, $1, 'confirmed')
      `, [walletA]));
    assert.match(feeDenied, /permission denied/);
    await withRole(db, 'service_role', '', async () => {
      await db.query(`
        INSERT INTO public.fee_payments (kind, amount_sol, payer_wallet, tx_signature, status)
        VALUES ('starter', 1, $1, 'sig-once', 'confirmed')
      `, [walletA]);
      await db.query(`
        INSERT INTO public.fee_payments (kind, amount_sol, payer_wallet, status)
        VALUES ('onboard', 0.25, $1, 'pending')
      `, [walletA]);
      await db.query(`
        INSERT INTO public.fee_payments (kind, amount_sol, payer_wallet, status)
        VALUES ('onboard', 0.25, $1, 'pending')
      `, [walletA]);
    });
    const dupFee = await withRole(db, 'service_role', '', () =>
      denied(db, `
        INSERT INTO public.fee_payments (kind, amount_sol, payer_wallet, tx_signature, status)
        VALUES ('starter', 1, $1, 'sig-once', 'confirmed')
      `, [walletA]));
    assert.match(dupFee, /duplicate|unique/i);
    const nonceDenied = await withRole(db, 'authenticated', walletA, () =>
      denied(db, `INSERT INTO public.auth_nonces (jti, wallet, expires_at) VALUES ('jti-a', $1, now())`, [walletA]));
    assert.match(nonceDenied, /permission denied/);
    await withRole(db, 'service_role', '', () => db.query(
      `INSERT INTO public.auth_nonces (jti, wallet, expires_at) VALUES ('jti-a', $1, now())`,
      [walletA]
    ));

    const tables = [
      'projects', 'campaigns', 'campaign_joins', 'holders', 'platform_claims',
      'fee_payments', 'vault_settlements', 'vault_reservations', 'project_roster', 'auth_nonces',
    ];
    await withRole(db, 'anon', '', async () => {
      for (const table of tables) {
        const msg = await denied(db, `INSERT INTO public.${table} DEFAULT VALUES`);
        assert.match(msg, /permission denied|null value|violates/, table);
        assert.doesNotMatch(msg, /^$/, table);
      }
      for (const table of ['holders', 'fee_payments', 'auth_nonces', 'project_roster', 'platform_claims']) {
        const msg = await denied(db, `SELECT * FROM public.${table}`);
        assert.match(msg, /permission denied/, table);
      }
      const visible = await db.query(`SELECT id FROM public.projects WHERE id = $1`, [project.id]);
      assert.equal(visible.rows.length, 1);
    });
  } finally {
    restore();
    await db.close();
  }
});
