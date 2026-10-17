import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';

const SHOTS = process.env.ARTIFACT_DIR ?? '/opt/cursor/artifacts';
const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 600 },
  { width: 1366, height: 480 },
  { width: 390, height: 844 },
  { width: 360, height: 780 },
];

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'Each size is applied inside this spec.');
});

for (const size of SIZES) {
  test(`guide bubble stays on screen at ${size.width}x${size.height}`, async ({ page }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(8_000);
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem('bard-duel-tutorial', 'due');
    });
    await page.goto('/');
    await at(page, 1);
    await check(page, size, 1);
    await next(page);
    await at(page, 2);
    await check(page, size, 2);
    await next(page);
    await at(page, 3);
    await check(page, size, 3);
    await page.locator('.page[data-i="0"] .pb').click({ force: true });
    await at(page, 4);
    await check(page, size, 4);
    await next(page);
    await at(page, 5);
    await check(page, size, 5);
    await next(page);
    await at(page, 6);
    await check(page, size, 6);
    await keywordHold(page);
    await at(page, 7);
    await check(page, size, 7);
    await drag(page, size, page.locator('.handrow [data-def="c_novice"]'), page.locator('.page[data-i="0"] .row.you .slot').first());
    await at(page, 8);
    await check(page, size, 8);
    await next(page);
    await at(page, 9);
    await check(page, size, 9);
    await endTurn(page);
    await at(page, 10);
    await check(page, size, 10);
    await at(page, 11);
    await check(page, size, 11);
    await page.locator('.handrow .dc').first().click({ force: true });
    await expect(page.locator('.cm-nudge')).toHaveText('Press Next.');
    await expect(page.locator('.toast')).toHaveCount(0);
    await check(page, size, 11);
    await next(page);
    await at(page, 12);
    await check(page, size, 12);
    await drag(page, size, page.locator('.handrow [data-def="n_doodle"]'), page.locator('.page[data-i="1"] .row.you .slot').first());
    await at(page, 13);
    await check(page, size, 13);
    await endTurn(page);
    await at(page, 14);
    await check(page, size, 14);
    await at(page, 15);
    await check(page, size, 15);
    await drag(page, size, page.locator('.page[data-i="0"] .row.you [data-def="c_novice"]'), page.locator('.page[data-i="0"] .row.rival .un'), 16);
    await at(page, 17);
    await check(page, size, 17);
    await endTurn(page);
    await at(page, 18);
    await check(page, size, 18);
    await next(page);
    await at(page, 19);
    await check(page, size, 19);
    const legend = page.locator('#legend');
    await expect(legend).toBeEnabled({ timeout: 20_000 });
    await legend.click({ force: true });
    await page.locator('.page[data-i="1"] .row.you [data-def="n_doodle"]').click({ force: true });
    await at(page, 20);
    await check(page, size, 20);
    await drag(page, size, page.locator('.handrow [data-def="c_mend"]'), page.locator('.page[data-i="0"] .row.you [data-def="c_novice"]'));
    await at(page, 21);
    await check(page, size, 21);
    await drag(page, size, page.locator('.page[data-i="0"] .row.you [data-def="c_novice"]'), page.locator('.page[data-i="0"] .row.rival .un'));
    await endTurn(page);
    await at(page, 22);
    await check(page, size, 22);
    await drag(page, size, page.locator('.handrow [data-def="champ_old_wick"]'), page.locator('.page[data-i="0"] .row.you .slot').first());
    await at(page, 23);
    await check(page, size, 23);
    await next(page);
    await at(page, 24);
    await check(page, size, 24);
    await next(page);
    await at(page, 25);
    await check(page, size, 25);
    for (let guard = 0; guard < 48; guard++) {
      if ((await step(page)) !== '25') break;
      const end = page.locator('#endturn');
      if (await end.isEnabled().catch(() => false)) await end.click({ force: true });
      await page.waitForTimeout(400);
    }
    await at(page, 26);
    await check(page, size, 26);
    await next(page);
    await at(page, 27);
    await check(page, size, 27);
  });
}

async function step(page: Page): Promise<string | undefined> {
  return page.evaluate(() => document.documentElement.dataset.guideStep);
}

