import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootDatabase } from '../../vault-src/sim/lib/postgrest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// TRAA-2331 (B7): a campaign's locked prize stayed reserved when nobody joined or its payout could
// never execute. cancel_campaign_vault cancels the campaign and its open settlements and releases
// the reservation; only the worker may call it, and the team cannot set or leave 'cancelled' itself.
async function as(db, role, wallet, sql, params) {
  await db.exec('BEGIN');
  try {
    await db.exec('SET LOCAL ROLE ' + role);
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role, wallet, sub: wallet })]);
    const res = await db.query(sql, params);
    await db.exec('COMMIT');
    return res;
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
}

const worker = (db, sql, params) => as(db, 'service_role', '', sql, params);
const cancel = async (db, project, campaign) => (await worker(db, `SELECT public.cancel_campaign_vault($1, $2) AS r`, [project, campaign])).rows[0].r;

test('cancel_campaign_vault releases the reservation once, and only the worker cancels', { timeout: 120000 }, async () => {
  const db = await bootDatabase(root);
  try {
    const admin = 'AdminAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const project = (await worker(db, `
      INSERT INTO public.projects (name, ticker, mint, chain, admin_wallet, created_by, vault_reserved_raw)
      VALUES ('Alpha', 'ALP', 'mint-cancel', 'solana', $1, $1, 1000) RETURNING id
    `, [admin])).rows[0].id;
    async function campaign(title, status, reservedRaw) {
      const id = (await worker(db, `
        INSERT INTO public.campaigns (project_id, title, type, rule_text, status, reward_mode, locked_raw, vault_reserved_raw)
        VALUES ($1, $2, 'custom', 'r', $3, 'pool', $4, $4) RETURNING id
      `, [project, title, status, reservedRaw])).rows[0].id;
      await worker(db, `INSERT INTO public.vault_reservations (project_id, campaign_id, amount, status) VALUES ($1, $2, 1, 'reserved')`, [project, id]);
      return id;
    }
    let txIndex = 0;
    async function settlement(campaignId, status, txSignature) {
      txIndex += 1;
      return (await worker(db, `
        INSERT INTO public.vault_settlements (project_id, campaign_id, payouts, total, unit, status, tx_signature, vault_multisig, tx_index)
        VALUES ($1, $2, '[]'::jsonb, 0, 'ALP', $3, $4, 'ms-test', $5) RETURNING id
      `, [project, campaignId, status, txSignature, String(txIndex)])).rows[0].id;
    }
    const row = async (id) => (await db.query(`SELECT status, vault_reserved_raw FROM public.campaigns WHERE id = $1`, [id])).rows[0];
    const projectRaw = async () => String((await db.query(`SELECT vault_reserved_raw FROM public.projects WHERE id = $1`, [project])).rows[0].vault_reserved_raw);

    // The team writes status directly: it cannot cancel, and cannot leave paid or cancelled.
    const empty = await campaign('Empty', 'ended', 300);
    await as(db, 'authenticated', admin, `UPDATE public.campaigns SET status = 'cancelled' WHERE id = $1`, [empty]);
    assert.equal((await row(empty)).status, 'ended');
    const denied = await as(db, 'authenticated', admin, `SELECT public.cancel_campaign_vault($1, $2)`, [project, empty]).then(() => '', (err) => err.message);
    assert.match(denied, /permission denied/i);

    // Nobody joined: the whole reservation goes back, and a second call changes nothing.
    const first = await cancel(db, project, empty);
    assert.deepEqual([first.ok, first.already, first.released_raw, first.vault_reserved_raw, first.settlements_cancelled], [true, false, '300', '700', 0]);
    assert.deepEqual(await row(empty), { status: 'cancelled', vault_reserved_raw: '0' });
    const reservations = (await db.query(`SELECT status FROM public.vault_reservations WHERE campaign_id = $1`, [empty])).rows;
    assert.deepEqual(reservations.map((r) => r.status), ['released']);
    const again = await cancel(db, project, empty);
    assert.deepEqual([again.ok, again.already, again.released_raw, again.vault_reserved_raw], [true, true, '0', '700']);
    await as(db, 'authenticated', admin, `UPDATE public.campaigns SET status = 'active' WHERE id = $1`, [empty]);
    assert.equal((await row(empty)).status, 'cancelled');
    const holder = 'HolderBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    await as(db, 'authenticated', holder, `INSERT INTO public.holders (wallet) VALUES ($1) ON CONFLICT DO NOTHING`, [holder]);
    const join = await as(db, 'authenticated', holder, `INSERT INTO public.campaign_joins (campaign_id, project_id, wallet) VALUES ($1, $2, $3)`, [empty, project, holder]).then(() => 'joined', (err) => err.message);
    assert.match(join, /not open for joins/);

    // A stuck payout: open settlements are cancelled with the campaign.
    const stuck = await campaign('Stuck', 'ended', 200);
    const open = await settlement(stuck, 'awaiting_bard', null);
    const old = await settlement(stuck, 'cancelled', null);
    const second = await cancel(db, project, stuck);
    assert.deepEqual([second.ok, second.released_raw, second.vault_reserved_raw, second.settlements_cancelled], [true, '200', '500', 1]);
    const statuses = (await db.query(`SELECT id, status FROM public.vault_settlements WHERE campaign_id = $1 ORDER BY id`, [stuck])).rows;
    assert.deepEqual(Object.fromEntries(statuses.map((s) => [s.id, s.status])), { [open]: 'cancelled', [old]: 'cancelled' });

    // Any payout recorded refuses the cancel and changes nothing.
    const half = await campaign('Half', 'ended', 100);
    const halfSettlement = await settlement(half, 'both_signed', null);
    await worker(db, `INSERT INTO public.vault_settlement_batches (settlement_id, batch, vault_multisig, tx_index, tx_signature) VALUES ($1, 1, 'ms-test', '99', 'sig-batch-1')`, [halfSettlement]);
    const partly = await cancel(db, project, half);
    assert.deepEqual([partly.ok, partly.reason], [false, 'partly_paid']);
    const signed = await campaign('Signed', 'ended', 50);
    await settlement(signed, 'both_signed', 'sig-closing');
    const paidSig = await cancel(db, project, signed);
    assert.deepEqual([paidSig.ok, paidSig.reason], [false, 'paid']);
    const paid = await campaign('Paid', 'paid', 0);
    const paidRow = await cancel(db, project, paid);
    assert.deepEqual([paidRow.ok, paidRow.reason], [false, 'paid']);
    assert.equal(await projectRaw(), '500');
    assert.deepEqual(await row(half), { status: 'ended', vault_reserved_raw: '100' });
    assert.equal((await db.query(`SELECT status FROM public.vault_settlements WHERE id = $1`, [halfSettlement])).rows[0].status, 'both_signed');

    // Another project's campaign is not found.
    const other = (await worker(db, `
      INSERT INTO public.projects (name, ticker, mint, chain, admin_wallet, created_by) VALUES ('Beta', 'BET', 'mint-b', 'solana', $1, $1) RETURNING id
    `, [admin])).rows[0].id;
    const missing = await cancel(db, other, half);
    assert.deepEqual([missing.ok, missing.reason], [false, 'missing']);
  } finally {
    await db.close();
  }
});
