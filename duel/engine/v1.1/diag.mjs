import { STARTERS } from './cards-src.mjs'; import { makeSmart } from './pilots.mjs'; import { newMatch, applyMut } from './engine.mjs';
const [a, b] = process.argv.slice(2); const why = [{}, {}]; const plays = [{}, {}]; let moves = [0, 0], trapFire = {};
for (let i = 0; i < 400; i++) { const s = newMatch({ houseA: a, deckA: STARTERS[a], houseB: b, deckB: STARTERS[b], seed: 555 + i }); const P = [makeSmart(), makeSmart()];
  while (s.phase !== 'over') { const actor = s.phase === 'mulligan' ? s.mull : s.active; applyMut(s, P[actor](s, actor)); }
  for (const e of s.log) { if (e.e === 'verse') why[e.p][e.why] = (why[e.p][e.why] || 0) + e.n; if (e.e === 'play') plays[e.p][e.id] = (plays[e.p][e.id] || 0) + 1; if (e.e === 'act' && e.a.type === 'move') moves[e.p]++; if (e.e === 'trap_reveal') trapFire[e.id] = (trapFire[e.id] || 0) + 1; } }
console.log(a, why[0], b, why[1]); console.log('moves', moves, 'traps', trapFire); console.log(a, plays[0]); console.log(b, plays[1]);
