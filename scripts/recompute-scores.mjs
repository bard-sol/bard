import { readFile } from 'node:fs/promises';
import { scoreCampaign } from '../scoring.js';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: node scripts/recompute-scores.mjs <url|file>');
  process.exit(2);
}

let body;
if (/^https?:\/\//i.test(arg)) {
  const res = await fetch(arg);
  if (!res.ok) {
    console.error('fetch failed ' + res.status);
    process.exit(1);
  }
  body = await res.json();
} else {
  body = JSON.parse(await readFile(arg, 'utf8'));
}

const again = scoreCampaign(body.inputs);
const published = Array.isArray(body.results) ? body.results : [];
const mismatches = [];
for (const row of published) {
  const found = (again.results || []).find((item) => item.wallet === row.wallet);
  const got = found ? found.score_milli : null;
  if (got !== row.score_milli) {
    mismatches.push(row.wallet + ' published ' + row.score_milli + ' recomputed ' + got);
  }
}
if (mismatches.length) {
  for (const line of mismatches) console.log(line);
  console.error(mismatches.length + ' mismatch');
  process.exit(1);
}
console.log('all ' + published.length + ' scores match');
