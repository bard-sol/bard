/** Authoritative duel-engine state. The seed and deck order stay on the server. */
export interface EngineCardRef {
  uid: number;
  id: string;
}

export interface EngineUnit {
  uid: number;
  id: string;
  owner: 0 | 1;
  page: number;
  atk: number;
  hp: number;
  maxHp: number;
  kw: string[];
  kindle: number;
  ward: boolean;
  hiddenOn: boolean;
  exhausted: boolean;
  attacked: boolean;
  moved: boolean;
  silenced: boolean;
  tempAtk: number;
  tempRip: boolean;
}

export interface EngineTrap {
  uid: number;
  id: string;
  owner: 0 | 1;
  page: number;
}

export interface EnginePlayer {
  house: string;
  legend: string;
  deck: EngineCardRef[];
  hand: EngineCardRef[];
  champion: string | null;
  maxInk: number;
  ink: number;
  verses: number;
  legendUsed: boolean;
  turns: number;
  mulled: boolean;
}

export interface EngineRules {
  secondVerse: number;
  holdAtEnd: boolean;
  winVerses: number;
  /** Turns on which the second player gains +1 max Ink. 1 means their first turn starts at 2. */
  secondInkTurns: number;
  /** v1.1: `alone` scores 1 Verse for an empty rival Page. Absent on v1 records. */
  holdMode?: string;
  /** v1.1: Verses for a Conquer. The Spine adds one more when `spineMode` is `conquer`. */
  conquerVerses?: number;
  /** v1.1: `conquer` adds the Spine bonus on a Conquer. `hold` adds it on a hold. */
  spineMode?: string;
}

export interface EngineLogEntry {
  e: string;
  [key: string]: unknown;
}

export interface EngineState {
  v: string;
  ai: string;
  seed: number;
  rng: number;
  first: 0 | 1;
  active: 0 | 1;
  phase: 'mulligan' | 'main' | 'fight' | 'over';
  mull: 0 | 1;
  pages: string[];
  board: EngineUnit[][][];
  traps: EngineTrap[];
  nextUid: number;
  R: EngineRules;
  players: [EnginePlayer, EnginePlayer];
  enemiesAtStart: boolean[];
  winner: number;
  reason: string;
  res: number;
  capHit: boolean;
  log: EngineLogEntry[];
  step: number;
}

/**
 * Everything `replay(setup, actions)` needs, plus the version pins.
 * `rules.secondInkTurns` is the second player's first-turn +2 Ink flag.
 */
export interface MatchSetup {
  houseA: string;
  deckA: string[];
  houseB: string;
  deckB: string[];
  seed: number;
  aiVersion: string;
  engineVersion: string;
  cardsVersion: string;
  rulesVersion: string;
  rules: EngineRules;
}
