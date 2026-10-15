import fs from 'fs'; import { wilson } from './sim.mjs';
const tag = process.argv[2] || 'final';
const G = JSON.parse(fs.readFileSync(`../sims-v1.3/gates-${tag}-games.json`)); const by = {}; for (const g of G) by[g.name] = g.games;
const pct = (k, n) => `${(100 * k / n).toFixed(1)}% [${wilson(k, n).map((x) => (100 * x).toFixed(1)).join('–')}] n=${n}`;
const out = {}; const L = (k, v) => { out[k] = v; console.log(k.padEnd(44), v); };
const pair = (a, b) => { const x = by[`ss:${a}-${b}`], y = by[`ss:${b}-${a}`]; const k = x.filter((g) => g.w === 0).length + y.filter((g) => g.w === 1).length; return [k, x.length + y.length]; };
L('Candle vs Fold (Candle favoured)', pct(...pair('candle', 'fold')));
L('Fold vs Tidewrack (Fold favoured)', pct(...pair('fold', 'tidewrack')));
L('Tidewrack vs Candle (Tidewrack favoured)', pct(...pair('tidewrack', 'candle')));
for (const h of ['candle', 'fold', 'tidewrack']) { const x = by[`ss:${h}-${h}`]; L(`Mirror ${h} (seat A)`, pct(x.filter((g) => g.w === 0).length, x.length)); }
const ss = Object.keys(by).filter((k) => k.startsWith('ss:')).flatMap((k) => by[k]);
L('First player (all smart-v-smart)', pct(ss.filter((g) => g.w === g.first).length, ss.length));
for (const h of ['candle', 'fold', 'tidewrack']) { const x = by[`ss:${h}-${h}`]; L(`First player, ${h} mirror`, pct(x.filter((g) => g.w === g.first).length, x.length)); }
const sn = ['candle', 'fold', 'tidewrack'].flatMap((h) => by[`sn:${h}`]); L('Smart vs naive (mirrors)', pct(sn.filter((g) => g.w === 0).length, sn.length));
for (const k of Object.keys(by).filter((k) => k.startsWith('upset:'))) L(`Smart unfav vs naive fav ${k.slice(6)}`, pct(by[k].filter((g) => g.w === 0).length, by[k].length));
const sk = ['candle', 'fold', 'tidewrack'].flatMap((h) => by[`skill_vs_ai:${h}`]); L('Skilled(smart) vs AI pilot v1, mirrors', pct(sk.filter((g) => g.w === 0).length, sk.length));
const nv = ['candle', 'fold', 'tidewrack'].flatMap((h) => by[`naive_vs_ai:${h}`]); L('Naive vs AI pilot v1, mirrors', pct(nv.filter((g) => g.w === 0).length, nv.length));
const nov = ['candle', 'fold', 'tidewrack'].flatMap((h) => by[`novice_vs_ai:${h}`] || []); if (nov.length) L('Novice proxy vs AI pilot v1, mirrors', pct(nov.filter((g) => g.w === 0).length, nov.length));
for (const k of Object.keys(by).filter((k) => k.startsWith('skill_vs_ai_') || k.startsWith('stance_'))) L(k, pct(by[k].filter((g) => g.w === 0).length, by[k].length));
// pre-decided: same seed & decks, smart vs naive in seat A against the same AI
let both = 0, bothLose = 0, bothWin = 0, n = 0; for (const h of ['candle', 'fold', 'tidewrack']) { const a = by[`skill_vs_ai:${h}`], b = by[`naive_vs_ai:${h}`]; for (let i = 0; i < a.length; i++) { n++; const sw = a[i].w === 0, nw = b[i].w === 0; if (sw === nw) both++; if (!sw && !nw) bothLose++; if (sw && nw) bothWin++; } }
L('Pre-decided (same result smart or naive)', pct(both, n)); L('  of which unwinnable for both', pct(bothLose, n)); L('  of which won even by naive', pct(bothWin, n));
// match length model on human(seat A) vs AI games
function len(g, think, per) { let t = 10 + 12; for (const x of g.ta) t += x.p === 0 ? Math.min(35, think + per * x.n) : 5; return t; }
const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
for (const [think, per, name] of [[8, 3, 'base (8s + 3s/action, cap 35)'], [12, 4, 'slow (12s + 4s/action)'], [5, 2, 'fast (5s + 2s/action)']]) { const ls = sk.map((g) => len(g, think, per)); L(`Match length ${name}`, `median ${(q(ls, .5) / 60).toFixed(2)} min, p10 ${(q(ls, .1) / 60).toFixed(2)}, p90 ${(q(ls, .9) / 60).toFixed(2)}`); }
const acts = sk.flatMap((g) => g.ta.filter((x) => x.p === 0).map((x) => x.n)); L('Human actions/turn (mean)', (acts.reduce((a, b) => a + b, 0) / acts.length).toFixed(2));
const all = G.flatMap((g) => g.games); L('Replay mismatches (all games)', `${all.reduce((a, g) => a + g.mm, 0)} of ${all.length}`);
const r8 = ss.filter((g) => g.reason === 'verses').length, bh = ss.filter((g) => g.reason === 'board_health').length, sd = ss.filter((g) => g.reason === 'seed').length;
L('Smart-v-smart ends: 8 Verses / Verses@7 / board health / seed', `${(100 * r8 / ss.length).toFixed(1)}% / ${(100 * (ss.length - r8 - bh - sd) / ss.length).toFixed(1)}% / ${(100 * bh / ss.length).toFixed(1)}% / ${(100 * sd / ss.length).toFixed(1)}%`);
const vs = ss.map((g) => Math.max(...g.v)); L('Winner Verses median (smart-v-smart)', q(vs, .5));
fs.writeFileSync(`../sims-v1.3/analysis-${tag}.json`, JSON.stringify(out, null, 1));
