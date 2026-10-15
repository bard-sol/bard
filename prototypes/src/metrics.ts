export type PrototypeId = "A" | "B";

export interface MetricEvent {
  id: string;
  ts: number;
  type:
    | "session_start"
    | "tutorial_beat"
    | "match_start"
    | "match_end"
    | "round_end"
    | "first_match_complete"
    | "preference"
    | "determinism_mismatch";
  prototype: PrototypeId | null;
  matchId?: string;
  result?: "win" | "loss" | "draw" | "fold";
  beat?: number;
  phase?: "start" | "done";
  practice?: boolean;
  choice?: "A" | "B" | "either";
  /** Prototype A: who went first, and who won the round. */
  round?: number;
  first?: "A" | "B";
  roundWinner?: "A" | "B" | "draw";
  /** Prototype B. Stake is match Ink, never Renown. */
  stake?: number;
  bluff?: "success" | "caught" | "none";
  retreatKind?: "after_ghost" | "after_self" | "unprompted";
  raiseTurns?: number[];
}

export interface MetricsSummary {
  generatedAt: number;
  matchesPerDay: Record<string, { A: number; B: number; total: number }>;
  firstMatchCompletion: { started: boolean; completed: boolean; rate: number | null };
  replayWithin5MinOfLoss: { losses: number; replays: number; rate: number | null };
  medianSessionLengthMatches: number | null;
  sessionCount: number;
  sessionLengths: number[];
  preference: "A" | "B" | "either" | null;
  /** Logged first-mover. `firstWon` is rounds the first side also won. */
  firstMover: Record<string, { games: number; aFirst: number; bFirst: number; firstWon: number }>;
  bluff: { success: number; caught: number; raises: number };
  retreats: { after_ghost: number; after_self: number; unprompted: number };
  events: MetricEvent[];
}

const KEY = "bard.proto.metrics.v1";
const FIVE_MIN = 5 * 60 * 1000;
const SESSION_GAP = 10 * 60 * 1000;

export function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function localDay(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2) return s[mid] ?? null;
  return ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

export function summarize(
  events: MetricEvent[],
  opts: { now?: number; day?: (ts: number) => string } = {},
): MetricsSummary {
  const dayOf = opts.day ?? localDay;
  const ordered = [...events].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  const matchesPerDay: MetricsSummary["matchesPerDay"] = {};
  for (const e of ordered) {
    if (e.type !== "match_end" || e.practice) continue;
    const key = dayOf(e.ts);
    const row = matchesPerDay[key] ?? { A: 0, B: 0, total: 0 };
    if (e.prototype === "A") row.A += 1;
    if (e.prototype === "B") row.B += 1;
    row.total += 1;
    matchesPerDay[key] = row;
  }

  const firstStart = ordered.find((e) => e.type === "match_start" && !e.practice);
  const firstDone = firstStart
    ? ordered.some((e) => e.type === "match_end" && e.matchId === firstStart.matchId)
    : false;

  const losses = ordered.filter(
    (e) => e.type === "match_end" && !e.practice && (e.result === "loss" || e.result === "fold"),
  );
  let replays = 0;
  for (const loss of losses) {
    const again = ordered.some(
      (e) =>
        e.type === "match_start" &&
        !e.practice &&
        e.prototype === loss.prototype &&
        e.matchId !== loss.matchId &&
        e.ts > loss.ts &&
        e.ts - loss.ts <= FIVE_MIN,
    );
    if (again) replays += 1;
  }

  const lengths: number[] = [];
  let sessionMatches = 0;
  let lastTs = -Infinity;
  let open = false;
  const close = () => {
    if (!open) return;
    lengths.push(sessionMatches);
    sessionMatches = 0;
    open = false;
  };
  for (const e of ordered) {
    if (!open || e.ts - lastTs > SESSION_GAP || e.type === "session_start") {
      close();
      open = true;
      sessionMatches = 0;
    }
    if (e.type === "match_end" && !e.practice) sessionMatches += 1;
    lastTs = e.ts;
  }
  close();

  const pref = [...ordered].reverse().find((e) => e.type === "preference");
  const firstMover: MetricsSummary["firstMover"] = {};
  const bluff = { success: 0, caught: 0, raises: 0 };
  const retreats = { after_ghost: 0, after_self: 0, unprompted: 0 };
  for (const e of ordered) {
    if (e.type === "round_end" && !e.practice && e.round && e.first && e.roundWinner) {
      const key = String(e.round);
      const row = firstMover[key] ?? { games: 0, aFirst: 0, bFirst: 0, firstWon: 0 };
      row.games += 1;
      if (e.first === "A") row.aFirst += 1;
      else row.bFirst += 1;
      if (e.roundWinner !== "draw" && e.roundWinner === e.first) row.firstWon += 1;
      firstMover[key] = row;
    }
    if (e.type === "match_end" && e.prototype === "B" && !e.practice) {
      bluff.raises += e.raiseTurns?.length ?? 0;
      if (e.bluff === "success") bluff.success += 1;
      if (e.bluff === "caught") bluff.caught += 1;
      if (e.retreatKind) retreats[e.retreatKind] += 1;
    }
  }
  return {
    generatedAt: opts.now ?? Date.now(),
    matchesPerDay,
    firstMatchCompletion: {
      started: Boolean(firstStart),
      completed: firstDone,
      rate: firstStart ? (firstDone ? 1 : 0) : null,
    },
    replayWithin5MinOfLoss: {
      losses: losses.length,
      replays,
      rate: losses.length ? replays / losses.length : null,
    },
    medianSessionLengthMatches: median(lengths),
    sessionCount: lengths.length,
    sessionLengths: lengths,
    preference: pref?.choice ?? null,
    firstMover,
    bluff,
    retreats,
    events: ordered,
  };
}

function load(): MetricEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MetricEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(events: MetricEvent[]) {
  localStorage.setItem(KEY, JSON.stringify(events));
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function record(partial: Omit<MetricEvent, "id" | "ts"> & { ts?: number; id?: string }): MetricEvent {
  const event: MetricEvent = {
    id: partial.id ?? newId(),
    ts: partial.ts ?? Date.now(),
    type: partial.type,
    prototype: partial.prototype,
    matchId: partial.matchId,
    result: partial.result,
    beat: partial.beat,
    phase: partial.phase,
    practice: partial.practice,
    choice: partial.choice,
    round: partial.round,
    first: partial.first,
    roundWinner: partial.roundWinner,
    stake: partial.stake,
    bluff: partial.bluff,
    retreatKind: partial.retreatKind,
    raiseTurns: partial.raiseTurns,
  };
  const all = load();
  all.push(event);
  save(all);
  const body = JSON.stringify(event);
  if (typeof fetch !== "undefined") {
    fetch("/api/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => {});
  }
  return event;
}

export function readEvents(): MetricEvent[] {
  return load();
}

export function exportSummary(): MetricsSummary {
  return summarize(load());
}

export function downloadSummary(): void {
  const summary = exportSummary();
  const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bard-metrics-${utcDay(summary.generatedAt)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function resetMetrics(): void {
  localStorage.removeItem(KEY);
}

export function ensureSession(prototype: PrototypeId | null): void {
  const events = load();
  const last = [...events].reverse().find((e) => e.type === "session_start");
  if (last && Date.now() - last.ts < SESSION_GAP) return;
  record({ type: "session_start", prototype });
}
