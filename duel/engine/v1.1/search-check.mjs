import fs from 'fs';
import { CARDS } from './cards-src.mjs';
import { m32 } from './engine.mjs';
import { runPool, chunks, wilson } from './sim.mjs';
const SRC = process.env.SRC || '../sims-v1.1/deck-search.json'; const D = JSON.parse(fs.readFileSync(SRC)); const H = ['candle', 'fold', 'tidewrack'];
const out = { baseline: {}, bestVsBest: {} };
for (const house of H) { // random legal deck baseline inclusion
  const pool = CARDS.filter((c) => !c.token && !c.champion && (c.house === house || c.house === 'neutral')); let st = 12345; const r = (n) => { const x = m32(st); st = x[1]; return x[0] % n; };
  const freq = {}; const T = 5000; for (let t = 0; t < T; t++) { const d = []; while (d.length < 20) { const c = pool[r(pool.length)]; if (d.filter((x) => x === c.id).length < (c.rarity === 'legendary' ? 1 : 2)) d.push(c.id); } for (const id of new Set(d)) freq[id] = (freq[id] || 0) + 1; }
  const v = Object.values(freq).map((x) => x / T); out.baseline[house] = { meanInclusion: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3), poolSize: pool.length };
  const ds = D.decks.filter((d) => d.house === house); const sf = {}; for (const d of ds) for (const id of new Set(d.deck)) sf[id] = (sf[id] || 0) + 1;
  out.perCard = out.perCard || {}; out.perCard[house] = pool.map((c) => { const base = (freq[c.id] || 0) / T, share = (sf[c.id] || 0) / ds.length; return { id: c.id, share: +share.toFixed(3), baseline: +base.toFixed(3), over: +(share - base).toFixed(3), flag: share - base >= 0.15, gateFail: share > 0.8 && share - base >= 0.15 }; }).sort((a, b) => b.over - a.over);
}
const best = {}; for (const h of H) best[h] = D.decks.filter((d) => d.house === h).sort((a, b) => b.score - a.score)[0].deck;
const pairs = [['candle', 'fold'], ['fold', 'tidewrack'], ['tidewrack', 'candle']]; const jobs = []; const own = [];
pairs.forEach(([a, b], i) => { for (const [x, y, flip] of [[a, b, 0], [b, a, 1]]) for (const j of chunks({ a: x, b: y, deckA: best[x], deckB: best[y], pa: { kind: 'smart' }, pb: { kind: 'smart' }, seed0: 31_000_000 + i * 100000 + flip * 50000 }, 1000)) { jobs.push(j); own.push([i, flip]); } });
const res = await runPool(jobs); const k = [0, 0, 0], n = [0, 0, 0];
res.forEach((g, q) => { const [i, flip] = own[q]; for (const x of g) { n[i]++; if (x.w === flip) k[i]++; } });
pairs.forEach(([a, b], i) => { out.bestVsBest[`${a} (fav) vs ${b}`] = { rate: +(k[i] / n[i]).toFixed(4), ci: wilson(k[i], n[i]).map((x) => +x.toFixed(4)), n: n[i] }; });
out.bestDecks = best;
for (const h of H) { console.log(h, out.perCard[h].filter((c) => c.flag).map((c) => `${c.id} ${c.share}/${c.baseline}`).join(', ') || 'no flags'); }
fs.writeFileSync(SRC.replace('.json', '-check.json'), JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1));
