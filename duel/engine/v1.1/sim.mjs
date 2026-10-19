// Parallel sim harness. node sim.mjs <experiment> [N]  -> writes ../sims/<experiment>.json
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os'; import fs from 'fs';
import { STARTERS } from './cards-src.mjs';
import { makeSmart, makeNaive } from './pilots.mjs';
import { playMatch } from './play.mjs';
const H = ['candle', 'fold', 'tidewrack'];
function pilot(spec, seed) { if (spec.kind === 'naive') return makeNaive(seed ^ 0x2545F491); return makeSmart({ stance: spec.stance || 'balanced', slip: spec.slip || 0, trapAware: spec.trapAware !== false, salt: spec.salt || 0 }); }
function runJob(j) {
  const out = [];
  for (let i = 0; i < j.n; i++) {
    const seed = (j.seed0 + i) >>> 0;
    const deckA = j.deckA || STARTERS[j.a], deckB = j.deckB || STARTERS[j.b];
    const r = playMatch({ houseA: j.a, deckA, houseB: j.b, deckB, seed, rules: j.rules || {} }, [pilot(j.pa, seed), pilot(j.pb, seed + 1)], { verify: j.verify !== false });
    out.push({ seed, w: r.winner, first: r.first, reason: r.reason, v: r.verses, ta: r.turnActs, mm: r.mismatch ? 1 : 0, cap: r.capHit ? 1 : 0, nAct: r.actions.length, pg: r.pages });
  }
  return out;
}
if (!isMainThread) { parentPort.postMessage(runJob(workerData)); }
export async function runPool(jobs) {
  const nw = Math.max(1, os.cpus().length - 1); const results = new Array(jobs.length); let next = 0;
  await new Promise((resolve, reject) => {
    let live = 0; const spawn = () => { if (next >= jobs.length) { if (live === 0) resolve(); return; } const k = next++; live++;
      const w = new Worker(new URL(import.meta.url), { workerData: jobs[k] }); w.on('message', (m) => { results[k] = m; }); w.on('error', reject); w.on('exit', () => { live--; spawn(); }); };
    for (let i = 0; i < nw; i++) spawn();
  });
  return results;
}
// split a (n games) spec into chunks
export function chunks(spec, n, size = 250) { const js = []; for (let o = 0; o < n; o += size) js.push({ ...spec, n: Math.min(size, n - o), seed0: spec.seed0 + o }); return js; }
export function wilson(k, n) { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; }
export { H, runJob };
