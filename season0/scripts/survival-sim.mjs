#!/usr/bin/env node
/** Randomized Season 0 fields. Prints who is marked in each chapter and who wins. */
import { simulateSurvivalSeeds } from '../lib/survival.js';

const seeds = Number(process.argv[2] || 500);
const report = await simulateSurvivalSeeds(seeds);
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
