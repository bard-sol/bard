/**
 * Duel re-sim. The Trial engine is not modified.
 *
 * Run: node season0/sims/duel-sim.mjs
 * Optional: SEEDS=40 node season0/sims/duel-sim.mjs
 *
 * Deck: generics + that hero's 2 signatures. Allies are deferred to S2.
 * The engine auto-fills Hob+Wren unless opts.allies has two ids. Two ids that
 * are not in the ally pool add no cards (cardsForAllies skips unknown ids),
 * and the engine still shuffles with the shared seed. That is the signature-only
 * deck. HP stays 115. Combo bonus stays 4. No train, no underdog.
 *
 * One seed is shared by every House and both skills. Kill awards +2 and a
 * non-kill at the damage bar awards +1. They do not stack (brief: up to +2).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { CAST } from '../lib/cast.js';
import { defaultConfig, seasonStartMs } from '../lib/config.js';
import { botMoves, lookaheadMoves, replayTrial, trialContext, trialSeed } from '../lib/trial.js';

const NO_ALLY = ['__duel_no_ally_a', '__duel_no_ally_b'];
const IDS = CAST.map((character) => character.id);
const SEEDS = Math.max(4, Number(process.env.SEEDS || 40));
const HERE = fileURLToPath(import.meta.url);

function optsFor(charId, chapter, dayIndex) {
  const start = seasonStartMs();
  const chapterLen = defaultConfig().chapter_len_s * 1000;
  const now = start + (chapter - 1) * chapterLen + dayIndex * 86400000;
  const opts = trialContext({ charId, chapter, now, inDanger: false });
  opts.allies = NO_ALLY.slice();
  opts.baseHp = 115;
  opts.comboBonus = 4;
  return opts;
}

function playOne(seed, charId, chapter, dayIndex) {
  const opts = optsFor(charId, chapter, dayIndex);
  const greedyMoves = botMoves(seed, opts);
  const greedy = replayTrial(seed, greedyMoves, opts);
  const lookMoves = lookaheadMoves(seed, opts);
  const look = replayTrial(seed, lookMoves, opts);
  if (greedy.deckSize !== 10 || look.deckSize !== 10) {
    throw new Error('expected a 10-card signature deck, got ' + greedy.deckSize);
  }
  if (greedy.autoPicked || (greedy.allies || []).some((id) => NO_ALLY.indexOf(id) < 0)) {
    throw new Error('engine auto-filled allies');
  }
  return {
    charId,
    chapter,
    variant: greedy.variant,
    bossMax: greedy.bossMax,
    seed,
    greedy: { dmg: greedy.damagePercent, kill: greedy.ended === 'boss' },
    look: { dmg: look.damagePercent, kill: look.ended === 'boss' }
  };
}

if (!isMainThread) {
  const rows = [];
  for (const job of workerData.jobs) rows.push(playOne(job.seed, job.charId, job.chapter, job.dayIndex));
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

function award(rows, bar, plusTwo) {
  let plus1 = 0;
  let plus2 = 0;
  for (const row of rows) {
    const high = plusTwo === 'kill' ? row.kill : row.dmg >= plusTwo;
    if (high) plus2 += 1;
    else if (row.dmg >= bar) plus1 += 1;
  }
  const n = rows.length || 1;
  return {
    exactlyPlus1: plus1 / n,
    plus2: plus2 / n,
    reachBar: rows.filter((row) => row.dmg >= bar).length / n
  };
}

function closestBar(summary, bandLow, bandHigh, target) {
  let best = null;
  for (const [bar, rate] of Object.entries(summary.reach)) {
    const value = Number(bar);
    const inside = rate >= bandLow && rate <= bandHigh;
    const distance = Math.abs(rate - target);
    if (!best || (inside && !best.inside) || (inside === best.inside && distance < best.distance)) {
      best = { bar: value, rate, inside, distance };
    }
  }
  return best;
}

function groupRows(results, skill) {
  return results.map((row) => ({ ...row[skill], chapter: row.chapter, variant: row.variant, charId: row.charId, seed: row.seed }));
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

function sharedSeedSpread(results) {
  const groups = new Map();
  for (const row of results) {
    const key = row.chapter + '|' + row.variant + '|' + row.seed;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row.look.dmg);
  }
  let allClear = 0;
  let allKill = 0;
  let spreadSum = 0;
  for (const list of groups.values()) {
    if (list.every((dmg) => dmg >= 60)) allClear += 1;
    const mean = list.reduce((sum, dmg) => sum + dmg, 0) / list.length;
    const variance = list.reduce((sum, dmg) => sum + (dmg - mean) ** 2, 0) / list.length;
    spreadSum += Math.sqrt(variance);
  }
  const n = groups.size || 1;
  return {
    days: groups.size,
    allHousesReach60: allClear / n,
    meanCrossHouseStd: spreadSum / n,
    allKill
  };
}

function recommend(lookRows, lookSummary) {
  const plus1 = closestBar(lookSummary, 0.5, 0.6, 0.55);
  const plus2Bar = closestBar(lookSummary, 0.15, 0.25, 0.2);
  const killInside = lookSummary.kill >= 0.15 && lookSummary.kill <= 0.25;
  const plus2 = killInside ? { mode: 'kill', rate: lookSummary.kill } : { mode: 'damage', bar: plus2Bar.bar, rate: plus2Bar.rate };
  const proposed = award(lookRows, 60, 'kill');
  const picked = award(lookRows, plus1.bar, plus2.mode === 'kill' ? 'kill' : plus2.bar);
  return {
    note: "Bands 50–60% earn +1 and 15–25% earn +2 are Gameplay's suggestion, not a measured result. 'Earn +1' is read as reaching the damage bar (Gameplay's own '~55% reach 60%'), including players who also earn +2. Exclusive +1 is reported beside it. +2 does not stack on +1.",
    proposed60AndKill: proposed,
    recommended: {
      plus1Bar: plus1.bar,
      plus1Reach: plus1.rate,
      plus1InsideSuggestion: plus1.inside,
      plus2,
      plus2InsideSuggestion: plus2.mode === 'kill' ? killInside : plus2Bar.inside,
      payout: picked
    }
  };
}

async function main() {
  const seeds = [];
  for (let i = 0; i < SEEDS; i++) seeds.push(await trialSeed('s0', 'duel-v4-' + String(i).padStart(4, '0')));
  const jobs = [];
  for (const seed of seeds) {
    for (let chapter = 1; chapter <= 7; chapter++) {
      for (let dayIndex = 0; dayIndex < 3; dayIndex++) {
        for (const charId of IDS) jobs.push({ seed, chapter, dayIndex, charId });
      }
    }
  }
  const workers = Math.min(availableParallelism(), 4);
  const chunks = Array.from({ length: workers }, () => []);
  jobs.forEach((job, index) => chunks[index % workers].push(job));
  const started = Date.now();
  const parts = await Promise.all(chunks.map((chunk) => new Promise((resolve, reject) => {
    const worker = new Worker(HERE, { workerData: { jobs: chunk } });
    worker.on('message', resolve);
    worker.on('error', reject);
  })));
  const results = parts.flat();
  const lookRows = groupRows(results, 'look');
  const greedyRows = groupRows(results, 'greedy');
  const look = summarize(lookRows);
  const greedy = summarize(greedyRows);
  const report = {
    seeds: SEEDS,
    runsPerSkill: results.length,
    seconds: Math.round((Date.now() - started) / 1000),
    deck: '8 generics + 2 signatures, no allies',
    hp: 115,
    comboBonus: 4,
    sharedSeed: true,
    skills: { lookahead: 'good (beam 20, depth 16)', greedy: 'setup then best attack' },
    overall: {
      lookahead: look,
      greedy
    },
    byHouse: {
      lookahead: byKey(lookRows, (row) => row.charId),
      greedy: byKey(greedyRows, (row) => row.charId)
    },
    byChapter: {
      lookahead: byKey(lookRows, (row) => 'ch' + row.chapter),
      greedy: byKey(greedyRows, (row) => 'ch' + row.chapter)
    },
    byVariant: {
      lookahead: byKey(lookRows, (row) => row.variant),
      greedy: byKey(greedyRows, (row) => row.variant)
    },
    sharedSeedSpread: sharedSeedSpread(results),
    recommendation: recommend(lookRows, look),
    byChapterRecommendation: {},
    greedyAtRecommendation: null
  };
  for (const [chapter, summary] of Object.entries(report.byChapter.lookahead)) {
    const rows = lookRows.filter((row) => 'ch' + row.chapter === chapter);
    const plus1 = closestBar(summary, 0.5, 0.6, 0.55);
    const plus2Bar = closestBar(summary, 0.15, 0.25, 0.2);
    const killInside = summary.kill >= 0.15 && summary.kill <= 0.25;
    report.byChapterRecommendation[chapter] = {
      median: summary.median,
      reach60: summary.reach[60],
      kill: summary.kill,
      plus1Bar: plus1.bar,
      plus1Reach: plus1.rate,
      plus1Inside: plus1.inside,
      plus2: killInside ? { mode: 'kill', rate: summary.kill } : { mode: 'damage', bar: plus2Bar.bar, rate: plus2Bar.rate, inside: plus2Bar.inside }
    };
  }
  const rec = report.recommendation.recommended;
  report.greedyAtRecommendation = award(greedyRows, rec.plus1Bar, rec.plus2.mode === 'kill' ? 'kill' : rec.plus2.bar);
  report.ratesForScoreSim = {
    lookahead: { reach60: look.reach[60], kill: look.kill, expectedBonus: look.reach[60] + look.kill },
    greedy: { reach60: greedy.reach[60], kill: greedy.kill, expectedBonus: greedy.reach[60] + greedy.kill }
  };
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./results/duel.json', import.meta.url), JSON.stringify(report, null, 2));
  const line = (label, summary) => {
    const pct = (value) => (100 * value).toFixed(1) + '%';
    return [
      label.padEnd(16),
      'med ' + String(summary.median).padStart(3),
      'p25 ' + String(summary.p25).padStart(3),
      'p75 ' + String(summary.p75).padStart(3),
      '≥60 ' + pct(summary.reach[60]).padStart(6),
      'kill ' + pct(summary.kill).padStart(6)
    ].join('  ');
  };
  console.log('runs', results.length, 'seconds', report.seconds);
  console.log(line('lookahead', look));
  console.log(line('greedy', greedy));
  for (const id of IDS) console.log(line(id, report.byHouse.lookahead[id]));
  console.log(JSON.stringify(report.recommendation.recommended));
  console.log(JSON.stringify(report.ratesForScoreSim));
}

if (isMainThread) main();
