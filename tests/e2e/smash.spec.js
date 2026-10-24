import { test, expect, mockSupabase, smashTables, HOLDER } from './guard.js';

test('smash links open X and do not write campaign_joins', async ({ page }) => {
  const writes = await mockSupabase(page, smashTables());
  await page.addInitScript((wallet) => {
    localStorage.setItem('bard_holder_wallet', wallet);
  }, HOLDER);
  page.on('popup', (popup) => { popup.close().catch(() => {}); });

  await page.goto('/dashboard.html');
  await expect(page.locator('#app')).toBeVisible();
  await page.locator('[data-open]').first().click();
  const links = page.locator('a.smash-btn');
  await expect(links).toHaveCount(3);
  const hrefs = await links.evaluateAll((els) => els.map((el) => el.getAttribute('href')));
  expect(hrefs[0]).toBe('https://x.com/intent/like?tweet_id=1234567890123456789');
  expect(hrefs[1]).toBe('https://x.com/intent/retweet?tweet_id=1234567890123456789');
  expect(hrefs[2].startsWith('https://x.com/intent/post?url=')).toBe(true);
  await expect(page.getByRole('button', { name: /mark qualified/i })).toHaveCount(0);

  for (let i = 0; i < 3; i++) {
    await links.nth(i).click();
  }
  const joinWrites = writes.filter((hit) => /campaign_joins/i.test(hit.url));
  expect(joinWrites).toEqual([]);
});
