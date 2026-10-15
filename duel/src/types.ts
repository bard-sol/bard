import type { EngineState, MatchSetup } from './engine/state.js';

/** Shared duel types. The client may import this module. It has no secrets. */

export type PlayerId = 0 | 1;

export type Stance = 'aggressive' | 'balanced' | 'patient';

export type CardType = 'character' | 'inkwork' | 'marginalia';

export type Glyph = 'flame' | 'lamp' | 'shield' | 'spark' | 'note' | 'blade' | 'fox' | 'recruit';

export type Phase = 'mulligan' | 'main' | 'fight' | 'game_over';

export type WinReason = 'verse' | 'health' | 'tiebreak';

export interface CardEffect {
  kind: 'damage' | 'ink' | 'trap';
  amount: number;
}

export interface LegendPower {
  kind: 'heal' | 'buff';
  amount: number;
}

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  house: string;
  cost: number;
  attack: number | null;
  health: number | null;
  keywords: string[];
  text: string;
  glyph: Glyph;
  effect: CardEffect | null;
}

export interface LegendDef {
  id: string;
  name: string;
  house: string;
  powerName: string;
  powerText: string;
  powerCost: number;
  power: LegendPower;
}

export interface PageDef {
  id: string;
  name: string;
  rule: string;
}

export interface Deck {
  house: string;
  legendId: string;
  cards: string[];
}

export interface CardInstance {
  instanceId: string;
  defId: string;
  owner: PlayerId;
}

export interface Unit {
  instanceId: string;
  defId: string;
  owner: PlayerId;
  attack: number;
  health: number;
  maxHealth: number;
  exhausted: boolean;
  warded: boolean;
  page: 0 | 1;
  slot: 0 | 1 | 2 | 3;
  keywords: string[];
}

export interface MarginaliaInPlay {
  instanceId: string;
  defId: string;
  owner: PlayerId;
  page: 0 | 1;
  faceDown: boolean;
  amount: number;
}

export interface PlayerState {
  legendId: string;
  deck: CardInstance[];
  hand: CardInstance[];
  ink: number;
  maxInk: number;
  powerUsed: boolean;
}

export interface PublicEvent {
  id: number;
  kind: 'hold' | 'conquer' | 'play' | 'attack' | 'power' | 'trap' | 'draw' | 'mulligan' | 'win' | 'move';
  text: string;
  player: PlayerId | null;
}

/**
 * Full authoritative state. Stays on the server.
 * The seed is NOT stored here. Shuffle and the final tiebreak are derived
 * from the seed inside `initialState`, and the seed itself lives only on the
 * match record.
 */
export interface GameState {
  active: PlayerId;
  priority: PlayerId;
  phase: Phase;
  verse: [number, number];
  verseGoal: number;
  maxTurns: number;
  turnsCompleted: [number, number];
  turnIndex: [number, number];
  winner: PlayerId | null;
  winReason: WinReason | null;
  tiebreak: PlayerId;
  pages: [PageDef, PageDef];
  units: Unit[];
  marginalia: MarginaliaInPlay[];
  players: [PlayerState, PlayerState];
  nextEventId: number;
  events: PublicEvent[];
  /** Def ids that have been played face up. Shared names stay public after that. */
  revealed: string[];
}

/** Actions of duel-engine 1.0.0. The log stores these so `replay(setup, actions)` matches. */
export type GameAction =
  | { type: 'mulligan'; idx: number[] }
  | { type: 'play'; uid: number; page?: number; target?: number }
  | { type: 'champion'; page?: number; target?: number }
  | { type: 'legend'; target: number; target2?: number }
  | { type: 'fight' }
  | { type: 'attack'; uid: number; target: number }
  | { type: 'move'; uid: number }
  | { type: 'end' };

export interface CardView {
  instanceId: string;
  defId: string;
  name: string;
  type: CardType;
  house: string;
  cost: number;
  attack: number | null;
  health: number | null;
  keywords: string[];
  text: string;
  glyph: Glyph;
}

export interface UnitView {
  instanceId: string;
  defId: string;
  name: string;
  owner: PlayerId;
  attack: number;
  health: number;
  maxHealth: number;
  exhausted: boolean;
  warded: boolean;
  keywords: string[];
  glyph: Glyph;
  house: string;
  page: 0 | 1;
  slot: number;
}

export interface MarginaliaView {
  /** Real id when the viewer knows the note. Otherwise a sealed token. */
  instanceId: string;
  page: 0 | 1;
  owner: PlayerId;
  faceDown: boolean;
  known: boolean;
  name: string | null;
  text: string | null;
  glyph: Glyph | null;
}

export interface LegendView {
  id: string;
  name: string;
  house: string;
  powerName: string;
  powerText: string;
  powerCost: number;
  powerUsed: boolean;
}

export interface PageView {
  index: 0 | 1;
  name: string;
  rule: string;
  slots: Array<{ index: number; you: UnitView | null; foe: UnitView | null }>;
  marginalia: MarginaliaView[];
}

/** Redacted per-player projection. Safe to send to that player's client. */
export interface PlayerView {
  you: PlayerId;
  active: PlayerId;
  phase: Phase;
  yourTurn: boolean;
  turn: [number, number];
  turnsCompleted: [number, number];
  maxTurns: number;
  verse: [number, number];
  verseGoal: number;
  winner: PlayerId | null;
  winReason: WinReason | null;
  pages: [PageView, PageView];
  youLegend: LegendView;
  foeLegend: LegendView;
  hand: CardView[];
  foeHandCount: number;
  yourDeckCount: number;
  foeDeckCount: number;
  ink: number;
  maxInk: number;
  foeInk: number;
  foeMaxInk: number;
  foePowerUsed: boolean;
  events: PublicEvent[];
}

export interface ClientPayload {
  matchId: string;
  view: PlayerView;
  legalActions: GameAction[];
  turnDeadline: number | null;
  turnDurationMs: number;
  opponentThinking: boolean;
  engineVersion: string;
  cardsVersion: string;
  rulesVersion: string;
  aiVersion: string;
  /** Second player's opening max Ink is 2 when this is 1. Public rule, not a secret. */
  secondInkTurns: number;
  stance: Stance;
  status: 'playing' | 'complete';
}

export interface TradePreview {
  attackerId: string;
  defenderId: string;
  attackerName: string;
  defenderName: string;
  attackerHealthBefore: number;
  defenderHealthBefore: number;
  attackerHealthAfter: number;
  defenderHealthAfter: number;
  attackerDies: boolean;
  defenderDies: boolean;
  verseGain: number;
  marginNoteStrikes: boolean;
}

export interface EngineAdapter {
  readonly engineVersion: string;
  readonly cardsVersion: string;
  readonly rulesVersion: string;
  readonly aiVersion: string;
  /** Pinned opening rules. `secondInkTurns: 1` is the second player's first-turn max of 2 Ink. */
  readonly rules: {
    secondVerse: number;
    holdAtEnd: boolean;
    winVerses: number;
    secondInkTurns: number;
    holdMode?: string;
    conquerVerses?: number;
    spineMode?: string;
  };
  initialState(decks: readonly [Deck, Deck], seed: number): EngineState;
  legalActions(state: EngineState, player: PlayerId): GameAction[];
  apply(state: EngineState, action: GameAction): EngineState;
  view(state: EngineState, player: PlayerId): PlayerView;
  /** Must not read the match seed. The pilot derives its own salt from public state. */
  pilot(state: EngineState, stance: Stance): GameAction;
  replay(setup: MatchSetup, actions: readonly GameAction[]): EngineState;
  stateHash(state: EngineState): string;
}
