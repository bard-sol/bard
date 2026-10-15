// Pilots. All pilots see only a determinized copy of the state: rival hand/deck emptied, rival traps
// removed (only their Page positions are known), own deck re-shuffled with the pilot's own RNG, game RNG replaced.
import { legalActions, applyMut, clone, other, m32, fnv, cardById, deriveSeed, holdValue } from './engine.mjs';
export const PILOT_VERSION = 'pilot-1.1.0';

export function determinize(s, me, pseed) {
  const d = clone({ ...s, log: [] });
  const op = other(me);
  d.players[op].hand = d.players[op].hand.map(() => ({ uid: -1, id: 'spare_ink' })); d.players[op].deck = [];
  d.players[op].hand = []; // pilots never act for the rival inside a lookahead
  const st = { v: pseed | 0 }; const dk = d.players[me].deck; for (let i = dk.length - 1; i > 0; i--) { const r = m32(st.v); st.v = r[1]; const j = r[0] % (i + 1); [dk[i], dk[j]] = [dk[j], dk[i]]; }
  d.knownTraps = s.traps.filter((t) => t.owner === op).map((t) => t.page);
  d.traps = s.traps.filter((t) => t.owner === me);
  d.rng = pseed | 0;
  return d;
}
// public-information hash -> pilot seed (never uses the match seed or hidden zones)
function publicSeed(s, me, salt) { return deriveSeed(parseInt(fnv(JSON.stringify([s.board, s.pages, s.players.map((p) => p.verses), s.players[me].hand, s.step, salt])), 16) | 0, 7); }

const KWV = { ward: 2, riposte: 2, bound: 1, hidden: 2, board: 1, cleave: 2, swift: 0 };
export const STANCES = {
  balanced: { verse: 30, hold: 14, atk: 3, hp: 2, card: 2, trap: 3 },
  aggressive: { verse: 33, hold: 16, atk: 3.5, hp: 2, card: 2, trap: 3 },
  patient: { verse: 30, hold: 15, atk: 2.5, hp: 2.5, card: 2.5, trap: 4 },
};
function unitVal(u, w) { let v = u.atk * w.atk + u.hp * w.hp; if (!u.silenced) { for (const k of u.kw) v += KWV[k] || 0; v += u.kindle * 2; if (u.ward) v += 2; } return v; }
export function evaluate(s, me, w) {
  if (s.phase === 'over') return s.winner === me ? 1e7 : -1e7;
  const op = other(me); let v = w.verse * (s.players[me].verses - s.players[op].verses);
  const turnsLeft = 7 - s.players[me].turns;
  for (let pg = 0; pg < 2; pg++) {
    const m = s.board[pg][me], o = s.board[pg][op];
    v += w.hold * holdValue(s, me, pg) - w.hold * 1.3 * holdValue(s, op, pg);
    for (const u of m) v += unitVal(u, w); for (const u of o) v -= unitVal(u, w);
  }
  v += w.card * s.players[me].hand.length;
  for (const t of s.traps) if (t.owner === me) v += w.trap * Math.min(3, cardById(t.id).cost + 1);
  return v + (turnsLeft < 0 ? 0 : 0);
}
function mulliganPick(s, me, smart) { const h = s.players[me].hand; if (!smart) return []; const idx = []; for (let i = 0; i < h.length; i++) if (h[i].id !== 'spare_ink' && cardById(h[i].id).cost >= 4) idx.push(i); return idx; }

// Smart / AI pilot: greedy one-action lookahead on a determinized state, with trap-aware pessimism.
export function makeSmart({ stance = 'balanced', slip = 0, trapAware = true, salt = 0 } = {}) {
  const w = STANCES.balanced; // v1.1: one evaluator for every stance; stance only breaks near-ties
  const PREF = { aggressive: { attack: 0, move: 1, legend: 2, play: 3, champion: 3 }, balanced: null, patient: { play: 0, champion: 0, legend: 1, move: 2, attack: 3 } }[stance];
  return function choose(s, me) {
    if (s.phase === 'mulligan') return { type: 'mulligan', idx: mulliganPick(s, me, true) };
    const ps = publicSeed(s, me, salt); const d = determinize(s, me, ps);
    const acts = legalActions(d);
    const base = evaluate(d, me, w);
    const scored = [];
    for (const a of acts) {
      if (a.type === 'end' || a.type === 'fight') continue;
      const c = clone(d); let pess = 0;
      if (trapAware && (a.type === 'attack' || a.type === 'move')) {
        const f = c.board[0][me].concat(c.board[1][me]).find((u) => u.uid === a.uid);
        const pg = a.type === 'move' ? 1 - f.page : f.page;
        if (d.knownTraps.indexOf(pg) >= 0) { pess = Math.min(f.hp, 2) * w.hp + (f.hp <= 2 ? unitVal(f, w) : 0); }
      }
      try { applyMut(c, a, false); } catch (e) { continue; }
      scored.push({ a, v: evaluate(c, me, w) - pess });
    }
    scored.sort((x, y) => y.v - x.v);
    if (PREF && scored.length > 1) { const top = scored[0].v; const near = scored.filter((q) => q.v >= top - 2); const rest = scored.filter((q) => q.v < top - 2);
      const isTrap = (q) => q.a.type === 'play' && cardById(d.players[me].hand.find((h) => h.uid === q.a.uid).id).type === 'marginalia';
      const key = (q) => { if (stance === 'patient') return isTrap(q) ? -1 : PREF[q.a.type] ?? 9; const t = q.a.type; if (t === 'play' || t === 'champion' || t === 'legend') return isTrap(q) ? 3 : 0; return t === 'attack' ? 1 : 2; };
      near.sort((x, y) => key(x) - key(y) || y.v - x.v); scored.length = 0; scored.push(...near, ...rest); }
    const margin = 0;
    let pick = scored[0];
    if (slip > 0 && scored.length > 1) { const r = m32(ps ^ 0x5bd1e995)[0] % 1000; if (r < slip) pick = scored[1]; }
    if (pick && pick.v > base + margin) return pick.a;
    return s.phase === 'main' && acts.some((a) => a.type === 'attack' || a.type === 'move') && !scored.length ? { type: 'fight' } : { type: 'end' };
  };
}
// Naive pilot: plays random affordable cards to random Pages, attacks random targets, never moves, ignores traps.
export function makeNaive(seed) {
  let st = seed | 0; const r = (n) => { const x = m32(st); st = x[1]; return x[0] % n; };
  return function choose(s, me) {
    if (s.phase === 'mulligan') return { type: 'mulligan', idx: [] };
    const acts = legalActions(s);
    const plays = acts.filter((a) => a.type === 'play' || a.type === 'champion' || (a.type === 'legend' && r(2) === 0));
    if (s.phase === 'main' && plays.length) return plays[r(plays.length)];
    const atk = acts.filter((a) => a.type === 'attack');
    if (atk.length) { const byUnit = []; for (const a of atk) if (byUnit.indexOf(a.uid) < 0) byUnit.push(a.uid); const u = byUnit[0]; const opts = atk.filter((a) => a.uid === u); return opts[r(opts.length)]; }
    return { type: 'end' };
  };
}
