import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.ARTIFACT_DIR ?? '/opt/cursor/artifacts';
const PACED_URL = process.env.BASE_URL ? new URL('/', process.env.BASE_URL).href : 'http://127.0.0.1:5200/';

interface Board {
  view: {
    yourTurn: boolean;
    phase: string;
    turn: number[];
    winner: number | null;
  };
  opponentThinking: boolean;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('bard-duel-tutorial', 'skipped');
    localStorage.setItem('bard-duel-real-matches', '9');
  });
});

test('a sideways swipe scrolls the hand on your turn', async ({ page }) => {
  await startMatch(page, '/');
  await growHand(page);
  const before = await resetHand(page);
  await swipeHand(page, -224);
  await expect.poll(() => scrollLeft(page)).toBeGreaterThanOrEqual(before + 150);
  await shot(page, 'hand-swipe-your-turn.png');
});

test('a sideways swipe scrolls the hand on the rival turn', async ({ page }) => {
  await startMatch(page, PACED_URL);
  await growHand(page);
  const before = await resetHand(page);
  await page.locator('#endturn').click({ force: true });
  await page.waitForFunction(() => {
    const board = window.__duel as Board | undefined;
    return Boolean(board && board.view.winner == null && (board.opponentThinking || !board.view.yourTurn));
  });
  await swipeHand(page, -224);
  await expect.poll(() => scrollLeft(page)).toBeGreaterThanOrEqual(before + 150);
  await shot(page, 'hand-swipe-rival-turn.png');
});

test('a vertical drag still plays a character', async ({ page }) => {
  await startMatch(page, '/');
  const def = await playableCharacter(page);
  const from = await center(page, `.handrow > .dc.character.playable[data-def="${def}"]`);
  const pageBox = await boxOf(page, '.page[data-i="0"]');
  const drop = { x: Math.min(Math.max(from.x, pageBox.x + 24), pageBox.x + pageBox.width - 24), y: pageBox.y + Math.min(72, pageBox.height / 2) };
  await finger(page, [from, { x: from.x, y: from.y - 48 }, drop]);
  await expect.poll(() => page.locator(`.row.you [data-def="${def}"]`).count()).toBeGreaterThan(0);
});

test('a drop on a unit plays that Page', async ({ page }) => {
  await startMatch(page, '/');
  const [first, second] = await twoCharacters(page);
  await playAt(page, first, await pagePoint(page, 0));
  await expect.poll(() => page.locator(`.row.you [data-def="${first.def}"]`).count()).toBeGreaterThan(0);
  const unit = await unitPoint(page, first.def);
  const before = await page.locator(`.row.you [data-def="${second.def}"]`).count();
  const legal = await legalPlays(page, second.uid);
  const posts = trackPlays(page);
  await playAt(page, second, unit);
  await expect.poll(() => page.locator(`.row.you [data-def="${second.def}"]`).count()).toBeGreaterThan(before);
  const sent = posts.at(-1);
  expect(sent?.page).toBe(unit.page);
  expect(legal).toContainEqual(sent);
});

test('a tap on a unit plays that Page', async ({ page }) => {
  await startMatch(page, '/');
  const [first, second] = await twoCharacters(page);
  await playAt(page, first, await pagePoint(page, 0));
  await expect.poll(() => page.locator(`.row.you [data-def="${first.def}"]`).count()).toBeGreaterThan(0);
  const unit = await unitPoint(page, first.def);
  const before = await page.locator(`.row.you [data-def="${second.def}"]`).count();
  const legal = await legalPlays(page, second.uid);
  const held = await visibleCard(page, second.uid);
  await fingerTap(page, held);
  await expect(page.locator(`.handrow > .dc.armed[data-uid="${second.uid}"]`)).toHaveCount(1);
  const posts = trackPlays(page);
  await fingerTap(page, unit);
  await expect.poll(() => page.locator(`.row.you [data-def="${second.def}"]`).count()).toBeGreaterThan(before);
  const sent = posts.at(-1);
  expect(sent?.page).toBe(unit.page);
  expect(legal).toContainEqual(sent);
});

test('a drop off a Page sends nothing', async ({ page }) => {
  await startMatch(page, '/');
  const def = await playableCharacter(page);
  const uid = await page.locator(`.handrow > .dc.character.playable[data-def="${def}"]`).first().getAttribute('data-uid');
  const from = await visibleCard(page, uid ?? '');
  const away = await center(page, '.rbar');
  const posts = trackPlays(page);
  await finger(page, [from, { x: from.x, y: from.y - 48 }, away]);
  await page.waitForTimeout(400);
  expect(posts).toEqual([]);
  await expect(page.locator(`.handrow [data-uid="${uid}"]`)).toHaveCount(1);
});

