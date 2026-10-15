import { Duel as Engine, type DuelCardInst } from "../../engine/ref/v2/duel_v2.mjs";
import { card, DUEL_DATA } from "./cards";

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
  shuffleSeed: number;
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
  power: number;
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
  skipBluff?: boolean;
  commitTurn?: number;
}

export interface LaneRule {
  id: string;
  name: string;
  text: string;
  revealed: boolean;
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
  lanes: LaneRule[];
}

const other = (s: Side): Side => (s === "A" ? "B" : "A");

function losingLane(engine: Engine, side: Side): number {
  const [, tot] = engine.powers();
  const rows = [0, 1, 2].map((lane) => ({
    lane,
    margin: tot[side][lane]! - tot[other(side)][lane]!,
    room: engine.room(side, lane),
  }));
  const open = rows.filter((r) => r.room);
  const pool = open.length ? open : rows;
  const losing = pool.filter((r) => r.margin < 0).sort((a, b) => b.margin - a.margin || a.lane - b.lane);
  return (losing[0] ?? pool[0]!).lane;
}

function greedyPlays(engine: Engine, side: Side): [string, number][] {
  const hand = engine.S[side]!.hand.slice();
  let left = engine.turn;
  const plays: [string, number][] = [];
  const used = engine.S[side]!.board.map((lane) => lane.length);
  while (true) {
    const opts = hand
      .map((id, i) => ({ id, i, cost: card(id).cost }))
      .filter((c) => c.cost > 0 && c.cost <= left);
    if (!opts.length) break;
    opts.sort((a, b) => b.cost - a.cost || a.i - b.i);
    const pick = opts[0]!;
    let lane = losingLane(engine, side);
    if ((used[lane] ?? 0) >= engine.slots(lane)) {
      const open = [0, 1, 2].find((l) => (used[l] ?? 0) < engine.slots(l));
      if (open === undefined) break;
      lane = open;
    }
    hand.splice(pick.i, 1);
    left -= pick.cost;
    used[lane] = (used[lane] ?? 0) + 1;
    plays.push([pick.id, lane]);
  }
  return plays;
}

function ghostFolds(profile: ProfileName, turn: number, engine: Engine): boolean {
  if (profile === "Bold" || turn >= 6 || turn < 3) return false;
  const [, tot] = engine.powers();
  let lanes = 0;
  let deficit = 0;
  for (let i = 0; i < 3; i++) {
    const a = tot.A[i]!;
    const b = tot.B[i]!;
    if (a > b) {
      lanes += 1;
      deficit += a - b;
    }
  }
  if (profile === "Cautious") return turn >= 3 && lanes >= 2 && deficit >= 4;
  return turn >= 4 && lanes >= 2 && deficit >= 8;
}

function boardOf(engine: Engine): Inst[] {
  const [P] = engine.powers();
  const out: Inst[] = [];
  for (const side of ["A", "B"] as const) {
    for (const lane of engine.S[side]!.board) {
      for (const c of lane) out.push(instOf(c, P[c.uid] ?? c.base + c.perm));
    }
  }
  return out;
}

function instOf(c: DuelCardInst, power: number): Inst {
  return {
    uid: String(c.uid),
    id: c.id,
    side: c.side === "B" ? "B" : "A",
    lane: c.lane,
    base: c.base,
    cost: c.cost,
    revealed: true,
    turn: c.turn,
    order: c.order,
    token: c.token,
    power,
  };
}

function lanesOf(engine: Engine): LaneRule[] {
  return engine.locs.map((id, i) => {
    const meta = engine.locsMeta.find((l) => l.id === id);
    return { id, name: meta?.name ?? id, text: meta?.text ?? "", revealed: engine.revealed[i] ?? false };
  });
}

function peekOf(log: DuelLog[]): Partial<Record<Side, string>> {
  const peek: Partial<Record<Side, string>> = {};
  for (const e of log) {
    if (e.t === "peek" && (e.side === "A" || e.side === "B") && Array.isArray(e.hand)) {
      peek[e.side] = (e.hand as string[]).join(", ");
    }
  }
  return peek;
}

