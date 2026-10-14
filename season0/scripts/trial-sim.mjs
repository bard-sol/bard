#!/usr/bin/env node
/** Greedy Trial bot. Starts at base HP 80 and adds 5 while the bot is too strong. */
import { tuneTrialBase } from '../lib/trial.js';

const runs = Number(process.argv[2] || 300);
const tuned = await tuneTrialBase(runs);
process.stdout.write(JSON.stringify(tuned, null, 2) + '\n');
