#!/usr/bin/env node
/** Random ally pairs across the cast, at locked HP and Combo +4. Overall only. */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';

const script = fileURLToPath(import.meta.url);

function medianOf(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const count = sorted.length;
  if (!count) return 0;
  return count % 2 ? sorted[(count - 1) / 2] : (sorted[count / 2 - 1] + sorted[count / 2]) / 2;
}

if (!isMainThread) {
  const { trialSeed, trialContext, replayTrial, botMoves, lookaheadMoves } = await import('../lib/trial.js');
  const { CAST } = await import('../lib/cast.js');
  const { ALLY_POOL } = await import('../lib/allies.js');
  const { defaultConfig, seasonStartMs } = await import('../lib/config.js');
  const chars = CAST.map((row) => row.id);
  const ids = ALLY_POOL.map((row) => row.entity_id);
  const baseHp = defaultConfig().trial_base_hp;
  const comboBonus = defaultConfig().trial_combo_bonus;
  const greedy = [];
  const lookahead = [];
  let greedyKills = 0;
  let lookaheadKills = 0;
  const seenChars = new Set();
  const seenPairs = new Set();
  for (let i = workerData.start; i < workerData.start + workerData.count; i++) {
    const seed = await trialSeed('s0', 'field-' + String(i).padStart(4, '0'));
    const byte = (offset) => parseInt(seed.slice(offset, offset + 2), 16);
    const charId = chars[byte(0) % chars.length];
    const first = byte(2) % ids.length;
    let second = byte(4) % ids.length;
    if (second === first) second = (second + 1) % ids.length;
    const allies = [ids[first], ids[second]].sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
    seenChars.add(charId);
    seenPairs.add(allies.join('+'));
    const opts = trialContext({ charId, chapter: 1, now: seasonStartMs(), inDanger: false });
    opts.baseHp = baseHp;
    opts.comboBonus = comboBonus;
    opts.allies = allies;
    const greedyResult = replayTrial(seed, botMoves(seed, opts), opts);
    const lookResult = replayTrial(seed, lookaheadMoves(seed, opts), opts);
    greedy.push(greedyResult.damagePercent);
    lookahead.push(lookResult.damagePercent);
    if (greedyResult.ended === 'boss') greedyKills += 1;
    if (lookResult.ended === 'boss') lookaheadKills += 1;
  }
  parentPort.postMessage({
    greedy,
    lookahead,
    greedyKills,
    lookaheadKills,
    chars: [...seenChars],
    pairs: [...seenPairs]
  });
} else {
  const runs = Math.max(300, Number(process.argv[2] || 300));
  const width = Math.max(1, Math.min(availableParallelism(), 8, runs));
  const chunk = Math.ceil(runs / width);
  const parts = [];
  for (let start = 0; start < runs; start += chunk) {
    parts.push(new Promise((resolve, reject) => {
      const worker = new Worker(script, { workerData: { start, count: Math.min(chunk, runs - start) } });
      worker.once('message', resolve);
      worker.once('error', reject);
    }));
  }
  const rows = await Promise.all(parts);
  const greedy = rows.flatMap((row) => row.greedy);
  const lookahead = rows.flatMap((row) => row.lookahead);
  const greedyMedian = medianOf(greedy);
  const lookaheadMedian = medianOf(lookahead);
  const greedyKills = rows.reduce((sum, row) => sum + row.greedyKills, 0);
  const lookaheadKills = rows.reduce((sum, row) => sum + row.lookaheadKills, 0);
  const report = {
    runs: greedy.length,
    characters: new Set(rows.flatMap((row) => row.chars)).size,
    pairs: new Set(rows.flatMap((row) => row.pairs)).size,
    baseHp: 120,
    comboBonus: 4,
    greedyMedian,
    greedyKills: greedyKills / greedy.length,
    lookaheadMedian,
    lookaheadKills: lookaheadKills / lookahead.length,
    gap: lookaheadMedian - greedyMedian
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
