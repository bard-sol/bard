#!/usr/bin/env node
/** Hob + Wren on every character. Locked HP 120 and Combo +4. 300 seeds each. */
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
  const { defaultConfig, seasonStartMs } = await import('../lib/config.js');
  const baseHp = defaultConfig().trial_base_hp;
  const comboBonus = defaultConfig().trial_combo_bonus;
  const greedy = [];
  const lookahead = [];
  let lookaheadKills = 0;
  for (let i = 0; i < workerData.runs; i++) {
    const seed = await trialSeed('s0', 'cast-' + String(i).padStart(4, '0'));
    const opts = trialContext({ charId: workerData.charId, chapter: 1, now: seasonStartMs(), inDanger: false });
    opts.baseHp = baseHp;
    opts.comboBonus = comboBonus;
    const greedyResult = replayTrial(seed, botMoves(seed, opts), opts);
    const lookResult = replayTrial(seed, lookaheadMoves(seed, opts), opts);
    greedy.push(greedyResult.damagePercent);
    lookahead.push(lookResult.damagePercent);
    if (lookResult.ended === 'boss') lookaheadKills += 1;
  }
  parentPort.postMessage({
    charId: workerData.charId,
    greedyMedian: medianOf(greedy),
    lookaheadMedian: medianOf(lookahead),
    lookaheadKills: lookaheadKills / lookahead.length,
    runs: lookahead.length
  });
} else {
  const { CAST } = await import('../lib/cast.js');
  const runs = Math.max(1, Number(process.argv[2] || 300));
  const width = Math.max(1, Math.min(availableParallelism(), 4, CAST.length));
  const rows = [];
  let next = 0;
  async function pump() {
    while (next < CAST.length) {
      const character = CAST[next++];
      const row = await new Promise((resolve, reject) => {
        const worker = new Worker(script, { workerData: { charId: character.id, runs } });
        worker.once('message', resolve);
        worker.once('error', reject);
      });
      row.name = character.name;
      row.gap = row.lookaheadMedian - row.greedyMedian;
      rows.push(row);
      process.stderr.write(
        character.id +
        ' greedy ' + row.greedyMedian +
        ' lookahead ' + row.lookaheadMedian +
        ' gap ' + row.gap +
        ' kills ' + row.lookaheadKills.toFixed(3) + '\n'
      );
    }
  }
  await Promise.all(Array.from({ length: width }, pump));
  rows.sort((a, b) => CAST.findIndex((row) => row.id === a.charId) - CAST.findIndex((row) => row.id === b.charId));
  process.stdout.write(JSON.stringify({
    runs,
    baseHp: 120,
    comboBonus: 4,
    allies: ['hob', 'wren'],
    rows
  }, null, 2) + '\n');
}
