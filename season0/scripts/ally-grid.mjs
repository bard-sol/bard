#!/usr/bin/env node
/** Every ally pair on every character. Lookahead kills only. HP stays at the config lock. */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';

const script = fileURLToPath(import.meta.url);

if (!isMainThread) {
  const { trialSeed, trialContext, replayTrial, lookaheadMoves } = await import('../lib/trial.js');
  const { ALLY_POOL } = await import('../lib/allies.js');
  const { defaultConfig, seasonStartMs } = await import('../lib/config.js');
  const ids = ALLY_POOL.map((row) => row.entity_id);
  const pairs = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i], ids[j]]);
  }
  const baseHp = defaultConfig().trial_base_hp;
  const comboBonus = defaultConfig().trial_combo_bonus;
  const runs = workerData.runs;
  const rows = [];
  for (const allies of pairs) {
    let kills = 0;
    for (let n = 0; n < runs; n++) {
      const seed = await trialSeed('s0', 'grid-' + String(n).padStart(4, '0'));
      const opts = trialContext({ charId: workerData.charId, chapter: 1, now: seasonStartMs(), inDanger: false });
      opts.baseHp = baseHp;
      opts.comboBonus = comboBonus;
      opts.allies = allies;
      const result = replayTrial(seed, lookaheadMoves(seed, opts), opts);
      if (result.ended === 'boss') kills += 1;
    }
    rows.push({ allies, killRate: kills / runs });
  }
  parentPort.postMessage({ charId: workerData.charId, rows });
} else {
  const { CAST } = await import('../lib/cast.js');
  const { defaultConfig } = await import('../lib/config.js');
  const runs = Math.max(1, Number(process.argv[2] || 100));
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
      rows.push(row);
      const flagged = row.rows.filter((item) => item.killRate < 0.15 || item.killRate > 0.35).length;
      process.stderr.write(character.id + ' flagged ' + flagged + '/' + row.rows.length + '\n');
    }
  }
  await Promise.all(Array.from({ length: width }, pump));
  rows.sort((a, b) => CAST.findIndex((row) => row.id === a.charId) - CAST.findIndex((row) => row.id === b.charId));
  process.stdout.write(JSON.stringify({
    runs,
    baseHp: defaultConfig().trial_base_hp,
    comboBonus: defaultConfig().trial_combo_bonus,
    characters: rows
  }) + '\n');
}
