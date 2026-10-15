export interface DuelCardInst {
  uid: number;
  id: string;
  side: string;
  lane: number;
  base: number;
  perm: number;
  token: boolean;
  order: number;
  turn: number;
  cost: number;
  hob_used?: boolean;
}

export interface DuelSideState {
  deck: string[];
  hand: string[];
  board: DuelCardInst[][];
  destroyed: number;
  discarded: number;
  pending: number[];
  played: Record<string, boolean>;
  plan: [string, number][];
}

export class Duel {
  turn: number;
  log: { i: number; t: string; turn: number; [k: string]: unknown }[];
  locs: string[];
  revealed: boolean[];
  S: Record<string, DuelSideState>;
  D: Record<string, { id: string; name: string; cost: number; power: number; ability_text?: string; fx?: Record<string, unknown> }>;
  locsMeta: { id: string; name: string; text: string }[];
  constructor(deckA: string[], deckB: string[], seed: number, data: unknown);
  loc(L: number): string | null;
  slots(L: number): number;
  room(side: string, L: number): boolean;
  powers(): [Record<number, number>, { A: number[]; B: number[] }];
  start_turn(): void;
  commit(side: string, plays: [string, number][]): [string, number][];
  reveal(): void;
  end_turn(): { A: number[]; B: number[] };
  result(): { winner: string; why: string; totA: number[]; totB: number[]; locs: string[]; log?: unknown[] };
}

export function duel(
  recA: { deck: string[]; plays: [string, number][][] },
  recB: { deck: string[]; plays: [string, number][][] },
  seed: number,
  data: unknown,
): {
  winner: string;
  why: string;
  totA: number[];
  totB: number[];
  locs: string[];
  log: { i: number; t: string; [k: string]: unknown }[];
};
