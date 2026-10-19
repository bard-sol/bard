import { expect, test } from '@playwright/test';

test('turn 1 can end with no other action for both seats', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('bard-duel-tutorial', 'skipped');
    localStorage.setItem('bard-duel-real-matches', '9');
  });
  const seen = new Set<string>();
  for (let attempt = 0; attempt < 12 && seen.size < 2; attempt++) {
    await page.goto('/');
    await page.locator('#play-title').click();
    await page.waitForFunction(() => {
      const board = window.__duel as Board | undefined;
      return Boolean(board && board.view.yourTurn && !board.opponentThinking);
    });
    const seat = await page.evaluate(() => {
      const board = window.__duel as Board | undefined;
      if (!board) return 'first';
      const second = board.view.verse[0] > 0 || board.view.hand.some((card) => card.defId === 'spare_ink');
      return second ? 'second' : 'first';
    });
    if (await page.evaluate(() => (window.__duel as Board | undefined)?.view.phase === 'mulligan')) {
      await page.locator('#endturn').click();
      await page.waitForFunction(() => {
        const board = window.__duel as Board | undefined;
        return Boolean(board && board.view.phase !== 'mulligan' && board.view.yourTurn && !board.opponentThinking);
      });
    }
    const before = await page.evaluate(() => (window.__duel as Board | undefined)?.view.turn.join(',') ?? '');
    await page.locator('#endturn').click();
    const confirm = page.locator('#confirm-yes');
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect(page.locator('.toast', { hasText: /illegal/i })).toHaveCount(0);
    await page.waitForFunction((turn) => {
      const board = window.__duel as Board | undefined;
      if (!board) return false;
      return board.view.turn.join(',') !== turn || !board.view.yourTurn || board.opponentThinking;
    }, before);
    seen.add(seat);
  }
  expect(seen.has('first')).toBe(true);
  expect(seen.has('second')).toBe(true);
});

interface Board {
  view: {
    yourTurn: boolean;
    phase: string;
    verse: number[];
    turn: number[];
    hand: { defId: string }[];
  };
  opponentThinking: boolean;
}
