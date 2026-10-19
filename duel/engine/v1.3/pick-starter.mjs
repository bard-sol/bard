// Score candidate searched decks of a House vs the field of searched decks of all 3 Houses; writes ../sims-v1.3/pick-<house>.json
import fs from 'fs'; import { runPool } from './sim.mjs';
const [house, src = '../sims-v1.1/deck-search-final.json', top = 8, n = 300] = process.argv.slice(2);
const D = JSON.parse(fs.readFileSync(src)).decks; const H = ['candle', 'fold', 'tidewrack'];
const field = {}; for (const h of H) field[h] = D.filter((d) => d.house === h).map((d) => d.deck);
const cands = D.filter((d) => d.house === house).sort((a, b) => b.score - a.score).slice(0, +top);
const jobs = [], own = [];
cands.forEach((c, ci) => { for (let k = 0; k < +n; k += 25) { const oh = H[(k / 25) % 3]; const od = field[oh][((k / 25) * 5 + ci) % field[oh].length]; jobs.push({ a: house, b: oh, deckA: c.deck, deckB: od, pa: { kind: 'smart' }, pb: { kind: 'smart' }, n: 25, seed0: 51_000_000 + ci * 1e5 + k }); own.push(ci); } });
const res = await runPool(jobs); const w = cands.map(() => [0, 0]);
res.forEach((g, q) => { for (const x of g) { w[own[q]][1]++; if (x.w === 0) w[own[q]][0]++; } });
const out = cands.map((c, i) => ({ k: c.k, score: +(w[i][0] / w[i][1]).toFixed(3), deck: c.deck })).sort((a, b) => b.score - a.score);
fs.writeFileSync(`../sims-v1.3/pick-${house}.json`, JSON.stringify(out, null, 1)); console.log(house, out.map((o) => o.k + ':' + o.score).join(' '));
