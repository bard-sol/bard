/**
 * Scenario 10. The team pays a large campaign from the admin screens, in Chromium. 13 qualified
 * holders and no cut make 13 lines, so the payout is three vault transactions of 6, 6 and 1. For
 * each batch the team presses Sign (key 1), Bard presses Approve in its panel (key 2), and the
 * team presses Pay; every batch row shows where it stands. Pay before both signatures is refused
 * on screen and moves nothing. The public receipt then lists all 13 holders with their amounts.
 * Last, the team cancels a second, unpaid campaign from the same screen and its prize is released.
 *
 * Wallet prompts are the only thing simulated: the page's window.solana signs with the actor's
 * key. Everything else is the real admin.html, admin_app.js, bard-vault.js and the worker.
 */
import { createHash } from 'node:crypto';
import { check, checkEqual, ok } from '../lib/harness.mjs';
import {
  openSim, closeSim, makeTeam, makeHolders, launchProject, createCampaign, joinAll, human,
} from '../lib/journey.mjs';
import { payoutBatchCount } from '../../src/index.js';
import { settlementBatchLines } from '../../../server/settlement.js';

const WAIT = 30000;
const HOLDERS = 13;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** One person's admin.html tab, signed in with their wallet. */
async function adminTab(ctx, sim, keypair) {
  const tab = await ctx.browser.page(sim.world, keypair);
  tab.page.on('dialog', (dialog) => dialog.accept());
  tab.logs = [];
  tab.page.on('console', (m) => { if (m.type() === 'error') tab.logs.push(m.text().slice(0, 300)); });
  tab.page.on('response', (r) => { if (r.status() >= 400) tab.logs.push(r.status() + ' ' + r.request().method() + ' ' + r.url().slice(0, 120)); });
  return tab;
}

/** Wait for an element; on a timeout say what the screen said instead. */
async function waitFor(tab, selector) {
  await waitOn(tab, (sel) => !!document.querySelector(sel), selector);
}

/** Wait on the page; on a timeout say what the screen said instead. */
async function waitOn(tab, fn, arg) {
  try {
    await tab.page.waitForFunction(fn, arg, { timeout: WAIT });
  } catch (err) {
    const toast = await tab.page.evaluate(() => ['toast', 'bard-signs', 'camp-settle']
      .map((id) => id + ': ' + ((document.getElementById(id) || {}).textContent || '').slice(0, 300)).join(' / ')).catch(() => '?');
    throw new Error(String(err.message).split('\n')[0] + '; toast "' + toast.replace(/\s+/g, ' ').slice(0, 600) + '"; errors ' + JSON.stringify(tab.errors.concat(tab.logs || []).slice(-6)));
  }
}

/** Load admin.html, sign in if the tab has no session yet, and open one campaign. */
async function openCampaign(tab, sim, projectId, campaignId) {
  const { page } = tab;
  await page.goto(sim.world.base + '/admin.html');
  const card = '#project-list [data-open-project="' + projectId + '"]';
  try {
    await page.waitForSelector(card, { timeout: 4000 });
  } catch {
    await page.click('#btn-wallet');
    await waitFor(tab, card);
  }
  await page.click(card);
  await page.click('#proj-campaigns [data-open-camp="' + campaignId + '"]');
  await waitFor(tab, '#page-campaign.is-on');
}

async function toastMatching(tab, pattern) {
  await waitOn(tab, (src) => new RegExp(src).test((document.getElementById('toast') || {}).textContent || ''), pattern.source);
  return tab.page.textContent('#toast');
}

async function batchStatus(tab, table, n) {
  return (await tab.page.textContent('#' + table + ' tr[data-batch="' + n + '"] .batch-status')).trim();
}

async function waitBatchStatus(tab, table, n, want) {
  await waitOn(tab, ({ table, n, want }) => {
    const cell = document.querySelector('#' + table + ' tr[data-batch="' + n + '"] .batch-status');
    return cell && cell.textContent.trim() === want;
  }, { table, n, want });
}

