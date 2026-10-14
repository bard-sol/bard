#!/usr/bin/env node
/** Replays one Season 0 elimination with the contribution weights. No network. */
import { simulateSeason } from '../lib/survival.js';

const report = await simulateSeason(process.argv[2] || 's0-survival');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
