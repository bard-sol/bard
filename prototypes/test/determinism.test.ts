import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deriveSeed, resolve, Mulberry32 } from "../engine/ref/resolver.mjs";
import sheet from "../engine/units-s0.json";
import { Shop } from "../src/a/shop";
import { carryLine, matchOver, matchResult, resultCopy } from "../src/a/match";
import { foldAgrees, foldFight } from "../src/a/replay";
import { STORED_RUNS, pickRival } from "../src/a/bots";
import { CARDS, STARTERS, card } from "../src/b/cards";
import { duel, type GhostRecord, type LiveInput } from "../src/b/duel";
import { GHOSTS } from "../src/b/ghosts";
import { summarize, type MetricEvent } from "../src/metrics";

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(fs.readFileSync(path.join(here, "../engine/ref/golden/fixtures.json"), "utf8")) as {
  mulberry32: { seed: number; first10: number[] };
  derive_seed: { base: number; k: number; out: number }[];
  fights: { name: string; lineA: { id: string; copies: number }[]; lineB: { id: string; copies: number }[]; seed: number; winner: string; log: unknown[]; stats: unknown }[];
  shop_rolls: { cards: string[]; line: { id: string; copies: number }[]; match_seed: number; round: number; reroll?: string[] }[];
};

const canon = (v: unknown) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k2) => [k2, (x as Record<string, unknown>)[k2]]))
      : x,
  );

describe("reference resolver", () => {
  it("matches the golden mulberry and derive vectors", () => {
    const m = new Mulberry32(golden.mulberry32.seed);
    const first10 = Array.from({ length: 10 }, () => m.next());
    expect(canon(first10)).toBe(canon(golden.mulberry32.first10));
    for (const d of golden.derive_seed) expect(deriveSeed(d.base, d.k)).toBe(d.out);
  });

  it("reproduces every golden fight and the client fold agrees", () => {
    for (const f of golden.fights) {
      const r = resolve(f.lineA, f.lineB, f.seed, sheet);
      expect(r.winner).toBe(f.winner);
      expect(canon(r.log)).toBe(canon(f.log));
      expect(canon(r.stats)).toBe(canon(f.stats));
      expect(foldAgrees(r)).toBe(true);
      expect(foldFight(r.log).winner).toBe(r.winner);
    }
  });

  it("is stable across two calls", () => {
    const line = [{ id: "deckhand", copies: 3 as const }, { id: "blotling", copies: 1 as const }];
    const enemy = [{ id: "copyist", copies: 1 as const }, { id: "copyist", copies: 1 as const }];
    const a = resolve(line, enemy, 1, sheet);
    const b = resolve(line, enemy, 1, sheet);
    expect(canon(a)).toBe(canon(b));
    expect(a.winner).toBe("A");
    const deaths = a.log.filter((e) => e.t === "death").map((e) => e.uid);
    expect(deaths.some((id) => String(id).startsWith("A"))).toBe(true);
    expect(deaths.some((id) => String(id).startsWith("B"))).toBe(true);
    expect(a.stats.survivorsA).toContain("A0");
  });
});

describe("shop and match", () => {
  it("matches the golden shop rolls, including the continued reroll stream", () => {
    for (const roll of golden.shop_rolls) {
      const shop = new Shop(roll.round, roll.match_seed);
      expect(shop.roll(roll.line)).toEqual(roll.cards);
      if (roll.reroll) expect(shop.roll(roll.line)).toEqual(roll.reroll);
    }
  });

  it("echoes unmerged line units into the first slots when you own any", () => {
    const shop = new Shop(3, 42);
    const cards = shop.roll([
      { id: "grub", copies: 2 },
      { id: "thorn", copies: 1 },
    ]);
    expect(cards.slice(0, 2).every((id) => id === "grub" || id === "thorn")).toBe(true);
  });

  it("keeps the whole bought line unless survivors mode is on", () => {
    const line = [
      { id: "deckhand", copies: 3 },
      { id: "blotling", copies: 1 },
    ];
    const fight = resolve(line, [{ id: "copyist", copies: 1 }, { id: "copyist", copies: 1 }], 1, sheet);
    expect(carryLine(line, fight, "line")).toEqual(line);
    const survivors = carryLine(line, fight, "survivors");
    expect(survivors.map((p) => p.id)).toEqual(["deckhand"]);
  });

  it("ends 2–0 without a draw, and breaks a level match on health then seed", () => {
    expect(matchOver(["A", "A"])).toBe(true);
    expect(matchOver(["A", "draw"])).toBe(false);
    expect(matchOver(["A", "B", "draw"])).toBe(true);
    expect(matchResult(["A", "A"], null, 1)).toBe("win");
    expect(matchResult(["B", "B"], null, 1)).toBe("loss");
    expect(matchResult(["A", "B", "draw"], [5, 2], 1)).toBe("win");
    expect(matchResult(["A", "B", "draw"], [1, 4], 1)).toBe("loss");
    const seedWin = matchResult(["draw", "draw", "draw"], [3, 3], 1);
    const again = matchResult(["draw", "draw", "draw"], [3, 3], 1);
    expect(seedWin).toBe(again);
    expect(["win", "loss"]).toContain(seedWin);
    expect(resultCopy(["A", "A"], null, 1).headline).toBe("Won 2–0");
    expect(resultCopy(["B", "A", "B"], null, 1).headline).toBe("Lost 1–2");
    expect(resultCopy(["A", "B", "draw"], [4, 1], 1).tiebreak).toBe("health");
    expect(resultCopy(["draw", "draw", "draw"], [2, 2], 1).tiebreak).toBe("seed");
  });

  it("only offers rivals that stored all three rounds", () => {
    for (const run of STORED_RUNS) expect(run.snaps).toHaveLength(3);
    const cocoon = pickRival({ renown: 0, matchesPlayed: 0 }, 7);
    expect(cocoon.matches).toBeLessThan(10);
    expect(cocoon.house).not.toBe("tidewrack");
    expect(pickRival({ renown: 0, matchesPlayed: 0 }, 1, "ferris").id).toBe("ferris");
  });
});

