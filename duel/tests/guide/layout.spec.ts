import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const ARTIFACTS = process.env.ARTIFACT_DIR ?? '/opt/cursor/artifacts';

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
    let ready = false;
    for (let attempt = 0; attempt < 4 && !ready; attempt++) {
      await page.goto('/');
      await page.locator('#play-title').click();
      await settle(page);
      if ((await phase(page)) === 'mulligan') {
        await page.locator('#endturn').click({ force: true });
        await page.waitForFunction(() => {
          const board = window.__duel as Board | undefined;
          return Boolean(board && board.view.phase !== 'mulligan' && board.view.yourTurn && !board.opponentThinking && board.view.winner == null);
        });
      }
      for (let turn = 0; turn < 8; turn++) {
        const infoNow = await boardInfo(page);
        if (infoNow.winner != null) break;
        expect(await layoutProblems(page), `attempt ${attempt} turn ${turn}`).toEqual([]);
        if (infoNow.cards >= 7 && infoNow.units > 0) {
          if (info.project.name === 'phone') {
            mkdirSync(ARTIFACTS, { recursive: true });
            await page.screenshot({ path: `${ARTIFACTS}/layout-${size.width}-hand7.png`, fullPage: false });
          }
          ready = true;
          break;
        }
        await advance(page);
      }
    }
    expect(ready).toBe(true);
  });
}

async function phase(page: Page): Promise<string> {
  return page.evaluate(() => (window.__duel as Board | undefined)?.view.phase ?? '');
}

async function boardInfo(page: Page): Promise<{ cards: number; units: number; winner: number | null }> {
  return page.evaluate(() => {
    const board = window.__duel as Board | undefined;
    return {
      cards: document.querySelectorAll('.handrow > .dc').length,
      units: document.querySelectorAll('.un').length,
      winner: board?.view.winner ?? null,
    };
  });
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const board = window.__duel as Board | undefined;
    return Boolean(board && board.view.yourTurn && !board.opponentThinking && board.view.winner == null && board.view.phase !== 'game_over');
  });
}

async function advance(page: Page): Promise<void> {
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

async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const norm = (value: string) => value.replace(/\s+/g, ' ').trim();
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
    for (const name of Array.from(document.querySelectorAll('.pb-name'))) {
      if (!(name instanceof HTMLElement)) continue;
      const label = norm(name.textContent ?? '');
      if (name.scrollWidth > name.clientWidth + 1) problems.push(`page label clipped ${label}`);
      const chip = name.closest('.pb')?.querySelector('.pb-st');
      if (chip && hit(name.getBoundingClientRect(), chip.getBoundingClientRect())) problems.push(`chip overlaps ${label}`);
    }
    const rival = document.querySelector('.r-id b');
    if (rival instanceof HTMLElement) {
      const label = norm(rival.textContent ?? '');
      if (rival.scrollWidth > rival.clientWidth + 1) problems.push(`rival name clipped ${label}`);
      const bar = rival.closest('.rbar')?.getBoundingClientRect();
      const box = rival.getBoundingClientRect();
      if (bar && (box.bottom > bar.bottom + 1 || box.right > bar.right + 1 || box.left < bar.left - 1)) problems.push(`rival name outside header ${label}`);
    }
    const cards = Array.from(document.querySelectorAll('.handrow > .dc'));
    const handBox = document.querySelector('.handrow')?.getBoundingClientRect();
    const statBoxes: DOMRect[] = [];
    const cardBoxes: DOMRect[] = [];
    cards.forEach((card, index) => {
      const cardBox = card.getBoundingClientRect();
      cardBoxes.push(cardBox);
      if (cardBox.width < 44) problems.push(`card ${index} tap ${Math.round(cardBox.width)}`);
      if (cardBox.width < 88) problems.push(`card ${index} width ${Math.round(cardBox.width)}`);
      const text = card.querySelector('.dc-text');
      if (!(text instanceof HTMLElement)) {
        problems.push(`card ${index} has no ability`);
        return;
      }
      const style = getComputedStyle(text);
      const rect = text.getBoundingClientRect();
      const shown = norm(text.textContent ?? '');
      const full = norm(text.dataset.full ?? shown);
      const rest = full.startsWith(shown) ? full.slice(shown.length) : 'mismatch';
      const font = parseFloat(style.fontSize);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) problems.push(`card ${index} ability hidden`);
      if (rect.height < 8 || rect.width < 8) problems.push(`card ${index} ability not visible`);
      if (!shown) problems.push(`card ${index} ability empty`);
      if (rest === 'mismatch' || (rest !== '' && !/^\s/.test(rest))) problems.push(`card ${index} ability cut mid-word (${shown})`);
      if (rect.bottom > cardBox.bottom + 1 || rect.top < cardBox.top - 1) problems.push(`card ${index} ability outside the card`);
      if (font < 10) problems.push(`card ${index} ability ${font}px`);
      if (cards.length >= 7) {
        const fullWords = full.split(' ').filter(Boolean);
        const shownWords = shown.split(' ').filter(Boolean);
        const lineHeight = parseFloat(style.lineHeight) || font * 1.25;
        const lines = lineHeight > 0 ? rect.height / lineHeight : 1;
        if (fullWords.length >= 3) {
          if (shownWords.length < 3 && lines < 1.7) problems.push(`card ${index} ability too short (${shown})`);
        } else if (shown !== full) problems.push(`card ${index} ability shortened (${shown})`);
      }
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
      const cx = cardBox.left + cardBox.width / 2;
      const cy = cardBox.top + cardBox.height / 2;
      const visible = handBox && cx >= handBox.left + 1 && cx <= handBox.right - 1 && cy >= handBox.top + 1 && cy <= handBox.bottom - 1;
      if (visible && !document.querySelector('.app.busy')) {
        const hitEl = document.elementFromPoint(cx, cy);
        const owner = hitEl instanceof Element ? hitEl.closest('.handrow > .dc') : null;
        if (owner !== card) problems.push(`card ${index} center hits a neighbour`);
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
    for (let i = 0; i < cardBoxes.length; i++) {
      for (let j = i + 1; j < cardBoxes.length; j++) {
        const a = cardBoxes[i];
        const b = cardBoxes[j];
        if (a && b && hit(a, b)) problems.push('hand cards overlap');
      }
    }
    const handEl = document.querySelector('.handrow');
    if (handEl) {
      const box = handEl.getBoundingClientRect();
      if (box.bottom > window.innerHeight + 2) problems.push('hand runs off the screen');
    }
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
