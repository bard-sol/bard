/**
 * Scenario 8. Fees stay off. Launch fees were removed (f23ecc8); the only charge left in the
 * code is Bard's cut of each payout, which this scenario sets to 0. Nothing may then reach the
 * fee treasury or the cut wallet: no SOL, no tokens, not even an account touched by a
 * transaction. The team pays only network costs, holders pay nothing, the vault pays exactly the
 * holders, and every page and route says there is no fee. A stray FEES_ENABLED=true is set on the
 * worker to show the old flag is dead.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Keypair } from '@solana/web3.js';
import { check, checkEqual, ok } from '../lib/harness.mjs';
import { root } from '../lib/world.mjs';
import { FEE_TREASURY } from '../../../server/chain.js';
import {
  openSim, closeSim, makeTeam, makeHolders, launchProject, createCampaign,
  expectedLock, joinAll, joinRows, publicState, settle, human,
} from '../lib/journey.mjs';
import { expectedFixed, expectedPool } from '../lib/expect.mjs';
import { readTeamCutSetting } from '../lib/pages.mjs';

const CODE = ['worker.js', 'platform.js', 'admin_app.js', 'campaign.html', 'dashboard.html', 'index.html', 'wrangler.toml'];

function serverFiles() {
  const dir = path.join(root, 'server');
  return CODE.map((f) => path.join(root, f)).concat(
    ['api.js', 'settlement.js', 'chain.js', 'campaign_state.js', 'queue.js', 'score_api.js'].map((f) => path.join(dir, f)),
  );
}

export default {
  id: 's8',
  name: 'Fees stay off: no fee anywhere, the vault pays exactly the holders',
  async run(ctx) {
    const { rng, step } = ctx;
    let sim;
    try {
      await step('the code has no fee switch and no launch fee', async () => {
        const hits = [];
        for (const file of serverFiles()) {
          const text = readFileSync(file, 'utf8');
          if (/FEES_ENABLED|setFeesEnabled|payLaunchFee|fee_amount_sol:\s*0\.25/.test(text)) hits.push(path.relative(root, file));
        }
        checkEqual(hits, [], 'files with a fee switch');
        const prod = readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
        const bps = (prod.match(/BARD_CUT_BPS\s*=\s*"?(\d+)"?/) || [])[1];
        ctx.note('productionCutBps', bps == null ? null : Number(bps));
        return 'no FEES_ENABLED anywhere; production wrangler.toml sets BARD_CUT_BPS ' + (bps == null ? '(unset, 500 by default)' : bps) + ', which this run overrides to 0';
      });

      const cutKeys = Keypair.fromSeed(rng.seedBytes('cut-wallet'));
      const cutWallet = cutKeys.publicKey.toBase58();
      sim = await openSim(ctx, { cutBps: 0, cutWallet, extraEnv: { FEES_ENABLED: 'true' } });
      const watched = [FEE_TREASURY, cutWallet];
      const before = new Map();
      for (const w of watched) before.set(w, await sim.chain.solBalance(w));

      await step('the worker reports a 0 cut and no fee settings', async () => {
        const cfg = ok(await sim.world.api('GET', '/api/config'), 'config');
        checkEqual(cfg.cutBps, 0, 'cutBps');
        const keys = Object.keys(cfg).filter((k) => /fee/i.test(k));
        checkEqual(keys, [], 'fee keys in /api/config');
        return 'cutBps 0; keys ' + Object.keys(cfg).sort().join(', ');
      });

      const decimals = rng.pick([0, 6, 9]);
      const unit = 10n ** BigInt(decimals);
      const each = BigInt(rng.int(1, 50)) * unit + BigInt(rng.int(0, Number(unit > 1000n ? 1000n : unit) - 1));
      const winners = rng.int(2, 5);
      const fixedPrize = each * BigInt(winners);
      const pool = BigInt(rng.int(3, 300)) * unit + BigInt(rng.int(1, 9));
      const prize = fixedPrize + pool;
      const team = await step('team signs in', async () => makeTeam(sim, 'team'));
      const teamSolStart = await sim.chain.solBalance(team.wallet);

      const project = await step('launch a project; the vault lock needs the prize and nothing more', async () => {
        const lockFixed = expectedLock(fixedPrize, 0n);
        const lockPool = expectedLock(pool, 0n);
        checkEqual([lockFixed.cutRaw, lockPool.cutRaw], [0n, 0n], 'cut in the lock');
        checkEqual(lockFixed.lockedRaw + lockPool.lockedRaw, prize, 'lock');
        const p = await launchProject(sim, team, { name: 'No Fee Project', ticker: 'FREE', decimals, depositRaw: prize });
        const row = ok(await sim.world.rest('GET', '/projects?id=eq.' + p.id + '&select=fee_paid,fee_amount_sol,fee_tx'), 'project')[0];
        checkEqual([row.fee_paid, Number(row.fee_amount_sol), row.fee_tx], [true, 0, null], 'project fee columns');
        return { p, detail: 'vault holds exactly the prize, ' + human(prize, decimals) + '; no fee recorded' };
      }).then((v) => v.p);

      const fixed = await createCampaign(sim, project, { title: 'Fixed, no fee', type: 'custom', rule: 'r', rewardMode: 'fixed', reward: human(each, decimals), config: { holderCount: String(winners) }, days: 7 });
      const shared = await createCampaign(sim, project, { title: 'Pool, no fee', type: 'custom', rule: 'r', rewardMode: 'pool', pool: human(pool, decimals), days: 7 });

      await step('campaigns lock the prize with no cut and record no fee', async () => {
        for (const [c, want] of [[fixed, fixedPrize], [shared, pool]]) {
          const row = ok(await sim.world.rest('GET', '/campaigns?id=eq.' + c.id + '&select=fee_paid,fee_amount_sol,cut_bps,cut_raw,locked_raw,prize_raw'), 'campaign')[0];
          checkEqual([row.fee_paid, Number(row.fee_amount_sol), Number(row.cut_bps), String(row.cut_raw), String(row.locked_raw), String(row.prize_raw)],
            [true, 0, 0, '0', want.toString(), want.toString()], c.title);
        }
        const fees = ok(await sim.world.rest('GET', '/fee_payments?select=id'), 'fee_payments');
        checkEqual(fees.length, 0, 'fee_payments rows');
        return 'cut 0; locked = prize; fee_payments empty';
      });

      await step('the public page and the team settings say there is no cut', async () => {
        const state = await publicState(sim, shared.id);
        checkEqual(state.prize.cut_bps, 0, 'public cut_bps');
        const copy = team.platform.campaignPublicCopy ? team.platform.campaignPublicCopy(state) : null;
        if (copy) check(!/Bard takes [1-9]/.test(copy.cut), 'public cut line: ' + copy.cut);
        let shown = 'not checked (no browser)';
        if (ctx.browser) {
          shown = await readTeamCutSetting(ctx, sim, team, project.id);
          check(/^None/.test(shown), 'team settings say "' + shown + '"');
        }
        return 'public cut_bps 0; team settings: ' + shown;
      });

      const holders = await makeHolders(sim, ctx.holderCount(5, 20));
      const holderSol = new Map();
      for (const h of holders) holderSol.set(h.wallet, await sim.chain.solBalance(h.wallet));

      await step('holders sign in, join both campaigns and are scored, paying nothing', async () => {
        await joinAll(project, fixed, holders);
        await joinAll(project, shared, holders);
        for (const c of [fixed, shared]) {
          for (const h of rng.sample(holders, rng.int(1, holders.length))) {
            await team.platform.markQualified(project.id, c.id, h.wallet);
            await team.platform.setJoinProgress(c.id, h.wallet, rng.int(1, 100), null);
          }
          await team.platform.updateCampaignStatus(c.id, 'ended');
        }
        for (const h of holders) checkEqual(await sim.chain.solBalance(h.wallet), holderSol.get(h.wallet), 'SOL for ' + h.label);
        return holders.length + ' holders joined twice; no holder SOL moved';
      });

      await step('both payouts send the vault\'s tokens to holders only, to the last unit', async () => {
        const vaultStart = await sim.chain.tokenBalance(project.vault, project.mint);
        let paid = 0n;
        for (const [c, expected] of [
          [fixed, expectedFixed(await joinRows(sim, fixed.id), each, fixedPrize)],
          [shared, expectedPool(await joinRows(sim, shared.id), pool)],
        ]) {
          await settle(sim, project, c.id, {
            afterPropose: async (s) => {
              checkEqual(s.payouts.map((p) => [p.wallet, p.amountRaw]), expected.map((p) => [p.wallet, p.amountRaw]), c.title + ' payouts');
              checkEqual([String(s.cut_raw || 0), s.cut_bps == null ? 0 : Number(s.cut_bps)], ['0', 0], c.title + ' cut');
            },
          });
          paid += expected.reduce((n, p) => n + BigInt(p.amountRaw), 0n);
          const receipt = ok(await sim.world.api('GET', '/api/campaigns/' + c.id + '/receipt'), 'receipt');
          checkEqual(receipt.rows.filter((r) => r.is_platform_cut).length, 0, c.title + ' receipt cut rows');
        }
        const vaultEnd = await sim.chain.tokenBalance(project.vault, project.mint);
        checkEqual((vaultStart - vaultEnd).toString(), paid.toString(), 'vault outflow');
        return 'vault paid ' + human(paid, decimals) + ' and holders received exactly that';
      });

      await step('no transaction touched the fee treasury or the cut wallet, and neither holds anything', async () => {
        for (const w of watched) {
          checkEqual(await sim.chain.solBalance(w), before.get(w), 'SOL at ' + w.slice(0, 6));
          checkEqual(await sim.chain.tokenBalance(w, project.mint), 0n, 'tokens at ' + w.slice(0, 6));
        }
        let scanned = 'balances only (this chain keeps no history)';
        if (sim.chain.transactions) {
          const txs = sim.chain.transactions();
          const touched = txs.filter((tx) => tx.transaction.message.accountKeys.some((k) => watched.includes(k.pubkey))
            || (tx.meta.postTokenBalances || []).some((b) => watched.includes(b.owner)));
          checkEqual(touched.map((t) => t.signature.slice(0, 8)), [], 'transactions touching a fee wallet');
          scanned = txs.length + ' transactions scanned';
        }
        const teamSpent = teamSolStart - await sim.chain.solBalance(team.wallet);
        ctx.note('teamSolSpentLamports', teamSpent.toString());
        return scanned + '; team spent ' + teamSpent + ' lamports on network fees, rent and vault gas, none to Bard';
      });
    } finally {
      await closeSim(sim);
    }
  },
};
