/**
 * Scenario 3. Join approval on: every join waits for the team. The team approves some holders
 * and rejects others; some are never reviewed. Rejected and pending holders earn nothing, even
 * when the team gives them points, and a rejected holder cannot re-join their way back in.
 */
import { check, checkEqual, ok, refused } from '../lib/harness.mjs';
import {
  openSim, closeSim, makeTeam, makeHolders, launchProject, createCampaign,
  expectedLock, joinAll, joinRows, publicState, settle, human, labelOf,
} from '../lib/journey.mjs';
import { expectedPool, boardOrder } from '../lib/expect.mjs';

export default {
  id: 's3',
  name: 'Join approval: approved, rejected and never-reviewed holders',
  async run(ctx) {
    const { rng, step } = ctx;
    let sim;
    try {
      sim = await openSim(ctx);
      const decimals = rng.pick([0, 3, 6]);
      const unit = 10n ** BigInt(decimals);
      const pool = BigInt(rng.int(5, 500)) * unit + BigInt(rng.int(0, Number(unit) - 1));
      const lock = expectedLock(pool, 500n);
      const team = await step('team signs in', async () => makeTeam(sim, 'team'));
      const project = await step('launch the project', async () => {
        const p = await launchProject(sim, team, { name: 'Approval Project', ticker: 'APRV', decimals, depositRaw: lock.lockedRaw });
        return { p, detail: 'vault holds exactly the lock, ' + human(lock.lockedRaw, decimals) };
      }).then((v) => v.p);
      const campaign = await step('create a custom campaign with join approval and a shared pool', async () => {
        const c = await createCampaign(sim, project, { title: 'Approved only', type: 'custom', rule: 'Do the thing; the team checks.', rewardMode: 'pool', pool: human(pool, decimals), accessMode: 'approval', days: 7 });
        checkEqual(c.access_mode, 'approval', 'access mode');
        return { c, detail: 'pool ' + human(pool, decimals) };
      }).then((v) => v.c);

      const holders = await step('holders sign in and ask to join', async () => {
        const list = await makeHolders(sim, ctx.holderCount(8, 50));
        await joinAll(project, campaign, list);
        const rows = await joinRows(sim, campaign.id);
        check(rows.every((r) => r.status === 'pending'), 'a join skipped approval');
        const state = await publicState(sim, campaign.id);
        checkEqual(state.counts.joined, list.length, 'pending joins counted as joined');
        return { list, detail: list.length + ' pending' };
      }).then((v) => v.list);

      // At least one holder is left to reject.
      const shuffled = rng.shuffle(holders);
      const approved = shuffled.slice(0, rng.int(2, shuffled.length - 1));
      const rejected = shuffled.slice(approved.length, approved.length + rng.int(1, Math.max(1, shuffled.length - approved.length - 1)));
      const pending = shuffled.slice(approved.length + rejected.length);

      await step('a holder cannot approve themselves', async () => {
        const h = pending[0] || rejected[0];
        await refused(() => sim.world.api('POST', '/api/joins/status', { campaignId: campaign.id, wallet: h.wallet, status: 'approved' }, h.token), /not the project admin/i, 'self approval');
        await sim.world.rest('PATCH', '/campaign_joins?campaign_id=eq.' + campaign.id + '&wallet=eq.' + h.wallet, { status: 'approved' }, h.token);
        const row = (await joinRows(sim, campaign.id)).find((r) => r.wallet === h.wallet);
        checkEqual(row.status, 'pending', 'status after a direct write');
        return 'worker and database both kept it pending';
      });

      await step('the team approves ' + approved.length + ', rejects ' + rejected.length + ', leaves ' + pending.length + ' pending', async () => {
        for (const h of approved) await team.platform.setJoinStatus(campaign.id, h.wallet, 'approved');
        for (const h of rejected) await team.platform.setJoinStatus(campaign.id, h.wallet, 'rejected');
        const rows = await joinRows(sim, campaign.id);
        const by = new Map(rows.map((r) => [r.wallet, r.status]));
        for (const h of approved) checkEqual(by.get(h.wallet), 'approved', labelOf(sim, h.wallet));
        for (const h of rejected) checkEqual(by.get(h.wallet), 'rejected', labelOf(sim, h.wallet));
        for (const h of pending) checkEqual(by.get(h.wallet), 'pending', labelOf(sim, h.wallet));
        return 'statuses stored';
      });

      await step('a rejected holder re-joins and is still rejected', async () => {
        const h = rejected[0];
        await h.platform.joinCampaign(project.id, campaign.id, h.wallet, null, false, null, null, null);
        const row = (await joinRows(sim, campaign.id)).find((r) => r.wallet === h.wallet);
        checkEqual(row.status, 'rejected', 'status after re-join');
        const dup = await sim.world.rest('POST', '/campaign_joins', { project_id: project.id, campaign_id: campaign.id, wallet: h.wallet }, h.token);
        check(dup.status >= 400 && dup.status < 500, 'a second join row was accepted: ' + dup.status);
        checkEqual((await joinRows(sim, campaign.id)).filter((r) => r.wallet === h.wallet).length, 1, 'join rows for the wallet');
        return 'still rejected; a second row is refused (' + dup.status + ')';
      });

      await step('the team gives everyone points, rejected and pending included', async () => {
        for (const h of holders) await team.platform.setJoinProgress(campaign.id, h.wallet, rng.int(1, 100), null);
        const state = await publicState(sim, campaign.id);
        const rows = await joinRows(sim, campaign.id);
        checkEqual(state.counts.joined, holders.length - rejected.length, 'rejected holders leave the public count');
        checkEqual(state.board.length, boardOrder(rows).length, 'board length');
        check(state.board.length === holders.length - rejected.length, 'a rejected holder is on the board');
        return 'board shows ' + state.board.length + ' (rejected hidden)';
      });

      await step('the pool goes to approved holders only, split evenly with the remainder handed out in rank order', async () => {
        await team.platform.updateCampaignStatus(campaign.id, 'ended');
        const rows = await joinRows(sim, campaign.id);
        const expected = expectedPool(rows, pool);
        const paidWallets = new Set(expected.map((p) => p.wallet));
        for (const h of [...rejected, ...pending]) check(!paidWallets.has(h.wallet), labelOf(sim, h.wallet) + ' would be paid');
        const done = await settle(sim, project, campaign.id, {
          afterPropose: async (s) => checkEqual(s.payouts.map((p) => [p.wallet, p.amountRaw]), expected.map((p) => [p.wallet, p.amountRaw]), 'pool payouts'),
        });
        const total = expected.reduce((n, p) => n + BigInt(p.amountRaw), 0n);
        checkEqual(total.toString(), pool.toString(), 'pool fully paid');
        for (const h of [...rejected, ...pending]) checkEqual(await sim.chain.tokenBalance(h.wallet, project.mint), 0n, 'tokens for ' + labelOf(sim, h.wallet));
        ctx.fact('approvedPaid', expected.map((p) => [labelOf(sim, p.wallet), p.amountRaw]));
        return expected.length + ' paid, sum ' + human(total, decimals) + ' = pool; tx ' + done.signature.slice(0, 8) + '…';
      });
    } finally {
      await closeSim(sim);
    }
  },
};
