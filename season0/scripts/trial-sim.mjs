#!/usr/bin/env node
/** Trial v2 tune. Combo bonus first, then boss HP by steps of 5. */
import { tuneTrialV2 } from '../lib/trial.js';

const runs = Number(process.argv[2] || 300);
const tuned = await tuneTrialV2(runs);
process.stdout.write(JSON.stringify(tuned, null, 2) + '\n');
