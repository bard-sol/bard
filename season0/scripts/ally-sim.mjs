#!/usr/bin/env node
/** 12-card ally deck. Combo stays +4. HP starts at 105 and rises by 5 while lookahead kills exceed 35% or the greedy median is still above 70. */
import { tuneAllyDeck } from '../lib/trial.js';

const runs = Number(process.argv[2] || 300);
const tuned = await tuneAllyDeck(runs);
process.stdout.write(JSON.stringify(tuned, null, 2) + '\n');