async function at(page: Page, id: number): Promise<void> {
  const want = String(id);
  await expect.poll(() => step(page), { timeout: 20_000 }).toBe(want);
  await expect.poll(() => page.locator('#bub').getAttribute('data-guide-step'), { timeout: 20_000 }).toBe(want);
}

async function endTurn(page: Page): Promise<void> {
  const end = page.locator('#endturn');
  await expect(end).toBeEnabled();
  await end.click({ force: true });
}

async function next(page: Page): Promise<void> {
  await page.locator('[data-guide-next]').click({ force: true });
}

async function keywordHold(page: Page): Promise<void> {
  const lift = page.locator('#lift [data-keyword="Kindle"]');
  const hand = page.locator('.handrow [data-keyword="Kindle"]');
  const target = (await lift.count()) > 0 ? lift.first() : hand.first();
  await target.click({ delay: 700, force: true });
}

async function drag(page: Page, size: { width: number; height: number }, from: Locator, to: Locator, hold?: number): Promise<void> {
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error('missing drag target');
  const x = Math.min(size.width - 12, Math.max(12, start.x + start.width / 2));
  const y = Math.min(size.height - 12, Math.max(12, start.y + start.height / 2));
  const tx = Math.min(size.width - 12, Math.max(12, end.x + end.width / 2));
  const ty = Math.min(size.height - 12, Math.max(12, end.y + end.height / 2));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, Math.max(12, y - 48), { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 12 });
  if (hold) {
    await at(page, hold);
    await check(page, size, hold, false);
  }
  await page.mouse.up();
}

