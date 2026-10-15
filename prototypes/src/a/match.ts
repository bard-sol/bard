import { deriveSeed, type FightResult } from "../../engine/ref/resolver.mjs";
import type { CarryMode } from "../config";
import type { Piece } from "./sheet";

export function fightSeed(matchSeed: number, round: number): number {
  return deriveSeed(matchSeed >>> 0, round);
}

/** Bought pieces return at fresh sheet stats. Survivors mode keeps original slots that lived. */
export function carryLine(line: Piece[], fight: FightResult, mode: CarryMode): Piece[] {
  if (mode === "line") return line.map((p) => ({ id: p.id, copies: p.copies }));
  const alive = new Set(fight.stats.survivorsA);
  return line.filter((_, i) => alive.has(`A${i}`)).map((p) => ({ id: p.id, copies: p.copies }));
}

export function matchOver(roundWinners: ("A" | "B" | "draw")[]): boolean {
  const a = roundWinners.filter((w) => w === "A").length;
  const b = roundWinners.filter((w) => w === "B").length;
  return a >= 2 || b >= 2 || roundWinners.length >= 3;
}

export type MatchOutcome = "win" | "loss";

/** Level after round 3: more surviving health, then deriveSeed(matchSeed, 999) % 2. Never a draw. */
export function matchResult(
  roundWinners: ("A" | "B" | "draw")[],
  r3hp: [number, number] | null,
  matchSeed: number,
): MatchOutcome {
  const a = roundWinners.filter((w) => w === "A").length;
  const b = roundWinners.filter((w) => w === "B").length;
  if (a !== b) return a > b ? "win" : "loss";
  if (r3hp && r3hp[0] !== r3hp[1]) return r3hp[0] > r3hp[1] ? "win" : "loss";
  return deriveSeed(matchSeed >>> 0, 999) % 2 === 0 ? "win" : "loss";
}

export interface ResultCopy {
  outcome: MatchOutcome;
  headline: string;
  tiebreak: "health" | "seed" | null;
}

export function resultCopy(
  roundWinners: ("A" | "B" | "draw")[],
  r3hp: [number, number] | null,
  matchSeed: number,
): ResultCopy {
  const outcome = matchResult(roundWinners, r3hp, matchSeed);
  const a = roundWinners.filter((w) => w === "A").length;
  const b = roundWinners.filter((w) => w === "B").length;
  const verb = outcome === "win" ? "Won" : "Lost";
  if (a !== b) return { outcome, headline: `${verb} ${a}–${b}`, tiebreak: null };
  if (r3hp && r3hp[0] !== r3hp[1]) {
    return { outcome, headline: `${verb} on surviving ink`, tiebreak: "health" };
  }
  return { outcome, headline: `${verb} on the Book's seed`, tiebreak: "seed" };
}

export function firstOf(log: { t: string; first?: unknown }[]): "A" | "B" {
  const start = log.find((e) => e.t === "start");
  return start?.first === "B" ? "B" : "A";
}
