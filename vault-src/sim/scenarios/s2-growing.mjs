/**
 * Scenario 2. A growing pool, with vesting inside Growing: the pot starts at a set amount and
 * adds more every day or week up to a cap. The cap is the locked prize. One campaign is closed
 * part-way (pays what has vested) and one runs past the cap (pays the cap). The public page and
 * the payout must agree on the vested amount.
 */
import { check, checkEqual, ok } from '../lib/harness.mjs';
import {
  openSim, closeSim, makeTeam, makeHolders, launchProject, giveTokens, createCampaign,
  expectedLock, joinAll, joinRows, publicState, settle, human, labelOf, ageCampaign,
} from '../lib/journey.mjs';
import { expectedGrowing, expectedCut } from '../lib/expect.mjs';

export default {
  id: 's2',
  name: 'Growing pool with vesting: part-vested and fully vested',
  async run(ctx) {
    const { rng, step } = ctx;
    let sim;
    try {
      sim = await openSim(ctx);
      const decimals = rng.pick([0, 6, 9]);
      const unit = 10n ** BigInt(decimals);
      const team = await step('team signs in', async () => makeTeam(sim, 'team'));

      const plans = ['part', 'full'].map((kind) => {
        const every = rng.pick(['day', 'week']);
        // Tenths as well as whole tokens, when the token has decimals, so the page has to add 0.1 + 0.2.
        const tenth = decimals ? unit / 10n : 0n;
        const start = BigInt(rng.int(1, 50)) * unit + BigInt(rng.int(0, 9)) * tenth;
        const add = BigInt(rng.int(1, 20)) * unit + BigInt(rng.int(0, 9)) * tenth;
        const steps = rng.int(2, 10);
        const cap = start + add * BigInt(steps);
        const periods = kind === 'part' ? rng.int(0, steps - 1) : steps + rng.int(0, 5);
        return { kind, every, start, add, cap, periods, lock: expectedLock(cap, 500n) };
      });
      const deposit = plans.reduce((n, p) => n + p.lock.lockedRaw, 0n);

      const project = await step('launch the project and fund the vault for both caps', async () => {
        const p = await launchProject(sim, team, { name: 'Growing Project', ticker: 'GROW', decimals, depositRaw: deposit, extraRaw: 100n * unit });
        return { p, detail: 'vault holds ' + human(deposit, decimals) + ' GROW' };
      }).then((v) => v.p);

      const holders = await step('holders sign in and buy the token', async () => {
        const list = await makeHolders(sim, ctx.holderCount());
        await giveTokens(sim, project, list, () => BigInt(rng.int(1, 100)) * unit);
        return { list, detail: list.length + ' holders' };
      }).then((v) => v.list);

      for (const plan of plans) {
        const label = plan.kind === 'part' ? 'part-vested' : 'past the cap';
        const campaign = await step(label + ': create a growing campaign (' + human(plan.start, decimals) + ' + ' + human(plan.add, decimals) + ' per ' + plan.every + ', cap ' + human(plan.cap, decimals) + ')', async () => {
          const c = await createCampaign(sim, project, {
            title: 'Growing ' + plan.kind, type: 'hold', rule: 'The pot grows while you hold.', rewardMode: 'growing',
            config: { growStart: human(plan.start, decimals), growAdd: human(plan.add, decimals), growEvery: plan.every, growCap: human(plan.cap, decimals), minBalance: '1' },
            days: 0,
          });
          checkEqual(c.prize_raw.toString(), plan.cap.toString(), 'the cap is the locked prize');
          checkEqual(c.locked_raw.toString(), plan.lock.lockedRaw.toString(), 'locked with the cut');
          const state = await publicState(sim, c.id);
          checkEqual(state.prize.who_gets_paid, 'growing', 'who gets paid');
          checkEqual(state.clock.no_end, true, 'a growing pool has no end date');
          return { c, detail: 'locked ' + human(plan.lock.lockedRaw, decimals) };
        }).then((v) => v.c);

        await step(label + ': holders join, the team qualifies and ranks them', async () => {
          await joinAll(project, campaign, holders);
          await team.platform.qualifyMatching(campaign.id);
          const rows = await joinRows(sim, campaign.id);
          for (const row of rows.filter((r) => r.qualified)) await team.platform.setJoinProgress(campaign.id, row.wallet, rng.int(1, 1000), null);
          const q = (await joinRows(sim, campaign.id)).filter((r) => r.qualified).length;
          check(q > 0, 'no one qualified');
          return q + ' qualified';
        });

        const periodMs = plan.every === 'day' ? 1 : 7;
        await step(label + ': ' + plan.periods + ' ' + plan.every + '(s) pass; the page shows what has vested', async () => {
          // Half a period past the boundary so the count is exact on either side of the clock.
          await ageCampaign(sim, campaign.id, plan.periods * periodMs + periodMs / 2);
          const row = ok(await sim.world.rest('GET', '/campaigns?id=eq.' + campaign.id + '&select=*'), 'campaign')[0];
          const meta = team.platform.growingMeta(mapForPlatform(row));
          const want = expectedGrowing([{ wallet: 'x', qualified: true, progress: 1, status: 'approved' }], { startRaw: plan.start, addRaw: plan.add, capRaw: plan.cap, periods: plan.periods })[0].amountRaw;
          checkEqual(String(meta.now), human(want, decimals), 'page amount now');
          return 'now ' + meta.now + ' GROW';
        });

        await step(label + ': the team ends it; the top holder is paid the vested amount; the rest stays in the vault', async () => {
          await team.platform.updateCampaignStatus(campaign.id, 'ended');
          const rows = await joinRows(sim, campaign.id);
          const expected = expectedGrowing(rows, { startRaw: plan.start, addRaw: plan.add, capRaw: plan.cap, periods: plan.periods });
          const done = await settle(sim, project, campaign.id, {
            afterPropose: async (s) => {
              checkEqual(s.payouts.map((p) => [p.wallet, p.amountRaw]), expected.map((p) => [p.wallet, p.amountRaw]), 'growing payout');
              checkEqual(String(s.cut_raw), expectedCut(expected, 500).toString(), 'cut on the vested amount');
            },
          });
          ctx.fact(plan.kind, { periods: plan.periods, paid: expected[0].amountRaw, to: labelOf(sim, expected[0].wallet) });
          return 'paid ' + human(expected[0].amountRaw, decimals) + ' of cap ' + human(plan.cap, decimals) + '; tx ' + done.signature.slice(0, 8) + '…';
        });
      }

      await step('both reservations are released and the unvested remainder is free again', async () => {
        const rows = ok(await sim.world.rest('GET', '/projects?id=eq.' + project.id + '&select=vault_reserved_raw'), 'project');
        checkEqual(String(rows[0].vault_reserved_raw), '0', 'reserved raw');
        return 'reserved 0';
      });
    } finally {
      await closeSim(sim);
    }
  },
};

// growingMeta in platform.js reads the camelCase row the dashboard builds (mapCampaignRow).
function mapForPlatform(row) {
  return { config: row.config, pool: row.pool_size, reward: row.reward, createdAt: row.created_at, unit: 'GROW', rewardMode: row.reward_mode };
}
