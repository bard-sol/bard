import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootDatabase } from '../../vault-src/sim/lib/postgrest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// TRAA-2319 (B8): the launch simulation joined campaigns that had ended, run past their end
// date, or been paid. The page hides the join button, but the database took the row.
async function asHolder(db, wallet, sql, params) {
  await db.exec('BEGIN');
  try {
    await db.exec('SET LOCAL ROLE authenticated');
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', wallet, sub: wallet })]);
    const res = await db.query(sql, params);
    await db.exec('COMMIT');
    return res;
  } catch (err) {
    await db.exec('ROLLBACK');
    throw err;
  }
}

async function join(db, wallet, campaignId, projectId) {
  await asHolder(db, wallet, `INSERT INTO public.holders (wallet) VALUES ($1) ON CONFLICT DO NOTHING`, [wallet]);
  return asHolder(db, wallet, `INSERT INTO public.campaign_joins (campaign_id, project_id, wallet) VALUES ($1, $2, $3)`, [campaignId, projectId, wallet]);
}

test('a holder cannot join a campaign that has ended, been paid, or passed its end date', { timeout: 120000 }, async () => {
  const db = await bootDatabase(root);
  try {
    const admin = 'AdminAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const project = (await db.query(`
      INSERT INTO public.projects (name, ticker, mint, chain, admin_wallet, created_by)
      VALUES ('Alpha', 'ALP', 'mint-open', 'solana', $1, $1) RETURNING id
    `, [admin])).rows[0].id;
    async function campaign(title, status, mode, ageDays, days = 7) {
      const row = (await db.query(`
        INSERT INTO public.campaigns (project_id, title, type, rule_text, status, reward_mode, duration_days, created_at, locked_raw)
        VALUES ($1, $2, 'custom', 'r', $3, $4, $5, now() - make_interval(days => $6), 0) RETURNING id
      `, [project, title, status, mode, days, ageDays])).rows[0];
      return row.id;
    }
    const cases = [
      ['live', 'active', 'fixed', 1, 7, true],
      ['no end date', 'active', 'fixed', 400, 0, true],
      ['growing never ends', 'active', 'growing', 400, 7, true],
      ['past its end date', 'active', 'fixed', 8, 7, false],
      ['ended by the team', 'ended', 'fixed', 1, 7, false],
      ['paid', 'paid', 'fixed', 1, 7, false],
    ];
    let n = 0;
    for (const [title, status, mode, age, days, open] of cases) {
      const id = await campaign(title, status, mode, age, days);
      const wallet = 'Holder' + String(n++).padStart(2, '0') + 'b'.repeat(34);
      const outcome = await join(db, wallet, id, project).then(() => 'joined', (err) => err.message);
      if (open) assert.equal(outcome, 'joined', title);
      else assert.match(outcome, /not open for joins/, title);
    }
    const late = await campaign('service still writes', 'ended', 'fixed', 1);
    await db.query(`INSERT INTO public.holders (wallet) VALUES ('ServiceHolder') ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO public.campaign_joins (campaign_id, project_id, wallet) VALUES ($1, $2, 'ServiceHolder')`, [late, project]);
  } finally {
    await db.close();
  }
});
