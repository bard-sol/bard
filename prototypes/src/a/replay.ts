import type { FightLogEvent, FightResult } from "../../engine/ref/resolver.mjs";

interface Body {
  uid: string;
  side: "A" | "B";
  hp: number;
  alive: boolean;
}

/**
 * Client fold of a fight log. Health comes from the logged events,
 * not from a second combat pass. The end event must agree.
 */
export function foldFight(log: FightLogEvent[]): { hpA: number; hpB: number; winner: string } {
  const lines: Record<"A" | "B", Body[]> = { A: [], B: [] };
  const index = new Map<string, Body>();
  const place = (side: "A" | "B", uid: string, hp: number, at: number) => {
    const body: Body = { uid, side, hp, alive: true };
    const pos = Math.max(0, Math.min(at, lines[side].length));
    lines[side].splice(pos, 0, body);
    index.set(uid, body);
  };
  for (const ev of log) {
    if (ev.t === "start") {
      const snap = ev.lines as { A: { uid: string; hp: number }[]; B: { uid: string; hp: number }[] };
      for (const side of ["A", "B"] as const) {
        snap[side].forEach((u, i) => place(side, u.uid, u.hp, i));
      }
    } else if (ev.t === "damage" || ev.t === "heal" || ev.t === "buff") {
      const body = index.get(String(ev.tgt));
      if (body && typeof ev.hp === "number") body.hp = ev.hp;
    } else if (ev.t === "endure") {
      const body = index.get(String(ev.uid));
      if (body) body.hp = 1;
    } else if (ev.t === "death") {
      const body = index.get(String(ev.uid));
      if (body) body.alive = false;
    } else if (ev.t === "summon") {
      const uid = String(ev.uid);
      const side = uid.startsWith("B") ? "B" : "A";
      place(side, uid, Number(ev.hp ?? 0), Number(ev.slot ?? lines[side].length));
    }
  }
  const sum = (side: "A" | "B") => lines[side].filter((u) => u.alive).reduce((s, u) => s + u.hp, 0);
  const end = log.find((e) => e.t === "end");
  return { hpA: sum("A"), hpB: sum("B"), winner: String(end?.winner ?? "") };
}

export function foldAgrees(result: FightResult): boolean {
  const folded = foldFight(result.log);
  const end = result.log.find((e) => e.t === "end");
  return folded.hpA === Number(end?.hpA) && folded.hpB === Number(end?.hpB) && folded.winner === result.winner;
}