async function inspectFaces(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as Window & {
      cardFace: (id: string, options?: { size?: string }) => string;
      D13: { cards: Record<string, { name?: string }> };
    };
    const ids = new Set<string>();
    for (const el of Array.from(document.querySelectorAll('.handrow [data-def], .un[data-def]'))) {
      const id = el.getAttribute('data-def');
      if (id && w.D13.cards[id]) ids.add(id);
    }
    for (const extra of ['champ_old_wick', 'c_lamplighter']) if (w.D13.cards[extra]) ids.add(extra);

    const lineHeightOf = (el: HTMLElement): number => {
      const parsed = parseFloat(getComputedStyle(el).lineHeight);
      return Number.isFinite(parsed) ? parsed : parseFloat(getComputedStyle(el).fontSize) * 1.2;
    };
    const naturalLines = (el: HTMLElement): number => {
      const cs = getComputedStyle(el);
      const probe = document.createElement('div');
      probe.textContent = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      probe.style.position = 'absolute';
      probe.style.left = '-9999px';
      probe.style.top = '0';
      probe.style.visibility = 'hidden';
      probe.style.boxSizing = 'content-box';
      probe.style.width = `${el.clientWidth}px`;
      probe.style.fontFamily = cs.fontFamily;
      probe.style.fontSize = cs.fontSize;
      probe.style.fontWeight = cs.fontWeight;
      probe.style.fontStyle = cs.fontStyle;
      probe.style.fontStretch = cs.fontStretch;
      probe.style.fontVariationSettings = cs.fontVariationSettings;
      probe.style.fontFeatureSettings = cs.fontFeatureSettings;
      probe.style.letterSpacing = cs.letterSpacing;
      probe.style.whiteSpace = 'normal';
      probe.style.lineHeight = cs.lineHeight;
      probe.style.padding = '0';
      probe.style.margin = '0';
      document.body.append(probe);
      const lines = Math.max(1, Math.round(probe.getBoundingClientRect().height / lineHeightOf(el)));
      probe.remove();
      return lines;
    };
    const overlaps = (a: DOMRect, b: DOMRect): boolean =>
      a.width > 1 && b.width > 1 && a.height > 1 && b.height > 1 && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const inside = (el: HTMLElement, card: HTMLElement): boolean => {
      const a = el.getBoundingClientRect();
      const b = card.getBoundingClientRect();
      return a.height > 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1 && a.left >= b.left - 1 && a.right <= b.right + 1;
    };
    const onArt = (el: HTMLElement): boolean => el.classList.contains('dc-cost') || el.classList.contains('dc-q') || el.classList.contains('dc-champ');
    const measure = (card: HTMLElement, id: string): string[] => {
      const problems: string[] = [];
      const name = card.querySelector('.dc-name');
      const text = card.querySelector('.dc-text');
      const label = `${id} “${name?.textContent?.trim() ?? ''}”`;
      if (!(name instanceof HTMLElement)) return [`${label} has no name`];
      const nameLh = lineHeightOf(name);
      const lines = naturalLines(name);
      const nameBox = name.getBoundingClientRect();
      if (nameBox.height + 1 < nameLh * lines) problems.push(`${label} name is ${nameBox.height.toFixed(1)}px, need ${lines} × ${nameLh.toFixed(1)}px`);
      if (!inside(name, card)) problems.push(`${label} name is clipped by the card`);
      if (!(text instanceof HTMLElement)) problems.push(`${label} has no rules text`);
      else {
        const textCs = getComputedStyle(text);
        const font = parseFloat(textCs.fontSize);
        const textLh = lineHeightOf(text);
        const textBox = text.getBoundingClientRect();
        const canScroll = (textCs.overflowY === 'auto' || textCs.overflowY === 'scroll') && text.scrollHeight > text.clientHeight + 1;
        if (!(font >= 10.8)) problems.push(`${label} rules text is ${font}px`);
        if (textBox.height + 1 < textLh * 2 && !canScroll) problems.push(`${label} rules text is ${textBox.height.toFixed(1)}px tall and does not scroll`);
        if (!inside(text, card)) problems.push(`${label} rules text is clipped by the card`);
      }
      const stats = card.querySelector('.dc-stats');
      if (stats instanceof HTMLElement && !inside(stats, card)) problems.push(`${label} stats are clipped by the card`);
      const parts = ['.dc-name', '.dc-type', '.kw-chips', '.dc-text', '.dc-stats', '.dc-champ', '.dc-cost', '.dc-q'].flatMap((sel) => {
        const el = card.querySelector(sel);
        return el instanceof HTMLElement ? [el] : [];
      });
      for (let i = 0; i < parts.length; i += 1) {
        for (let j = i + 1; j < parts.length; j += 1) {
          const a = parts[i];
          const b = parts[j];
          if (!a || !b || (onArt(a) && onArt(b))) continue;
          if (overlaps(a.getBoundingClientRect(), b.getBoundingClientRect())) problems.push(`${label} ${a.className} overlaps ${b.className}`);
        }
      }
      return problems;
    };

    let pop = document.getElementById('hovercard');
    const existed = Boolean(pop);
    const previous = pop?.innerHTML ?? '';
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'hovercard';
      document.body.append(pop);
    }
    pop.classList.toggle('dock-left', document.documentElement.dataset.inspectDock === 'left');
    const problems: string[] = [];
    for (const id of ids) {
      pop.innerHTML = w.cardFace(id, { size: 'inspect' });
      const card = pop.querySelector('.dc');
      if (card instanceof HTMLElement) problems.push(...measure(card, id));
    }
    for (const card of Array.from(document.querySelectorAll('.sheet .dc.sz-inspect, #lift .dc.sz-inspect'))) {
      if (card instanceof HTMLElement) problems.push(...measure(card, card.querySelector('.dc-name')?.textContent?.trim() || 'open'));
    }
    if (existed) pop.innerHTML = previous;
    else pop.remove();
    return problems;
  });
}

