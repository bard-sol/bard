#!/usr/bin/env node
/**
 * Recompute Annotation fire rates from recorded Season 0 chapter files.
 * Does not run the sim and does not read the live Supabase project.
 *
 *   node season0/scripts/annotation-recheck.mjs [dir]
 *
 * dir defaults to season0/mirror. Each file is a chapter snapshot JSON,
 * or a publish plan whose body is that snapshot.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { recheckRecords } from '../lib/annotations.js';

const dir = process.argv[2] || 'season0/mirror';

async function readSnapshot(file) {
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : (parsed.body || parsed);
  if (!body || body.chapter == null || !body.train_spend) return null;
  return body;
}

async function loadDir(path) {
  let names = [];
  try {
    names = await readdir(path);
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw err;
  }
  const bySeason = {};
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const snap = await readSnapshot(join(path, name));
    if (!snap) continue;
    const season = snap.season || 's0';
    if (!bySeason[season]) bySeason[season] = [];
    bySeason[season].push(snap);
  }
  return bySeason;
}

const report = recheckRecords(await loadDir(dir));
report.dir = dir;
console.log(JSON.stringify(report, null, 2));
