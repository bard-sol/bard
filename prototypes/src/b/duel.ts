import { deriveSeed, Mulberry32 } from "../../engine/ref/resolver.mjs";
import { card } from "./cards";

export type Side = "A" | "B";
export type ProfileName = "Cautious" | "Steady" | "Bold";

export interface Play {
  turn: number;
  cardId: string;
  lane: number;
}

export interface LiveInput {
  deck: string[];
  plays: Play[];
  raises: number[];
  retreatTurn?: number;
  retreatKind?: "after_ghost" | "after_self" | "unprompted";
}

export interface GhostRecord {
  name: string;
  house: string;
  renown: number;
  matches: number;
  profile: ProfileName;
  deck: string[];
  /** Used when `plays` is a real recording. Generated ghosts reshuffle from the match seed. */
  shuffleSeed: number;
  /** Null means a generated greedy policy, evaluated from the hand it actually holds. */
  plays: Play[] | null;
  raises: number[];
  retreatedTurn?: number;
}

export interface Inst {
  uid: string;
  id: string;
  side: Side;
  lane: number;
  base: number;
  cost: number;
  revealed: boolean;
  turn: number;
  order: number;
  token: boolean;
}

export interface DuelLog {
  i: number;
  t: string;
  [k: string]: unknown;
}

export interface DuelOpts {
  throughTurn?: number;
  ignoreGhostRetreat?: boolean;
  noLiveRetreat?: boolean;
  /** Internal: skip the counterfactual re-entry. */
  skipBluff?: boolean;
  /** Finish every earlier turn, draw this turn, and stop before plays. */
  commitTurn?: number;
}

export interface DuelResult {
  winner: Side | null;
  stake: number;
  over: boolean;
  turn: number;
  log: DuelLog[];
  board: Inst[];
  hands: Record<Side, string[]>;
  decksLeft: Record<Side, number>;
  energy: number;
  peek: Partial<Record<Side, string>>;
  powers: [number, number][];
  revealFirst: Side | null;
  raised: Record<Side, boolean>;
  retreated: { side: Side; kind: string; stake: number } | null;
  bluff: "success" | "caught" | "none";
  playerRaises: number[];
  ghostRaises: number[];
}

const other = (s: Side): Side => (s === "A" ? "B" : "A");

