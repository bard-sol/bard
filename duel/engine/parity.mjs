// Parity / determinism check. Exit code 1 on any mismatch.
// CI runs `node engine/parity.mjs` from the duel folder. The imports follow engine/active.mjs.
import fs from 'node:fs';
import { replay, stateHash, fnv, newMatch, apply, legalActions, clientView, clientLog, cardById, FIXTURES } from './active.mjs';

const F = JSON.parse(fs.readFileSync(FIXTURES));
let bad = 0;
for (const f of F.fixtures) {
  const s = replay(f.setup, f.actions);
  const got = { winner: s.winner, reason: s.reason, verses: s.players.map((p) => p.verses), stateHash: stateHash(s), logHash: fnv(JSON.stringify(s.log)), logLen: s.log.length };
  const ok = JSON.stringify(got) === JSON.stringify(f.expect);
  if (!ok) bad++;
  console.log(ok ? 'OK  ' : 'FAIL', f.name, got.stateHash, got.logHash, 'winner', got.winner, got.reason, got.verses.join('-'));
}
{
  const f = F.fixtures[0];
  let s = newMatch(f.setup);
  for (const a of f.actions.slice(0, 40)) {
    const before = stateHash(s);
    const n = apply(s, a);
    if (stateHash(s) !== before) {
      bad++;
      console.log('FAIL purity');
      break;
    }
    s = JSON.parse(JSON.stringify(n));
  }
  let t = newMatch(f.setup);
  for (const a of f.actions) {
    if (!legalActions(t).length) {
      bad++;
      break;
    }
    t = apply(t, a);
  }
  const v = clientView(t, 0);
  const leaks = ['seed', 'rng'].filter((k) => k in v).concat(v.rival.hand ? ['rival.hand'] : [], v.rival.deck ? ['rival.deck'] : [], v.me.deck ? ['me.deck'] : []);
  for (const fx of F.fixtures) {
    const z = replay(fx.setup, fx.actions);
    for (const p of [0, 1]) {
      const cl = clientLog(z, p);
      const shown = cl.filter((e) => e.e === 'play' && e.p !== p && e.id && cardById(e.id).type === 'marginalia').length;
      const drawLeak = cl.filter((e) => e.e === 'draw' && e.p !== p && e.uid).length;
      if (shown || drawLeak) leaks.push(`${fx.name} p${p} clientLog`);
    }
  }
  if (leaks.length) {
    bad++;
    console.log('FAIL clientView leaks', leaks);
  } else console.log('OK   clientView/clientLog hide seed, rng, deck order, rival hand, rival draws, rival trap identity');
}
console.log(bad ? `PARITY FAILED (${bad})` : 'PARITY OK');
process.exit(bad ? 1 : 0);
