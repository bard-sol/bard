/**
 * Scenario 6. Two projects, each with its own team, token and vault, run campaigns at the same
 * time. Some holders join both. Moves are interleaved in a seeded order. Points, approvals and
 * payouts must never cross from one campaign to the other, and neither team can touch the
 * other's campaign.
 */
import { check, checkEqual, ok, refused } from '../lib/harness.mjs';
import {
  openSim, closeSim, makeTeam, makeHolders, launchProject, createCampaign,
  expectedLock, joinRows, publicState, settle, human, labelOf,
} from '../lib/journey.mjs';
import { expectedTop3, boardOrder } from '../lib/expect.mjs';

export default {
  id: 's6',
  name: 'Two projects at once with shared holders: nothing leaks between them',
  async run(ctx) {
    const { rng, step } = ctx;
    let sim;
    try {
      sim = await openSim(ctx);
      const sides = [
        { label: 'alpha', ticker: 'ALPH', decimals: rng.pick([0, 6]) },
        { label: 'beta', ticker: 'BETA', decimals: rng.pick([2, 9]) },
      ];
      for (const side of sides) {
        side.unit = 10n ** BigInt(side.decimals);
        side.prize = BigInt(rng.int(10, 1000)) * side.unit;
        side.lock = expectedLock(side.prize, 500n);
      }
      await step('two teams sign in and launch their projects', async () => {
        for (const side of sides) {
          side.team = await makeTeam(sim, 'team-' + side.label);
          side.project = await launchProject(sim, side.team, { name: 'Project ' + side.label, ticker: side.ticker, decimals: side.decimals, depositRaw: side.lock.lockedRaw });
          side.campaign = await createCampaign(sim, side.project, { title: side.label + ' leaderboard', type: 'custom', rule: 'Top 3 by points.', rewardMode: 'top3', prize: human(side.prize, side.decimals), days: 7 });
        }
        check(sides[0].project.vault !== sides[1].project.vault, 'shared vault');
        return sides.map((s) => s.ticker + ' prize ' + human(s.prize, s.decimals)).join(', ');
      });

      const holders = await makeHolders(sim, ctx.holderCount(6, 40));
      const both = rng.sample(holders, rng.int(2, Math.min(6, holders.length)));
      for (const h of holders) {
        h.sides = both.includes(h) ? [0, 1] : [rng.int(0, 1)];
      }
      await step(holders.length + ' holders join; ' + both.length + ' join both campaigns (interleaved)', async () => {
        const moves = [];
        for (const h of holders) for (const i of h.sides) moves.push({ h, i });
        for (const { h, i } of rng.shuffle(moves)) {
          const side = sides[i];
          await h.platform.joinCampaign(side.project.id, side.campaign.id, h.wallet, null, false, null, null, null);
        }
        for (const [i, side] of sides.entries()) {
          const rows = await joinRows(sim, side.campaign.id);
          checkEqual(rows.length, holders.filter((h) => h.sides.includes(i)).length, side.label + ' joins');
          check(rows.every((r) => r.project_id === side.project.id), side.label + ' join stamped with the other project');
        }
        return 'joins land in the right campaign';
      });

      const points = [new Map(), new Map()];
      await step('both teams score their holders in an interleaved order', async () => {
        const moves = [];
        for (const h of holders) for (const i of h.sides) moves.push({ h, i, pts: rng.int(1, 1000) });
        for (const m of rng.shuffle(moves)) {
          await sides[m.i].team.platform.setJoinProgress(sides[m.i].campaign.id, m.h.wallet, m.pts, null);
          points[m.i].set(m.h.wallet, m.pts);
        }
        for (const [i, side] of sides.entries()) {
          const rows = await joinRows(sim, side.campaign.id);
          for (const row of rows) checkEqual(row.progress, points[i].get(row.wallet), side.label + ' points for ' + labelOf(sim, row.wallet));
        }
        const h = both[0];
        return labelOf(sim, h.wallet) + ' has ' + points[0].get(h.wallet) + ' in alpha and ' + points[1].get(h.wallet) + ' in beta';
      });

      await step('neither team can score, approve, qualify, close, draw or pay the other\'s campaign', async () => {
        const [a, b] = sides;
        const shared = both[0].wallet;
        const tries = [
          ['progress', () => sim.world.api('POST', '/api/joins/progress', { campaignId: b.campaign.id, wallet: shared, progress: 99999 }, a.team.token)],
          ['status', () => sim.world.api('POST', '/api/joins/status', { campaignId: b.campaign.id, wallet: shared, status: 'rejected' }, a.team.token)],
          ['qualify', () => sim.world.api('POST', '/api/joins/qualify', { campaignId: b.campaign.id, wallet: shared }, a.team.token)],
          ['draw', () => sim.world.api('POST', '/api/campaigns/' + b.campaign.id + '/draw/commit', { topN: 1 }, a.team.token)],
          ['propose', () => sim.world.api('POST', '/api/settlements/propose', { campaignId: b.campaign.id }, a.team.token)],
          ['queue', () => sim.world.api('GET', '/api/campaigns/' + b.campaign.id + '/queue', undefined, a.team.token)],
        ];
        for (const [name, fn] of tries) await refused(fn, /not the project admin|403|forbidden/i, 'alpha team ' + name + ' on beta');
        const direct = await sim.world.rest('PATCH', '/campaigns?id=eq.' + b.campaign.id, { status: 'ended' }, a.team.token);
        const row = ok(await sim.world.rest('GET', '/campaigns?id=eq.' + b.campaign.id + '&select=status'), 'campaign')[0];
        checkEqual(row.status, 'active', 'beta status after alpha tried to end it (HTTP ' + direct.status + ')');
        const joinsB = await joinRows(sim, b.campaign.id);
        checkEqual(joinsB.find((r) => r.wallet === shared).progress, points[1].get(shared), 'beta points untouched');
        return tries.length + ' worker calls and a direct database write refused';
      });

      await step('each public leaderboard shows only its own points', async () => {
        for (const [i, side] of sides.entries()) {
          const state = await publicState(sim, side.campaign.id);
          const expected = boardOrder(await joinRows(sim, side.campaign.id));
          checkEqual(state.board.map((r) => r.progress), expected.map((r) => r.progress), side.label + ' board');
          checkEqual(state.counts.joined, holders.filter((h) => h.sides.includes(i)).length, side.label + ' count');
        }
        return 'boards independent';
      });

      await step('both campaigns close and pay from their own vaults, in either order', async () => {
        const order = rng.shuffle([0, 1]);
        const before = new Map();
        for (const h of both) before.set(h.wallet, [await sim.chain.tokenBalance(h.wallet, sides[0].project.mint), await sim.chain.tokenBalance(h.wallet, sides[1].project.mint)]);
        for (const i of order) {
          const side = sides[i];
          await side.team.platform.updateCampaignStatus(side.campaign.id, 'ended');
          const expected = expectedTop3(await joinRows(sim, side.campaign.id), side.prize);
          side.expected = expected;
          await settle(sim, side.project, side.campaign.id, {
            afterPropose: async (s) => {
              checkEqual(s.payouts.map((p) => [p.wallet, p.amountRaw]), expected.map((p) => [p.wallet, p.amountRaw]), side.label + ' payouts');
              checkEqual(s.project_id, side.project.id, side.label + ' settlement project');
            },
          });
        }
        for (const h of both) {
          for (const [i, side] of sides.entries()) {
            const paid = side.expected.find((p) => p.wallet === h.wallet);
            const got = await sim.chain.tokenBalance(h.wallet, side.project.mint);
            checkEqual((got - before.get(h.wallet)[i]).toString(), paid ? paid.amountRaw : '0', side.label + ' tokens for ' + labelOf(sim, h.wallet));
          }
        }
        ctx.fact('alpha', sides[0].expected.map((p) => [labelOf(sim, p.wallet), p.amountRaw]));
        ctx.fact('beta', sides[1].expected.map((p) => [labelOf(sim, p.wallet), p.amountRaw]));
        return 'paid ' + order.map((i) => sides[i].label).join(' then ');
      });

      await step('each holder\'s claims list shows each campaign once, with its own amount', async () => {
        for (const h of both) {
          const claims = await h.platform.listClaimsForWallet(h.wallet);
          for (const side of sides) {
            const mine = claims.filter((c) => c.campaign_id === side.campaign.id);
            const paid = side.expected.find((p) => p.wallet === h.wallet);
            checkEqual(mine.length, paid ? 1 : 0, side.label + ' claims for ' + labelOf(sim, h.wallet));
          }
        }
        return 'claims match payouts';
      });
    } finally {
      await closeSim(sim);
    }
  },
};
