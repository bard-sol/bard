import { describe, expect, it } from 'vitest';
import { apply, newMatch } from '../engine/active.mjs';
import { localTrade } from '../src/client/scene.js';
import { projectView } from '../src/engine/project.js';
import type { EngineState } from '../src/engine/state.js';
import type { UnitView } from '../src/types.js';
import { candleDeck, foldDeck } from './support.js';

describe('conquer', () => {
  it('awards 2 Verses and the board log says so', () => {
    const candle = candleDeck();
    const fold = foldDeck();
    let state = newMatch({
      houseA: candle.house,
      deckA: candle.cards,
      houseB: fold.house,
      deckB: fold.cards,
      seed: 11,
      aiVersion: 'pilot-1.1.0',
    }) as EngineState;
    state = apply(state, { type: 'mulligan', idx: [] });
    state = apply(state, { type: 'mulligan', idx: [] });
    const owner = state.active;
    state.enemiesAtStart = [true, false];
    state.board[0][owner].push({
      uid: 900,
      id: 'c_novice',
      owner,
      page: 0,
      atk: 1,
      hp: 2,
      maxHp: 2,
      kw: ['kindle'],
      kindle: 1,
      ward: false,
      hiddenOn: false,
      exhausted: true,
      attacked: false,
      moved: false,
      silenced: false,
      tempAtk: 0,
      tempRip: false,
    });
    const next = apply(state, { type: 'end' });
    const gained = next.log.filter((entry) => entry.e === 'verse' && entry.why === 'conquer');
    expect(gained).toHaveLength(1);
    expect(gained[0]?.n).toBe(2);
    const view = projectView(next, 0);
    expect(view.events.some((event) => event.text === 'Conquer +2 Verses')).toBe(true);
    expect(view.verse[owner]).toBeGreaterThanOrEqual(2);
  });

  it('previews a clearing attack as Conquer +2 Verses', () => {
    const unit = (id: string, attack: number, health: number): UnitView => ({
      instanceId: id,
      defId: 'c_novice',
      name: 'Lanternfall Novice',
      owner: 0,
      attack,
      health,
      maxHealth: health,
      exhausted: false,
      warded: false,
      keywords: [],
      glyph: 'flame',
      house: 'candle',
      page: 0,
      slot: 0,
    });
    const preview = localTrade(unit('a', 3, 3), unit('d', 1, 2), false, 1, 1);
    expect(preview.defenderDies).toBe(true);
    expect(preview.verseGain).toBe(2);
    expect(`Conquer +${preview.verseGain} Verses`).toBe('Conquer +2 Verses');
  });
});
