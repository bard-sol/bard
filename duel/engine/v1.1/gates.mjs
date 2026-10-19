import fs from 'fs';
import { runPool, chunks, wilson, H } from './sim.mjs';
const N = +(process.argv[2] || 1000); const tag = process.argv[3] || 'run';
const smart = { kind: 'smart' }, naive = { kind: 'naive' }, ai = { kind: 'smart', slip: +(process.env.SLIP || 250), salt: 99 };
const FAV = [['candle', 'fold'], ['fold', 'tidewrack'], ['tidewrack', 'candle']];
const exps = [];
let seed = 7_000_000;
// smart vs smart all ordered pairs (incl. mirrors)
for (const a of H) for (const b of H) exps.push({ name: `ss:${a}-${b}`, spec: { a, b, pa: smart, pb: smart, seed0: (seed += 100000) }, n: N });
for (const h of H) exps.push({ name: `sn:${h}`, spec: { a: h, b: h, pa: smart, pb: naive, seed0: (seed += 100000) }, n: N });
for (const [f, u] of FAV) exps.push({ name: `upset:${u}-vs-${f}`, spec: { a: u, b: f, pa: smart, pb: naive, seed0: (seed += 100000) }, n: N });
for (const [f, u] of FAV) exps.push({ name: `fav_naive:${f}-vs-${u}`, spec: { a: f, b: u, pa: smart, pb: naive, seed0: (seed += 100000) }, n: N });
for (const h of H) { const sd = (seed += 100000); exps.push({ name: `skill_vs_ai:${h}`, spec: { a: h, b: h, pa: smart, pb: ai, seed0: sd }, n: N }); exps.push({ name: `naive_vs_ai:${h}`, spec: { a: h, b: h, pa: naive, pb: ai, seed0: sd }, n: N }); }
for (const [f, u] of FAV) { const sd = (seed += 100000); exps.push({ name: `skill_vs_ai_unfav:${u}-vs-${f}`, spec: { a: u, b: f, pa: smart, pb: ai, seed0: sd }, n: N }); exps.push({ name: `skill_vs_ai_fav:${f}-vs-${u}`, spec: { a: f, b: u, pa: smart, pb: ai, seed0: sd + 50000 }, n: N }); }
const novice = { kind: 'smart', slip: 650, trapAware: false, salt: 5 };
for (const h of H) exps.push({ name: `novice_vs_ai:${h}`, spec: { a: h, b: h, pa: novice, pb: ai, seed0: (seed += 100000) }, n: N });
for (const st of ['aggressive', 'patient']) for (const h of H) exps.push({ name: `stance_${st}_vs_bal:${h}`, spec: { a: h, b: h, pa: { kind: 'smart', stance: st }, pb: smart, seed0: (seed += 100000) }, n: N });
const FILTER = process.env.FILTER ? new RegExp(process.env.FILTER) : null;
const exps2 = exps.filter((e) => !FILTER || FILTER.test(e.name)); exps.length = 0; exps.push(...exps2);
const jobs = []; const owner = [];
const RULES = process.env.RULES ? JSON.parse(process.env.RULES) : {};
exps.forEach((e, i) => { for (const j of chunks({ ...e.spec, rules: RULES }, e.n)) { jobs.push(j); owner.push(i); } });
const t0 = Date.now(); const res = await runPool(jobs);
const agg = exps.map((e) => ({ name: e.name, games: [] })); res.forEach((r, k) => agg[owner[k]].games.push(...r));
const summary = {};
for (const g of agg) { const n = g.games.length, k = g.games.filter((x) => x.w === 0).length, fk = g.games.filter((x) => x.w === x.first).length;
  summary[g.name] = { n, seatA: +(k / n).toFixed(4), ci: wilson(k, n).map((x) => +x.toFixed(4)), firstWins: fk, mm: g.games.reduce((a, x) => a + x.mm, 0), cap: g.games.reduce((a, x) => a + x.cap, 0), reasons: g.games.reduce((a, x) => (a[x.reason] = (a[x.reason] || 0) + 1, a), {}) }; }
fs.mkdirSync('../sims-v1.1', { recursive: true });
fs.writeFileSync(`../sims-v1.1/gates-${tag}.json`, JSON.stringify({ N, RULES, summary, ms: Date.now() - t0 }, null, 1));
fs.writeFileSync(`../sims-v1.1/gates-${tag}-games.json`, JSON.stringify(agg.map((g) => ({ name: g.name, games: g.games.map(({ seed, w, first, reason, v, ta, mm, nAct, pg }) => ({ seed, w, first, reason, v, ta, mm, nAct, pg })) }))));
for (const k in summary) console.log(k.padEnd(34), summary[k].seatA, summary[k].ci, 'mm', summary[k].mm, JSON.stringify(summary[k].reasons));
console.log('sec', (Date.now() - t0) / 1000);
