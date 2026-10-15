import {
  apply as applyV1,
  ENGINE_VERSION as ENGINE_V1,
  legalActions as legalV1,
  replay as replayV1,
  stateHash as hashV1,
} from '../../engine/v1/engine.mjs';
import { makeSmart as makeSmartV1, PILOT_VERSION as PILOT_V1 } from '../../engine/v1/pilots.mjs';
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

/** Frozen stamps for engine v1. The v1 manifest reads the cards file with node:fs, so the worker must not import it. */
const CARDS_V1 = 'cards-proto-1';
const RULES_V1 = 'rules-1.0.0';

interface RecordedBundle {
  engineVersion: string;
  cardsVersion: string;
  aiVersion: string;
  rulesVersion: string;
  secondInkTurns: number;
  apply: typeof engineApply;
  legal: typeof engineLegal;
  replay: typeof engineReplay;
  hash: typeof engineHash;
  pilot: typeof makeSmart;
}

/** Versions and functions for a match recorded under v1 or the live pin. */
export function recordedBundle(engineVersion: string): RecordedBundle | null {
  if (engineVersion === ENGINE_V1) {
    return {
      engineVersion: ENGINE_V1,
      cardsVersion: CARDS_V1,
      aiVersion: PILOT_V1,
      rulesVersion: RULES_V1,
      secondInkTurns: 1,
      apply: applyV1,
      legal: legalV1,
      replay: replayV1,
      hash: hashV1,
      pilot: makeSmartV1,
    };
  }
  if (engineVersion === ENGINE_VERSION) {
    return {
      engineVersion: ENGINE_VERSION,
      cardsVersion: CARDS_VERSION,
      aiVersion: PILOT_VERSION,
      rulesVersion: RULES_VERSION,
      secondInkTurns: DEFAULT_RULES.secondInkTurns,
      apply: engineApply,
      legal: engineLegal,
      replay: engineReplay,
      hash: engineHash,
      pilot: makeSmart,
    };
  }
  return null;
}

function bundleForState(state: EngineState): RecordedBundle {
  const found = recordedBundle(state.v);
  if (!found) throw new Error(`unknown engine ${state.v}`);
  return found;
}

/**
 * Live adapter over the pin in engine/active.mjs. Stored v1 matches replay
 * through engine/v1. `apply` clones. `view` is the only projection that may
 * leave the server. The pilot never receives the match seed.
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
      return bundleForState(state).legal(state).map(asAction);
    },
    apply(state, action) {
      try {
        return bundleForState(state).apply(state, action);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('illegal')) throw new IllegalActionError();
        throw error;
      }
    },
    view: projectView,
    pilot(state, stance) {
      const actor = actorOf(state);
      if (actor == null) throw new Error('pilot called with no actor');
      const choose = bundleForState(state).pilot({ stance, slip: PILOT_SLIP, salt: PILOT_SALT });
      return asAction(choose(state, actor));
    },
    replay(setup, actions) {
      const found = recordedBundle(setup.engineVersion);
      if (!found) throw new Error(`unknown engine ${setup.engineVersion}`);
      return found.replay(setup, actions);
    },
    stateHash(state) {
      return bundleForState(state).hash(state);
    },
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
