// Parity / determinism check. Exit code 1 on any mismatch.
import fs from 'fs';
import { replay, stateHash, fnv, newMatch, apply, legalActions, clientView, clientLog, cardById, CURRENT_PILOT_VERSION } from './engine.mjs';
import { evaluate, STANCES, PILOT_VERSION } from './pilots.mjs';
const F = JSON.parse(fs.readFileSync(new URL('./fixtures/golden-v1.3.json', import.meta.url)));
let bad = 0;
for (const f of F.fixtures) {
  const s = replay(f.setup, f.actions);
  const got = { winner: s.winner, reason: s.reason, verses: s.players.map((p) => p.verses), stateHash: stateHash(s), logHash: fnv(JSON.stringify(s.log)), logLen: s.log.length };
  const ok = JSON.stringify(got) === JSON.stringify(f.expect); if (!ok) bad++;
  console.log(ok ? 'OK  ' : 'FAIL', f.name, got.stateHash, got.logHash, 'winner', got.winner, got.reason, got.verses.join('-'));
}
// purity: apply() must not mutate its input, and JSON round-trip of state must not change results
{ const f = F.fixtures[0]; let s = newMatch(f.setup); for (const a of f.actions.slice(0, 40)) { const before = stateHash(s); const n = apply(s, a); if (stateHash(s) !== before) { bad++; console.log('FAIL purity'); break; } s = JSON.parse(JSON.stringify(n)); }
  // legal-actions must contain every recorded action
  let t = newMatch(f.setup); for (const a of f.actions) { if (!legalActions(t).length) { bad++; break; } t = apply(t, a); }
  const v = clientView(t, 0); const leaks = ['seed', 'rng'].filter((k) => k in v).concat(v.rival.hand ? ['rival.hand'] : [], v.rival.deck ? ['rival.deck'] : [], v.me.deck ? ['me.deck'] : []);
  for (const fx of F.fixtures) { const z = replay(fx.setup, fx.actions); for (const p of [0, 1]) { const cl = clientLog(z, p); const hidden = z.log.filter((e) => e.e === 'play' && e.p !== p && cardById(e.id).type === 'marginalia').length; const shown = cl.filter((e) => e.e === 'play' && e.p !== p && e.id && cardById(e.id).type === 'marginalia').length; const drawLeak = cl.filter((e) => e.e === 'draw' && e.p !== p && e.uid).length; if (shown || drawLeak) leaks.push(`${fx.name} p${p} clientLog`); } }
  if (leaks.length) { bad++; console.log('FAIL clientView leaks', leaks); } else console.log('OK   clientView/clientLog hide seed, rng, deck order, rival hand, rival draws, rival trap identity');
}
// v1.2 integer-only check: every number in every fixture state, and every evaluator score at every step, is an integer
{ const nonInt = (o) => { if (typeof o === 'number') return !Number.isInteger(o); if (Array.isArray(o)) return o.some(nonInt); if (o && typeof o === 'object') return Object.values(o).some(nonInt); return false; };
  let floats = 0, steps = 0;
  for (const f of F.fixtures) { let t = newMatch(f.setup); for (const a of f.actions) { steps++; if (nonInt(t)) floats++; for (const k of ['balanced', 'aggressive', 'patient']) for (const p of [0, 1]) if (!Number.isInteger(evaluate(t, p, STANCES[k]))) floats++; t = apply(t, a); } }
  if (floats) { bad++; console.log('FAIL integer-only', floats, 'of', steps, 'steps'); } else console.log('OK   integer-only: state and evaluator scores are integers at all', steps, 'fixture steps');
  const dv = newMatch({ ...F.fixtures[0].setup, aiVersion: undefined }).ai;
  if (dv !== PILOT_VERSION || dv !== CURRENT_PILOT_VERSION) { bad++; console.log('FAIL newMatch default aiVersion', dv); } else console.log('OK   newMatch default aiVersion =', dv); }
console.log(bad ? `PARITY FAILED (${bad})` : 'PARITY OK'); process.exit(bad ? 1 : 0);
