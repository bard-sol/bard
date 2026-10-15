#!/usr/bin/env node
/** Auto-fill pair at the locked base HP. Does not retune HP. */
import { simulateAllyPair } from '../lib/trial.js';
import { defaultConfig } from '../lib/config.js';

const runs = Number(process.argv[2] || 300);
const row = await simulateAllyPair(runs, ['hob', 'wren']);
const inRange = row.killRate >= 0.15 && row.killRate <= 0.35;
process.stdout.write(JSON.stringify({
  baseHp: defaultConfig().trial_base_hp,
  ...row,
  inRange
}, null, 2) + '\n');
if (!inRange) process.exitCode = 2;
