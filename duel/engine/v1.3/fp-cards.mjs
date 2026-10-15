// Which cards raise the first player's win rate? Random pairs of searched decks; per card, P1 WR when P1's deck has it vs not.
import fs from 'fs'; import { runPool } from './sim.mjs';
const src = process.argv[2] || '../sims-v1.1/deck-search-final.json'; const N = +(process.argv[3] || 4000);
const D = JSON.parse(fs.readFileSync(src)).decks; const jobs = [], meta = [];
for (let k = 0; k < N; k += 20) { const i = (k / 20 * 7) % D.length, j = (k / 20 * 13 + 5) % D.length; jobs.push({ a: D[i].house, b: D[j].house, deckA: D[i].deck, deckB: D[j].deck, pa: { kind: 'smart' }, pb: { kind: 'smart' }, n: 20, seed0: 61_000_000 + k }); meta.push([D[i].deck, D[j].deck]); }
const res = await runPool(jobs); const st = {};
res.forEach((g, q) => { for (const x of g) { const p1deck = new Set(meta[q][x.first]); const win = x.w === x.first ? 1 : 0; for (const id of new Set([...meta[q][0], ...meta[q][1]])) { st[id] = st[id] || [0, 0, 0, 0]; if (p1deck.has(id)) { st[id][0] += win; st[id][1]++; } else { st[id][2] += win; st[id][3]++; } } } });
const rows = Object.entries(st).filter(([, v]) => v[1] > 200 && v[3] > 200).map(([id, v]) => [id, v[0] / v[1], v[2] / v[3]]).sort((a, b) => (b[1] - b[2]) - (a[1] - a[2]));
const tot = res.flat(); console.log('overall first', (tot.filter((x) => x.w === x.first).length / tot.length).toFixed(3), tot.length);
for (const r of rows) console.log(r[0].padEnd(14), 'with', r[1].toFixed(3), 'without', r[2].toFixed(3), 'delta', (r[1] - r[2]).toFixed(3));
