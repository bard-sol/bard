/**
 * Duel re-sim, rule set v2. The Trial engine is not modified.
 *
 * Run: node season0/sims/duel-sim.mjs
 * Optional: SEEDS=40 FIT_SEEDS=16 node season0/sims/duel-sim.mjs
 *
 * Deck: generics + that hero's 2 signatures. Allies are deferred to S2.
 * The engine auto-fills Hob+Wren unless opts.allies has two ids. Two ids that
 * are not in the ally pool add no cards, and the engine still shuffles with
 * the shared seed. Combo bonus stays 4. No train, no underdog.
 *
 * Boss HP is chosen per chapter so the lookahead median damage is about 60%.
 * The engine's +8%/chapter curve is cancelled by passing a baseHp that makes
 * D1 (and D2) land on that HP. D3 stays at the engine's 0.9 scale. D2 still
 * starts with 10 guard. A kill adds nothing on top of the damage bars.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { CAST } from '../lib/cast.js';
import { defaultConfig, seasonStartMs } from '../lib/config.js';
import { bossMaxHp, botMoves, lookaheadMoves, replayTrial, trialContext, trialSeed } from '../lib/trial.js';

const NO_ALLY = ['__duel_no_ally_a', '__duel_no_ally_b'];
const IDS = CAST.map((character) => character.id);
const SEEDS = Math.max(4, Number(process.env.SEEDS || 40));
const FIT_SEEDS = Math.max(4, Math.min(SEEDS, Number(process.env.FIT_SEEDS || 16)));
const HERE = fileURLToPath(import.meta.url);

function engineBaseForD1(chapter, targetHp) {
  const curve = 100 + 8 * (chapter - 1);
  const guess = Math.max(1, Math.round((targetHp * 100) / curve));
  let best = guess;
  let bestHp = bossMaxHp(chapter, 'D1', guess);
  for (let delta = -6; delta <= 6; delta++) {
    const base = Math.max(1, guess + delta);
    const hp = bossMaxHp(chapter, 'D1', base);
    if (Math.abs(hp - targetHp) < Math.abs(bestHp - targetHp)) {
      best = base;
      bestHp = hp;
    }
  }
  return {
    baseHp: best,
    d1: bestHp,
    d2: bossMaxHp(chapter, 'D2', best),
    d3: bossMaxHp(chapter, 'D3', best)
  };
}

function optsFor(charId, chapter, dayIndex, baseHp) {
  const start = seasonStartMs();
  const chapterLen = defaultConfig().chapter_len_s * 1000;
  const now = start + (chapter - 1) * chapterLen + dayIndex * 86400000;
  const opts = trialContext({ charId, chapter, now, inDanger: false });
  opts.allies = NO_ALLY.slice();
  opts.baseHp = baseHp;
  opts.comboBonus = 4;
  return opts;
}

function playOne(job) {
  const opts = optsFor(job.charId, job.chapter, job.dayIndex, job.baseHp);
  const skills = job.skills || ['greedy', 'look'];
  const out = {
    charId: job.charId,
    chapter: job.chapter,
    dayIndex: job.dayIndex,
    seed: job.seed,
    baseHp: job.baseHp
  };
  if (skills.includes('greedy')) {
    const greedyMoves = botMoves(job.seed, opts);
    const greedy = replayTrial(job.seed, greedyMoves, opts);
    out.variant = greedy.variant;
    out.bossMax = greedy.bossMax;
    out.deckSize = greedy.deckSize;
    out.autoPicked = greedy.autoPicked;
    out.greedy = { dmg: greedy.damagePercent, kill: greedy.ended === 'boss' };
  }
  if (skills.includes('look')) {
    const lookMoves = lookaheadMoves(job.seed, opts);
    const look = replayTrial(job.seed, lookMoves, opts);
    out.variant = look.variant;
    out.bossMax = look.bossMax;
    out.deckSize = look.deckSize;
    out.autoPicked = look.autoPicked;
    out.look = { dmg: look.damagePercent, kill: look.ended === 'boss' };
  }
  if (out.deckSize !== 10) throw new Error('expected a 10-card signature deck, got ' + out.deckSize);
  if (out.autoPicked) throw new Error('engine auto-filled allies');
  const expected = bossMaxHp(job.chapter, out.variant, job.baseHp);
  if (out.bossMax !== expected) throw new Error('boss HP ' + out.bossMax + ' != ' + expected);
  return out;
}

if (!isMainThread) {
  const rows = [];
  for (const job of workerData.jobs) rows.push(playOne(job));
  parentPort.postMessage(rows);
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(rows) {
  const dmg = rows.map((row) => row.dmg).sort((a, b) => a - b);
  const kills = rows.filter((row) => row.kill).length;
  const n = rows.length || 1;
  const reach = {};
  for (const bar of [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95]) {
    reach[bar] = rows.filter((row) => row.dmg >= bar).length / n;
  }
  return {
    n: rows.length,
    min: dmg[0] ?? 0,
    p10: percentile(dmg, 10),
    p25: percentile(dmg, 25),
    median: percentile(dmg, 50),
    p75: percentile(dmg, 75),
    p90: percentile(dmg, 90),
    max: dmg[dmg.length - 1] ?? 0,
    mean: dmg.reduce((sum, value) => sum + value, 0) / n,
    kill: kills / n,
    reach
  };
}

function groupRows(results, skill) {
  return results.filter((row) => row[skill]).map((row) => ({
    ...row[skill],
    chapter: row.chapter,
    variant: row.variant,
    charId: row.charId,
    seed: row.seed,
    bossMax: row.bossMax
  }));
}

function byKey(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const out = {};
  for (const [key, list] of groups) out[key] = summarize(list);
  return out;
}

function runJobs(jobs) {
  const workers = Math.max(1, Math.min(availableParallelism(), 4));
  const chunks = Array.from({ length: workers }, () => []);
  jobs.forEach((job, index) => chunks[index % workers].push(job));
  return Promise.all(chunks.filter((chunk) => chunk.length).map((chunk) => new Promise((resolve, reject) => {
    const worker = new Worker(HERE, { workerData: { jobs: chunk } });
    worker.on('message', resolve);
    worker.on('error', reject);
  }))).then((parts) => parts.flat());
}

function jobsFor(seeds, hpByChapter, skills) {
  const jobs = [];
  for (const seed of seeds) {
    for (let chapter = 1; chapter <= 7; chapter++) {
      const fitted = engineBaseForD1(chapter, hpByChapter[chapter]);
      for (let dayIndex = 0; dayIndex < 3; dayIndex++) {
        for (const charId of IDS) {
          jobs.push({ seed, chapter, dayIndex, charId, baseHp: fitted.baseHp, skills });
        }
      }
    }
  }
  return jobs;
}

function mediansByChapter(results) {
  const out = {};
  for (let chapter = 1; chapter <= 7; chapter++) {
    const rows = groupRows(results.filter((row) => row.chapter === chapter), 'look');
    out[chapter] = summarize(rows).median;
  }
  return out;
}

async function fitChapters(fitSeeds) {
  const state = {};
  for (let chapter = 1; chapter <= 7; chapter++) {
    state[chapter] = { lo: 40, hi: 360, bestHp: 140, bestDist: Infinity, bestMed: null, seen: new Map() };
  }
  const consider = (chapter, hp, med) => {
    const row = state[chapter];
    row.seen.set(hp, med);
    const dist = Math.abs(med - 60);
    if (dist < row.bestDist || (dist === row.bestDist && Math.abs(hp - row.bestHp) < 0)) {
      row.bestDist = dist;
      row.bestHp = hp;
      row.bestMed = med;
    }
  };
  for (let step = 0; step < 9; step++) {
    const targets = {};
    let pending = false;
    for (let chapter = 1; chapter <= 7; chapter++) {
      const row = state[chapter];
      if (row.lo > row.hi) targets[chapter] = row.bestHp;
      else {
        pending = true;
        let hp = Math.round((row.lo + row.hi) / 2);
        if (row.seen.has(hp)) hp = row.lo;
        targets[chapter] = hp;
      }
    }
    if (!pending) break;
    const started = Date.now();
    const results = await runJobs(jobsFor(fitSeeds, targets, ['look']));
    const medians = mediansByChapter(results);
    for (let chapter = 1; chapter <= 7; chapter++) {
      const row = state[chapter];
      if (row.lo > row.hi) continue;
      const hp = targets[chapter];
      const med = medians[chapter];
      consider(chapter, hp, med);
      if (med > 60) row.lo = hp + 1;
      else if (med < 60) row.hi = hp - 1;
      else {
        row.lo = hp + 1;
        row.hi = hp - 1;
      }
      console.log('fit', step, 'ch' + chapter, 'hp', hp, 'median', med, 'best', row.bestHp, 'sec', Math.round((Date.now() - started) / 1000));
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    const targets = {};
    let pending = false;
    for (let chapter = 1; chapter <= 7; chapter++) {
      const row = state[chapter];
      const want = [row.bestHp - 2, row.bestHp - 1, row.bestHp + 1, row.bestHp + 2].find((hp) => hp >= 20 && !row.seen.has(hp));
      if (want) pending = true;
      targets[chapter] = want || row.bestHp;
    }
    if (!pending) break;
    const results = await runJobs(jobsFor(fitSeeds, targets, ['look']));
    const medians = mediansByChapter(results);
    for (let chapter = 1; chapter <= 7; chapter++) {
      if (state[chapter].seen.has(targets[chapter])) continue;
      consider(chapter, targets[chapter], medians[chapter]);
      console.log('neighbor', 'ch' + chapter, 'hp', targets[chapter], 'median', medians[chapter], 'best', state[chapter].bestHp);
    }
  }
  const hp = {};
  for (let chapter = 1; chapter <= 7; chapter++) hp[chapter] = state[chapter].bestHp;
  return { hp, state };
}

function reachAt(summary, bar) {
  return summary.reach[bar];
}

async function main() {
  const seeds = [];
  for (let i = 0; i < SEEDS; i++) seeds.push(await trialSeed('s0', 'duel-v4-' + String(i).padStart(4, '0')));
  const fitSeeds = seeds.slice(0, FIT_SEEDS);
  const started = Date.now();
  const fitted = await fitChapters(fitSeeds);
  console.log('fitted HP', JSON.stringify(fitted.hp));
  const results = await runJobs(jobsFor(seeds, fitted.hp, ['greedy', 'look']));
  const lookRows = groupRows(results, 'look');
  const greedyRows = groupRows(results, 'greedy');
  const engines = {};
  for (let chapter = 1; chapter <= 7; chapter++) engines[chapter] = engineBaseForD1(chapter, fitted.hp[chapter]);
  const byChapterLook = byKey(lookRows, (row) => row.chapter);
  const byChapterGreedy = byKey(greedyRows, (row) => row.chapter);
  const rates = {};
  for (let chapter = 1; chapter <= 7; chapter++) {
    const look = byChapterLook[chapter];
    const greedy = byChapterGreedy[chapter];
    const engine = engines[chapter];
    rates[chapter] = {
      hp: engine.d1,
      requestedHp: fitted.hp[chapter],
      d2: engine.d2,
      d3: engine.d3,
      baseHp: engine.baseHp,
      fitMedian: fitted.state[chapter].bestMed,
      lookMedian: look.median,
      greedyMedian: greedy.median,
      look40: reachAt(look, 40),
      look50: reachAt(look, 50),
      look55: reachAt(look, 55),
      look65: reachAt(look, 65),
      greedy40: reachAt(greedy, 40),
      greedy50: reachAt(greedy, 50),
      greedy55: reachAt(greedy, 55),
      greedy65: reachAt(greedy, 65),
      lookKill: look.kill,
      greedyKill: greedy.kill
    };
  }
  const report = {
    ruleSet: 'v2',
    seeds: SEEDS,
    fitSeeds: FIT_SEEDS,
    runsPerSkill: lookRows.length,
    seconds: Math.round((Date.now() - started) / 1000),
    deck: '8 generics + 2 signatures, no allies',
    comboBonus: 4,
    sharedSeed: true,
    target: 'lookahead median damage about 60% in every chapter',
    rewards: '+1 at 50% damage, +2 at 65%. A kill adds nothing extra. Twist 12 uses 40/55.',
    engineNotes: 'D1 and D2 share the fitted HP. D2 still starts with 10 guard. D3 uses the engine scale of 0.9, so its HP is about 90% of the fitted HP. The +8%/chapter curve is cancelled through baseHp and is not removed from the engine.',
    skills: { lookahead: 'good (beam 20, depth 16)', greedy: 'setup then best attack' },
    fittedHp: fitted.hp,
    ratesForScoreSim: { byChapter: rates },
    byChapter: {
      lookahead: Object.fromEntries(Object.entries(byChapterLook).map(([chapter, summary]) => ['ch' + chapter, summary])),
      greedy: Object.fromEntries(Object.entries(byChapterGreedy).map(([chapter, summary]) => ['ch' + chapter, summary]))
    },
    byHouse: {
      lookahead: byKey(lookRows, (row) => row.charId),
      greedy: byKey(greedyRows, (row) => row.charId)
    },
    byVariant: {
      lookahead: byKey(lookRows, (row) => row.variant),
      greedy: byKey(greedyRows, (row) => row.variant)
    }
  };
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./results/duel.json', import.meta.url), JSON.stringify(report, null, 2));
  const pct = (value) => (100 * value).toFixed(1) + '%';
  console.log('seconds', report.seconds);
  for (let chapter = 1; chapter <= 7; chapter++) {
    const row = rates[chapter];
    console.log(
      'ch' + chapter,
      'HP', row.hp,
      'D3', row.d3,
      'look med', row.lookMedian,
      '≥50', pct(row.look50),
      '≥65', pct(row.look65),
      'greedy ≥50', pct(row.greedy50),
      '≥65', pct(row.greedy65)
    );
  }
}

if (isMainThread) main();
