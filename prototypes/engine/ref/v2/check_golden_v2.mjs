// node check_golden_v2.mjs -> verifies resolver_v2.mjs reproduces golden/fixtures-v2.json exactly
import fs from 'fs';
import { resolve, Mulberry32, deriveSeed } from './resolver_v2.mjs';
const here = new URL('.', import.meta.url).pathname;
const U = JSON.parse(fs.readFileSync(here + '../../units-s0-v2.json'));
const G = JSON.parse(fs.readFileSync(here + 'golden/fixtures-v2.json'));
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.fromEntries(Object.keys(x).sort().map(k2 => [k2, x[k2]])) : x);
let bad = 0;
const m = new Mulberry32(G.mulberry32.seed); const f10 = Array.from({ length: 10 }, () => m.next());
if (canon(f10) !== canon(G.mulberry32.first10)) { bad++; console.log('mulberry32 mismatch'); }
for (const d of G.derive_seed) if (deriveSeed(d.base, d.k) !== d.out) { bad++; console.log('derive_seed mismatch', d); }
for (const f of G.fights) {
  const r = resolve(f.lineA, f.lineB, f.seed, U);
  if (canon(r.log) !== canon(f.log) || r.winner !== f.winner || canon(r.stats) !== canon(f.stats)) {
    bad++; const a = r.log, b = f.log; let i = 0; while (i < Math.min(a.length, b.length) && canon(a[i]) === canon(b[i])) i++;
    console.log('MISMATCH', f.name, 'first diff at event', i, canon(a[i]), canon(b[i]));
  }
}
console.log(`${G.fights.length} fights, ${G.derive_seed.length} seed vectors: ${bad === 0 ? 'ZERO MISMATCHES' : bad + ' mismatches'}`);
process.exit(bad ? 1 : 0);
