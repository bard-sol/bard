#!/usr/bin/env node
/** Lookahead kill rate for every ally pair. HP stays locked. Prints pairs outside 15–35%. */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';

const script = fileURLToPath(import.meta.url);

if (!isMainThread) {
  const { simulateAllyPair } = await import('../lib/trial.js');
  const row = await simulateAllyPair(workerData.runs, workerData.allies);
  parentPort.postMessage(row);
} else {
  const { ALLY_POOL } = await import('../lib/allies.js');
  const runs = Number(process.argv[2] || 300);
  const ids = ALLY_POOL.map((row) => row.entity_id);
  const pairs = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i], ids[j]]);
  }
  const width = Math.max(1, Math.min(availableParallelism(), 8));
  const rows = [];
  let next = 0;
  async function pump() {
    while (next < pairs.length) {
      const allies = pairs[next++];
      const row = await new Promise((resolve, reject) => {
        const worker = new Worker(script, { workerData: { runs, allies } });
        worker.once('message', resolve);
        worker.once('error', reject);
      });
      rows.push(row);
      const flagged = row.killRate < 0.15 || row.killRate > 0.35;
      process.stderr.write((flagged ? 'FLAG ' : 'ok   ') + row.allies.join('+') + ' kills ' + row.killRate.toFixed(3) + ' median ' + row.median + '\n');
    }
  }
  await Promise.all(Array.from({ length: width }, pump));
  rows.sort((a, b) => a.allies.join().localeCompare(b.allies.join()));
  const flagged = rows.filter((row) => row.killRate < 0.15 || row.killRate > 0.35);
  process.stdout.write(JSON.stringify({ runs, pairs: rows.length, flagged }, null, 2) + '\n');
  if (flagged.length) process.exitCode = 2;
}
