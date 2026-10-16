import fs from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';

const SHOTS = process.env.ARTIFACT_DIR ?? '/opt/cursor/artifacts';

async function shot(page: Page, name: string): Promise<void> {
  if (test.info().project.name !== 'desktop') return;
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
  } catch {
    return;
  }
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function step(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.documentElement.dataset.guideStep);
}

async function at(page: Page, id: number): Promise<void> {
  await expect.poll(() => step(page), { timeout: 15_000 }).toBe(String(id));
}

async function next(page: Page): Promise<void> {
  await page.locator('[data-guide-next]').click();
}

async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error('missing drag target');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 16 });
  await page.mouse.up();
}

test('card sheet, labelled board, illegal reason, and the rival log', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bard-duel-tutorial', 'due'));
  await page.goto('/');
  await at(page, 1);
  await next(page);
  await at(page, 2);
  await next(page);
  await at(page, 3);
  await page.locator('.page[data-i="0"] .pb').click();
  await at(page, 4);
  await next(page);
  await at(page, 5);
  await expect(page.locator('.pb-name').nth(0)).toContainText('Lanternfall');
  await expect(page.locator('.pb-name').nth(1)).toContainText('Port Foxing');
  await expect(page.locator('#yverse')).toContainText('/ 8');
  await expect(page.locator('#rverse')).toContainText('/ 8');
  await expect(page.locator('#ink')).toContainText('/ 1');
  await expect(page.locator('#turn').first()).toContainText('/ 7');
  await expect(page.locator('#legend')).toContainText('Restore 3');
  await expect(page.locator('#legend .lg-cost')).toContainText('2');
  await expect(page.locator('#help-d, #help').first()).toBeVisible();
  await page.locator('#help').click();
  await expect(page.locator('#howto')).toContainText('First to 8 Verses');
  await expect.poll(() => step(page)).toBe('5');
  await page.locator('#howto-close').click();
  await at(page, 5);
  await shot(page, 'labelled-board');

  await next(page);
  await at(page, 6);
  await page.locator('.handrow [data-def="c_novice"]').click();
  const sheet = page.locator('#card-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.dc-cost')).toContainText('1');
  await expect(sheet.locator('.dc-type')).toContainText('Character');
  await expect(sheet.locator('.st.atk')).toContainText('1');
  await expect(sheet.locator('.st.hp')).toContainText('2');
  await expect(sheet.locator('.dc-text')).toContainText('Kindle');
  await expect(sheet.locator('.kwdef')).toContainText('most-damaged allied unit');
  await shot(page, 'card-sheet');
  await page.locator('#card-sheet #sheet-x').click();
  await expect(sheet).toHaveCount(0);
  await at(page, 6);

  const lift = page.locator('#lift [data-keyword="Kindle"]');
  const hand = page.locator('.handrow [data-keyword="Kindle"]');
  await ((await lift.count()) > 0 ? lift.first() : hand.first()).click({ delay: 700 });
  await at(page, 7);
  await drag(page, page.locator('.handrow [data-def="c_novice"]'), page.locator('.page[data-i="0"] .row.you .slot').first());
  await at(page, 8);
  await drag(page, page.locator('.page[data-i="0"] .row.you [data-def="c_novice"]'), page.locator('.page[data-i="1"] .row.you .slot').first());
  await expect(page.locator('.toast', { hasText: 'Tired: played this turn' })).toBeVisible();
  await expect.poll(() => step(page)).toBe('8');
  await shot(page, 'illegal-action');

  await next(page);
  await at(page, 9);
  await page.locator('#endturn').click();
  await at(page, 11);
  const phone = (page.viewportSize()?.width ?? 0) < 600;
  const log = page.locator(phone ? '.ticker' : '#logp');
  await expect(log).toContainText('Running-Sea Deckhand');
  await expect(log).toContainText('Port Foxing');
  await expect(page.locator('.page[data-i="1"]')).toHaveClass(/hl/);
  await shot(page, 'ai-log');
});
