import { Mulberry32, deriveSeed } from "../../engine/ref/resolver.mjs";
import { ECHO_SLOTS, LINE_SLOTS, SHOP_SIZE } from "../config";
import { unit, unitsInTier, type Piece } from "./sheet";

/** Tier weights by round. Same order as match.py. */
export const TIER_WEIGHTS: Record<number, [number, number][]> = {
  1: [
    [1, 60],
    [2, 40],
  ],
  2: [
    [1, 35],
    [2, 35],
    [3, 30],
  ],
  3: [
    [1, 15],
    [2, 20],
    [3, 25],
    [4, 25],
    [5, 15],
  ],
};

/**
 * One shop stream per round: deriveSeed(matchSeed, 100 + round).
 * Rerolls continue that stream. They do not reseed.
 * Echo slots are copies of un-merged units on the line (not the bench).
 */
export class Shop {
  readonly rng: Mulberry32;
  cards: (string | null)[] = [];

  constructor(
    readonly round: number,
    matchSeed: number,
  ) {
    this.rng = new Mulberry32(deriveSeed(matchSeed >>> 0, 100 + round));
  }

  roll(line: Piece[]): string[] {
    const weights = TIER_WEIGHTS[this.round] ?? TIER_WEIGHTS[1]!;
    const maxtier = Math.max(...weights.map(([t]) => t));
    const merged = new Set(line.filter((u) => u.copies >= 3).map((u) => u.id));
    const cards: string[] = [];
    const owned = line.filter((u) => u.copies < 3 && unit(u.id).tier <= maxtier).map((u) => u.id);
    const echoes = owned.length ? ECHO_SLOTS : 0;
    for (let i = 0; i < echoes; i++) cards.push(owned[this.rng.below(owned.length)]!);
    while (cards.length < SHOP_SIZE) {
      const r = this.rng.below(100);
      let acc = 0;
      let tier = weights[weights.length - 1]![0];
      for (const [t, w] of weights) {
        acc += w;
        if (r < acc) {
          tier = t;
          break;
        }
      }
      const pool = unitsInTier(tier).filter((id) => !merged.has(id));
      const fallback = unitsInTier(1).filter((id) => !merged.has(id));
      const use = pool.length ? pool : fallback;
      cards.push(use[this.rng.below(use.length)]!);
    }
    this.cards = cards;
    return cards;
  }
}

export type BuyResult = "ok" | "full" | "maxed";

/** Stack onto an owned copy (line or bench). Else the chosen slot, else the line, else the bench. */
export function buyPiece(
  line: Piece[],
  bench: Piece[],
  id: string,
  benchSlots: number,
  at?: { zone: "line" | "bench"; index: number },
): BuyResult {
  const owned = [...line, ...bench].find((p) => p.id === id);
  if (owned) {
    if (owned.copies >= 3) return "maxed";
    owned.copies += 1;
    return "ok";
  }
  const zone = at?.zone ?? "line";
  const dest = zone === "bench" ? bench : line;
  const cap = zone === "bench" ? benchSlots : LINE_SLOTS;
  if (dest.length < cap) {
    const idx = Math.max(0, Math.min(at?.index ?? dest.length, dest.length));
    dest.splice(idx, 0, { id, copies: 1 });
    return "ok";
  }
  if (zone !== "line" && line.length < LINE_SLOTS) {
    line.push({ id, copies: 1 });
    return "ok";
  }
  if (bench.length < benchSlots) {
    bench.push({ id, copies: 1 });
    return "ok";
  }
  return "full";
}

export function moveWithin(list: Piece[], from: number, to: number): void {
  if (from === to || from < 0 || from >= list.length) return;
  const [item] = list.splice(from, 1);
  if (!item) return;
  const idx = Math.max(0, Math.min(to, list.length));
  list.splice(idx, 0, item);
}
