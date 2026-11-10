/**
 * Scenario 1. A basic project from launch to receipt: create the project, lock a prize, the
 * public page shows it, holders join a Hold and a Refer campaign, the team scores them, the
 * leaderboard follows, the campaigns close, Bard computes payouts, the 2-of-2 vault settles
 * with both signatures, and the public receipt appears. Raid is checked as not offered.
 */
import { check, checkEqual, ok, refused } from '../lib/harness.mjs';
import { classifyHost } from '../lib/world.mjs';
import {
  openSim, closeSim, makeTeam, makeHolders, launchProject, giveTokens, createCampaign,
  expectedLock, joinAll, joinRows, publicState, settle, human, labelOf,
} from '../lib/journey.mjs';
import { expectedFixed, expectedTop3, boardOrder } from '../lib/expect.mjs';
import { checkPublicPage, checkReceiptPage, joinThroughPage } from '../lib/pages.mjs';

export default {
  id: 's1',
  name: 'Basic project: hold and refer campaigns from launch to receipt',
  devnetInMixed: true,
  async run(ctx) {
    const { rng, step } = ctx;
    let sim;
    try {
      sim = await step('open the simulated Bard', async () => {
        const opened = await openSim(ctx);
        const rpcHost = classifyHost(opened.world.env.SOLANA_RPC);
        check(rpcHost.ok, 'the worker RPC is outside the guard');
        check(!classifyHost('https://' + 'pxdiyukxgnphxlknhmke.supabase.co/rest/v1/projects').ok, 'production Supabase was allowed');
        check(!classifyHost('https://api.mainnet-beta.solana.com').ok, 'mainnet was allowed');
        return { sim: opened, detail: 'chain ' + opened.chain.name + ', worker RPC ' + rpcHost.kind + ', Bard signer ' + opened.bard.publicKey.toBase58().slice(0, 6) + '…' };
      }).then((v) => v.sim);

      const decimals = rng.pick([2, 6, 9]);
      const unit = 10n ** BigInt(decimals);
      const holderCount = ctx.holderCount();
      const team = await step('team signs in with its wallet', async () => {
        const t = await makeTeam(sim, 'team');
        checkEqual(await t.mode(), 'supabase', 'platform.js mode');
        return { t, detail: t.wallet };
      }).then((v) => v.t);

      const rewardEach = BigInt(rng.int(1, 20)) * unit;
      const fixedCount = rng.int(1, holderCount);
      const top3Prize = BigInt(rng.int(10, 500)) * unit + BigInt(rng.int(0, Number(unit) - 1));
      const cutBps = 500n;
      const holdLock = expectedLock(rewardEach * BigInt(fixedCount), cutBps);
      const referLock = expectedLock(top3Prize, cutBps);
      const deposit = holdLock.lockedRaw + referLock.lockedRaw + BigInt(rng.int(0, 5)) * unit;

      const project = await step('launch the project: token, 2-of-2 vault, deposit, link', async () => {
        const p = await launchProject(sim, team, { name: 'Basic Project', ticker: 'BASIC', decimals, depositRaw: deposit, extraRaw: 1000n * unit });
        checkEqual(p.project.vault_status, 'linked', 'vault status');
        checkEqual(p.project.fee_paid, true, 'project fee_paid');
        checkEqual(Number(p.project.fee_amount_sol), 0, 'project fee_amount_sol');
        ctx.note('plan', p.project.plan);
        return { p, detail: 'vault ' + p.vault.slice(0, 6) + '… holds ' + human(deposit, decimals) + ' BASIC; plan column ' + p.project.plan };
      }).then((v) => v.p);

      await step('Raid is not offered (hidden in the builder and refused by the worker)', async () => {
        await refused(() => team.platform.createCampaign(project.id, { title: 'Raid', type: 'raid', rule: 'Raid', reward: '1', config: { holderCount: '1' } }), /not offered/i, 'raid campaign');
        const direct = await sim.world.api('POST', '/api/campaigns', { projectId: project.id, title: 'Raid', type: 'raid', rule: 'r', reward: '1', config: { holderCount: '1' } }, team.token);
        checkEqual(direct.status, 400, 'worker status for raid');
        return 'refused by platform.js and by the worker';
      });

      const minBalance = BigInt(rng.int(1, 50));
      const hold = await step('create the Hold campaign and lock its prize', async () => {
        const c = await createCampaign(sim, project, {
          title: 'Hold BASIC', type: 'hold', rule: 'Hold at least ' + minBalance + ' BASIC until the end.',
          rewardMode: 'fixed', reward: human(rewardEach, decimals), config: { holderCount: String(fixedCount), minBalance: String(minBalance) }, days: 7,
        });
        checkEqual(c.prize_raw.toString(), holdLock.prizeRaw.toString(), 'prize_raw');
        checkEqual(c.locked_raw.toString(), holdLock.lockedRaw.toString(), 'locked_raw');
        checkEqual(c.cut_raw.toString(), holdLock.cutRaw.toString(), 'cut_raw');
        return { c, detail: fixedCount + ' × ' + human(rewardEach, decimals) + ' locked as ' + human(holdLock.lockedRaw, decimals) + ' with the cut' };
      }).then((v) => v.c);

      await step('the public page shows the locked prize', async () => {
        const page = await sim.world.app(new Request(sim.world.base + '/c/' + hold.id));
        const html = await page.text();
        check(page.status === 200 && html.includes('id="prize-line"'), 'campaign page did not load');
        const state = await publicState(sim, hold.id);
        checkEqual(state.prize.locked, true, 'prize.locked');
        checkEqual(state.prize.prize_raw, holdLock.prizeRaw.toString(), 'public prize_raw');
        checkEqual(state.clock.state, 'live', 'clock');
        if (ctx.browser) await checkPublicPage(ctx, sim, hold.id, { prizeRaw: holdLock.prizeRaw, decimals, ticker: 'BASIC' });
        return 'prize ' + human(state.prize.prize_raw, decimals) + ' BASIC locked' + (ctx.browser ? '; checked in Chromium' : '');
      });

      const refer = await step('create the Refer campaign (top 3) and lock its prize', async () => {
        const c = await createCampaign(sim, project, {
          title: 'Refer friends', type: 'refer', rule: 'Bring holders in with your link.', rewardMode: 'top3',
          prize: human(top3Prize, decimals), config: {}, days: 7,
        });
        checkEqual(c.locked_raw.toString(), referLock.lockedRaw.toString(), 'locked_raw');
        const rows = ok(await sim.world.rest('GET', '/projects?id=eq.' + project.id + '&select=vault_reserved_raw'), 'project');
        checkEqual(String(rows[0].vault_reserved_raw), (holdLock.lockedRaw + referLock.lockedRaw).toString(), 'project reserved raw');
        return { c, detail: 'reserved ' + human(holdLock.lockedRaw + referLock.lockedRaw, decimals) + ' of ' + human(deposit, decimals) };
      }).then((v) => v.c);

      const holders = await step(holderCount + ' holders sign in with their wallets', async () => {
        const list = await makeHolders(sim, holderCount);
        return { list, detail: holderCount + ' sessions' };
      }).then((v) => v.list);

      const balances = new Map(holders.map((h) => [h.wallet, BigInt(rng.int(0, Number(minBalance) * 3)) * unit + BigInt(rng.int(0, 9))]));
      await step('holders buy the token (seeded balances, some under the minimum)', async () => {
        await giveTokens(sim, project, holders, (h) => balances.get(h.wallet));
        const under = holders.filter((h) => balances.get(h.wallet) < minBalance * unit).length;
        return (holders.length - under) + ' at or over ' + minBalance + ' BASIC, ' + under + ' under';
      });

      let uiJoiner = null;
      await step('holders join the Hold campaign' + (ctx.browser ? ' (one through the page in Chromium)' : ''), async () => {
        let rest = holders;
        if (ctx.browser) {
          uiJoiner = holders[0];
          await joinThroughPage(ctx, sim, hold.id, uiJoiner);
          rest = holders.slice(1);
        }
        await joinAll(project, hold, rest);
        const rows = await joinRows(sim, hold.id);
        checkEqual(rows.length, holders.length, 'join rows');
        check(rows.every((r) => r.status === 'approved' && r.qualified === false && r.progress === 0), 'an open join was not approved at zero');
        const state = await publicState(sim, hold.id);
        checkEqual(state.counts.joined, holders.length, 'public joined count');
        return holders.length + ' joined; public count ' + state.counts.joined;
      });

      const referrers = new Map();
      await step('holders join the Refer campaign through each other\'s links', async () => {
        const joined = [];
        for (const h of rng.shuffle(holders)) {
          const by = joined.length && rng.bool(0.7) ? rng.pick(joined) : null;
          await h.platform.joinCampaign(project.id, refer.id, h.wallet, null, false, null, by ? by.wallet : null, null);
          if (by) referrers.set(h.wallet, by.wallet);
          joined.push(h);
        }
        const rows = await joinRows(sim, refer.id);
        for (const row of rows) checkEqual(row.referred_by || null, referrers.get(row.wallet) || null, 'referred_by for ' + labelOf(sim, row.wallet));
        return referrers.size + ' referred joins recorded';
      });

      await step('a holder cannot refer themselves or change their referrer', async () => {
        const h = holders[0];
        await refused(() => sim.world.api('POST', '/api/campaigns/' + refer.id + '/referred-by', { referrer: h.wallet }, h.token), /refer itself/i, 'self referral');
        const other = holders.find((x) => x.wallet !== h.wallet && x.wallet !== referrers.get(h.wallet));
        if (referrers.get(h.wallet) && other) {
          await refused(() => sim.world.api('POST', '/api/campaigns/' + refer.id + '/referred-by', { referrer: other.wallet }, h.token), /already set/i, 'second referrer');
        }
        return 'refused';
      });

      const qualified = holders.filter((h) => balances.get(h.wallet) >= minBalance * unit).map((h) => h.wallet);
      await step('the team qualifies Hold holders from on-chain balances', async () => {
        const queue = await team.platform.fetchJoinQueue(hold.id);
        for (const row of queue.joins) {
          checkEqual(row.evidence.balance_raw, balances.get(row.wallet).toString(), 'queue balance for ' + labelOf(sim, row.wallet));
          checkEqual(row.evidence.meets_min, balances.get(row.wallet) >= minBalance * unit, 'meets_min for ' + labelOf(sim, row.wallet));
        }
        const res = await team.platform.qualifyMatching(hold.id);
        checkEqual(res.qualified, qualified.length, 'qualified count');
        const rows = await joinRows(sim, hold.id);
        for (const row of rows) checkEqual(row.qualified, qualified.includes(row.wallet), 'qualified flag for ' + labelOf(sim, row.wallet));
        return qualified.length + ' of ' + holders.length + ' qualified';
      });

      const holdPoints = new Map();
      await step('the team scores Hold holders and the leaderboard follows', async () => {
        for (const wallet of qualified) {
          const pts = rng.int(0, 100);
          holdPoints.set(wallet, pts);
          await team.platform.setJoinProgress(hold.id, wallet, pts, null);
        }
        const state = await publicState(sim, hold.id);
        const rows = await joinRows(sim, hold.id);
        const expected = boardOrder(rows);
        checkEqual(state.board.map((b) => b.progress), expected.map((r) => r.progress), 'board points order');
        checkEqual(state.board.map((b) => b.qualified), expected.map((r) => r.qualified), 'board qualified order');
        checkEqual(state.counts.qualified, qualified.length, 'public qualified count');
        return 'board of ' + state.board.length + ', top ' + (state.board[0] ? state.board[0].progress : 0) + ' points';
      });

      await step('the team scores Refer holders by referrals and the leaderboard follows', async () => {
        const queue = await team.platform.fetchJoinQueue(refer.id);
        const counts = new Map();
        for (const [, by] of referrers) counts.set(by, (counts.get(by) || 0) + 1);
        for (const row of queue.joins) {
          checkEqual(row.evidence.referral_count, counts.get(row.wallet) || 0, 'referral count for ' + labelOf(sim, row.wallet));
          await team.platform.setJoinProgress(refer.id, row.wallet, row.evidence.referral_count, null);
        }
        const state = await publicState(sim, refer.id);
        const expected = boardOrder(await joinRows(sim, refer.id));
        checkEqual(state.board.map((b) => b.progress), expected.map((r) => r.progress), 'refer board order');
        return 'top referrer brought ' + (state.board[0] ? state.board[0].progress : 0);
      });

      await step('a holder cannot score themselves', async () => {
        const h = holders[holders.length - 1];
        await refused(() => sim.world.api('POST', '/api/joins/progress', { campaignId: hold.id, wallet: h.wallet, progress: 999 }, h.token), /not the project admin/i, 'self score');
        const direct = await sim.world.rest('PATCH', '/campaign_joins?campaign_id=eq.' + hold.id + '&wallet=eq.' + h.wallet, { progress: 999, qualified: true }, h.token);
        const rows = await joinRows(sim, hold.id);
        const mine = rows.find((r) => r.wallet === h.wallet);
        check(mine.progress !== 999, 'a holder wrote their own progress through PostgREST (status ' + direct.status + ')');
        return 'worker refused; database kept progress ' + mine.progress;
      });

      await step('the team ends both campaigns', async () => {
        await team.platform.updateCampaignStatus(hold.id, 'ended');
        await team.platform.updateCampaignStatus(refer.id, 'ended');
        const a = await publicState(sim, hold.id);
        const b = await publicState(sim, refer.id);
        checkEqual([a.clock.state, b.clock.state], ['ended', 'ended'], 'clock states');
        return 'both ended';
      });

      const holdRows = await joinRows(sim, hold.id);
      const holdExpected = expectedFixed(holdRows, rewardEach, holdLock.prizeRaw);
      let holdPaid;
      await step('Hold: payouts computed, vault signed by team and Bard, executed', async () => {
        holdPaid = await settle(sim, project, hold.id, {
          afterPropose: async (s) => {
            checkEqual(s.payouts.map((p) => [p.wallet, p.amountRaw]), holdExpected.map((p) => [p.wallet, p.amountRaw]), 'Hold payouts');
            const total = holdExpected.reduce((n, p) => n + BigInt(p.amountRaw), 0n);
            checkEqual(String(s.cut_raw), (total * cutBps / 10000n).toString(), 'cut at payout');
          },
        });
        ctx.fact('holdPayouts', holdExpected.map((p) => [labelOf(sim, p.wallet), p.amountRaw]));
        return holdExpected.length + ' paid ' + human(rewardEach, decimals) + ' each; tx ' + holdPaid.signature.slice(0, 8) + '…';
      });

      await step('Hold: the public receipt appears and checks out', async () => {
        const state = await publicState(sim, hold.id);
        checkEqual(state.clock.state, 'paid', 'clock');
        checkEqual(state.links.receipt, '/c/' + hold.id + '/receipt', 'receipt link');
        const receipt = ok(await sim.world.api('GET', '/api/campaigns/' + hold.id + '/receipt'), 'receipt');
        checkEqual(receipt.settlement.tx_signature, holdPaid.signature, 'receipt signature');
        checkEqual(receipt.settlement.transactions.map((t) => t.tx_signature), holdPaid.signatures, 'receipt transactions, one per vault transaction');
        check(receipt.settlement.hash_recomputed_ok === true, 'receipt is not verified: ' + JSON.stringify(receipt));
        checkEqual(receipt.rows.filter((r) => !r.is_platform_cut).length, holdExpected.length, 'receipt holder rows');
        checkEqual(receipt.rows.some((r) => r.is_platform_cut), BigInt(holdPaid.settlement.cut_raw || 0) > 0n, 'receipt cut row');
        const claims = ok(await sim.world.rest('GET', '/platform_claims?campaign_id=eq.' + hold.id + '&select=wallet,settled'), 'claims');
        checkEqual(claims.length, holdExpected.length, 'claim rows');
        if (ctx.browser) await checkReceiptPage(ctx, sim, hold.id, holdExpected.length);
        return 'receipt verified with ' + receipt.rows.length + ' rows' + (ctx.browser ? '; checked in Chromium' : '');
      });

      await step('Refer: top 3 payouts (50/30/20 with rounding), settled', async () => {
        const rows = await joinRows(sim, refer.id);
        const expected = expectedTop3(rows, top3Prize);
        const done = await settle(sim, project, refer.id, {
          afterPropose: async (s) => checkEqual(s.payouts.map((p) => [p.wallet, p.amountRaw]), expected.map((p) => [p.wallet, p.amountRaw]), 'Top 3 payouts'),
        });
        ctx.fact('referPayouts', expected.map((p) => [labelOf(sim, p.wallet), p.amountRaw]));
        const paid = expected.reduce((n, p) => n + BigInt(p.amountRaw), 0n);
        return expected.length + ' paid ' + human(paid, decimals) + ' of ' + human(top3Prize, decimals) + '; tx ' + done.signature.slice(0, 8) + '…';
      });

      await step('every reservation is released once both campaigns are paid', async () => {
        const rows = ok(await sim.world.rest('GET', '/projects?id=eq.' + project.id + '&select=vault_reserved_raw'), 'project');
        checkEqual(String(rows[0].vault_reserved_raw), '0', 'project reserved raw');
        const res = ok(await sim.world.rest('GET', '/vault_reservations?project_id=eq.' + project.id + '&select=status'), 'reservations');
        check(res.every((r) => r.status === 'settled'), 'a reservation is still open');
        return res.length + ' reservations settled';
      });

      ctx.fact('holders', holderCount);
      ctx.fact('decimals', decimals);
      ctx.fact('qualified', qualified.map((w) => labelOf(sim, w)));
    } finally {
      await closeSim(sim);
    }
  },
};
