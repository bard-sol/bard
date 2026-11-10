/**
 * Chromium checks on the pages a holder sees: the public campaign page, joining from it with a
 * wallet, and the public receipt.
 */
import { check, checkEqual } from './harness.mjs';
import { human, joinRows } from './journey.mjs';

const WAIT = 20000;

export async function checkPublicPage(ctx, sim, campaignId, { prizeRaw, decimals, ticker }) {
  const tab = await ctx.browser.page(sim.world, null);
  try {
    await tab.page.goto(sim.world.base + '/c/' + campaignId);
    const want = human(prizeRaw, decimals);
    await tab.page.waitForFunction((w) => (document.getElementById('prize-line') || {}).textContent.includes(w), want, { timeout: WAIT });
    const text = await tab.page.textContent('#prize-line');
    check(text.includes(want), 'prize line shows "' + text + '", expected ' + want + ' ' + ticker);
    checkEqual(tab.errors, [], 'page errors');
  } finally {
    await tab.close();
  }
}

export async function joinThroughPage(ctx, sim, campaignId, holder) {
  const tab = await ctx.browser.page(sim.world, holder.keypair);
  try {
    await tab.page.goto(sim.world.base + '/c/' + campaignId);
    await tab.page.waitForFunction(() => {
      const b = document.getElementById('join-btn');
      return b && !b.disabled && b.offsetParent !== null;
    }, null, { timeout: WAIT });
    await tab.page.click('#join-btn');
    await tab.page.waitForTimeout(300);
    const deadline = Date.now() + WAIT;
    for (;;) {
      const rows = await joinRows(sim, campaignId);
      if (rows.some((r) => r.wallet === holder.wallet)) break;
      if (Date.now() > deadline) throw new Error('joining from the page did not create a join; page says: ' + (await tab.page.textContent('#join-reason')));
      if (await tab.page.isEnabled('#join-btn')) await tab.page.click('#join-btn');
      await tab.page.waitForTimeout(400);
    }
    checkEqual(tab.errors, [], 'page errors');
  } finally {
    await tab.close();
  }
}

export async function checkReceiptPage(ctx, sim, campaignId, holderRows) {
  const tab = await ctx.browser.page(sim.world, null);
  try {
    await tab.page.goto(sim.world.base + '/c/' + campaignId + '/receipt');
    await tab.page.waitForFunction(() => document.querySelectorAll('#receipt-rows tr').length > 0, null, { timeout: WAIT });
    const rows = await tab.page.$$eval('#receipt-rows tr', (trs) => trs.map((tr) => tr.textContent));
    check(rows.length >= holderRows, 'receipt shows ' + rows.length + ' rows, expected at least ' + holderRows);
    const unverified = await tab.page.isVisible('#unverified');
    check(!unverified, 'receipt page says unverified');
    checkEqual(tab.errors, [], 'page errors');
  } finally {
    await tab.close();
  }
}

/** The team signs in on admin.html, opens its project and reads the Bard cut line in Settings. */
export async function readTeamCutSetting(ctx, sim, team, projectId) {
  const tab = await ctx.browser.page(sim.world, team.keypair);
  const logs = [];
  tab.page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  tab.page.on('response', (r) => { if (r.status() >= 400) logs.push(r.status() + ' ' + r.request().method() + ' ' + r.url().slice(0, 120)); });
  try {
    await tab.page.goto(sim.world.base + '/admin.html');
    await tab.page.click('#btn-wallet');
    const card = '#project-list [data-open-project="' + projectId + '"]';
    try {
      await tab.page.waitForSelector(card, { timeout: WAIT });
    } catch (err) {
      const toast = await tab.page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
      throw new Error('the team page did not list the project; toast "' + toast + '"; errors ' + JSON.stringify(tab.errors.concat(logs).slice(-6)));
    }
    await tab.page.click(card);
    await tab.page.click('#page-project .tab[data-tab="settings"]');
    await tab.page.waitForFunction(() => /Bard cut/.test((document.getElementById('proj-settings') || {}).textContent || ''), null, { timeout: WAIT });
    const text = await tab.page.$eval('#proj-settings .field:last-child > div', (el) => el.textContent);
    checkEqual(tab.errors, [], 'page errors');
    return text.trim();
  } finally {
    await tab.close();
  }
}
