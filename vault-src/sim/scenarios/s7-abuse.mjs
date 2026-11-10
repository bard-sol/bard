/**
 * Scenario 7. Abuse and edge cases: the same wallet joining twice, bad base58 addresses, a
 * holder who drops below the hold amount, zero joiners, a prize smaller than the winner count,
 * rounding remainders, cosigning a settlement twice, executing before both signatures, joining
 * after the end, and a settlement with more holders than one vault transaction can pay.
 */
import { Keypair } from '@solana/web3.js';
import { check, checkEqual, ok, refused } from '../lib/harness.mjs';
import {
  openSim, closeSim, makeTeam, makeHolders, launchProject, giveTokens, createCampaign,
  expectedLock, joinAll, joinRows, settle, human, labelOf, ageCampaign,
} from '../lib/journey.mjs';
import { createPayoutProposal, teamApprove, executePayout } from '../../src/index.js';
import { expectedPool, expectedCut } from '../lib/expect.mjs';

const BAD_ADDRESSES = ['', 'not-a-wallet', '0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl', '1111', 'So11111111111111111111111111111111111111112x', '<script>alert(1)</script>', ' '.repeat(44)];

export default {
  id: 's7',
  name: 'Abuse and edge cases',
  async run(ctx) {
    const { rng, step } = ctx;
    let sim;
    try {
      sim = await openSim(ctx);
      const decimals = 6;
      const unit = 10n ** 6n;
      const team = await step('team signs in', async () => makeTeam(sim, 'team'));

      await step('bad base58 addresses are refused at project creation and sign-in', async () => {
        for (const bad of BAD_ADDRESSES) {
          await refused(() => sim.world.api('POST', '/api/projects', { name: 'Bad', ticker: 'BAD', mint: bad }, team.token), /required|invalid|mint/i, 'mint ' + JSON.stringify(bad));
          await refused(() => sim.world.api('POST', '/api/auth/nonce', { wallet: bad }), null, 'sign-in for ' + JSON.stringify(bad));
        }
        const rows = ok(await sim.world.rest('GET', '/projects?select=id'), 'projects');
        checkEqual(rows.length, 0, 'projects saved from bad input');
        return BAD_ADDRESSES.length + ' bad addresses refused at project and sign-in';
      });

      // Room for every campaign in this scenario, plus spare.
      const deposit = 100000n * unit;
      const project = await step('launch the project', async () => {
        const p = await launchProject(sim, team, { name: 'Edge Project', ticker: 'EDGE', decimals, depositRaw: deposit, extraRaw: 100000n * unit });
        return { p, detail: 'vault holds ' + human(deposit, decimals) };
      }).then((v) => v.p);

      await step('linking a vault with a bad address is refused', async () => {
        for (const bad of BAD_ADDRESSES.slice(1)) {
          await refused(() => sim.world.api('POST', '/api/projects/' + project.id + '/vault', { multisig: bad, address: bad, mint: project.mint }, team.token), /invalid|Squads|vault/i, 'vault ' + JSON.stringify(bad));
        }
        const row = ok(await sim.world.rest('GET', '/projects?id=eq.' + project.id + '&select=vault_address'), 'project')[0];
        checkEqual(row.vault_address, project.vault, 'linked vault after bad attempts');
        return 'refused; linked vault unchanged';
      });

      const holders = await makeHolders(sim, ctx.holderCount(8, 30));
      const pool = BigInt(rng.int(7, 99)) * unit + 7n;

      // --- the same wallet joins twice ---
      const twice = await createCampaign(sim, project, { title: 'Join twice', type: 'custom', rule: 'r', rewardMode: 'pool', pool: human(pool, decimals), days: 7 });
      await step('the same wallet joins twice (page, then again, then straight to the database)', async () => {
        const h = holders[0];
        await h.platform.joinCampaign(project.id, twice.id, h.wallet, null, false, null, null, null);
        await h.platform.joinCampaign(project.id, twice.id, h.wallet, null, false, null, null, null);
        const dup = await sim.world.rest('POST', '/campaign_joins', { project_id: project.id, campaign_id: twice.id, wallet: h.wallet }, h.token);
        check(dup.status >= 400, 'a second join row was accepted');
        const rows = (await joinRows(sim, twice.id)).filter((r) => r.wallet === h.wallet);
        checkEqual(rows.length, 1, 'rows for the wallet');
        return 'one row; direct duplicate refused (' + dup.status + ')';
      });

      await step('a holder cannot join in someone else\'s name', async () => {
        const [a, b] = [holders[1], holders[2]];
        await refused(() => a.platform.joinCampaign(project.id, twice.id, b.wallet, null, false, null, null, null), null, 'join as another wallet');
        const rows = await joinRows(sim, twice.id);
        check(!rows.some((r) => r.wallet === b.wallet), 'a join was written for another wallet');
        return 'refused by the database';
      });

      // --- prize smaller than the winner count, and the rounding remainder ---
      const tiny = BigInt(rng.int(1, 4));
      const small = await step('a pool smaller than the number of winners (' + tiny + ' raw units)', async () => {
        const c = await createCampaign(sim, project, { title: 'Tiny pool', type: 'custom', rule: 'r', rewardMode: 'pool', pool: human(tiny, decimals), days: 7 });
        const five = holders.slice(3, 8);
        await joinAll(project, c, five);
        for (const h of five) await team.platform.markQualified(project.id, c.id, h.wallet);
        await team.platform.updateCampaignStatus(c.id, 'ended');
        const rows = await joinRows(sim, c.id);
        const expected = expectedPool(rows, tiny);
        checkEqual(expected.length, Number(tiny), 'only as many winners as raw units');
        const done = await settle(sim, project, c.id, {
          afterPropose: async (s) => {
            checkEqual(s.payouts.map((p) => [p.wallet, p.amountRaw]), expected.map((p) => [p.wallet, p.amountRaw]), 'tiny pool payouts');
            checkEqual(s.cut_waived, true, 'a cut that rounds to zero is waived');
          },
        });
        return { c, detail: tiny + ' of 5 qualified get 1 raw unit each; the rest get nothing; cut waived; tx ' + done.signature.slice(0, 8) + '…' };
      }).then((v) => v.c);
      void small;

      await step('rounding: a pool that does not divide evenly is paid to the last unit; the lock\'s extra cut stays in the vault', async () => {
        const n = rng.int(3, 6);
        const odd = BigInt(rng.int(1, 999)) * unit + BigInt(rng.int(1, n - 1));
        const lock = expectedLock(odd, 500n);
        const c = await createCampaign(sim, project, { title: 'Odd pool', type: 'custom', rule: 'r', rewardMode: 'pool', pool: human(odd, decimals), days: 7 });
        const who = holders.slice(8, 8 + n).length === n ? holders.slice(8, 8 + n) : holders.slice(0, n);
        await joinAll(project, c, who);
        for (const h of who) await team.platform.markQualified(project.id, c.id, h.wallet);
        await team.platform.updateCampaignStatus(c.id, 'ended');
        const expected = expectedPool(await joinRows(sim, c.id), odd);
        const sum = expected.reduce((x, p) => x + BigInt(p.amountRaw), 0n);
        checkEqual(sum.toString(), odd.toString(), 'pool paid to the last unit');
        const cut = expectedCut(expected, 500);
        await settle(sim, project, c.id, {
          afterPropose: async (s) => {
            checkEqual(s.payouts.map((p) => p.amountRaw), expected.map((p) => p.amountRaw), 'odd pool payouts');
            checkEqual(String(s.cut_raw), cut.toString(), 'cut rounds down at payout');
          },
        });
        check(lock.cutRaw >= cut, 'the cut paid is more than the cut locked');
        return n + ' holders share ' + human(odd, decimals) + ' (remainder ' + (odd % BigInt(n)) + ' raw); locked cut ' + lock.cutRaw + ', paid cut ' + cut;
      });

      // --- hold: a holder drops below the hold amount ---
      const min = BigInt(rng.int(10, 100));
      const hold = await createCampaign(sim, project, { title: 'Hold edge', type: 'hold', rule: 'Hold ' + min, rewardMode: 'fixed', reward: '1', config: { holderCount: '6', minBalance: String(min) }, days: 7 });
      const holdPeople = holders.slice(0, 6);
      await step('a holder who sells below the minimum before the check is not qualified', async () => {
        await giveTokens(sim, project, holdPeople, () => min * unit * 2n);
        await joinAll(project, hold, holdPeople);
        const seller = holdPeople[0];
        await sim.chain.fundSol(seller.wallet, 10_000_000n);
        // Earlier payouts in this scenario may have paid the seller too: sell down from what they hold.
        const held = await sim.chain.tokenBalance(seller.wallet, project.mint);
        await sim.chain.transferTokens(team.keypair, seller.keypair, project.mint, team.wallet, held - (min * unit - 1n), decimals);
        checkEqual(await sim.chain.tokenBalance(seller.wallet, project.mint), min * unit - 1n, 'seller balance');
        const res = await team.platform.qualifyMatching(hold.id);
        checkEqual(res.qualified, holdPeople.length - 1, 'qualified');
        const row = (await joinRows(sim, hold.id)).find((r) => r.wallet === seller.wallet);
        checkEqual(row.qualified, false, 'seller qualified');
        return labelOf(sim, seller.wallet) + ' is 1 raw unit short and stays unqualified';
      });

      await step('a qualified holder who sells afterwards is shown below the minimum and the team can drop them', async () => {
        const late = holdPeople[1];
        await sim.chain.fundSol(late.wallet, 10_000_000n);
        const held = await sim.chain.tokenBalance(late.wallet, project.mint);
        await sim.chain.transferTokens(team.keypair, late.keypair, project.mint, team.wallet, held - (min * unit - 1n), decimals);
        const { clearHolderBalanceCache } = await import('../../../server/queue.js');
        clearHolderBalanceCache();
        const queue = await team.platform.fetchJoinQueue(hold.id);
        const mine = queue.joins.find((j) => j.wallet === late.wallet);
        checkEqual(mine.evidence.meets_min, false, 'queue shows the sale');
        checkEqual(mine.qualified, true, 'still marked qualified until the team acts');
        await team.platform.setJoinStatus(hold.id, late.wallet, 'rejected');
        await team.platform.updateCampaignStatus(hold.id, 'ended');
        const rows = await joinRows(sim, hold.id);
        await settle(sim, project, hold.id, {
          afterPropose: async (s) => check(!s.payouts.some((p) => p.wallet === late.wallet), 'the seller is still paid'),
        });
        checkEqual(rows.filter((r) => r.qualified && r.status !== 'rejected').length, holdPeople.length - 2, 'paid holders');
        return 'queue says below minimum; rejected; not paid';
      });

      // --- zero joiners ---
      await step('a campaign nobody joins cannot be paid, and no settlement is left behind', async () => {
        const c = await createCampaign(sim, project, { title: 'Empty', type: 'custom', rule: 'r', rewardMode: 'pool', pool: '5', days: 7 });
        await team.platform.updateCampaignStatus(c.id, 'ended');
        await refused(() => team.platform.proposeSettlement(project.id, c.id), /No qualified/i, 'propose with zero joiners');
        const rows = ok(await sim.world.rest('GET', '/vault_settlements?campaign_id=eq.' + c.id + '&select=id'), 'settlements');
        checkEqual(rows.length, 0, 'settlements left behind');
        ctx.note('emptyCampaign', c.id);
        return 'refused cleanly';
      });

      await step('the locked prize of a campaign nobody joined can be released back to the team', async () => {
        const c = ok(await sim.world.rest('GET', '/campaigns?project_id=eq.' + project.id + '&title=eq.Empty&select=id,locked_raw'), 'empty')[0];
        await team.platform.updateCampaignStatus(c.id, 'cancelled').catch(() => {});
        const row = ok(await sim.world.rest('GET', '/campaigns?id=eq.' + c.id + '&select=status,vault_reserved_raw'), 'campaign')[0];
        const project1 = ok(await sim.world.rest('GET', '/projects?id=eq.' + project.id + '&select=vault_reserved_raw'), 'project')[0];
        check(String(row.vault_reserved_raw) === '0', 'campaign still reserves ' + row.vault_reserved_raw + ' (status ' + row.status + '; project reserves ' + project1.vault_reserved_raw + ')');
        return 'released';
      }, { known: 'B7 (TRAA-2331) no way to cancel a campaign and release its locked prize (zero joiners, or a settlement that cannot be built)' });

      // --- signatures: cosign twice, wrong signer, execute early ---
      const sig = await createCampaign(sim, project, { title: 'Signatures', type: 'custom', rule: 'r', rewardMode: 'pool', pool: '3', days: 7 });
      await step('cosigning twice, signing for the other side, and executing before both signatures are refused', async () => {
        const who = holders.slice(10, 12).length === 2 ? holders.slice(10, 12) : holders.slice(0, 2);
        await joinAll(project, sig, who);
        for (const h of who) await team.platform.markQualified(project.id, sig.id, h.wallet);
        await team.platform.updateCampaignStatus(sig.id, 'ended');
        const conn = sim.chain.connection;
        const settlement = await team.platform.proposeSettlement(project.id, sig.id);
        const cut = BigInt(settlement.cut_raw || 0) > 0n ? { wallet: settlement.cut_wallet, amountRaw: String(settlement.cut_raw) } : null;
        const proposal = await createPayoutProposal(conn, team.keypair, team.wallet, project.multisig, project.mint, settlement.payouts, cut);
        const intruder = holders[holders.length - 1];
        await refused(() => sim.world.api('POST', '/api/settlements/' + settlement.id + '/team-signed', { txIndex: proposal.transactionIndex }, intruder.token), /admin|403|not/i, 'a holder records the team signature');
        await refused(() => team.platform.signSettlement(settlement.id, 'team', { txIndex: proposal.transactionIndex }), /approv|sign|not/i, 'team-signed before the team approved on chain');
        await refused(() => sim.bardActor.platform.signSettlement(settlement.id, 'bard', { txIndex: proposal.transactionIndex }), /team|approv|sign|order/i, 'Bard signs before the team');
        const teamSig = await teamApprove(conn, team.keypair, team.wallet, project.multisig, proposal.transactionIndex);
        const first = await team.platform.signSettlement(settlement.id, 'team', { sig: teamSig, txIndex: proposal.transactionIndex });
        const again = await team.platform.signSettlement(settlement.id, 'team', { sig: teamSig, txIndex: proposal.transactionIndex }).catch((err) => ({ error: err.message }));
        const row1 = ok(await sim.world.rest('GET', '/vault_settlements?id=eq.' + settlement.id + '&select=status,team_signed,bard_signed,tx_index'), 'settlement')[0];
        checkEqual([row1.team_signed, row1.bard_signed, String(row1.tx_index)], [true, false, String(proposal.transactionIndex)], 'state after a second team cosign');
        await refused(() => team.platform.signSettlement(settlement.id, 'bard', { txIndex: proposal.transactionIndex }), null, 'the team records Bard\'s signature');
        await refused(() => executePayout(conn, team.keypair, team.wallet, project.multisig, proposal.transactionIndex), null, 'on-chain execute with one signature');
        await refused(() => team.platform.executeSettlement(settlement.id, teamSig, project.id), null, 'recording the team approval as the payout');
        const fake = Keypair.generate();
        await refused(() => team.platform.executeSettlement(settlement.id, 'x'.repeat(10), project.id), /signature/i, 'a junk signature');
        void fake;
        await teamApprove(conn, sim.bard, sim.bard.publicKey.toBase58(), project.multisig, proposal.transactionIndex);
        const bard1 = await sim.bardActor.platform.signSettlement(settlement.id, 'bard', { txIndex: proposal.transactionIndex });
        const bard2 = await sim.bardActor.platform.signSettlement(settlement.id, 'bard', { txIndex: proposal.transactionIndex }).catch((err) => ({ error: err.message }));
        checkEqual(bard1.status, 'both_signed', 'status after Bard');
        const row2 = ok(await sim.world.rest('GET', '/vault_settlements?id=eq.' + settlement.id + '&select=status,team_signed,bard_signed'), 'settlement')[0];
        checkEqual([row2.status, row2.team_signed, row2.bard_signed], ['both_signed', true, true], 'state after a second Bard cosign');
        const signature = await executePayout(conn, team.keypair, team.wallet, project.multisig, proposal.transactionIndex);
        const done = await team.platform.executeSettlement(settlement.id, signature, project.id);
        checkEqual(done.status, 'executed', 'executed');
        const replay = await team.platform.executeSettlement(settlement.id, signature, project.id);
        checkEqual(replay.status, 'executed', 'recording the same payout twice is harmless');
        await refused(() => team.platform.executeSettlement(settlement.id, teamSig, project.id), /closed|signature/i, 'recording another signature after execution');
        await refused(() => team.platform.proposeSettlement(project.id, sig.id), /paid|settlement/i, 'paying the campaign again');
        return 'second cosigns: team ' + (again.error ? 'refused' : 'no change') + ', Bard ' + (bard2.error ? 'refused' : 'no change') + '; early execute refused on chain and by the worker';
      });

      // --- join after the end ---
      await step('a holder cannot join a campaign that has ended, been paid, or run past its end date', async () => {
        const late = holders[holders.length - 2];
        const outcomes = [];
        const overdue = await createCampaign(sim, project, { title: 'Overdue', type: 'custom', rule: 'r', rewardMode: 'pool', pool: '1', days: 3 });
        await ageCampaign(sim, overdue.id, 4);
        for (const c of [hold, sig, overdue]) {
          const before = (await joinRows(sim, c.id)).some((r) => r.wallet === late.wallet);
          check(!before, 'already joined');
          const res = await late.platform.joinCampaign(project.id, c.id, late.wallet, null, false, null, null, null).then(() => 'accepted', (err) => 'refused: ' + err.message);
          outcomes.push(c.title + ' ' + res);
        }
        check(outcomes.every((o) => /refused: .*not open for joins/.test(o)), outcomes.join('; '));
        return outcomes.join('; ');
      });

      // --- more holders than one vault transaction can pay ---
      await step('a fixed prize for 8 holders is proposed, signed and paid', async () => {
        const c = await createCampaign(sim, project, { title: 'Eight', type: 'custom', rule: 'r', rewardMode: 'fixed', reward: '1', config: { holderCount: '8' }, days: 7 });
        const eight = holders.slice(0, 8);
        await joinAll(project, c, eight);
        for (const h of eight) await team.platform.markQualified(project.id, c.id, h.wallet);
        await team.platform.updateCampaignStatus(c.id, 'ended');
        await settle(sim, project, c.id);
        return 'paid 8';
      }, { known: 'B2 (TRAA-2329) one settlement is one vault transaction, which fits 6 holder transfers plus the cut' });
    } finally {
      await closeSim(sim);
    }
  },
};