describe("margin duel", () => {
  it("has 32 cards, four 12-card starters, and no duplicate ids", () => {
    expect(CARDS).toHaveLength(32);
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(32);
    for (const deck of STARTERS) {
      expect(deck.cards).toHaveLength(12);
      expect(new Set(deck.cards).size).toBe(12);
      for (const id of deck.cards) expect(card(id).cost).toBeGreaterThan(0);
    }
  });

  const ghost = (): GhostRecord => ({
    name: "Cinder",
    house: "pit",
    renown: 8,
    matches: 3,
    profile: "Cautious",
    deck: [...STARTERS[2]!.cards],
    shuffleSeed: 11,
    plays: null,
    raises: [2],
  });

  it("resolves the same duel twice with the same log", () => {
    const live: LiveInput = { deck: [...STARTERS[0]!.cards], plays: [], raises: [], };
    for (const seed of [1, 99, 404, 9001, 2 ** 31 - 1]) {
      const a = duel(live, ghost(), seed);
      const b = duel(live, ghost(), seed);
      expect(canon(a.log)).toBe(canon(b.log));
      expect(a.winner).toBe(b.winner);
      expect(a.over).toBe(true);
      expect(a.winner === "A" || a.winner === "B").toBe(true);
    }
  });

  it("keeps a retreat on the pre-raise stake", () => {
    const live: LiveInput = {
      deck: [...STARTERS[0]!.cards],
      plays: [{ turn: 1, cardId: "novice", lane: 0 }],
      raises: [1],
      retreatTurn: 1,
      retreatKind: "after_self",
    };
    const result = duel(live, ghost(), 5);
    expect(result.winner).toBe("B");
    expect(result.stake).toBe(1);
    expect(result.retreated?.side).toBe("A");
    expect(result.log.some((e) => e.t === "raise" && e.side === "A")).toBe(true);
  });

  it("doubles ink when a raise is called and the match plays out", () => {
    const live: LiveInput = { deck: [...STARTERS[0]!.cards], plays: [], raises: [1] };
    const bold: GhostRecord = { ...ghost(), profile: "Bold", raises: [] };
    const result = duel(live, bold, 8);
    expect(result.retreated).toBeNull();
    expect(result.stake).toBeGreaterThanOrEqual(2);
    expect(result.log.some((e) => e.t === "end")).toBe(true);
  });

  it("offers a commit hand before the turn is played", () => {
    const live: LiveInput = { deck: [...STARTERS[0]!.cards], plays: [], raises: [] };
    const opened = duel(live, ghost(), 3, { commitTurn: 1 });
    expect(opened.over).toBe(false);
    expect(opened.turn).toBe(1);
    expect(opened.hands.A.length).toBe(4);
    expect(opened.board).toHaveLength(0);
  });
});

describe("metrics", () => {
  it("counts first mover, replays, and session length", () => {
    const events: MetricEvent[] = [
      { id: "s", ts: 0, type: "session_start", prototype: "A" },
      { id: "a", ts: 1_000, type: "match_start", prototype: "A", matchId: "m1", practice: false },
      { id: "r1", ts: 2_000, type: "round_end", prototype: "A", matchId: "m1", round: 1, first: "A", roundWinner: "A" },
      { id: "r2", ts: 3_000, type: "round_end", prototype: "A", matchId: "m1", round: 2, first: "B", roundWinner: "B" },
      { id: "e1", ts: 4_000, type: "match_end", prototype: "A", matchId: "m1", result: "loss" },
      { id: "b", ts: 5_000, type: "match_start", prototype: "A", matchId: "m2" },
      { id: "e2", ts: 6_000, type: "match_end", prototype: "A", matchId: "m2", result: "win" },
      { id: "p", ts: 7_000, type: "preference", prototype: null, choice: "A" },
      {
        id: "late",
        ts: 9_000 + 11 * 60 * 1000,
        type: "match_end",
        prototype: "B",
        matchId: "m4",
        result: "loss",
        bluff: "caught",
        retreatKind: "unprompted",
        raiseTurns: [2, 4],
        stake: 4,
      },
    ];
    const summary = summarize(events, { now: 9_000 + 11 * 60 * 1000, day: () => "2026-10-15" });
    expect(summary.firstMatchCompletion.completed).toBe(true);
    expect(summary.replayWithin5MinOfLoss.replays).toBe(1);
    expect(summary.medianSessionLengthMatches).toBe(1.5);
    expect(summary.preference).toBe("A");
    expect(summary.firstMover["1"]).toEqual({ games: 1, aFirst: 1, bFirst: 0, firstWon: 1 });
    expect(summary.firstMover["2"]?.firstWon).toBe(1);
    expect(summary.bluff.caught).toBe(1);
    expect(summary.bluff.raises).toBe(2);
    expect(summary.retreats.unprompted).toBe(1);
    expect(GHOSTS.every((g) => g.plays === null && g.deck.length === 12)).toBe(true);
  });
});
