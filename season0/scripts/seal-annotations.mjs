#!/usr/bin/env node
/**
 * Build Season 0 Annotation seals locally.
 *
 * Reads the six texts from ANNOTATION_TEXTS (JSON object keyed A1–A6)
 * or from season0/.secrets/annotation-texts.json.
 * Writes salts and texts to season0/.secrets/annotations.json (gitignored).
 * Writes only {id, kind:'seal', commit} to season0/data/annotation-seals.js.
 *
 * Re-running rotates salts. Do that only before the memo transaction is posted.
 * This script never prints salts or annotation text.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotationCommit, canonicalAnnotationText, sealMemo } from '../lib/annotations.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const secretDir = join(root, '.secrets');
const textFile = join(secretDir, 'annotation-texts.json');
const secretFile = join(secretDir, 'annotations.json');
const outFile = join(root, 'data', 'annotation-seals.js');
const IDS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];

function loadTexts() {
  if (process.env.ANNOTATION_TEXTS) return JSON.parse(process.env.ANNOTATION_TEXTS);
  if (existsSync(textFile)) return JSON.parse(readFileSync(textFile, 'utf8'));
  throw new Error('Set ANNOTATION_TEXTS or create season0/.secrets/annotation-texts.json. Nothing was written.');
}

function freshSalt() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

const texts = loadTexts();
for (const id of IDS) {
  if (typeof texts[id] !== 'string' || !texts[id].trim()) throw new Error('missing text for ' + id);
}

const items = [];
const seals = [];
for (const id of IDS) {
  const salt = freshSalt();
  const text = texts[id].normalize('NFC').replace(/[\r\n]+$/g, '');
  const canonical = canonicalAnnotationText('s0', id, text);
  const commit = await annotationCommit(salt, canonical);
  items.push({ id, text, salt });
  seals.push({ id, kind: 'seal', commit });
}

mkdirSync(secretDir, { recursive: true });
writeFileSync(secretFile, JSON.stringify({ season: 's0', items }, null, 2) + '\n');
const memo = sealMemo('s0', seals);
const body = '/** Public commits only. Salts and annotation text are not in this file. */\n' +
  'export const SEASON_SEALS = ' + JSON.stringify({ season: 's0', kind: 'seal', memo, seals }, null, 2) + ';\n';
writeFileSync(outFile, body);
console.log('Wrote ' + seals.length + ' seals to season0/data/annotation-seals.js');
console.log('Wrote salts to season0/.secrets/annotations.json (gitignored).');
console.log('Memo label is seal. Post this string in the season-open devnet memo:');
console.log(memo);
