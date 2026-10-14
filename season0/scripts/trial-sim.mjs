#!/usr/bin/env node
/** Finisher tune. Lookahead is a width-20 beam over one full turn. */
import { tuneFinisher } from '../lib/trial.js';

const runs = Number(process.argv[2] || 300);
const tuned = await tuneFinisher(runs);
process.stdout.write(JSON.stringify(tuned, null, 2) + '\n');