for (const size of [
  { width: 390, height: 844 },
  { width: 360, height: 780 },
]) {
  test(`a tapped card lifts clear of the Page at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await startMatch(page, '/');
    const play = await visiblePlayable(page);
    const def = play.def;
    const before = await layoutBoxes(page);
    await fingerTap(page, play);
    await expect(page.locator(`.handrow > .dc.armed[data-def="${def}"]`)).toHaveCount(1);
    const after = await layoutBoxes(page);
    expect(Math.abs(after.pages.x - before.pages.x)).toBeLessThan(2);
    expect(Math.abs(after.pages.y - before.pages.y)).toBeLessThan(2);
    expect(Math.abs(after.pages.width - before.pages.width)).toBeLessThan(2);
    expect(Math.abs(after.pages.height - before.pages.height)).toBeLessThan(2);
    expect(Math.abs(after.hand.x - before.hand.x)).toBeLessThan(2);
    expect(Math.abs(after.hand.y - before.hand.y)).toBeLessThan(2);
    expect(Math.abs(after.hand.width - before.hand.width)).toBeLessThan(2);
    expect(Math.abs(after.hand.height - before.hand.height)).toBeLessThan(2);
    const lifted = await page.evaluate(() => {
      const card = document.querySelector('.handrow > .dc.armed');
      if (!(card instanceof HTMLElement)) return null;
      const box = card.getBoundingClientRect();
      const obstacles = Array.from(document.querySelectorAll('.page, #tray')).map((el) => {
        const rect = el.getBoundingClientRect();
        return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
      });
      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
        width: window.innerWidth,
        height: window.innerHeight,
        obstacles,
      };
    });
    expect(lifted).not.toBeNull();
    if (!lifted) return;
    expect(lifted.top).toBeGreaterThanOrEqual(0);
    expect(lifted.left).toBeGreaterThanOrEqual(0);
    expect(lifted.right).toBeLessThanOrEqual(lifted.width + 0.5);
    expect(lifted.bottom).toBeLessThanOrEqual(lifted.height + 0.5);
    expect(lifted.bottom - lifted.top).toBeGreaterThan(80);
    for (const obstacle of lifted.obstacles) {
      if (obstacle.width < 2 || obstacle.height < 2) continue;
      const clear = lifted.right <= obstacle.left + 1 || lifted.left >= obstacle.right - 1 || lifted.bottom <= obstacle.top + 1 || lifted.top >= obstacle.bottom - 1;
      expect(clear).toBe(true);
    }
    await shot(page, `hand-lift-${size.width}.png`);
    const pageBox = await boxOf(page, '.page[data-i="0"]');
    const posts = trackPlays(page);
    await fingerTap(page, { x: pageBox.x + pageBox.width / 2, y: pageBox.y + Math.min(36, pageBox.height / 2) });
    await expect.poll(() => page.locator(`.row.you [data-def="${def}"]`).count()).toBeGreaterThan(0);
    expect(posts.at(-1)?.page).toBe(0);
  });
}

async function startMatch(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('#play-title').click();
  await page.waitForFunction(() => {
    const board = window.__duel as Board | undefined;
    return Boolean(board && board.view.winner == null && board.view.yourTurn && !board.opponentThinking);
  });
  if ((await phase(page)) === 'mulligan') {
    await page.locator('#endturn').click({ force: true });
    await page.waitForFunction(() => {
      const board = window.__duel as Board | undefined;
      return Boolean(board && board.view.phase !== 'mulligan' && board.view.yourTurn && !board.opponentThinking && board.view.winner == null);
    });
  }
}

async function phase(page: Page): Promise<string> {
  return page.evaluate(() => (window.__duel as Board | undefined)?.view.phase ?? '');
}

async function scrollLeft(page: Page): Promise<number> {
  return page.evaluate(() => document.getElementById('hand')?.scrollLeft ?? 0);
}

async function resetHand(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hand = document.getElementById('hand');
    if (!hand) return 0;
    hand.classList.add('panning');
    void hand.offsetWidth;
    hand.scrollLeft = 0;
    hand.classList.remove('panning');
    return hand.scrollLeft;
  });
}

async function growHand(page: Page): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) {
    const range = await page.evaluate(() => {
      const hand = document.getElementById('hand');
      if (!hand) return 0;
      return hand.scrollWidth - hand.clientWidth;
    });
    if (range >= 220) return;
    await endTurn(page);
  }
  const range = await page.evaluate(() => {
    const hand = document.getElementById('hand');
    return hand ? hand.scrollWidth - hand.clientWidth : 0;
  });
  expect(range).toBeGreaterThanOrEqual(150);
}

async function endTurn(page: Page): Promise<void> {
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

interface HandCard {
  def: string;
  uid: string;
  cost: number;
}

interface PlayAction {
  type: string;
  uid?: number;
  page?: number;
  target?: number;
}

function trackPlays(page: Page): PlayAction[] {
  const posts: PlayAction[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'POST' || !req.url().includes('/actions')) return;
    try {
      const data = req.postDataJSON() as { action?: PlayAction };
      if (data.action?.type === 'play' || data.action?.type === 'champion') posts.push(data.action);
    } catch {
      /* A non-JSON post is not a play. */
    }
  });
  return posts;
}

async function legalPlays(page: Page, uid: string): Promise<PlayAction[]> {
  return page.evaluate((id) => {
    const board = window.__duel as { legalActions?: PlayAction[] } | undefined;
    return (board?.legalActions ?? []).filter((action) => action.type === 'play' && String(action.uid) === id);
  }, uid);
}

async function twoCharacters(page: Page): Promise<[HandCard, HandCard]> {
  for (let turn = 0; turn < 8; turn += 1) {
    const pair = await page.evaluate(() => {
      const board = window.__duel as { view?: { ink: number; hand: { instanceId: string; defId: string; type: string; cost: number }[] } } | undefined;
      const ink = board?.view?.ink ?? 0;
      const playable = new Set(Array.from(document.querySelectorAll('.handrow > .dc.character.playable')).map((el) => el.getAttribute('data-uid') ?? ''));
      const cards = (board?.view?.hand ?? []).flatMap((card) => {
        if (card.type !== 'character' || !playable.has(card.instanceId)) return [];
        return [{ def: card.defId, uid: card.instanceId, cost: card.cost }];
      });
      for (let i = 0; i < cards.length; i += 1) {
        for (let j = 0; j < cards.length; j += 1) {
          const left = cards[i];
          const right = cards[j];
          if (!left || !right || left.uid === right.uid) continue;
          if (left.cost + right.cost <= ink) return left.cost <= right.cost ? [left, right] : [right, left];
        }
      }
      return null;
    });
    if (pair) return pair as [HandCard, HandCard];
    await endTurn(page);
  }
  throw new Error('need two characters that can both be played');
}

async function visibleCard(page: Page, uid: string): Promise<{ x: number; y: number }> {
  const hit = await page.evaluate((id) => {
    const hand = document.getElementById('hand');
    const card = document.querySelector(`.handrow > .dc[data-uid="${id}"]`);
    if (!hand || !(card instanceof HTMLElement)) return null;
    const show = () => {
      const box = card.getBoundingClientRect();
      const handBox = hand.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (x < 8 || y < 8 || x > window.innerWidth - 8 || y > window.innerHeight - 8) return null;
      if (x < handBox.left + 8 || x > handBox.right - 8 || y < handBox.top || y > handBox.bottom) return null;
      return { x, y };
    };
    const ready = show();
    if (ready) return ready;
    hand.classList.add('panning');
    void hand.offsetWidth;
    const max = hand.scrollWidth - hand.clientWidth;
    for (let nudge = 0; nudge < 8 && hand.scrollLeft < max - 1; nudge += 1) {
      hand.scrollLeft = Math.min(max, hand.scrollLeft + 100);
      const next = show();
      if (next) return next;
    }
    return null;
  }, uid);
  if (!hit) throw new Error(`card ${uid} is not in view`);
  return hit;
}

async function pagePoint(page: Page, index: number): Promise<{ x: number; y: number }> {
  const box = await boxOf(page, `.page[data-i="${index}"]`);
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height - 12, Math.max(20, box.height * 0.7)) };
}

async function unitPoint(page: Page, def: string): Promise<{ x: number; y: number; page: number }> {
  const found = await page.evaluate((id) => {
    const unit = document.querySelector(`.row.you [data-def="${id}"]`);
    if (!(unit instanceof HTMLElement)) return null;
    const box = unit.getBoundingClientRect();
    return {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
      page: Number(unit.closest('.page')?.getAttribute('data-i')),
    };
  }, def);
  if (!found || !Number.isInteger(found.page)) throw new Error(`missing unit ${def}`);
  return found;
}

async function playAt(page: Page, card: HandCard, at: { x: number; y: number }): Promise<void> {
  const from = await visibleCard(page, card.uid);
  await finger(page, [from, { x: from.x, y: from.y - 48 }, at]);
}

async function playableCharacter(page: Page): Promise<string> {
  for (let turn = 0; turn < 6; turn += 1) {
    const def = await page.evaluate(() => document.querySelector('.handrow > .dc.character.playable')?.getAttribute('data-def') ?? '');
    if (def) return def;
    await endTurn(page);
  }
  throw new Error('no playable character');
}

async function visiblePlayable(page: Page): Promise<{ def: string; x: number; y: number }> {
  for (let turn = 0; turn < 6; turn += 1) {
    const hit = await page.evaluate(() => {
      const hand = document.getElementById('hand');
      if (!hand) return null;
      const find = () => {
        const handBox = hand.getBoundingClientRect();
        const cards = Array.from(hand.querySelectorAll(':scope > .dc.character.playable'));
        for (const card of cards) {
          if (!(card instanceof HTMLElement)) continue;
          const box = card.getBoundingClientRect();
          const x = box.left + box.width / 2;
          const y = box.top + box.height / 2;
          if (x < 8 || y < 8 || x > window.innerWidth - 8 || y > window.innerHeight - 8) continue;
          if (x < handBox.left + 8 || x > handBox.right - 8 || y < handBox.top || y > handBox.bottom) continue;
          return { def: card.getAttribute('data-def') ?? '', x, y };
        }
        return null;
      };
      const ready = find();
      if (ready) return ready;
      hand.classList.add('panning');
      void hand.offsetWidth;
      const max = hand.scrollWidth - hand.clientWidth;
      for (let nudge = 0; nudge < 8 && hand.scrollLeft < max - 1; nudge += 1) {
        hand.scrollLeft = Math.min(max, hand.scrollLeft + 100);
        const next = find();
        if (next) return next;
      }
      return null;
    });
    if (hit?.def) return hit;
    await endTurn(page);
  }
  throw new Error('no visible playable character');
}

async function center(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await boxOf(page, selector);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`missing ${selector}`);
  return box;
}

async function layoutBoxes(page: Page): Promise<{ pages: Box; hand: Box }> {
  const pages = await boxOf(page, '.pages');
  const hand = await boxOf(page, '#hand');
  return { pages, hand };
}

async function swipeHand(page: Page, dx: number): Promise<void> {
  const start = await page.evaluate(() => {
    const hand = document.getElementById('hand');
    if (!hand) return null;
    const handBox = hand.getBoundingClientRect();
    const cards = Array.from(hand.querySelectorAll(':scope > .dc'));
    let pick: Element | null = null;
    for (const card of cards) {
      if (!(card instanceof HTMLElement) || card.style.position === 'fixed') continue;
      const box = card.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      if (x < handBox.left + 8 || x > handBox.right - 8 || y < handBox.top || y > handBox.bottom) continue;
      pick = card;
    }
    if (!(pick instanceof HTMLElement)) return null;
    const box = pick.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  if (!start) throw new Error('no card to swipe');
  await finger(page, [start, { x: start.x + dx, y: start.y }]);
}

/** CDP touches stepped by 8px, the way a finger actually moves. */
async function finger(page: Page, points: { x: number; y: number }[]): Promise<void> {
  const path = stepped(points, 8);
  const client = await page.context().newCDPSession(page);
  const first = path[0];
  if (!first) throw new Error('empty finger path');
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(first.x), y: Math.round(first.y), id: 0 }] });
  for (const point of path.slice(1)) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: Math.round(point.x), y: Math.round(point.y), id: 0 }],
    });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

async function fingerTap(page: Page, point: { x: number; y: number }): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: Math.round(point.x), y: Math.round(point.y), id: 0 }],
  });
  await page.waitForTimeout(40);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

function stepped(points: { x: number; y: number }[], step: number): { x: number; y: number }[] {
  const first = points[0];
  if (!first) return [];
  const path = [first];
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    if (!from || !to) continue;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const count = Math.max(1, Math.round(dist / step));
    for (let s = 1; s <= count; s += 1) {
      path.push({ x: from.x + ((to.x - from.x) * s) / count, y: from.y + ((to.y - from.y) * s) / count });
    }
  }
  return path;
}

async function shot(page: Page, name: string): Promise<void> {
  try {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}` });
  } catch {
    /* Screenshot dir is optional away from the artifact machine. */
  }
}
