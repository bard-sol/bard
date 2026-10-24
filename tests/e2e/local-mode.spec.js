import { test, expect, BANNER } from './guard.js';

test('local mode banner shows and project create is refused', async ({ page }) => {
  test.setTimeout(120000);
  for (const path of ['/', '/admin.html', '/dashboard.html', '/explore.html']) {
    await page.goto(path);
    await expect(page.locator('#bard-local-banner')).toHaveText(BANNER, { timeout: 20000 });
  }

  await page.goto('/admin.html');
  await expect(page.locator('#bard-local-banner')).toHaveText(BANNER, { timeout: 20000 });
  const before = await page.evaluate(() => localStorage.getItem('bard_team_v1'));
  await page.locator('#btn-new-project').click();
  await page.locator('#p-name').fill('Demo');
  await page.locator('#p-ticker').fill('DEMO');
  await page.locator('#p-mint').fill('So11111111111111111111111111111111111111112');
  await page.locator('#btn-submit-onboard').click();
  await expect(page.locator('#toast')).toContainText(BANNER);
  const after = await page.evaluate(() => localStorage.getItem('bard_team_v1'));
  expect(after).toBe(before);
});
