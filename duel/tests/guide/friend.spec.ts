import { expect, test, type Browser, type Page } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5201';
/**
 * Local fixture only. A live run passes the real passcode in PASSCODE.
 * This default is the dev server's test value and is not a production secret.
 */
const LOCAL_PASSCODE = 'bard-friend-test';
const PASSCODE = process.env.BASE_URL ? (process.env.PASSCODE ?? '') : LOCAL_PASSCODE;
const SHOTS = process.env.ARTIFACT_DIR ?? '/opt/cursor/artifacts';

interface Board {
  matchId: string;
  generation?: number;
  friend?: boolean;
  turnDurationMs?: number;
  view: {
    you: number;
    yourTurn: boolean;
    phase: string;
    winner: number | null;
    winReason: string | null;
    verse: [number, number];
    hand: Array<{ instanceId: string; defId: string }>;
  };
}

test.beforeEach(async ({ page }) => {
  await arm(page);
});

test('two friends play a match, rejoin, and rematch', async ({ page, browser }) => {
  await page.goto('/');
  await unlock(page);
  await page.locator('#play-friend').click();
  await page.locator('[data-deck="candle"]').click();
  await expect(page.locator('#invite-url')).toContainText('/m/');
  await page.screenshot({ path: `${SHOTS}/friend-invite-1440.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  const label = await page.locator('.title-card .eyebrow').boundingBox();
  const cancel = await page.locator('#cancel-invite').boundingBox();
  expect(label && cancel && cancel.y >= label.y + label.height).toBeTruthy();
  await page.screenshot({ path: `${SHOTS}/friend-invite-390.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  const link = (await page.locator('#invite-url').textContent()) ?? '';
  expect(link).toMatch(/\/m\/[0-9a-hjkmnp-tv-z]{26}$/);
  expect(link).not.toContain(PASSCODE);

  const guest = await guestPage(browser);
  await guest.goto(link);
  await unlock(guest);
  await guest.locator('[data-deck="fold"]').click();
  await expect(page.locator('#endturn')).toBeVisible();
  await expect(guest.locator('#endturn')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/friend-match-1440.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SHOTS}/friend-match-390.png` });
  await page.setViewportSize({ width: 1440, height: 900 });

  const hostIds = await handIds(page);
  const guestDump = await guest.evaluate(() => JSON.stringify(window.__duel));
  for (const id of hostIds) expect(guestDump.includes(`"${id}"`)).toBe(false);
  const bonus = await Promise.all([verse(page), verse(guest)]);
  expect(bonus.filter((value) => value > 0)).toHaveLength(1);

  const before = await handCount(page);
  await page.reload();
  await expect.poll(() => handCount(page)).toBe(before);
  await expect(page.locator('#endturn')).toBeVisible();

  const firstCode = new URL(page.url()).pathname;
  await finish(page, guest);
  await expect(page.locator('.why p')).toBeVisible();
  await expect(guest.locator('.why p')).toBeVisible();
  await expect(page.locator('.panel.war p')).toHaveText(/You (beat|lost to) .+, \d+\u2013\d+\./);
  await expect(guest.locator('.panel.war p')).toHaveText(/You (beat|lost to) .+, \d+\u2013\d+\./);
  const hostWon = await page.locator('h1').textContent();
  const guestWon = await guest.locator('h1').textContent();
  expect(hostWon === 'Won' || hostWon === 'Lost').toBe(true);
  expect(guestWon === 'Won' || guestWon === 'Lost').toBe(true);
  expect(hostWon).not.toBe(guestWon);

  await page.locator('#rematch').click();
  await expect.poll(() => page.url()).not.toContain(firstCode);
  await expect.poll(() => guest.url()).not.toContain(firstCode);
  await expect(page.locator('#endturn')).toBeVisible();
  await expect(guest.locator('#endturn')).toBeVisible();
  await guest.close();
});

test('the first socket delivers the other seat a move', async ({ page, browser }) => {
  const hostLive = tapLive(page);
  await page.goto('/');
  await unlock(page);
  await page.locator('#play-friend').click();
  await page.locator('[data-deck="candle"]').click();
  const link = (await page.locator('#invite-url').textContent()) ?? '';
  const guest = await guestPage(browser);
  const guestLive = tapLive(guest);
  await guest.goto(link);
  await unlock(guest);
  await guest.locator('[data-deck="fold"]').click();
  await expect(page.locator('#endturn')).toBeVisible();
  await expect(guest.locator('#endturn')).toBeVisible();
  const hostTurn = await yourTurn(page);
  const waiter = hostTurn ? guest : page;
  const actor = hostTurn ? page : guest;
  const live = hostTurn ? guestLive : hostLive;
  await waiter.route(/\/api\/matches\/[^/]+$/, (route) => {
    if (route.request().method() === 'GET') return route.abort();
    return route.continue();
  });
  const before = await generation(waiter);
  await actIfTurn(actor);
  await expect.poll(() => generation(waiter), { timeout: 8_000 }).toBeGreaterThan(before);
  expect(live.urls).toHaveLength(1);
  expect(live.urls[0]).toMatch(/^wss?:\/\//);
  expect(live.generations.some((value) => value > before)).toBe(true);
  await guest.close();
});

test('a missed turn ends itself', async ({ page, browser }) => {
  await page.goto('/');
  await unlock(page);
  await page.locator('#play-friend').click();
  await page.locator('[data-deck="candle"]').click();
  const link = (await page.locator('#invite-url').textContent()) ?? '';
  const guest = await guestPage(browser);
  await guest.goto(link);
  await unlock(guest);
  await guest.locator('[data-deck="fold"]').click();
  await expect(page.locator('#endturn')).toBeVisible();
  await expect.poll(async () => {
    const waiting = await Promise.all([phase(page), phase(guest)]);
    if (waiting.some((value) => value === 'mulligan')) {
      await actIfTurn(page);
      await actIfTurn(guest);
    }
    return waiting.every((value) => value !== '' && value !== 'mulligan');
  }, { timeout: 15_000 }).toBe(true);
  const active = (await page.evaluate(() => (window.__duel as Board).view.yourTurn)) ? page : guest;
  const stamp = await stampOf(active);
  const turnMs = await active.evaluate(() => (window.__duel as Board | undefined)?.turnDurationMs ?? 60_000);
  await expect.poll(() => stampOf(active), { timeout: turnMs + 15_000 }).not.toBe(stamp);
  await guest.close();
});

async function arm(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('bard-duel-tutorial', 'skipped');
    localStorage.setItem('bard-duel-real-matches', '9');
  });
}

async function guestPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await arm(page);
  return page;
}

async function unlock(page: Page): Promise<void> {
  if (await page.locator('#play-title').count()) return;
  if (await page.locator('[data-deck]').count()) return;
  if (await page.locator('#endturn').count()) return;
  await page.locator('input[name="passcode"]').fill(PASSCODE);
  await page.locator('button[type="submit"]').click();
  await page.waitForLoadState('domcontentloaded');
}

async function handIds(page: Page): Promise<string[]> {
  return page.evaluate(() => ((window.__duel as Board).view.hand ?? []).map((card) => card.instanceId));
}

async function handCount(page: Page): Promise<number> {
  return page.evaluate(() => (window.__duel as Board | undefined)?.view.hand.length ?? -1);
}

async function verse(page: Page): Promise<number> {
  return page.evaluate(() => (window.__duel as Board).view.verse[0]);
}

async function phase(page: Page): Promise<string> {
  return page.evaluate(() => (window.__duel as Board | undefined)?.view.phase ?? '');
}

async function stampOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const board = window.__duel as Board | undefined;
    if (!board) return '';
    return `${board.view.yourTurn}:${board.view.phase}:${board.generation ?? 0}`;
  });
}

function tapLive(page: Page): { urls: string[]; generations: number[] } {
  const tap = { urls: [] as string[], generations: [] as number[] };
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/live')) return;
    tap.urls.push(socket.url());
    socket.on('framereceived', (frame) => {
      try {
        const body = JSON.parse(String(frame.payload)) as { generation?: number };
        if (typeof body.generation === 'number') tap.generations.push(body.generation);
      } catch {
        /* A non-JSON frame is not a match view. */
      }
    });
  });
  return tap;
}

async function generation(page: Page): Promise<number> {
  return page.evaluate(() => (window.__duel as Board | undefined)?.generation ?? -1);
}

async function actIfTurn(page: Page): Promise<void> {
  const before = await page.evaluate(() => {
    const board = window.__duel as Board | undefined;
    if (!board || !board.view.yourTurn || board.view.winner != null) return null;
    return board.generation ?? 0;
  });
  if (before == null) return;
  if ((await page.locator('#confirm-yes').count()) === 0) {
    const end = page.locator('#endturn');
    await expect(end).toBeEnabled();
    await end.click({ force: true });
  }
  const confirm = page.locator('#confirm-yes');
  if (await confirm.count()) await confirm.click();
  await expect.poll(() => page.evaluate(() => (window.__duel as Board | undefined)?.generation ?? -1), { timeout: 8_000 }).not.toBe(before);
}

async function finish(host: Page, guest: Page): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const done = await Promise.all([over(host), over(guest)]);
    if (done.every(Boolean)) return;
    const turn = await Promise.all([yourTurn(host), yourTurn(guest)]);
    if (turn[0]) await actIfTurn(host);
    else if (turn[1]) await actIfTurn(guest);
    else await host.waitForTimeout(150);
  }
  throw new Error('friend match did not finish');
}

async function yourTurn(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const board = window.__duel as Board | undefined;
    return Boolean(board && board.view.yourTurn && board.view.winner == null);
  });
}

async function over(page: Page): Promise<boolean> {
  return page.evaluate(() => (window.__duel as Board | undefined)?.view.winner != null);
}
