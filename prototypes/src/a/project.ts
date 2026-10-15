import type { FightLogEvent } from "../../engine/ref/resolver.mjs";
import { face, trigLabel } from "../v3/catalog";

export interface Actor {
  uid: string;
  id: string;
  side: "A" | "B";
  atk: number;
  hp: number;
  max: number;
  copies: number;
  ward: boolean;
  silence: boolean;
  debuff: boolean;
  braced: boolean;
  alive: boolean;
}

export interface Projected {
  A: Actor[];
  B: Actor[];
  lines: { t: string; html: string }[];
  banner: string;
  queue: { id: string; side: "A" | "B"; dead: boolean; now: boolean }[];
  hpA: number;
  hpB: number;
}

const nameOf = (id: string) => face(id).short;

function find(lines: Record<"A" | "B", Actor[]>, uid: string): Actor | undefined {
  return lines.A.find((u) => u.uid === uid) ?? lines.B.find((u) => u.uid === uid);
}

export function project(log: FightLogEvent[], upto: number): Projected {
  const lines: Record<"A" | "B", Actor[]> = { A: [], B: [] };
  let braced = "";
  const out: Projected["lines"] = [];
  let banner = "";
  const queue: Projected["queue"] = [];
  const cut = Math.max(0, Math.min(upto, log.length));
  for (let n = 0; n < cut; n++) {
    const ev = log[n]!;
    const src = typeof ev.src === "string" ? find(lines, ev.src) : undefined;
    const tgt = typeof ev.tgt === "string" ? find(lines, ev.tgt) : undefined;
    const srcName = src ? nameOf(src.id) : "A unit";
    const tgtName = tgt ? nameOf(tgt.id) : "";
    if (ev.t === "brace" && typeof ev.uid === "string") {
      braced = ev.uid;
      banner = "Braced · second mover’s Front gains +1 health";
    } else if (ev.t === "start") {
      const snap = ev.lines as { A: { uid: string; id: string; copies: number; atk: number; hp: number }[]; B: { uid: string; id: string; copies: number; atk: number; hp: number }[] };
      for (const side of ["A", "B"] as const) {
        lines[side] = snap[side].map((u) => ({
          uid: u.uid,
          id: u.id,
          side,
          atk: u.atk,
          hp: u.hp,
          max: u.hp,
          copies: u.copies,
          ward: false,
          silence: false,
          debuff: false,
          braced: u.uid === braced,
          alive: true,
        }));
      }
      out.push({ t: "0", html: `<b>${ev.first === "B" ? "They" : "You"}</b> strike first` });
    } else if (ev.t === "trigger") {
      const who = srcName;
      const label = trigLabel(String(ev.trig ?? ""));
      banner = `${who} · ${label}`;
      out.push({ t: String(n), html: `<b>${who}</b> · ${label}${ev.relayed ? " · relayed" : ""}` });
    } else if (ev.t === "attack" && src && tgt) {
      queue.push({ id: src.id, side: src.side, dead: false, now: n === cut - 1 });
      out.push({ t: String(n), html: `<b>${srcName}</b> attacks <b>${tgtName}</b> for <span class="d">${ev.n}</span>` });
    } else if (ev.t === "damage" && tgt && typeof ev.hp === "number") {
      tgt.hp = ev.hp;
      out.push({ t: String(n), html: `<b>${srcName}</b> deals <span class="d">${ev.n}</span> to <b>${tgtName}</b> · ${ev.hp} left` });
    } else if (ev.t === "ward" && tgt) {
      tgt.ward = true;
      out.push({ t: String(n), html: `<b>${srcName}</b> gives <b>${tgtName}</b> Ward` });
    } else if (ev.t === "ward_break" && tgt) {
      tgt.ward = false;
      banner = `${srcName} breaks Ward on ${tgtName}`;
      out.push({ t: String(n), html: `<b>${srcName}</b> breaks Ward on <b>${tgtName}</b>${ev.pierced ? " · pierce" : ""}` });
    } else if (ev.t === "guard") {
      out.push({ t: String(n), html: `Guard on <b>${tgtName}</b> blocks <span class="hl">${ev.blocked}</span>` });
    } else if (ev.t === "shelter") {
      banner = `Shelter redirects the hit`;
      out.push({ t: String(n), html: `<b>Shelter</b> takes the hit` });
    } else if (ev.t === "heal" && tgt && typeof ev.hp === "number") {
      tgt.hp = ev.hp;
      out.push({ t: String(n), html: `<b>${srcName}</b> heals <b>${tgtName}</b> to <span class="hl">${ev.hp}</span>` });
    } else if (ev.t === "buff" && tgt && typeof ev.atk === "number" && typeof ev.hp === "number") {
      tgt.atk = ev.atk;
      tgt.hp = ev.hp;
      tgt.max = Math.max(tgt.max, ev.hp);
      out.push({ t: String(n), html: `<b>${srcName}</b> → <b>${tgtName}</b> now <span class="bf">${ev.atk}/${ev.hp}</span>` });
    } else if (ev.t === "debuff" && tgt && typeof ev.atk === "number") {
      tgt.atk = ev.atk;
      tgt.debuff = true;
      out.push({ t: String(n), html: `<b>${srcName}</b> cuts <b>${tgtName}</b> to <span class="d">${ev.atk}</span> attack` });
    } else if (ev.t === "silence" && tgt) {
      tgt.silence = true;
      tgt.ward = false;
      banner = `${srcName} silences ${tgtName}`;
      out.push({ t: String(n), html: `<b>${srcName}</b> silences <b>${tgtName}</b>` });
    } else if (ev.t === "death" && typeof ev.uid === "string") {
      const dead = find(lines, ev.uid);
      if (dead) {
        dead.alive = false;
        const side = dead.side;
        lines[side] = lines[side].filter((u) => u.uid !== dead.uid);
        out.push({ t: String(n), html: `<b>${nameOf(dead.id)}</b> falls` });
      }
    } else if (ev.t === "endure" && typeof ev.uid === "string") {
      const u = find(lines, ev.uid);
      if (u) u.hp = 1;
      out.push({ t: String(n), html: `<b>${u ? nameOf(u.id) : "A unit"}</b> endures at 1` });
    } else if (ev.t === "summon" && typeof ev.uid === "string" && typeof ev.id === "string") {
      const side: "A" | "B" = ev.uid.startsWith("B") ? "B" : "A";
      const slot = Number(ev.slot ?? lines[side].length);
      const actor: Actor = {
        uid: ev.uid,
        id: ev.id,
        side,
        atk: Number(ev.atk ?? 1),
        hp: Number(ev.hp ?? 1),
        max: Number(ev.hp ?? 1),
        copies: 1,
        ward: false,
        silence: Boolean(ev.smothered),
        debuff: false,
        braced: false,
        alive: true,
      };
      lines[side].splice(Math.max(0, Math.min(slot, lines[side].length)), 0, actor);
      banner = `${srcName} summons ${nameOf(ev.id)}`;
      out.push({ t: String(n), html: `<b>${srcName}</b> summons <b>${nameOf(ev.id)}</b>` });
    } else if (ev.t === "summon_fizzle") {
      const why = String(ev.why ?? "full");
      banner = `${srcName} · summon fizzles (${why})`;
      out.push({ t: String(n), html: `<b>${srcName}</b> · summon fizzles · ${why}` });
    } else if (ev.t === "filed") {
      out.push({ t: String(n), html: `Filed cancels <b>${srcName}</b>` });
    } else if (ev.t === "blighted") {
      out.push({ t: String(n), html: `<b>${tgtName || srcName}</b> is blighted` });
    } else if (ev.t === "swap") {
      const side = src?.side ?? "A";
      const row = lines[side === "A" ? "B" : "A"];
      if (row.length > 1) {
        const a = row[0]!;
        const b = row[row.length - 1]!;
        row[0] = b;
        row[row.length - 1] = a;
      }
      out.push({ t: String(n), html: `<b>${srcName}</b> swaps the enemy ends` });
    } else if (ev.t === "destroy" && tgt) {
      tgt.hp = 0;
      out.push({ t: String(n), html: `<b>${srcName}</b> destroys <b>${tgtName}</b>` });
    } else if (ev.t === "foresight") {
      out.push({ t: String(n), html: `<b>Foresight</b> · ${ev.side === "B" ? "they" : "you"} go first` });
    } else if (ev.t === "echo") {
      out.push({ t: String(n), html: `<b>${srcName}</b> echoes a death` });
    } else if (ev.t === "end") {
      out.push({ t: String(n), html: ev.winner === "draw" ? "The round is drawn" : `<b>${ev.winner === "A" ? "You" : "They"}</b> take the round` });
    }
  }
  for (const q of queue) q.now = false;
  if (queue.length) queue[queue.length - 1]!.now = true;
  const sum = (side: "A" | "B") => lines[side].reduce((s, u) => s + Math.max(0, u.hp), 0);
  return { A: lines.A, B: lines.B, lines: out.slice(-12), banner, queue: queue.slice(-10), hpA: sum("A"), hpB: sum("B") };
}
