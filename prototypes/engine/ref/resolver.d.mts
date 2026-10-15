export class Mulberry32 {
  draws: number;
  constructor(seed: number);
  next(): number;
  below(n: number): number;
}

export function deriveSeed(base: number, k: number): number;

export interface FightSpec {
  id: string;
  copies?: number;
  attack?: number;
  health?: number;
}

export interface FightLogEvent {
  i: number;
  t: string;
  [k: string]: unknown;
}

export interface FightResult {
  winner: "A" | "B" | "draw";
  log: FightLogEvent[];
  stats: {
    hpA: number;
    hpB: number;
    deaths: number;
    attacks: number;
    triggers: number;
    turns: number;
    rng_draws: number;
    survivorsA: string[];
    survivorsB: string[];
  };
}

export function resolve(lineA: FightSpec[], lineB: FightSpec[], seed: number, units: unknown): FightResult;
