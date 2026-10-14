#!/usr/bin/env node
/** Greedy Trial bot. Prints the median damage%. Does not change boss HP. */
import { simulateTrialMedian } from '../lib/trial.js';

const runs = Number(process.argv[2] || 300);
const report = await simulateTrialMedian(runs);
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
