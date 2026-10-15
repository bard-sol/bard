#!/usr/bin/env node
/** Read-only Annotation fire rates. Does not write season state. */
import { FIELD_MAP } from '../lib/annotations.js';
import { simulateAnnotationSeeds } from '../lib/annotation-sim.js';

const seasons = Math.max(1, Number(process.argv[2] || 1000));
const report = await simulateAnnotationSeeds(seasons);
console.log(JSON.stringify({ fieldMap: FIELD_MAP, ...report }, null, 2));
