// Parity / determinism check. Exit code 1 on any mismatch.
// CI runs `node engine/parity.mjs` from the duel folder.
// Each golden set replays on the engine that produced it. The live pin is v1.3.
import fs from 'node:fs';
import * as v1 from './v1/engine.mjs';
import * as v11 from './v1.1/engine.mjs';
import * as live from './active.mjs';

const SETS = [
  { label: 'golden-v1', engine: 'duel-engine-1.0.0', api: v1, file: new URL('./v1/fixtures/golden-v1.json', import.meta.url) },
  { label: 'golden-v1.1', engine: 'duel-engine-1.1.0', api: v11, file: new URL('./v1.1/fixtures/golden-v1.1.json', import.meta.url) },
  { label: 'golden-v1.3', engine: 'duel-engine-1.3.0', api: live, file: live.FIXTURES },
];

let bad = 0;

function checkSet(set) {
  const F = JSON.parse(fs.readFileSync(set.file));
  if (F.engine !== set.engine) {
    bad++;
    console.log('FAIL', set.label, 'header engine', F.engine);
  }
  console.log(`== ${set.label} (${set.engine}) ==`);
  const { replay, stateHash, fnv, newMatch, apply, legalActions, clientView, clientLog, cardById } = set.api;
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
        console.log('FAIL purity', set.label);
        break;
      }
      s = JSON.parse(JSON.stringify(n));
    }
    let t = newMatch(f.setup);
    let legal = true;
    for (const a of f.actions) {
      if (!legalActions(t).length) {
        bad++;
        legal = false;
        console.log('FAIL legalActions empty', set.label);
        break;
      }
      t = apply(t, a);
    }
    if (legal) {
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
        console.log('FAIL clientView leaks', set.label, leaks);
      } else console.log('OK   clientView/clientLog hide seed, rng, deck order, rival hand, rival draws, rival trap identity');
    }
  }
}

for (const set of SETS) checkSet(set);
console.log(bad ? `PARITY FAILED (${bad})` : 'PARITY OK');
process.exit(bad ? 1 : 0);
