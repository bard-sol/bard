import type { EngineState } from '../src/engine/state.js';

export const ENGINE_VERSION: string;
export const CARDS_VERSION: string;
export const RULES_VERSION: string;
export const PILOT_VERSION: string;
export const MAX_TURNS: number;
export const WIN_VERSES: number;
export const FIXTURES: URL;
export const DEFAULT_RULES: {
  secondVerse: number;
  holdAtEnd: boolean;
  winVerses: number;
  secondInkTurns: number;
};

export interface CardData {
  id: string;
  name: string;
  house: string;
  type: string;
  cost: number;
  atk?: number;
  hp?: number;
  kw: string[];
  text: string;
  token?: boolean;
  champion?: boolean;
  rarity?: string;
  kindle?: number;
}

export interface PageData {
  id: string;
  name: string;
  text: string;
}

export interface LegendData {
  id: string;
  name: string;
  house: string;
  cost: number;
  target: string;
  text: string;
  champion: string;
}

export const STARTERS: Record<string, string[]>;
export const PAGES: PageData[];
export const LEGENDS: Record<string, LegendData>;
export const CARDS: CardData[];

export function cardById(id: string): CardData;
export function validateDeck(house: string, ids: readonly string[]): string | null;
export function newMatch(setup: {
  houseA: string;
  deckA: readonly string[];
  houseB: string;
  deckB: readonly string[];
  seed: number;
  aiVersion?: string;
  rules?: Partial<{ secondVerse: number; holdAtEnd: boolean; winVerses: number; secondInkTurns: number }>;
  engineVersion?: string;
  cardsVersion?: string;
  rulesVersion?: string;
}): EngineState;
export function legalActions(state: EngineState): EngineAction[];
export function apply(state: EngineState, action: EngineAction): EngineState;
export function isLegal(state: EngineState, action: EngineAction): boolean;
export function replay(setup: {
  houseA: string;
  deckA: readonly string[];
  houseB: string;
  deckB: readonly string[];
  seed: number;
  aiVersion?: string;
  rules?: Partial<{ secondVerse: number; holdAtEnd: boolean; winVerses: number; secondInkTurns: number }>;
}, actions: readonly EngineAction[]): EngineState;
export function stateHash(state: EngineState): string;
export function fnv(value: string): string;
export function clientView(state: EngineState, player: number): ClientProjection;
export function clientLog(state: EngineState, player: number): LogProjection[];
export function makeSmart(options?: { stance?: string; slip?: number; trapAware?: boolean; salt?: number }): (state: EngineState, me: number) => EngineAction;

export interface EngineAction {
  type: string;
  idx?: number[];
  uid?: number;
  page?: number;
  target?: number;
  target2?: number;
  id?: string;
  n?: number;
}

export interface ClientProjection {
  v: string;
  phase: 'mulligan' | 'main' | 'fight' | 'over';
  active: 0 | 1;
  first: 0 | 1;
  pages: string[];
  board: EngineState['board'];
  winner: number;
  reason: string;
  me: Omit<EngineState['players'][number], 'deck'> & { deckCount: number };
  rival: {
    house: string;
    legend: string;
    verses: number;
    maxInk: number;
    handCount: number;
    deckCount: number;
    championAvailable: boolean;
    legendUsed: boolean;
  };
  traps: Array<{ uid?: number; id?: string; owner: 0 | 1; page: number; faceDown?: boolean }>;
}

export interface LogProjection {
  e: string;
  p?: number;
  n?: number;
  why?: string;
  id?: string;
  type?: string;
  page?: number;
  uid?: number;
  target?: number;
  first?: number;
  winner?: number;
  reason?: string;
  a?: { type?: string; n?: number; page?: number };
  [key: string]: unknown;
}
