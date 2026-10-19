import { newMatch, applyMut, stateHash, replay } from './engine.mjs';
// Plays one match. Returns result + action list; optional replay verification.
export function playMatch(setup, pilots, { verify = false } = {}) {
  const s = newMatch(setup); const actions = []; const turnActs = []; let cur = { p: -1, n: 0 };
  let guard = 0;
  while (s.phase !== 'over') {
    const actor = s.phase === 'mulligan' ? s.mull : s.active;
    const a = pilots[actor](s, actor);
    applyMut(s, a); actions.push(a);
    if (a.type !== 'mulligan') { if (cur.p !== actor || a.type === 'end') { } cur.n++; if (a.type === 'end') { turnActs.push({ p: actor, n: cur.n }); cur = { p: -1, n: 0 }; } }
    if (++guard > 2000) throw new Error('runaway match');
  }
  if (cur.n) turnActs.push({ p: s.active, n: cur.n });
  const res = { winner: s.winner, reason: s.reason, first: s.first, verses: s.players.map((p) => p.verses), turns: s.players.map((p) => p.turns), turnActs, capHit: s.capHit, pages: s.pages, hash: stateHash(s) };
  if (verify) { const r = replay(setup, actions); res.mismatch = stateHash(r) !== res.hash; }
  res.actions = actions;
  return res;
}
