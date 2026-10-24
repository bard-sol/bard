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

  await page.goto('/dashboard.html');
  await page.locator('#btn-browse').click();
  await assertPayloadLiteral(page, page.locator('#ov-list'));
  await page.locator('[data-open]').first().click();
  await assertPayloadLiteral(page, page.locator('#detail-title'));
  await assertPayloadLiteral(page, page.locator('#detail-rule'));
  await assertPayloadLiteral(page, page.locator('#detail-lb'));

  await page.goto('/explore.html');
  await assertPayloadLiteral(page, page.locator('#list'));
});
