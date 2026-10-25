import { test, expect, mockSupabase, assertPayloadLiteral, xssTables, PAYLOAD } from './guard.js';

test('stored payload stays text on admin, dashboard, and explore', async ({ page }) => {
  test.setTimeout(90000);
  await mockSupabase(page, xssTables());

  await page.goto('/admin.html');
  await assertPayloadLiteral(page, page.locator('#project-list'));
  await page.locator('[data-open-project]').click();
  await assertPayloadLiteral(page, page.locator('#proj-title'));
  await expect(page.locator('#proj-campaigns')).toContainText(PAYLOAD);
  await page.locator('[data-open-camp]').click();
  await assertPayloadLiteral(page, page.locator('#camp-lb'));
  await page.locator('#back-from-detail').click();
  await page.locator('#page-project [data-tab="roster"]').click();
  await assertPayloadLiteral(page, page.locator('#proj-roster'));

  const feedCalls = [];
  page.on('request', (req) => {
    if (req.url().includes('campaign_join_feed')) feedCalls.push(req.url());
  });
  await page.route('**/api/campaigns/*/state*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        board: [{
          rank: 1,
          wallet_short: 'Hold…1111',
          wallet_hash: 'not-the-browser-wallet',
          handle: PAYLOAD,
          progress: 1,
          qualified: false,
        }],
      }),
    });
  });

  await page.goto('/dashboard.html');
  await page.locator('#btn-browse').click();
  await assertPayloadLiteral(page, page.locator('#ov-list'));
  await page.locator('[data-open]').first().click();
  await assertPayloadLiteral(page, page.locator('#detail-title'));
  await assertPayloadLiteral(page, page.locator('#detail-rule'));
  await assertPayloadLiteral(page, page.locator('#detail-lb'));
  await expect(page.locator('#detail-lb')).toContainText('Hold…1111');
  expect(feedCalls).toEqual([]);

  await page.goto('/explore.html');
  await assertPayloadLiteral(page, page.locator('#list'));
});
