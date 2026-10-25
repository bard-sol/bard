import { test, expect } from './guard.js';

const ID = '11111111-1111-4111-8111-111111111111';

test('a campaign page renders without a wallet and explore opens it', async ({ page }) => {
  test.setTimeout(120000);
  const team = {
    projects: [{
      id: 'proj-local',
      name: 'Demo Project',
      ticker: 'DEMO',
      mint: 'mint',
      campaigns: [{
        id: ID,
        title: 'Hold the line',
        type: 'hold',
        rule: 'Hold',
        status: 'active',
        createdAt: '2026-01-02T00:00:00.000Z',
      }],
    }],
  };
  await page.addInitScript((saved) => {
    localStorage.setItem('bard_team_v1', JSON.stringify(saved));
  }, team);

  await page.goto('/c/' + ID);
  await expect(page).toHaveURL(new RegExp('/c/' + ID + '$'));
  await expect(page.locator('#your-status')).toHaveText('Not joined · progress 0 · not qualified · not paid', { timeout: 20000 });
  await expect(page.locator('#join-btn')).toHaveText('Connect to join');
  await expect(page.locator('#show-handle')).not.toBeChecked();
  const text = await page.locator('body').innerText();
  expect(text.toLowerCase()).not.toContain('price');
  expect(text).not.toContain('SOL');
  const html = await page.content();
  expect(html).not.toContain('SOL');
  expect(html.toLowerCase()).not.toContain('price');
  expect(html.toLowerCase()).not.toContain('claim');

  await page.goto('/explore.html');
  const card = page.locator('a.card').first();
  await expect(card).toBeVisible({ timeout: 20000 });
  await card.click();
  await expect(page).toHaveURL(new RegExp('/c/' + ID));
  await expect(page.locator('#your-status')).toHaveText('Not joined · progress 0 · not qualified · not paid');
  await expect(page.locator('#join-btn')).toHaveText('Connect to join');
});

const WALLET = 'TestWa11et111111111111111111111111111111';

function liveState(type) {
  return {
    as_of: '2026-10-25T00:00:00.000Z',
    campaign: {
      id: ID,
      title: 'Public raid',
      type,
      rule_text: 'Show up',
      reward_mode: 'fixed',
      access_mode: 'open',
      status: 'active',
      project: { id: 'proj-local', name: 'Demo', ticker: 'DEMO' },
    },
    clock: { state: 'live', ends_at: null, no_end: true, starts_at: null },
    prize: { symbol: 'DEMO', decimals: 6, locked: false, mint: null, who_gets_paid_text: 'every qualified holder is paid' },
    vault: { address: null, balance_raw: null, explorer_url: null, below_locked: null },
    counts: { joined: 0, qualified: 0, paid: 0 },
    board: [],
    settlement: null,
    links: { page: '/c/' + ID, receipt: null },
  };
}

async function openLive(page, type, holder) {
  await page.addInitScript(({ wallet, saved }) => {
    window.solana = {
      connect: async () => ({ publicKey: { toString: () => wallet } }),
      publicKey: { toString: () => wallet },
    };
    if (saved) localStorage.setItem('bard_holder_v1', JSON.stringify(saved));
  }, { wallet: WALLET, saved: holder || null });
  await page.route('**/api/campaigns/' + ID + '/state*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(liveState(type)),
    });
  });
  await page.goto('/c/' + ID);
  await expect(page.locator('#clock-line')).toHaveText('no end set', { timeout: 20000 });
  await page.locator('#join-btn').click();
}

test('an X-required campaign hides join until a handle is linked', async ({ page }) => {
  test.setTimeout(120000);
  await openLive(page, 'raid', null);
  await expect(page.locator('#join-btn')).toBeHidden();
  await expect(page.locator('#join-reason')).toContainText('This campaign needs a linked X account');
  await expect(page.locator('#join-reason a')).toHaveAttribute('href', '/dashboard.html');
  await expect(page.locator('#join-reason a')).toHaveText('Link it on the dashboard');
});

test('a linked holder joins an X-required campaign and keeps the handle', async ({ page }) => {
  test.setTimeout(120000);
  await openLive(page, 'raid', { joined: {}, claims: {}, xHandle: '@a' });
  await expect(page.locator('#join-btn')).toHaveText('Join');
  await page.locator('#show-handle').check();
  await page.locator('#join-btn').click();
  await expect(page.locator('#join-reason')).toHaveText('You already joined.');
  const ticked = await page.evaluate(() => JSON.parse(localStorage.getItem('bard_holder_v1')));
  expect(ticked.xHandle).toBe('@a');
  expect(ticked.showHandle).toBe(true);
  expect(ticked.joined['proj-local::' + ID].xHandle).toBe('@a');
});

test('joining with the box unticked keeps the linked handle and opts out', async ({ page }) => {
  test.setTimeout(120000);
  await openLive(page, 'post', { joined: {}, claims: {}, xHandle: '@a', showHandle: true });
  await expect(page.locator('#join-btn')).toHaveText('Join');
  await expect(page.locator('#show-handle')).not.toBeChecked();
  await page.locator('#join-btn').click();
  await expect(page.locator('#join-reason')).toHaveText('You already joined.');
  const unticked = await page.evaluate(() => JSON.parse(localStorage.getItem('bard_holder_v1')));
  expect(unticked.xHandle).toBe('@a');
  expect(unticked.showHandle).toBe(false);
  expect(unticked.joined['proj-local::' + ID].xHandle).toBe('@a');
});
