// Deck search gate: K independent hill-climbs per House; each evaluates a deck vs the 3 starter decks
// (smart vs smart, common random seeds). Reports how often each card appears in the final best decks.
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os'; import fs from 'fs';
import { CARDS, STARTERS } from './cards-src.mjs';
import { m32, validateDeck } from './engine.mjs';
import { makeSmart } from './pilots.mjs';
import { playMatch } from './play.mjs';
const H = ['candle', 'fold', 'tidewrack'];
function evalDeck(house, deck, games, seed0) { let w = 0, n = 0; for (const opp of H) for (let i = 0; i < games; i++) { const seed = seed0 + i * 7 + H.indexOf(opp) * 100003; const r = playMatch({ houseA: house, deckA: deck, houseB: opp, deckB: STARTERS[opp], seed }, [makeSmart(), makeSmart()]); n++; if (r.winner === 0) w++; } return w / n; }
function search({ house, k, iters, games }) {
  let st = (0xC0FFEE + k * 7919 + H.indexOf(house) * 104729) | 0; const r = (n) => { const x = m32(st); st = x[1]; return x[0] % n; };
  const pool = CARDS.filter((c) => !c.token && !c.champion && (c.house === house || c.house === 'neutral'));
  const lim = (c) => (c.rarity === 'legendary' ? 1 : 2);
  const rand = () => { const d = []; while (d.length < 20) { const c = pool[r(pool.length)]; if (d.filter((x) => x === c.id).length < lim(c)) d.push(c.id); } return d; };
  let cur = rand(), best = evalDeck(house, cur, games, 900000 + k);
  for (let it = 0; it < iters; it++) {
    const cand = cur.slice(); const nSwap = 1 + r(2);
    for (let s = 0; s < nSwap; s++) { for (let t = 0; t < 50; t++) { const i = r(20); const c = pool[r(pool.length)]; const tmp = cand.slice(); tmp[i] = c.id; if (!validateDeck(house, tmp)) { cand[i] = c.id; break; } } }
    const v = evalDeck(house, cand, games, 900000 + k + (it + 1) * 31);
    const vcur = evalDeck(house, cur, games, 900000 + k + (it + 1) * 31); // re-evaluate on the same seeds (paired)
    if (v > vcur) { cur = cand; best = v; } else best = vcur;
  }
  const fin = evalDeck(house, cur, games * 2, 5000000 + k);
  return { house, k, deck: cur.slice().sort(), score: fin };
}
if (!isMainThread) parentPort.postMessage(search(workerData));
else {
  const K = +(process.argv[2] || 10), iters = +(process.argv[3] || 30), games = +(process.argv[4] || 40);
  const OUTP = process.env.OUT || '../sims-v1.1/deck-search.json'; const JL = OUTP + '.partial.jsonl';
  const res = fs.existsSync(JL) ? fs.readFileSync(JL, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const jobs = []; for (const house of H) for (let k = 0; k < K; k++) if (!res.some((r) => r.house === house && r.k === k)) jobs.push({ house, k, iters, games }); let next = 0; const nw = Math.max(1, os.cpus().length - 1); const t0 = Date.now();
  await new Promise((resolve) => { let live = 0; const spawn = () => { if (next >= jobs.length) { if (!live) resolve(); return; } const j = jobs[next++]; live++; const w = new Worker(new URL(import.meta.url), { workerData: j }); w.on('message', (m) => { res.push(m); fs.appendFileSync(JL, JSON.stringify(m) + '\n'); }); w.on('error', (e) => { console.error(e); }); w.on('exit', () => { live--; spawn(); }); }; for (let i = 0; i < nw; i++) spawn(); });
  const report = {};
  for (const house of H) {
    const ds = res.filter((x) => x.house === house); const freq = {};
    for (const d of ds) for (const id of new Set(d.deck)) freq[id] = (freq[id] || 0) + 1;
    const top = Object.entries(freq).map(([id, c]) => [id, c / ds.length]).sort((a, b) => b[1] - a[1]);
    report[house] = { decks: ds.length, maxShare: top[0], top: top.slice(0, 8), scores: ds.map((d) => +d.score.toFixed(3)), starterIncluded: null };
    console.log(house, 'max', top[0], 'top', top.slice(0, 6).map(([i, s]) => i + ':' + s.toFixed(2)).join(' '), 'scores', ds.map((d) => d.score.toFixed(2)).join(','));
  }
  fs.writeFileSync(OUTP, JSON.stringify({ K, iters, games, secs: (Date.now() - t0) / 1000, report, decks: res }, null, 1));
  console.log('sec', (Date.now() - t0) / 1000);
}
