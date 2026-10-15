import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { headerCopy, screenState, PREDICT_NOTE, RELIC_NOTE, ELIGIBILITY_NOTE, voidCardLine } from '../ui/view.js';

test('P4 counts the window down and never names a snapshot time', () => {
  const screen = screenState({ now: Date.now(), query: { phase: 'P4', chapter: '3', elapsed: '0' } });
  const copy = headerCopy(screen);
  assert.match(copy.title, /^The Reaper walks · window closes in /);
  assert.match(copy.footnote, /hidden snapshot/);
  assert.equal(copy.title.includes('came at'), false);
  assert.equal(screen.previewSnapshot, null);
});

test('P0 is the 72h buy window and picks lock with the shortlist', () => {
  const pre = screenState({ now: Date.now(), query: { phase: 'P0', elapsed: '0' } });
  assert.match(headerCopy(pre).title, /buy now to be eligible/);
  const open = screenState({ now: Date.now(), query: { phase: 'P1', chapter: '2', elapsed: '0' } });
  assert.equal(open.picksOpen, true);
  assert.match(headerCopy(open).title, /picks lock in/);
  const locked = screenState({ now: Date.now(), query: { phase: 'P2', chapter: '2', elapsed: '0' } });
  assert.equal(locked.picksOpen, false);
  assert.equal(locked.danger.length, 2);
});

test('a void keeps the info reason and clears the mark', () => {
  const screen = screenState({ now: Date.now(), query: { phase: 'P4', chapter: '3', void: 'exploit', elapsed: '0' } });
  assert.equal(screen.voided, true);
  assert.equal(screen.marked, null);
  assert.match(screen.voidCopy, /critical exploit/);
  assert.match(headerCopy(screen).title, /voided/);
});

test('revival, relics and eligibility copy are the Season 0 rules', () => {
  const screen = screenState({ now: Date.now(), query: { phase: 'P8', chapter: '3', marked: 'thorn', elapsed: '0' } });
  assert.equal(screen.revivalOpen, true);
  assert.match(headerCopy(screen).footnote, /100%/);
  assert.match(PREDICT_NOTE, /both the signed time and the server receipt/);
  assert.match(RELIC_NOTE, /just trade/);
  assert.match(RELIC_NOTE, /in this app only/);
  assert.match(ELIGIBILITY_NOTE, /never makes you eligible/);
  assert.equal(voidCardLine('vrf'), 'Voided · randomness failed · stakes returned · Train kept');
  assert.equal(voidCardLine('indexer'), 'Voided · data outage · stakes returned · Train kept');
});

test('the landing page does not link into Season 0', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.equal(html.includes('/play/'), false);
  assert.equal(html.includes('season.html'), false);
});
