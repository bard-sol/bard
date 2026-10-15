import fs from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';

const SHOTS = '/opt/cursor/artifacts';

async function shot(page: Page, name: string): Promise<void> {
  if (test.info().project.name !== 'desktop' || !fs.existsSync(SHOTS)) return;
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

async function drag(page: Page, from: Locator, to: Locator, hold?: number): Promise<void> {
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error('missing drag target');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 16 });
  if (hold) await at(page, hold);
  await page.mouse.up();
}

test('clicks through all 27 guided steps', async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    const note = () => {
      const id = document.documentElement.dataset.guideStep;
      if (id && seen[seen.length - 1] !== id) seen.push(id);
    };
    const start = () => {
      note();
      new MutationObserver(note).observe(document.documentElement, { attributes: true, attributeFilter: ['data-guide-step'] });
    };
    localStorage.setItem('bard-duel-tutorial', 'due');
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
    (window as unknown as { __guideSeen: string[] }).__guideSeen = seen;
  });
  await page.goto('/');
  await at(page, 1);
  await expect(page.locator('.cm-tx')).toContainText('Welcome to the Book');
  await expect(page.locator('#help, #help-d').first()).toBeVisible();
  await shot(page, 'tutorial-step');
  await next(page);
  await at(page, 2);
  await expect(page.locator('.cm-tx')).toContainText('Old Wick');
  await next(page);
  await at(page, 3);
  await page.locator('.page[data-i="0"] .pb').click();
  await at(page, 4);
  await next(page);
  await at(page, 5);
  await expect(page.locator('#ink')).toBeVisible();
  await next(page);
  await at(page, 6);
  await page.locator('#lift [data-keyword="Kindle"], #inspect [data-keyword="Kindle"]').click({ delay: 700 });
  await at(page, 7);
  await drag(page, page.locator('.handrow [data-def="c_novice"]'), page.locator('.page[data-i="0"] .row.you .slot').first());
  await at(page, 8);
  await expect(page.locator('.page[data-i="0"] .row.you [data-def="c_novice"] img')).toBeVisible();
  await next(page);
  await at(page, 9);
  await page.locator('#endturn').click();
  await at(page, 11);
  await next(page);
  await at(page, 12);
  await drag(page, page.locator('.handrow [data-def="n_doodle"]'), page.locator('.page[data-i="1"] .row.you .slot').first());
  await at(page, 13);
  await page.locator('#endturn').click();
  await at(page, 14);
  if (test.info().project.name === 'paced') {
    await expect(page.locator('#endturn')).toBeDisabled();
    await expect(page.locator('#endturn')).toHaveText("Rival's turn");
    await expect(page.locator('#legend')).toBeDisabled();
  }
  await expect(page.locator('.cm-tx')).toContainText('played a unit');
  if (test.info().project.name === 'paced' && fs.existsSync(SHOTS)) {
    await page.screenshot({ path: `${SHOTS}/rival-turn-step-14.png` });
  }
  await at(page, 15);
  await drag(page, page.locator('.page[data-i="0"] .row.you [data-def="c_novice"]'), page.locator('.page[data-i="0"] .row.rival .un'), 16);
  await at(page, 17);
  await page.locator('#endturn').click();
  await at(page, 18);
  await expect(page.locator('.note:not(.none):not(.mine)')).toBeVisible();
  await next(page);
  await at(page, 19);
  await expect(page.locator('.cm-tx')).toContainText('hurt Deckle Doodle');
  await page.locator('#legend').click();
  await page.locator('.page[data-i="1"] .row.you [data-def="n_doodle"]').click();
  await at(page, 20);
  await drag(page, page.locator('.handrow [data-def="c_mend"]'), page.locator('.page[data-i="0"] .row.you [data-def="c_novice"]'));
  await at(page, 21);
  await expect(page.locator('.cm-tx')).toContainText('end the turn');
  await drag(page, page.locator('.page[data-i="0"] .row.you [data-def="c_novice"]'), page.locator('.page[data-i="0"] .row.rival .un'));
  await page.locator('#endturn').click();
  if (test.info().project.name === 'paced') {
    await expect(page.locator('#endturn')).toBeDisabled();
    await expect.poll(() => step(page)).toBe('21');
  }
  await at(page, 22);
  await drag(page, page.locator('.handrow [data-def="champ_old_wick"]'), page.locator('.page[data-i="0"] .row.you .slot').first());
  await at(page, 23);
  await expect(page.locator('.cm-tx')).toContainText('Port Foxing');
  await next(page);
  await at(page, 24);
  await expect(page.locator('.cm-tx')).toContainText('7 turns');
  await next(page);
  await at(page, 25);
  for (let guard = 0; guard < 48; guard++) {
    if ((await step(page)) !== '25') break;
    const end = page.locator('#endturn');
    if (await end.isEnabled().catch(() => false)) await end.click();
    await page.waitForTimeout(500);
  }
  await at(page, 26);
  await expect(page.locator('.why')).toContainText('because');
  await expect(page.locator('.score-table')).toContainText('Lanternfall');
  await expect(page.locator('.score-table')).toContainText('Port Foxing');
  await expect(page.locator('.swing').first()).toContainText('Swing: turn');
  await shot(page, 'end-screen');
  await next(page);
  await at(page, 27);
  await expect(page.locator('.cm-tx')).toContainText('Play');
  await page.locator('#play-real').click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('bard-duel-tutorial'))).toBe('done');
  const seen = await page.evaluate(() => (window as unknown as { __guideSeen?: string[] }).__guideSeen ?? []);
  for (let id = 1; id <= 27; id++) expect(seen, `step ${id}`).toContain(String(id));
});