function snapshot(engine: Engine, extra: Partial<DuelResult>): DuelResult {
  const [, tot] = engine.powers();
  return {
    winner: null,
    stake: 1,
    over: false,
    turn: engine.turn,
    log: engine.log.map((e) => ({ ...e })),
    board: boardOf(engine),
    hands: { A: [...engine.S.A!.hand], B: [...engine.S.B!.hand] },
    decksLeft: { A: engine.S.A!.deck.length, B: engine.S.B!.deck.length },
    energy: engine.turn,
    peek: peekOf(engine.log),
    powers: [0, 1, 2].map((i) => [tot.A[i]!, tot.B[i]!] as [number, number]),
    revealFirst: null,
    raised: { A: false, B: false },
    retreated: null,
    bluff: "none",
    playerRaises: [],
    ghostRaises: [],
    lanes: lanesOf(engine),
    ...extra,
  };
}

function playsFor(list: Play[] | null, turn: number): [string, number][] {
  if (!list) return [];
  return list.filter((p) => p.turn === turn).map((p) => [p.cardId, p.lane]);
}

export function duel(live: LiveInput, ghost: GhostRecord, seed: number, opts: DuelOpts = {}): DuelResult {
  const engine = new Engine(live.deck, ghost.deck, seed >>> 0, DUEL_DATA);
  let stake = 1;
  let retreated: DuelResult["retreated"] = null;
  let winner: Side | null = null;
  let revealFirst: Side | null = null;
  let raised: Record<Side, boolean> = { A: false, B: false };
  const playerRaises: number[] = [];
  const ghostRaises: number[] = [];
  const commit = opts.commitTurn && opts.commitTurn >= 1 && opts.commitTurn <= 6 ? opts.commitTurn : 0;
  const last = commit ? commit - 1 : Math.min(6, opts.throughTurn ?? 6);
  let played = 0;

  for (let turn = 1; turn <= last; turn++) {
    played = turn;
    raised = { A: false, B: false };
    engine.start_turn();
    const livePlays = playsFor(live.plays, turn);
    const recordingOpen = ghost.plays != null && (ghost.retreatedTurn == null || turn < ghost.retreatedTurn);
    const ghostPlays = recordingOpen ? playsFor(ghost.plays, turn) : greedyPlays(engine, "B");
    engine.commit("A", livePlays);
    engine.commit("B", ghostPlays);

    const can = (pending: number) => stake * 2 ** (pending + 1) <= 8;
    let pending = 0;
    if (live.raises.includes(turn) && can(pending)) {
      raised.A = true;
      pending += 1;
      playerRaises.push(turn);
      engine.log.push({ i: engine.log.length, t: "raise", turn, side: "A", stake });
    }
    if (ghost.raises.includes(turn) && can(pending)) {
      raised.B = true;
      pending += 1;
      ghostRaises.push(turn);
      engine.log.push({ i: engine.log.length, t: "raise", turn, side: "B", stake });
    }

    engine.reveal();
    const order = [...engine.log].reverse().find((e) => e.t === "reveal_order" && e.turn === turn);
    revealFirst = order?.first === "B" ? "B" : "A";

    const preRaise = stake;
    if (turn < 6 && !opts.noLiveRetreat && live.retreatTurn === turn) {
      retreated = {
        side: "A",
        kind: live.retreatKind ?? (raised.B ? "after_ghost" : raised.A ? "after_self" : "unprompted"),
        stake: preRaise,
      };
      winner = "B";
      engine.log.push({ i: engine.log.length, t: "retreat", turn, side: "A", stake: preRaise, kind: retreated.kind });
    } else if (turn < 6 && !opts.ignoreGhostRetreat && raised.A && ghostFolds(ghost.profile, turn, engine)) {
      retreated = { side: "B", kind: "after_self", stake: preRaise };
      winner = "A";
      engine.log.push({ i: engine.log.length, t: "retreat", turn, side: "B", stake: preRaise, kind: "after_self" });
    } else {
      for (let i = 0; i < pending; i++) if (stake < 8) stake *= 2;
      engine.end_turn();
    }
    if (retreated) break;
  }

  if (commit && !retreated) {
    played = commit;
    raised = { A: false, B: false };
    revealFirst = null;
    engine.start_turn();
  }

  const over = Boolean(retreated) || (!commit && played >= 6);
  if (!retreated && !commit && played >= 6) {
    const res = engine.result();
    winner = res.winner === "B" ? "B" : "A";
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

  return snapshot(engine, {
    winner,
    stake: retreated ? retreated.stake : stake,
    over,
    turn: played,
    energy: played,
    revealFirst,
    raised,
    retreated,
    bluff,
    playerRaises,
    ghostRaises,
  });
}
