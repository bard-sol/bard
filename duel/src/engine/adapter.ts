import {
  apply as engineApply,
  CARDS_VERSION,
  DEFAULT_RULES,
  ENGINE_VERSION,
  legalActions as engineLegal,
  makeSmart,
  PILOT_VERSION,
  replay as engineReplay,
  RULES_VERSION,
  stateHash as engineHash,
  validateDeck,
  newMatch,
} from '../../engine/active.mjs';
import type { Deck, EngineAdapter, GameAction, PlayerId, Stance } from '../types.js';
import { projectView } from './project.js';
import type { EngineRules, EngineState, MatchSetup } from './state.js';

export class IllegalActionError extends Error {
  readonly code = 'illegal_action' as const;
  constructor() {
    super('illegal_action');
    this.name = 'IllegalActionError';
  }
}

const PILOT_SLIP = 300;
const PILOT_SALT = 99;

/**
 * Live adapter over duel-engine v1. `apply` clones. `view` is the only projection
 * that may leave the server. The pilot never receives the match seed.
 */
export function createEngineAdapter(): EngineAdapter {
  const rules: EngineRules = { ...DEFAULT_RULES };
  return {
    engineVersion: ENGINE_VERSION,
    cardsVersion: CARDS_VERSION,
    rulesVersion: RULES_VERSION,
    aiVersion: PILOT_VERSION,
    rules,
    initialState(decks, seed) {
      return openMatch(decks, seed, rules);
    },
    legalActions(state, player) {
      if (actorOf(state) !== player) return [];
      return engineLegal(state).map(asAction);
    },
    apply(state, action) {
      try {
        return engineApply(state, action);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('illegal')) throw new IllegalActionError();
        throw error;
      }
    },
    view: projectView,
    pilot(state, stance) {
      const actor = actorOf(state);
      if (actor == null) throw new Error('pilot called with no actor');
      const choose = makeSmart({ stance, slip: PILOT_SLIP, salt: PILOT_SALT });
      return asAction(choose(state, actor));
    },
    replay(setup, actions) {
      return engineReplay(setup, actions);
    },
    stateHash: engineHash,
  };
}

export function actorOf(state: EngineState): PlayerId | null {
  if (state.phase === 'over' || state.winner >= 0) return null;
  if (state.phase === 'mulligan') return state.mull;
  return state.active;
}

export function sameAction(a: GameAction, b: GameAction): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'mulligan' && b.type === 'mulligan') return a.idx.join() === b.idx.join();
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

export function openMatch(decks: readonly [Deck, Deck], seed: number, rules: EngineRules): EngineState {
  return newMatch({
    houseA: decks[0].house,
    deckA: decks[0].cards,
    houseB: decks[1].house,
    deckB: decks[1].cards,
    seed: seed >>> 0,
    aiVersion: PILOT_VERSION,
    rules,
  });
}

export function buildSetup(decks: readonly [Deck, Deck], seed: number, adapter: EngineAdapter): MatchSetup {
  return {
    houseA: decks[0].house,
    deckA: decks[0].cards.slice(),
    houseB: decks[1].house,
    deckB: decks[1].cards.slice(),
    seed: seed >>> 0,
    aiVersion: adapter.aiVersion,
    engineVersion: adapter.engineVersion,
    cardsVersion: adapter.cardsVersion,
    rulesVersion: adapter.rulesVersion,
    rules: { ...adapter.rules },
  };
}

export function deckError(house: string, ids: readonly string[]): string | null {
  return validateDeck(house, ids);
}

function asAction(action: { type: string; idx?: number[]; uid?: number; page?: number; target?: number; target2?: number }): GameAction {
  switch (action.type) {
    case 'mulligan':
      return { type: 'mulligan', idx: (action.idx ?? []).slice() };
    case 'play':
      return compact({ type: 'play', uid: action.uid ?? 0, page: action.page, target: action.target });
    case 'champion':
      return compact({ type: 'champion', page: action.page, target: action.target });
    case 'legend':
      return compact({ type: 'legend', target: action.target ?? 0, target2: action.target2 });
    case 'fight':
      return { type: 'fight' };
    case 'attack':
      return { type: 'attack', uid: action.uid ?? 0, target: action.target ?? 0 };
    case 'move':
      return { type: 'move', uid: action.uid ?? 0 };
    case 'end':
      return { type: 'end' };
    default:
      throw new IllegalActionError();
  }
}

function compact<T extends GameAction>(action: T): T {
  const copy = { ...action };
  for (const key of Object.keys(copy) as (keyof T)[]) {
    if (copy[key] === undefined) delete copy[key];
  }
  return copy;
}

function normalize(action: GameAction): GameAction {
  return JSON.parse(JSON.stringify(action)) as GameAction;
}

export type { Stance };
