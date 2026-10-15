import fs from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';

const SHOTS = '/opt/cursor/artifacts';

async function step(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.documentElement.dataset.guideStep);
}

async function at(page: Page, id: number): Promise<void> {
  await expect.poll(() => step(page), { timeout: 15_000 }).toBe(String(id));
}

async function point(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  if (!box) throw new Error('missing touch target');
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

async function touchTap(page: Page, target: Locator): Promise<void> {
  await target.tap();
}

async function touchDrag(page: Page, from: Locator, to: Locator, hold?: () => Promise<void>): Promise<void> {
  const start = await point(from);
  const end = await point(to);
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 0 }] });
  const steps = 16;
  for (let i = 1; i <= steps; i += 1) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: Math.round(start.x + ((end.x - start.x) * i) / steps),
        y: Math.round(start.y + ((end.y - start.y) * i) / steps),
        id: 0,
      }],
    });
  }
  if (hold) await hold();
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

async function touchHold(page: Page, target: Locator): Promise<void> {
  const atPoint = await point(target);
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...atPoint, id: 0 }] });
  await page.waitForTimeout(700);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

async function openGuide(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('bard-duel-tutorial', 'due'));
  await page.goto('/');
  await at(page, 1);
  await touchTap(page, page.locator('[data-guide-next]'));
  await at(page, 2);
  await touchTap(page, page.locator('[data-guide-next]'));
  await at(page, 3);
  await touchTap(page, page.locator('.page[data-i="0"] .pb'));
  await at(page, 4);
  await touchTap(page, page.locator('[data-guide-next]'));
  await at(page, 5);
  await touchTap(page, page.locator('[data-guide-next]'));
  await at(page, 6);
  await touchHold(page, page.locator('#lift [data-keyword="Kindle"]'));
  await at(page, 7);
}

async function throughDoodle(page: Page, mode: 'drag' | 'tap'): Promise<void> {
  const novice = page.locator('.handrow [data-def="c_novice"]');
  const left = page.locator('.page[data-i="0"] .row.you .slot').first();
  if (mode === 'drag') await touchDrag(page, novice, left);
  else {
    await touchTap(page, novice);
    await expect(novice).toHaveClass(/armed/);
    await touchTap(page, left);
  }
  await at(page, 8);
  await touchTap(page, page.locator('[data-guide-next]'));
  await at(page, 9);
  await touchTap(page, page.locator('#endturn'));
  await at(page, 11);
  await touchTap(page, page.locator('[data-guide-next]'));
  await at(page, 12);
  const doodle = page.locator('.handrow [data-def="n_doodle"]');
  const right = page.locator('.page[data-i="1"] .row.you .slot').first();
  if (mode === 'drag') await touchDrag(page, doodle, right);
  else {
    await touchTap(page, doodle);
    await expect(doodle).toHaveClass(/armed/);
    await touchTap(page, right);
  }
  await at(page, 13);
  await touchTap(page, page.locator('#endturn'));
  await at(page, 14);
  await expect(page.locator('.cm-tx')).toContainText('played a unit');
  await at(page, 15);
  await expect(page.locator('.cm-tx')).toContainText('Drag it onto an enemy to attack');
  const hit = await page.evaluate(() => {
    const el = document.querySelector('.page[data-i="0"] .row.you [data-def="c_novice"]');
    if (!el) return 'missing';
    const rect = el.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return top?.closest('[data-def]')?.getAttribute('data-def') ?? 'overlay';
  });
  expect(hit).toBe('c_novice');
}

test('touch drag plays a card and attacks at step 15', async ({ page }) => {
  await openGuide(page);
  await throughDoodle(page, 'drag');
  const novice = page.locator('.page[data-i="0"] .row.you [data-def="c_novice"]');
  const foe = page.locator('.page[data-i="0"] .row.rival .un');
  await touchDrag(page, novice, foe, async () => {
    await at(page, 16);
  });
  await at(page, 17);
});

test('touch taps play a card and attack at step 15', async ({ page }) => {
  await openGuide(page);
  await throughDoodle(page, 'tap');
  const novice = page.locator('.page[data-i="0"] .row.you [data-def="c_novice"]');
  const foe = page.locator('.page[data-i="0"] .row.rival .un');
  await touchTap(page, novice);
  await expect(novice).toHaveClass(/armed/);
  if (fs.existsSync(SHOTS)) await page.screenshot({ path: `${SHOTS}/touch-attack-armed.png` });
  await touchTap(page, foe);
  await at(page, 17);
});
