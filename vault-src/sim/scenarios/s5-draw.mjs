/**
 * Scenario 5. Airdrop draw from the roster: the team keeps a roster (trusted and whale wallets
 * are approved on join, blocked wallets cannot join), commits a draw to a future Solana slot,
 * and finalizes it from that slot's blockhash. Anyone can recompute the winners from the stored
 * seed; the same seed always gives the same winners. The winners are who gets paid.
 * The draw is committed the way the team button does it: draw_count 0, the whole roster in draw
 * order. The locked prize then pays the first winners in that order (TRAA-2335).
 */
import { check, checkEqual, ok, refused } from '../lib/harness.mjs';
import {
  openSim, closeSim, makeTeam, makeHolders, launchProject, createCampaign,
  expectedLock, joinRows, settle, human, labelOf,
} from '../lib/journey.mjs';
import { computePayouts, deriveWinners as serverWinners, DRAW_SLOT_OFFSET } from '../../../server/settlement.js';

export default {
  id: 's5',
  name: 'Airdrop draw from the roster: seeded, reproducible, and the winners are paid',
  async run(ctx) {
    const { rng, step } = ctx;
    let sim;
    try {
      sim = await openSim(ctx);
      const decimals = 6;
      const unit = 10n ** 6n;
      const winnersWanted = rng.int(1, 6);
      const each = BigInt(rng.int(1, 20)) * unit;
      const lock = expectedLock(each * BigInt(winnersWanted), 500n);
      const team = await step('team signs in', async () => makeTeam(sim, 'team'));
      const project = await step('launch the project', async () => {
        const p = await launchProject(sim, team, { name: 'Draw Project', ticker: 'DRAW', decimals, depositRaw: lock.lockedRaw });
        return { p, detail: 'locked ' + human(lock.lockedRaw, decimals) };
      }).then((v) => v.p);

      const holders = await step('holders sign in', async () => {
        const list = await makeHolders(sim, ctx.holderCount(10, 50));
        return { list, detail: list.length + ' holders' };
      }).then((v) => v.list);

      const roles = new Map();
      await step('the team builds its roster: trusted, whale and blocked wallets', async () => {
        const picks = rng.shuffle(holders);
        const trusted = picks.slice(0, rng.int(1, 4));
        const whales = picks.slice(trusted.length, trusted.length + rng.int(1, 3));
        const blocked = picks.slice(trusted.length + whales.length, trusted.length + whales.length + rng.int(1, 3));
        for (const h of trusted) { await team.platform.upsertRoster(project.id, h.wallet, 'trusted', 'core'); roles.set(h.wallet, 'trusted'); }
        for (const h of whales) { await team.platform.upsertRoster(project.id, h.wallet, 'whale', null); roles.set(h.wallet, 'whale'); }
        for (const h of blocked) { await team.platform.upsertRoster(project.id, h.wallet, 'blocked', 'sniper'); roles.set(h.wallet, 'blocked'); }
        const list = await team.platform.listRoster(project.id);
        checkEqual(list.length, roles.size, 'roster rows');
        return trusted.length + ' trusted, ' + whales.length + ' whale, ' + blocked.length + ' blocked';
      });

      await step('a holder cannot add themselves to the roster or edit it', async () => {
        const h = holders.find((x) => !roles.has(x.wallet));
        await refused(() => h.platform.upsertRoster(project.id, h.wallet, 'trusted', 'me'), null, 'self roster');
        const blockedWallet = [...roles].find(([, r]) => r === 'blocked')[0];
        await sim.world.rest('DELETE', '/project_roster?project_id=eq.' + project.id + '&wallet=eq.' + blockedWallet, undefined, h.token);
        const list = ok(await sim.world.rest('GET', '/project_roster?project_id=eq.' + project.id + '&select=wallet,role'), 'roster');
        checkEqual(list.length, roles.size, 'roster rows after a holder tried to delete one');
        return 'refused; roster unchanged';
      });

      const campaign = await step('create an approval campaign whose winners come from a draw', async () => {
        const c = await createCampaign(sim, project, { title: 'Airdrop draw', type: 'custom', rule: 'Join; winners are drawn.', rewardMode: 'fixed', reward: human(each, decimals), config: { holderCount: String(winnersWanted) }, accessMode: 'approval', days: 7 });
        return { c, detail: winnersWanted + ' winners × ' + human(each, decimals) };
      }).then((v) => v.c);

      await step('holders join: roster wallets are approved at once, blocked wallets are refused', async () => {
        for (const h of holders) {
          if (roles.get(h.wallet) === 'blocked') {
            await refused(() => h.platform.joinCampaign(project.id, campaign.id, h.wallet, null, false, null, null, null), /blocked/i, 'blocked join');
            continue;
          }
          await h.platform.joinCampaign(project.id, campaign.id, h.wallet, null, false, null, null, null);
        }
        const rows = await joinRows(sim, campaign.id);
        for (const row of rows) {
          const role = roles.get(row.wallet);
          checkEqual(row.status, role === 'trusted' || role === 'whale' ? 'approved' : 'pending', 'status for ' + labelOf(sim, row.wallet) + ' (' + (role || 'none') + ')');
        }
        checkEqual(rows.some((r) => roles.get(r.wallet) === 'blocked'), false, 'a blocked wallet joined');
        return rows.length + ' joined; ' + rows.filter((r) => r.status === 'approved').length + ' approved by the roster';
      });

      await step('the team approves some of the rest and rejects some', async () => {
        const rows = await joinRows(sim, campaign.id);
        for (const row of rows.filter((r) => r.status === 'pending')) {
          const pick = rng.int(0, 2);
          if (pick === 1) await team.platform.setJoinStatus(campaign.id, row.wallet, 'approved');
          if (pick === 2) await team.platform.setJoinStatus(campaign.id, row.wallet, 'rejected');
        }
        const after = await joinRows(sim, campaign.id);
        return after.filter((r) => r.status === 'approved').length + ' approved, ' + after.filter((r) => r.status === 'rejected').length + ' rejected, ' + after.filter((r) => r.status === 'pending').length + ' pending';
      });

      let committed;
      await step('the team commits the draw to a future slot with the draw button', async () => {
        const before = await sim.chain.slot();
        committed = await team.platform.commitDraw(campaign.id, 0);
        check(Number(committed.drawSlot) >= before + DRAW_SLOT_OFFSET, 'draw slot is not in the future');
        checkEqual(Number(committed.drawCount), 0, 'draw count from the button');
        await refused(() => team.platform.finalizeDraw(campaign.id), /not final/i, 'finalize before the slot');
        await refused(() => team.platform.commitDraw(campaign.id, 0), null, 'second commit');
        const early = ok(await sim.world.rest('GET', '/campaigns?id=eq.' + campaign.id + '&select=*'), 'campaign')[0];
        const joins = await joinRows(sim, campaign.id);
        let payError = null;
        try { computePayouts(early, joins, decimals); } catch (err) { payError = err; }
        check(payError && /Finalize the draw/.test(payError.message), 'a committed draw could be paid before the reveal');
        return 'slot ' + committed.drawSlot + ' (now ' + before + '); early finalize, a second commit and an early payout refused';
      });

      let drawn;
      await step('the slot passes; the team finalizes from that slot\'s blockhash', async () => {
        await sim.chain.waitForSlot(Number(committed.drawSlot) + 2);
        drawn = await team.platform.finalizeDraw(campaign.id);
        check(drawn.drawSeed && Number(drawn.drawSeedSlot) >= Number(committed.drawSlot), 'no seed');
        const rows = await joinRows(sim, campaign.id);
        const eligible = rows.filter((r) => r.status === 'approved');
        checkEqual(drawn.drawWinners.length, eligible.length, 'winner count (the whole roster in draw order)');
        for (const w of drawn.drawWinners) check(eligible.some((r) => r.wallet === w.wallet), 'a winner was not approved');
        await refused(() => team.platform.finalizeDraw(campaign.id), null, 'second finalize');
        ctx.note('drawSeed', drawn.drawSeed);
        return drawn.drawWinners.length + ' winners from slot ' + drawn.drawSeedSlot + (Number(drawn.drawSeedSlot) > Number(committed.drawSlot) ? ' (committed slot was skipped)' : '');
      });

      await step('anyone recomputes the same winners from the stored seed; same seed, same winners', async () => {
        const rows = await joinRows(sim, campaign.id);
        const stored = ok(await sim.world.rest('GET', '/campaigns?id=eq.' + campaign.id + '&select=*'), 'campaign')[0];
        const again = serverWinners(rows, stored.draw_seed, stored.draw_count);
        const twice = serverWinners(rng.shuffle(rows), stored.draw_seed, stored.draw_count);
        checkEqual(again.map((w) => w.wallet), stored.draw_winners.map((w) => w.wallet), 'recomputed winners');
        checkEqual(twice.map((w) => w.wallet), again.map((w) => w.wallet), 'row order does not matter');
        const browser = team.platform.verifyDraw(mapRow(stored), rows);
        check(browser.ok === true, 'platform.verifyDraw (the browser check) rejected the draw');
        const other = serverWinners(rows, stored.draw_seed.slice(1) + 'x', stored.draw_count);
        ctx.fact('winners', again.map((w) => labelOf(sim, w.wallet)));
        const receipt = await sim.world.api('GET', '/api/campaigns/' + campaign.id + '/state');
        check(receipt.data.prize.who_gets_paid === 'draw', 'public page does not say draw');
        return 'match; another seed gives ' + (other.map((w) => w.wallet).join() === again.map((w) => w.wallet).join() ? 'the same' : 'different') + ' winners';
      });

      await step('the draw winners are the ones paid', async () => {
        await team.platform.updateCampaignStatus(campaign.id, 'ended');
        const winners = drawn.drawWinners.map((w) => w.wallet).slice(0, winnersWanted);
        await settle(sim, project, campaign.id, {
          afterPropose: async (s) => checkEqual(s.payouts.map((p) => p.wallet), winners, 'paid wallets vs the first draw winners, in order'),
        });
        return winners.length + ' winners paid ' + human(each, decimals) + ' each';
      });

      await step('the receipt shows the draw seed, slot and winners', async () => {
        const receipt = ok(await sim.world.api('GET', '/api/campaigns/' + campaign.id + '/receipt'), 'receipt');
        check(receipt.draw && receipt.draw.seed === drawn.drawSeed, 'receipt draw seed');
        checkEqual(receipt.draw.winners.length, drawn.drawWinners.length, 'receipt winners');
        return 'seed ' + drawn.drawSeed.slice(0, 8) + '…';
      });
    } finally {
      await closeSim(sim);
    }
  },
};

function mapRow(c) {
  return { drawSeed: c.draw_seed, drawCount: c.draw_count, drawWinners: c.draw_winners, drawSlot: c.draw_slot, drawSeedSlot: c.draw_seed_slot };
}
