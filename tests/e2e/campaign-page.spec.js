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