async function statuses(tab, count) {
  const out = [];
  for (let n = 0; n < count; n++) out.push(await batchStatus(tab, 'batch-table', n));
  return out;
}

export default {
  id: 's10',
  name: 'Team payout screens in Chromium: 13 holders in 3 batches, sign, approve, pay, cancel',
  async run(ctx) {
    const { rng, step } = ctx;
    if (!ctx.browser) {
      await step('the payout screens need the browser', async () => 'not run (--no-ui)');
      return;
    }
    if (ctx.chainName !== 'local') {
      await step('the payout screens run on the local chain', async () => 'not run on ' + ctx.chainName + ' (13 holder accounts would spend devnet SOL)');
      return;
    }
    let sim;
    const tabs = [];
    try {
      sim = await openSim(ctx, { cutBps: 0 });
      const decimals = 6;
      const unit = 10n ** BigInt(decimals);
      const each = BigInt(rng.int(1, 40)) * unit + BigInt(rng.int(1, 999_999));
      const eachB = BigInt(rng.int(1, 40)) * unit;
      const prizeA = each * BigInt(HOLDERS);
      const prizeB = eachB * 2n;
      const team = await step('team signs in', async () => makeTeam(sim, 'team'));
      const project = await step('launch a project with a vault holding both prizes', async () => {
        const p = await launchProject(sim, team, { name: 'Batch Screens', ticker: 'BTCH', decimals, depositRaw: prizeA + prizeB });
        return { p, detail: 'vault holds ' + human(prizeA + prizeB, decimals) + ' BTCH' };
      }).then((v) => v.p);
      const big = await createCampaign(sim, project, { title: 'Thirteen', type: 'custom', rule: 'r', rewardMode: 'fixed', reward: human(each, decimals), config: { holderCount: String(HOLDERS) }, days: 7 });
      const small = await createCampaign(sim, project, { title: 'Cancel me', type: 'custom', rule: 'r', rewardMode: 'fixed', reward: human(eachB, decimals), config: { holderCount: '2' }, days: 7 });
      const holders = await makeHolders(sim, HOLDERS);

      await step('13 holders join and qualify; both campaigns end', async () => {
        await joinAll(project, big, holders);
        await joinAll(project, small, holders.slice(0, 2));
        for (const h of holders) await team.platform.markQualified(project.id, big.id, h.wallet);
        for (const h of holders.slice(0, 2)) await team.platform.markQualified(project.id, small.id, h.wallet);
        await team.platform.updateCampaignStatus(big.id, 'ended');
        await team.platform.updateCampaignStatus(small.id, 'ended');
        return HOLDERS + ' qualified on Thirteen, 2 on Cancel me';
      });

      const teamTab = await adminTab(ctx, sim, team.keypair);
      tabs.push(teamTab);
      const bardTab = await adminTab(ctx, sim, sim.bard);
      tabs.push(bardTab);

      const settlement = await step('the team proposes the payout on screen: 13 holders in 3 batches of 6, 6 and 1', async () => {
        await openCampaign(teamTab, sim, project.id, big.id);
        await teamTab.page.click('#btn-propose-settle');
        await teamTab.page.waitForSelector('#batch-table tr[data-batch="2"]', { timeout: WAIT });
        const s = ok(await sim.world.rest('GET', '/vault_settlements?campaign_id=eq.' + big.id + '&select=*'), 'settlement')[0];
        checkEqual(s.payouts.length, HOLDERS, 'payout lines');
        check(s.payouts.every((p) => String(p.amountRaw) === each.toString()), 'every holder gets ' + each + ' raw');
        checkEqual(String(s.cut_raw || 0), '0', 'cut');
        checkEqual(payoutBatchCount(s.payouts, null), 3, 'vault transactions');
        checkEqual(settlementBatchLines(s).map((b) => b.length), [6, 6, 1], 'lines per batch');
        const shown = await teamTab.page.$$eval('#payout-table tbody tr', (trs) => trs.map((tr) => tr.textContent));
        checkEqual(shown.filter((t) => / \$BTCH$/.test(t)).length, HOLDERS, 'holder rows on screen: ' + JSON.stringify(shown.slice(-2)));
        checkEqual(await statuses(teamTab, 3), ['Needs your signature', 'Needs your signature', 'Needs your signature'], 'batch statuses');
        return { s, detail: 'settlement ' + s.id.slice(0, 8) + '; 3 batch rows, each "Needs your signature"' };
      }).then((v) => v.s);
      const batches = settlementBatchLines(settlement);

      await step('Pay before any signature is refused on screen', async () => {
        const vault = await sim.chain.tokenBalance(project.vault, project.mint);
        await teamTab.page.click('#batch-table [data-pay-batch="0"]');
        const said = await toastMatching(teamTab, /Batch 1 cannot be paid yet/);
        checkEqual(said, 'Batch 1 cannot be paid yet: both keys must sign first. Missing your signature and Bard\'s.', 'refusal');
        await teamTab.page.click('#btn-execute-payout');
        const whole = await toastMatching(teamTab, /Batch 1 cannot be paid yet/);
        check(/Missing your signature and Bard's/.test(whole), 'Execute payout said "' + whole + '"');
        checkEqual(await sim.chain.tokenBalance(project.vault, project.mint), vault, 'vault balance');
        return '"' + said + '"';
      });

      for (let n = 0; n < 3; n++) {
        const label = 'batch ' + (n + 1) + ' of 3';
        await step(label + ': the team signs with key 1', async () => {
          await openCampaign(teamTab, sim, project.id, big.id);
          await teamTab.page.click('#batch-table [data-sign-batch="' + n + '"]');
          await waitBatchStatus(teamTab, 'batch-table', n, 'Waiting for Bard');
          const row = ok(await sim.world.rest('GET', '/vault_settlement_batches?settlement_id=eq.' + settlement.id + '&batch=eq.' + n + '&select=*'), 'batch')[0];
          check(row && row.team_signed === true && row.bard_signed !== true, 'batch row ' + JSON.stringify(row));
          const all = await statuses(teamTab, 3);
          return 'statuses ' + all.join(' | ');
        });

        await step(label + ': Pay with only the team key is refused on screen', async () => {
          const vault = await sim.chain.tokenBalance(project.vault, project.mint);
          await teamTab.page.click('#batch-table [data-pay-batch="' + n + '"]');
          const said = await toastMatching(teamTab, new RegExp('Batch ' + (n + 1) + ' cannot be paid yet'));
          checkEqual(said, 'Batch ' + (n + 1) + ' cannot be paid yet: both keys must sign first. Missing Bard\'s signature.', 'refusal');
          checkEqual(await batchStatus(teamTab, 'batch-table', n), 'Waiting for Bard', 'status after the refusal');
          checkEqual(await sim.chain.tokenBalance(project.vault, project.mint), vault, 'vault balance');
          return '"' + said + '"';
        });

        await step(label + ': Bard approves with key 2 in its panel', async () => {
          await openCampaign(bardTab, sim, project.id, big.id);
          const button = '#bard-batch-table [data-bard-approve-batch="' + n + '"]';
          await waitFor(bardTab, button + ':not([disabled])');
          for (let later = n + 1; later < 3; later++) {
            check(await bardTab.page.isDisabled('#bard-batch-table [data-bard-approve-batch="' + later + '"]'), 'Approve on unsigned batch ' + (later + 1) + ' is enabled');
          }
          const check1 = await bardTab.page.$$eval('#bard-batch-table tr[data-batch="' + n + '"] td', (tds) => tds.map((td) => td.textContent.trim()).filter(Boolean).join(' | '));
          check(/Matches/.test(check1), 'Bard panel row: ' + check1);
          await bardTab.page.click(button);
          await toastMatching(bardTab, new RegExp('Bard signed batch ' + (n + 1)));
          await waitBatchStatus(bardTab, 'bard-batch-table', n, 'Signed');
          const row = ok(await sim.world.rest('GET', '/vault_settlement_batches?settlement_id=eq.' + settlement.id + '&batch=eq.' + n + '&select=*'), 'batch')[0];
          check(row.team_signed === true && row.bard_signed === true, 'batch row ' + JSON.stringify(row));
          return 'Bard panel row: ' + check1;
        });

        await step(label + ': the team presses Pay and exactly this batch\'s holders are paid', async () => {
          const before = new Map();
          for (const h of holders) before.set(h.wallet, await sim.chain.tokenBalance(h.wallet, project.mint));
          await openCampaign(teamTab, sim, project.id, big.id);
          await waitBatchStatus(teamTab, 'batch-table', n, 'Ready to pay');
          await teamTab.page.click('#batch-table [data-pay-batch="' + n + '"]');
          if (n < 2) {
            await waitBatchStatus(teamTab, 'batch-table', n, 'Paid');
            const all = await statuses(teamTab, 3);
            checkEqual(all.slice(0, n + 1), Array(n + 1).fill('Paid'), 'paid batches');
          } else {
            // The last batch closes the payout: the box turns into the paid line with the receipt link.
            await teamTab.page.waitForFunction(() => /Paid/.test((document.getElementById('camp-settle') || {}).textContent || '') && !document.getElementById('batch-table'), null, { timeout: WAIT });
          }
          const inBatch = new Set(batches[n].map((l) => l.wallet));
          for (const h of holders) {
            const got = (await sim.chain.tokenBalance(h.wallet, project.mint)) - before.get(h.wallet);
            checkEqual(got.toString(), inBatch.has(h.wallet) ? each.toString() : '0', 'paid to ' + h.label + ' in ' + label);
          }
          const row = ok(await sim.world.rest('GET', '/vault_settlement_batches?settlement_id=eq.' + settlement.id + '&batch=eq.' + n + '&select=tx_signature'), 'batch')[0];
          check(row.tx_signature, 'batch ' + n + ' has no recorded signature');
          return inBatch.size + ' holders paid ' + human(each, decimals) + ' BTCH each';
        });
      }

      await step('the payout is closed and the campaign is paid', async () => {
        const s = ok(await sim.world.rest('GET', '/vault_settlements?id=eq.' + settlement.id + '&select=status,tx_signature'), 'settlement')[0];
        checkEqual(s.status, 'executed', 'settlement status');
        const c = ok(await sim.world.rest('GET', '/campaigns?id=eq.' + big.id + '&select=status'), 'campaign')[0];
        checkEqual(c.status, 'paid', 'campaign status');
        const link = await teamTab.page.getAttribute('#camp-settle a[href$="/receipt"]', 'href');
        checkEqual(link, '/c/' + big.id + '/receipt', 'receipt link');
        return 'executed; closing signature ' + s.tx_signature.slice(0, 8);
      });

      await step('the receipt lists all 13 holders with the right amounts', async () => {
        const tab = await ctx.browser.page(sim.world, null);
        tabs.push(tab);
        await tab.page.goto(sim.world.base + '/c/' + big.id + '/receipt');
        await tab.page.waitForFunction((n) => document.querySelectorAll('#receipt-rows tr').length >= n, HOLDERS, { timeout: WAIT });
        const rows = await tab.page.$$eval('#receipt-rows tr', (trs) => trs.map((tr) => ({
          hash: tr.getAttribute('data-wallet-hash'),
          cut: tr.getAttribute('data-cut') === '1',
          amount: tr.lastElementChild.textContent,
        })));
        checkEqual(rows.length, HOLDERS, 'receipt rows');
        checkEqual(rows.filter((r) => r.cut).length, 0, 'cut rows');
        const want = human(each, decimals) + ' BTCH';
        const byHash = new Map(rows.map((r) => [r.hash, r.amount]));
        for (const h of holders) checkEqual(byHash.get(sha256(h.wallet)), want, 'receipt amount for ' + h.label);
        check(!(await tab.page.isVisible('#unverified')), 'receipt says unverified');
        const tx = await tab.page.textContent('#tx-line');
        check(/paid in 3 transactions/.test(tx), 'receipt transaction line: ' + tx);
        checkEqual(tab.errors, [], 'page errors');
        return '13 rows of ' + want + '; paid in 3 transactions';
      });

      await step('the team cancels the unpaid campaign from the same screen and its prize is released', async () => {
        const reserved = async () => ok(await sim.world.rest('GET', '/campaigns?id=eq.' + small.id + '&select=status,vault_reserved_raw'), 'campaign')[0];
        const before = await reserved();
        checkEqual(String(before.vault_reserved_raw), prizeB.toString(), 'reserved before');
        await openCampaign(teamTab, sim, project.id, small.id);
        check(/reserved from the vault/.test(await teamTab.page.textContent('#camp-vault-badge')), 'the screen does not show the reserved prize');
        // An open payout the team already signed: cancel must close its vault proposal first.
        await teamTab.page.click('#btn-propose-settle');
        await teamTab.page.waitForSelector('#btn-cosign', { timeout: WAIT });
        await teamTab.page.click('#btn-cosign');
        await teamTab.page.waitForFunction(() => /Waiting for Bard/.test((document.getElementById('camp-settle') || {}).textContent || ''), null, { timeout: WAIT });
        await teamTab.page.click('#btn-execute-payout');
        const said = await toastMatching(teamTab, /This payout cannot be paid yet/);
        checkEqual(said, 'This payout cannot be paid yet: both keys must sign first. Missing Bard\'s signature.', 'one-transaction refusal');
        const vault = await sim.chain.tokenBalance(project.vault, project.mint);
        await teamTab.page.click('#btn-cancel-campaign');
        await toastMatching(teamTab, /Campaign cancelled; the locked prize is released/);
        await teamTab.page.waitForFunction(() => (document.getElementById('camp-status') || {}).textContent === 'cancelled', null, { timeout: WAIT });
        const badge = await teamTab.page.textContent('#camp-vault-badge');
        check(!/reserved from the vault/.test(badge), 'the screen still shows a reserved prize: ' + badge);
        check(await teamTab.page.isHidden('#btn-cancel-campaign'), 'Cancel is still offered');
        const after = await reserved();
        checkEqual([after.status, String(after.vault_reserved_raw)], ['cancelled', '0'], 'campaign after cancel');
        const s = ok(await sim.world.rest('GET', '/vault_settlements?campaign_id=eq.' + small.id + '&select=status'), 'settlement')[0];
        checkEqual(s.status, 'cancelled', 'settlement after cancel');
        checkEqual(await sim.chain.tokenBalance(project.vault, project.mint), vault, 'vault balance');
        return 'status pill "cancelled"; reserved ' + human(prizeB, decimals) + ' -> 0; vault keeps ' + human(vault, decimals);
      });

      await step('the vault panel shows nothing reserved and no page errors', async () => {
        await teamTab.page.goto(sim.world.base + '/admin.html');
        await teamTab.page.waitForSelector('#project-list [data-open-project="' + project.id + '"]', { timeout: WAIT });
        await teamTab.page.click('#project-list [data-open-project="' + project.id + '"]');
        await teamTab.page.click('#page-project .tab[data-tab="vault"]');
        await teamTab.page.waitForSelector('#vault-res', { timeout: WAIT });
        checkEqual((await teamTab.page.textContent('#vault-res')).trim(), '0', 'reserved for campaigns');
        const p = ok(await sim.world.rest('GET', '/projects?id=eq.' + project.id + '&select=vault_reserved_raw'), 'project')[0];
        checkEqual(String(p.vault_reserved_raw), '0', 'project reservation');
        checkEqual(teamTab.errors, [], 'team page errors');
        checkEqual(bardTab.errors, [], 'Bard page errors');
        return 'reserved 0 on screen and in the database';
      });
    } finally {
      for (const tab of tabs) await tab.close().catch(() => {});
      await closeSim(sim);
    }
  },
};