async function check(page: Page, size: { width: number; height: number }, id: number, hover = true): Promise<void> {
  const faces = await inspectFaces(page);
  expect(faces, `step ${id} inspect card\n${faces.join('\n')}`).toEqual([]);
  if (hover && size.width > 600) {
    await page.evaluate(() => {
      const point = document.querySelector('[data-guide-point]');
      const cards = Array.from(document.querySelectorAll('.handrow .dc')).filter((el) => el !== point && !el.contains(point) && !(point && point.contains(el)));
      cards.sort((a, b) => (b.querySelector('.dc-name')?.textContent?.length ?? 0) - (a.querySelector('.dc-name')?.textContent?.length ?? 0));
      const champ = cards.find((el) => el.classList.contains('champ'));
      (champ ?? cards[0])?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    });
    await page.waitForTimeout(280);
  }
  const report = await page.evaluate(() => {
    const margin = 8;
    const bub = document.getElementById('bub');
    const bard = document.querySelector('.cm-bard');
    const rects = [bub, bard].flatMap((el) => (el instanceof HTMLElement ? [el.getBoundingClientRect()] : []));
    const union = rects.reduce(
      (acc, rect) => ({
        x: Math.min(acc.x, rect.left),
        y: Math.min(acc.y, rect.top),
        r: Math.max(acc.r, rect.right),
        b: Math.max(acc.b, rect.bottom),
      }),
      { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity },
    );
    const hits = (rect: DOMRect) => union.x < rect.right - 1 && rect.left < union.r - 1 && union.y < rect.bottom - 1 && rect.top < union.b - 1;
    const point = document.querySelector('[data-guide-point]');
    const end = document.getElementById('endturn');
    const pointsAtEnd = Boolean(point && end && (point === end || end.contains(point)));
    const inspects = Array.from(document.querySelectorAll('#hovercard, .sheet')).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2;
    });
    const hand = document.querySelector('.hand-wrap')?.getBoundingClientRect();
    const pages = document.querySelector('.pages')?.getBoundingClientRect();
    const app = document.querySelector('.app');
    return {
      missing: !bub || rects.length === 0,
      off: union.x < margin - 0.5 || union.y < margin - 0.5 || union.r > window.innerWidth - margin + 0.5 || union.b > window.innerHeight - margin + 0.5,
      union,
      view: { w: window.innerWidth, h: window.innerHeight },
      point: point ? (() => { const r = point.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, tag: point.id || point.className }; })() : null,
      spotlight: Boolean(point && !pointsAtEnd && hits(point.getBoundingClientRect())),
      endTurn: Boolean(end && !pointsAtEnd && hits(end.getBoundingClientRect())),
      inspect: inspects.some((el) => hits(el.getBoundingClientRect())),
      toast: Array.from(document.querySelectorAll('.toast')).some((el) => hits(el.getBoundingClientRect())),
      pageScroll: document.documentElement.scrollHeight > window.innerHeight + 2 || document.documentElement.scrollWidth > window.innerWidth + 2,
      boardClipped: Boolean(app && hand && pages && hand.height > 2 && (hand.bottom > window.innerHeight + 1 || pages.top < -1 || app.getBoundingClientRect().top < -1)),
      hand: hand && hand.height > 2 ? { top: hand.top, bottom: hand.bottom } : null,
      pages: pages && pages.height > 2 ? { top: pages.top, bottom: pages.bottom } : null,
    };
  });
  expect(report.missing, `step ${id} has no bubble`).toBe(false);
  expect(report.off, `step ${id} bubble leaves the viewport ${JSON.stringify(report.union)} in ${report.view.w}x${report.view.h}`).toBe(false);
  expect(report.spotlight, `step ${id} bubble covers its spotlight ${JSON.stringify({ union: report.union, point: report.point })}`).toBe(false);
  expect(report.endTurn, `step ${id} bubble covers End Turn`).toBe(false);
  expect(report.inspect, `step ${id} bubble covers the inspect panel`).toBe(false);
  expect(report.toast, `step ${id} toast covers the bubble`).toBe(false);
  if (size.width > 600) expect(report.pageScroll, `step ${id} page scrolls`).toBe(false);
  if (size.width > 600 && report.hand && report.pages) {
    expect(report.boardClipped, `step ${id} board is clipped`).toBe(false);
    expect(report.hand.bottom <= size.height + 1 && report.pages.top >= -1, `step ${id} board leaves the screen`).toBeTruthy();
    if (size.height <= 640) expect(report.hand.top - report.pages.bottom).toBeLessThan(96);
  }
  if (id === 11 || id === 15 || id === 22) {
    await page.screenshot({ path: `${SHOTS}/guide-step-${id}-${size.width}x${size.height}.png` });
  }
}
