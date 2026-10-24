import { describe, expect, it } from 'vitest';
import { PRACTICE_DECKS } from '../src/engine/stub-catalog.js';
import { initialState, view } from '../src/engine/stub.js';

describe('stub fixture', () => {
  it('still deals a redacted opening without the seed', () => {
    const candle = PRACTICE_DECKS.candle;
    const fold = PRACTICE_DECKS.fold;
    const seed = 'stub-fixture-seed-not-for-clients';
    const state = initialState(
      [
        { house: candle.house, legendId: candle.legendId, cards: candle.cards.slice() },
        { house: fold.house, legendId: fold.legendId, cards: fold.cards.slice() },
      ],
      seed,
    );
    const seen = JSON.stringify(view(state, 0));
    expect(seen).not.toContain(seed);
    expect(state.players[0].hand.length).toBeGreaterThan(0);
    expect(seen).toContain('Wickling');
  });
});