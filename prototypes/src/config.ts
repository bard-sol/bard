/**
 * Gameplay flags. Locked defaults follow resolver-spec / match.py.
 * Design's 3-slot Margin is available; balance numbers assume the bench is off.
 */
export const ROUND_COINS = [3, 5, 7] as const;
export const SHOP_SIZE = 5;
export const REROLL_COST = 1;
export const SELL_VALUE = 1;
export const SHOP_SECONDS = 60;
export const LINE_SLOTS = 5;
export const ECHO_SLOTS = 2;
export const MAX_MERGE = 2;
export const PLAYER_HOUSE = "tidewrack" as const;
/** Lane rules are always on in v2. Three locations are drawn from the match seed. */
export const LANE_RULES_DEFAULT = true;

const HOUSE_BAR_KEY = "bard.proto.houseBar";
const BENCH_KEY = "bard.proto.bench";
const CARRY_KEY = "bard.proto.carry";

export type HouseBarMode = "mock" | "off";
export type CarryMode = "line" | "survivors";
export type BenchSlots = 0 | 3;

function query(): URLSearchParams | null {
  if (typeof location === "undefined") return null;
  return new URLSearchParams(location.search);
}

export function houseBarMode(): HouseBarMode {
  const q = query()?.get("housebar");
  if (q === "mock" || q === "off") return q;
  try {
    const stored = globalThis.localStorage?.getItem(HOUSE_BAR_KEY);
    if (stored === "mock" || stored === "off") return stored;
  } catch {
    /* private mode */
  }
  return "off";
}

export function setHouseBarMode(mode: HouseBarMode): void {
  try {
    globalThis.localStorage?.setItem(HOUSE_BAR_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** Default 0: run the test with no bench first. `?bench=3` opens the Margin. */
export function benchSlots(): BenchSlots {
  const q = query()?.get("bench");
  if (q === "3") return 3;
  if (q === "0") return 0;
  try {
    const stored = globalThis.localStorage?.getItem(BENCH_KEY);
    if (stored === "3") return 3;
  } catch {
    /* ignore */
  }
  return 0;
}

export function setBenchSlots(n: BenchSlots): void {
  try {
    globalThis.localStorage?.setItem(BENCH_KEY, String(n));
  } catch {
    /* ignore */
  }
}

/** Whole bought line returns. Survivors-only is pending a decision and stays off. */
export function carryMode(): CarryMode {
  const q = query()?.get("carry");
  if (q === "survivors" || q === "line") return q;
  try {
    const stored = globalThis.localStorage?.getItem(CARRY_KEY);
    if (stored === "survivors") return "survivors";
  } catch {
    /* ignore */
  }
  return "line";
}

export function setCarryMode(mode: CarryMode): void {
  try {
    globalThis.localStorage?.setItem(CARRY_KEY, mode);
  } catch {
    /* ignore */
  }
}
