import { expect, test } from '@playwright/test';

test.beforeEach(({}, info) => {
  test.skip(info.project.name === 'paced', 'Phone layout is checked on the instant server.');
});

for (const size of [
  { width: 390, height: 844 },
  { width: 360, height: 780 },
]) {
  test(`real match board at ${size.width}x${size.height}`, async ({ page }, info) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem('bard-duel-tutorial', 'skipped');
      localStorage.setItem('bard-duel-real-matches', '9');
    });
    let units = 0;
    for (let attempt = 0; attempt < 4 && units === 0; attempt++) {
      await page.goto('/');
      await page.locator('#play-title').click();
      await settle(page);
      if (await phase(page) === 'mulligan') {
        await page.locator('#endturn').click({ force: true });
        await settle(page);
      }
      await expect(page.locator('.page')).toHaveCount(2);
      expect(await layoutProblems(page), `turn 1 attempt ${attempt}`).toEqual([]);
      if (info.project.name === 'phone' && attempt === 0) {
        await page.screenshot({ path: `/opt/cursor/artifacts/layout-${size.width}-turn1.png`, fullPage: false });
      }
      await advance(page);
      await advance(page);
      units = await page.locator('.un').count();
      if (units > 0) {
        expect(await layoutProblems(page), 'turn 3').toEqual([]);
        if (info.project.name === 'phone') {
          await page.screenshot({ path: `/opt/cursor/artifacts/layout-${size.width}-turn3.png`, fullPage: false });
        }
      }
    }
    expect(units).toBeGreaterThan(0);
  });
}

async function phase(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => (window.__duel as Board | undefined)?.view.phase ?? '');
}

async function settle(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => {
    const board = window.__duel as Board | undefined;
    return Boolean(board && board.view.yourTurn && !board.opponentThinking && board.view.winner == null && board.view.phase !== 'game_over');
  });
}

async function advance(page: import('@playwright/test').Page): Promise<void> {
  await settle(page);
  const before = await page.evaluate(() => (window.__duel as Board).view.turn[0]);
  await page.locator('#endturn').click({ force: true });
  const confirm = page.locator('#confirm-yes');
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.waitForFunction((turn) => {
    const board = window.__duel as Board | undefined;
    if (!board || board.view.winner != null) return true;
    return board.view.turn[0] > turn && board.view.yourTurn && !board.opponentThinking && board.view.phase !== 'mulligan';
  }, before);
}

async function layoutProblems(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const pages = Array.from(document.querySelectorAll('.page'));
    const ribbon = document.querySelector('.ribbon')?.getBoundingClientRect();
    const turn = document.querySelector('#turn')?.getBoundingClientRect();
    if (pages.length < 2) problems.push('expected two pages');
    for (const el of pages) {
      const box = el.getBoundingClientRect();
      if (box.width < 140) problems.push(`page width ${Math.round(box.width)}`);
      if (ribbon && hit(box, ribbon)) problems.push('page overlaps the turn bar');
      if (turn && hit(box, turn)) problems.push('page overlaps #turn');
      for (const unit of Array.from(el.querySelectorAll('.un'))) {
        const token = unit.getBoundingClientRect();
        if (token.width < 2 || token.height < 2) continue;
        if (ribbon && hit(token, ribbon)) problems.push('unit overlaps the turn bar');
        if (turn && hit(token, turn)) problems.push('unit overlaps #turn');
        if (token.left < box.left - 1 || token.right > box.right + 1 || token.top < box.top - 1 || token.bottom > box.bottom + 1) {
          problems.push('unit sits outside its page');
        }
      }
    }
    const cards = Array.from(document.querySelectorAll('.handrow > .dc'));
    const statBoxes: DOMRect[] = [];
    cards.forEach((card, index) => {
      const text = card.querySelector('.dc-text');
      if (!(text instanceof HTMLElement)) {
        problems.push(`card ${index} has no ability`);
        return;
      }
      const style = getComputedStyle(text);
      const rect = text.getBoundingClientRect();
      const shown = (text.textContent ?? '').trim();
      const full = (text.dataset.full ?? shown).trim();
      const rest = full.startsWith(shown) ? full.slice(shown.length) : 'mismatch';
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) problems.push(`card ${index} ability hidden`);
      if (rect.height < 8 || rect.width < 8) problems.push(`card ${index} ability not visible`);
      if (!shown) problems.push(`card ${index} ability empty`);
      if (rest === 'mismatch' || (rest !== '' && !/^\s/.test(rest))) problems.push(`card ${index} ability cut mid-word (${shown})`);
      if (rect.bottom < 0 || rect.top > window.innerHeight) problems.push(`card ${index} ability off screen`);
      const name = card.querySelector('.dc-name');
      const node = name?.firstChild;
      if (name instanceof HTMLElement && node && node.nodeType === Node.TEXT_NODE) {
        const box = name.getBoundingClientRect();
        let cursor = 0;
        const raw = node.textContent ?? '';
        for (const part of raw.split(/(\s+)/)) {
          if (!part.trim()) {
            cursor += part.length;
            continue;
          }
          const range = document.createRange();
          range.setStart(node, cursor);
          range.setEnd(node, cursor + part.length);
          cursor += part.length;
          for (const word of Array.from(range.getClientRects())) {
            if (word.right > box.right + 1 || word.left < box.left - 1 || word.bottom > box.bottom + 1 || word.top < box.top - 1) {
              problems.push(`name clips “${part}”`);
            }
          }
        }
      }
      const mine: DOMRect[] = [];
      for (const stat of Array.from(card.querySelectorAll('.st, .dc-stats .hint'))) {
        const box = stat.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) continue;
        mine.push(box);
      }
      for (const other of statBoxes) {
        for (const box of mine) {
          if (hit(box, other)) problems.push('hand stats overlap');
        }
      }
      statBoxes.push(...mine);
    });
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) problems.push(`horizontal scroll ${root.scrollWidth}>${root.clientWidth}`);
    if (document.body.scrollWidth > document.body.clientWidth + 1) problems.push(`body scroll ${document.body.scrollWidth}>${document.body.clientWidth}`);
    return problems;
  });
}

interface Board {
  view: {
    yourTurn: boolean;
    phase: string;
    turn: number[];
    winner: number | null;
  };
  opponentThinking: boolean;
}
