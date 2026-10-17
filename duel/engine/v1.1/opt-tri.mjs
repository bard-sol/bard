// Proxy for the optimized-deck triangle: random pairings of a saved set of searched decks (fixed lists) under current card numbers.
import fs from 'fs'; import { runPool, wilson } from './sim.mjs';
const src = process.argv[2] || '../sims-v1.1/deck-search.json'; const N = +(process.argv[3] || 1000);
const D = JSON.parse(fs.readFileSync(src)).decks; const H = ['candle', 'fold', 'tidewrack'];
const TOPK = +(process.argv[4] || 99); const by = {}; for (const h of H) by[h] = D.filter((d) => d.house === h).sort((a, b) => b.score - a.score).slice(0, TOPK).map((d) => d.deck);
const pairs = [['candle', 'fold'], ['fold', 'tidewrack'], ['tidewrack', 'candle']]; const jobs = [], own = [];
pairs.forEach(([a, b], i) => { for (let k = 0; k < N; k += 25) { const flip = (k / 25) & 1; const da = by[a][(k / 25) % by[a].length], db = by[b][((k / 25) * 7 + 3) % by[b].length];
  const [x, y, dx, dy] = flip ? [b, a, db, da] : [a, b, da, db]; jobs.push({ a: x, b: y, deckA: dx, deckB: dy, pa: { kind: 'smart' }, pb: { kind: 'smart' }, n: 25, seed0: 41_000_000 + i * 1e6 + k }); own.push([i, flip]); } });
const res = await runPool(jobs); const kk = [0, 0, 0], nn = [0, 0, 0];
res.forEach((g, q) => { const [i, flip] = own[q]; for (const x of g) { nn[i]++; if (x.w === flip) kk[i]++; } });
const out = pairs.map(([a, b], i) => `${a}>${b} ${(100 * kk[i] / nn[i]).toFixed(1)} [${wilson(kk[i], nn[i]).map((z) => (100 * z).toFixed(1)).join('-')}]`); console.log('OPT', out.join(' | '));
