import { apply, isLegal } from '../../engine/active.mjs';
import type { EngineState } from '../engine/state.js';
import type { Deck, GameAction } from '../types.js';
import { TUTORIAL_LINE, type TutorialBeat } from './line.js';

/**
 * bubble-guide v1.2. The human is Candle and goes first (1 Ink).
 * Pages are Lanternfall then Port Foxing. Opening hand includes
 * Lanternfall Novice, Deckle Doodle and Mending Flame. The champion
 * sits in the side zone. Tidewrack follows TUTORIAL_LINE.
 *
 * Seed 38558.
 */
export const TUTORIAL_SEED = 38558;

const PLAYER_DECK = [
  'c_lamplighter', 'c_lamps', 'c_novice', 'c_novice', 'c_snuff', 'c_snuff', 'c_trimmer', 'c_trimmer', 'c_vigil', 'c_watch',
  'n_blotling', 'n_blotling', 'n_colophon', 'n_doodle', 'n_doodle', 'n_errata', 'n_errata', 'n_hob', 'n_weeping', 'c_mend',
];

const RIVAL_DECK = [
  'n_blotling', 'n_doodle', 'n_doodle', 'n_erasure', 'n_weeping', 'n_wolf', 'n_wolf', 't_captain', 't_captain', 't_cutpurse',
  't_cutpurse', 't_deckhand', 't_deckhand', 't_raider', 't_riptide', 't_runner', 't_runner', 't_smuggler', 't_undertow', 't_undertow',
];

export function tutorialDecks(): [Deck, Deck] {
  return [
    { house: 'candle', legendId: 'old_wick', cards: PLAYER_DECK.slice() },
    { house: 'tidewrack', legendId: 'juniper', cards: RIVAL_DECK.slice() },
  ];
}

function opposing(state: EngineState, page: 0 | 1, id: string) {
  return state.board[page]?.[1 - state.active]?.find((unit) => unit.id === id);
}

function own(state: EngineState, page: 0 | 1, id: string) {
  return state.board[page]?.[state.active]?.find((unit) => unit.id === id);
}

function beatAction(state: EngineState, beat: TutorialBeat): GameAction | null {
  if (beat.op === 'play') {
    const card = state.players[state.active]?.hand.find((entry) => entry.id === beat.id);
    if (!card) return null;
    const action: GameAction = { type: 'play', uid: card.uid, page: beat.page };
    if (beat.target) {
      const target = opposing(state, beat.page, beat.target);
      if (!target) return null;
      action.target = target.uid;
    }
    return isLegal(state, action) ? action : null;
  }
  if (!beat.target) return null;
  const attacker = own(state, beat.page, beat.id);
  const defender = opposing(state, beat.page, beat.target);
  if (!attacker || !defender) return null;
  const action: GameAction = { type: 'attack', uid: attacker.uid, target: defender.uid };
  return isLegal(state, action) ? action : null;
}

export function scriptedTutorialTurn(state: EngineState): GameAction[] {
  const actions: GameAction[] = [];
  let cursor = state;
  const script = TUTORIAL_LINE.find((entry) => entry.turn === cursor.players[1].turns);
  for (const beat of script?.steps ?? []) {
    const action = beatAction(cursor, beat);
    if (!action) continue;
    actions.push(action);
    cursor = apply(cursor, action);
  }
  if (isLegal(cursor, { type: 'end' })) actions.push({ type: 'end' });
  return actions;
}