function shuffle(ids: string[], seed: number): string[] {
  const rng = new Mulberry32(seed >>> 0);
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.below(i + 1);
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

function drawInto(deck: string[], hand: string[]): string | null {
  if (!deck.length || hand.length >= 7) return null;
  const id = deck.shift()!;
  hand.push(id);
  return id;
}

interface Ctx {
  board: Inst[];
  stopped: Set<string>;
  seq: number;
  log: DuelLog[];
  hands: Record<Side, string[]>;
  decks: Record<Side, string[]>;
  playedLane: Record<Side, Set<number>[]>;
  fx: Mulberry32;
  peek: Partial<Record<Side, string>>;
}

function ev(ctx: Ctx, t: string, extra: Record<string, unknown> = {}): void {
  ctx.log.push({ i: ctx.log.length, t, ...extra });
}

function onActive(ctx: Ctx, inst: Inst): boolean {
  if (inst.token) return false;
  const def = card(inst.id);
  if (def.kind !== "on") return false;
  return !ctx.stopped.has(`${inst.lane}:${inst.side}`);
}

function protectedByWren(ctx: Ctx, inst: Inst): boolean {
  return ctx.board.some(
    (u) => u !== inst && u.side === inst.side && u.lane === inst.lane && u.revealed && u.id === "wren" && onActive(ctx, u),
  );
}

function grubHolds(ctx: Ctx, inst: Inst): boolean {
  return inst.id === "grub" && inst.revealed && onActive(ctx, inst);
}

/** Ongoing power. Marrow's end bonus is separate. Card power may be negative. */
export function powerOf(ctx: Ctx, inst: Inst, gameEnd = false): number {
  if (!inst.revealed) return inst.base;
  let p = inst.base;
  for (const src of ctx.board) {
    if (!src.revealed || !onActive(ctx, src)) continue;
    if ((src.id === "drummer" || src.id === "hob") && src.side === inst.side && src.lane === inst.lane && src !== inst) p += 1;
    if (src.id === "reader" && src.side === inst.side && Math.abs(src.lane - inst.lane) === 1) p += 1;
    if (src.id === "vey" && src.side === inst.side && inst.cost >= 1 && inst.cost <= 2) p += 1;
  }
  if (!protectedByWren(ctx, inst)) {
    for (const src of ctx.board) {
      if (src.revealed && onActive(ctx, src) && src.id === "weeping" && src.side !== inst.side && src.lane === inst.lane) p -= 1;
    }
  }
  if (gameEnd && inst.id === "marrow" && onActive(ctx, inst)) {
    const mine = lanePower(ctx, inst.side, inst.lane, false);
    const theirs = lanePower(ctx, other(inst.side), inst.lane, false);
    if (mine > theirs) p += 3;
  }
  return p;
}

function lanePower(ctx: Ctx, side: Side, lane: number, gameEnd: boolean): number {
  const sum = ctx.board
    .filter((u) => u.side === side && u.lane === lane && u.revealed)
    .reduce((s, u) => s + powerOf(ctx, u, gameEnd), 0);
  return Math.max(0, sum);
}

function powers(ctx: Ctx, gameEnd: boolean): [number, number][] {
  return [0, 1, 2].map((lane) => [lanePower(ctx, "A", lane, gameEnd), lanePower(ctx, "B", lane, gameEnd)] as [number, number]);
}

function laneCounts(ctx: Ctx, side: Side): number[] {
  return [0, 1, 2].map((lane) => ctx.board.filter((u) => u.side === side && u.lane === lane).length);
}

function addCard(ctx: Ctx, side: Side, id: string, lane: number, turn: number, token = false): Inst | null {
  const counts = laneCounts(ctx, side);
  let dest = lane;
  if ((counts[dest] ?? 0) >= 4) {
    dest = -1;
    for (let k = 1; k <= 3; k++) {
      const l = (lane + k) % 3;
      if ((counts[l] ?? 0) < 4) {
        dest = l;
        break;
      }
    }
  }
  if (dest < 0) return null;
  const def = card(id);
  const inst: Inst = {
    uid: `${side}${ctx.seq++}`,
    id,
    side,
    lane: dest,
    base: def.power,
    cost: def.cost,
    revealed: false,
    turn,
    order: ctx.seq,
    token,
  };
  ctx.board.push(inst);
  return inst;
}

function ranked(ctx: Ctx, list: Inst[], dir: "high" | "low"): Inst | null {
  if (!list.length) return null;
  return [...list].sort((a, b) => {
    const d = powerOf(ctx, b) - powerOf(ctx, a);
    if (dir === "low") return -d || a.order - b.order;
    return d || a.order - b.order;
  })[0]!;
}

function removeInst(ctx: Ctx, inst: Inst): void {
  const i = ctx.board.indexOf(inst);
  if (i >= 0) ctx.board.splice(i, 1);
}

function revealCard(ctx: Ctx, inst: Inst, turn: number): void {
  inst.revealed = true;
  ev(ctx, "reveal", { uid: inst.uid, id: inst.id, side: inst.side, lane: inst.lane });
  const here = (side: Side) => ctx.board.filter((u) => u.side === side && u.lane === inst.lane && u !== inst);
  const allies = () => here(inst.side);
  const enemies = () => here(other(inst.side));
  const id = inst.id;
  if (id === "novice") {
    const ally = allies().sort((a, b) => a.order - b.order)[0];
    if (ally) {
      ally.base += 1;
      ev(ctx, "buff", { src: inst.uid, tgt: ally.uid, n: 1 });
    }
  } else if (id === "hunter") {
    if (enemies().length) {
      inst.base += 2;
      ev(ctx, "buff", { src: inst.uid, tgt: inst.uid, n: 2 });
    }
  } else if (id === "blotling" || id === "ash_ember") {
    const token = id === "blotling" ? "ink_drop" : "ember";
    for (let k = 1; k <= 2; k++) {
      const lane = (inst.lane + k) % 3;
      const made = addCard(ctx, inst.side, token, lane, turn, true);
      if (made) {
        made.revealed = true;
        ev(ctx, "token", { src: inst.uid, uid: made.uid, id: token, lane: made.lane });
        break;
      }
    }
  } else if (id === "copyist") {
    const revealed = enemies().filter((u) => u.revealed);
    const tgt = ranked(ctx, revealed, "high");
    if (tgt && !protectedByWren(ctx, tgt)) {
      tgt.base -= 1;
      ev(ctx, "debuff", { src: inst.uid, tgt: tgt.uid, n: 1 });
    }
  } else if (id === "footnote") {
    const stronger = enemies().some((u) => u.revealed && powerOf(ctx, u) > powerOf(ctx, inst));
    if (stronger) {
      inst.base += 2;
      ev(ctx, "buff", { src: inst.uid, tgt: inst.uid, n: 2 });
    }
  } else if (id === "juniper") {
    const deck = ctx.decks[other(inst.side)];
    const next = deck[0] ?? null;
    if (next) ctx.peek[inst.side] = next;
    ev(ctx, "peek", { src: inst.uid, side: inst.side, cardId: next });
  } else if (id === "corvin") {
    const drawn = drawInto(ctx.decks[inst.side], ctx.hands[inst.side]);
    ev(ctx, "draw", { src: inst.uid, side: inst.side, cardId: drawn });
  } else if (id === "pip") {
    const roll = ctx.fx.below(2);
    if (roll === 1) inst.base += 5;
    ev(ctx, "coin", { src: inst.uid, roll, n: roll === 1 ? 5 : 0 });
  } else if (id === "index") {
    ctx.stopped.add(`${inst.lane}:${other(inst.side)}`);
    ev(ctx, "silence", { src: inst.uid, lane: inst.lane, side: other(inst.side) });
  } else if (id === "wolf") {
    const mine = lanePower(ctx, inst.side, inst.lane, false);
    const theirs = lanePower(ctx, other(inst.side), inst.lane, false);
    if (mine < theirs) {
      inst.base += 3;
      ev(ctx, "buff", { src: inst.uid, tgt: inst.uid, n: 3 });
    }
  } else if (id === "kesh") {
    const pool = allies().filter((u) => !grubHolds(ctx, u));
    const tgt = ranked(ctx, pool.filter((u) => u.revealed), "high") ?? pool[0];
    if (tgt) {
      const gain = powerOf(ctx, tgt);
      removeInst(ctx, tgt);
      inst.base += gain;
      ev(ctx, "destroy", { src: inst.uid, tgt: tgt.uid, gain });
    }
  } else if (id === "thorn") {
    if (!allies().length) {
      inst.base += 3;
      ev(ctx, "buff", { src: inst.uid, tgt: inst.uid, n: 3 });
    }
  } else if (id === "silas") {
    const pool = enemies().filter((u) => u.revealed && !grubHolds(ctx, u));
    const tgt = ranked(ctx, pool, "high");
    if (tgt) {
      for (const lane of [0, 1, 2]) {
        if (lane === inst.lane) continue;
        if (laneCounts(ctx, tgt.side)[lane]! >= 4) continue;
        tgt.lane = lane;
        ev(ctx, "move", { src: inst.uid, tgt: tgt.uid, lane });
        break;
      }
    }
  } else if (id === "wick") {
    const prev = ctx.playedLane[inst.side][turn - 1];
    if (prev?.has(inst.lane)) {
      inst.base += 4;
      ev(ctx, "buff", { src: inst.uid, tgt: inst.uid, n: 4 });
    }
  } else if (id === "errata") {
    const pool = enemies().filter((u) => u.revealed && !grubHolds(ctx, u));
    const tgt = ranked(ctx, pool, "low");
    if (tgt) {
      removeInst(ctx, tgt);
      ev(ctx, "destroy", { src: inst.uid, tgt: tgt.uid });
    }
  } else if (id === "colophon") {
    for (const ally of [...allies()]) {
      if (grubHolds(ctx, ally)) continue;
      removeInst(ctx, ally);
      ev(ctx, "destroy", { src: inst.uid, tgt: ally.uid });
    }
  }
}

function losingLane(ctx: Ctx, side: Side): number {
  const rows = [0, 1, 2].map((lane) => ({
    lane,
    margin: lanePower(ctx, side, lane, false) - lanePower(ctx, other(side), lane, false),
  }));
  const losing = rows.filter((r) => r.margin < 0).sort((a, b) => b.margin - a.margin || a.lane - b.lane);
  return (losing[0] ?? rows[0]!).lane;
}

function greedyPlays(ctx: Ctx, side: Side, energy: number, turn: number): Play[] {
  const hand = [...ctx.hands[side]];
  const plays: Play[] = [];
  let left = energy;
  const counts = laneCounts(ctx, side);
  while (true) {
    const opts = hand
      .map((id, i) => ({ id, i, cost: card(id).cost }))
      .filter((c) => c.cost > 0 && c.cost <= left);
    if (!opts.length) break;
    opts.sort((a, b) => b.cost - a.cost || a.i - b.i);
    const pick = opts[0]!;
    let lane = losingLane(ctx, side);
    if ((counts[lane] ?? 0) >= 4) {
      const open = [0, 1, 2].find((l) => (counts[l] ?? 0) < 4);
      if (open === undefined) break;
      lane = open;
    }
    hand.splice(pick.i, 1);
    left -= pick.cost;
    counts[lane] = (counts[lane] ?? 0) + 1;
    plays.push({ turn, cardId: pick.id, lane });
  }
  return plays;
}

function takePlays(ctx: Ctx, side: Side, wanted: Play[], energy: number, turn: number): Inst[] {
  const placed: Inst[] = [];
  let left = energy;
  for (const play of wanted) {
    const idx = ctx.hands[side].indexOf(play.cardId);
    if (idx < 0) {
      ev(ctx, "skip_play", { side, cardId: play.cardId, reason: "hand" });
      continue;
    }
    const cost = card(play.cardId).cost;
    if (cost > left) {
      ev(ctx, "skip_play", { side, cardId: play.cardId, reason: "energy" });
      continue;
    }
    ctx.hands[side].splice(idx, 1);
    left -= cost;
    const inst = addCard(ctx, side, play.cardId, play.lane, turn, false);
    if (!inst) {
      ctx.hands[side].push(play.cardId);
      left += cost;
      ev(ctx, "skip_play", { side, cardId: play.cardId, reason: "full" });
      continue;
    }
    ctx.playedLane[side][turn]?.add(inst.lane);
    placed.push(inst);
    ev(ctx, "play", { side, uid: inst.uid, id: inst.id, lane: inst.lane, turn });
  }
  return placed;
}

function lanesWon(rows: [number, number][]): { A: number; B: number } {
  let A = 0;
  let B = 0;
  for (const [a, b] of rows) {
    if (a > b) A += 1;
    else if (b > a) B += 1;
  }
  return { A, B };
}

function decideWinner(ctx: Ctx, seed: number): Side {
  const rows = powers(ctx, true);
  const won = lanesWon(rows);
  if (won.A >= 2) return "A";
  if (won.B >= 2) return "B";
  const totalA = rows.reduce((s, r) => s + r[0], 0);
  const totalB = rows.reduce((s, r) => s + r[1], 0);
  if (totalA !== totalB) return totalA > totalB ? "A" : "B";
  return deriveSeed(seed >>> 0, 999) % 2 === 0 ? "A" : "B";
}

function ghostFolds(profile: ProfileName, turn: number, ctx: Ctx): boolean {
  if (profile === "Bold" || turn >= 6 || turn < 3) return false;
  const rows = powers(ctx, false);
  let lanes = 0;
  let deficit = 0;
  for (const [a, b] of rows) {
    if (a > b) {
      lanes += 1;
      deficit += a - b;
    }
  }
  if (profile === "Cautious") return turn >= 3 && lanes >= 2 && deficit >= 4;
  return turn >= 4 && lanes >= 2 && deficit >= 8;
}

function snapshot(ctx: Ctx, extra: Partial<DuelResult>): DuelResult {
  return {
    winner: null,
    stake: 1,
    over: false,
    turn: 0,
    log: ctx.log,
    board: ctx.board.map((u) => ({ ...u })),
    hands: { A: [...ctx.hands.A], B: [...ctx.hands.B] },
    decksLeft: { A: ctx.decks.A.length, B: ctx.decks.B.length },
    energy: 0,
    peek: { ...ctx.peek },
    powers: powers(ctx, extra.over === true),
    revealFirst: null,
    raised: { A: false, B: false },
    retreated: null,
    bluff: "none",
    playerRaises: [],
    ghostRaises: [],
    ...extra,
  };
}

export function duel(live: LiveInput, ghost: GhostRecord, seed: number, opts: DuelOpts = {}): DuelResult {
  const aSeed = deriveSeed(seed >>> 0, 200);
  const bSeed = ghost.plays ? ghost.shuffleSeed >>> 0 : deriveSeed(seed >>> 0, 201);
  const ctx: Ctx = {
    board: [],
    stopped: new Set(),
    seq: 0,
    log: [],
    hands: { A: [], B: [] },
    decks: { A: shuffle(live.deck, aSeed), B: shuffle(ghost.deck, bSeed) },
    playedLane: { A: [[], [], [], [], [], [], []].map(() => new Set<number>()), B: [[], [], [], [], [], [], []].map(() => new Set<number>()) },
    fx: new Mulberry32(deriveSeed(seed >>> 0, 400)),
    peek: {},
  };
  for (let i = 0; i < 3; i++) {
    drawInto(ctx.decks.A, ctx.hands.A);
    drawInto(ctx.decks.B, ctx.hands.B);
  }
  ev(ctx, "deal", { handA: ctx.hands.A.length, handB: ctx.hands.B.length });
  let stake = 1;
  let retreated: DuelResult["retreated"] = null;
  let winner: Side | null = null;
  let turn = 0;
  let energy = 0;
  let revealFirst: Side | null = null;
  let raised: Record<Side, boolean> = { A: false, B: false };
  const playerRaises: number[] = [];
  const ghostRaises: number[] = [];
  const commit = opts.commitTurn && opts.commitTurn >= 1 && opts.commitTurn <= 6 ? opts.commitTurn : 0;
  const last = commit ? commit - 1 : Math.min(6, opts.throughTurn ?? 6);
  let played = 0;

  for (turn = 1; turn <= last; turn++) {
    played = turn;
    energy = turn;
    raised = { A: false, B: false };
    const drawnA = drawInto(ctx.decks.A, ctx.hands.A);
    const drawnB = drawInto(ctx.decks.B, ctx.hands.B);
    ev(ctx, "turn_draw", { turn, cardA: drawnA, cardB: drawnB });

    const livePlays = live.plays.filter((p) => p.turn === turn);
    let ghostPlays: Play[];
    const recordingOpen = ghost.plays != null && (ghost.retreatedTurn == null || turn < ghost.retreatedTurn);
    if (recordingOpen && ghost.plays) ghostPlays = ghost.plays.filter((p) => p.turn === turn);
    else ghostPlays = greedyPlays(ctx, "B", energy, turn);
    takePlays(ctx, "A", livePlays, energy, turn);
    takePlays(ctx, "B", ghostPlays, energy, turn);

    const can = (pending: number) => stake * 2 ** (pending + 1) <= 8;
    let pending = 0;
    if (live.raises.includes(turn) && can(pending)) {
      raised.A = true;
      pending += 1;
      playerRaises.push(turn);
      ev(ctx, "raise", { side: "A", turn, stake });
    }
    if (ghost.raises.includes(turn) && can(pending)) {
      raised.B = true;
      pending += 1;
      ghostRaises.push(turn);
      ev(ctx, "raise", { side: "B", turn, stake });
    }

    const before = lanesWon(powers(ctx, false));
    if (before.A > before.B) revealFirst = "A";
    else if (before.B > before.A) revealFirst = "B";
    else {
      const roll = ctx.fx.below(2);
      revealFirst = roll === 0 ? "A" : "B";
      ev(ctx, "reveal_coin", { turn, first: revealFirst, roll });
    }
    ev(ctx, "reveal_order", { turn, first: revealFirst });
    const order = [revealFirst, other(revealFirst)];
    for (const side of order) {
      const flipping = ctx.board
        .filter((u) => u.side === side && !u.revealed && !u.token)
        .sort((a, b) => a.order - b.order);
      for (const inst of flipping) revealCard(ctx, inst, turn);
    }

    const preRaise = stake;
    if (turn < 6 && !opts.noLiveRetreat && live.retreatTurn === turn) {
      retreated = { side: "A", kind: live.retreatKind ?? (raised.B ? "after_ghost" : raised.A ? "after_self" : "unprompted"), stake: preRaise };
      winner = "B";
      ev(ctx, "retreat", { side: "A", stake: preRaise, kind: retreated.kind });
    } else if (
      turn < 6 &&
      !opts.ignoreGhostRetreat &&
      raised.A &&
      ghostFolds(ghost.profile, turn, ctx)
    ) {
      retreated = { side: "B", kind: "after_self", stake: preRaise };
      winner = "A";
      ev(ctx, "retreat", { side: "B", stake: preRaise, kind: "after_self" });
    } else {
      for (let i = 0; i < pending; i++) if (stake < 8) stake *= 2;
      ev(ctx, "turn_end", { turn, stake, powers: powers(ctx, false) });
    }
    if (retreated) break;
  }

  if (commit && !retreated) {
    played = commit;
    energy = commit;
    const drawnA = drawInto(ctx.decks.A, ctx.hands.A);
    const drawnB = drawInto(ctx.decks.B, ctx.hands.B);
    ev(ctx, "turn_draw", { turn: commit, cardA: drawnA, cardB: drawnB });
    raised = { A: false, B: false };
    revealFirst = null;
  }

  let over = Boolean(retreated) || (!commit && played >= 6);
  if (!retreated && !commit && played >= 6) {
    winner = decideWinner(ctx, seed);
    over = true;
    ev(ctx, "end", { winner, stake, powers: powers(ctx, true) });
  }

  let bluff: DuelResult["bluff"] = "none";
  if (!opts.skipBluff && over && !opts.ignoreGhostRetreat) {
    if (retreated?.side === "B" && playerRaises.includes(played)) {
      const cf = duel(live, ghost, seed, { ignoreGhostRetreat: true, noLiveRetreat: true, skipBluff: true });
      bluff = cf.winner === "B" ? "success" : "none";
    } else if (playerRaises.length && !retreated && winner === "B") {
      bluff = "caught";
    }
  }

  return snapshot(ctx, {
    winner,
    stake: retreated ? retreated.stake : stake,
    over,
    turn: played,
    energy,
    revealFirst,
    raised,
    retreated,
    bluff,
    playerRaises,
    ghostRaises,
    powers: powers(ctx, over && !retreated),
  });
}
