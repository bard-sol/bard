import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bardAvatarSrc, bardMood, bardNightMood } from '../ui/bard.js';

test('bard narration uses the four canon faces', () => {
  assert.equal(bardMood({ phase: 'P0' }), 'calm');
  assert.equal(bardMood({ phase: 'P1' }), 'calm');
  assert.equal(bardMood({ phase: 'announced' }), 'calm');
  assert.equal(bardMood({ phase: 'P7', chapterNight: true }), 'smug');
  assert.equal(bardMood({ phase: 'P2' }), 'ominous');
  assert.equal(bardMood({ phase: 'P3' }), 'ominous');
  assert.equal(bardMood({ phase: 'P4' }), 'ominous');
  assert.equal(bardMood({ phase: 'P5' }), 'ominous');
  assert.equal(bardMood({ phase: 'P6', marked: 'thorn' }), 'ominous');
  assert.equal(bardMood({ phase: 'P1', voided: true }), 'ominous');
  assert.equal(bardMood({ phase: 'P8', revivalOpen: true, marked: 'thorn' }), 'delighted');
  assert.equal(bardMood({ phase: 'ended' }), 'delighted');
  assert.equal(bardNightMood(0, false), 'ominous');
  assert.equal(bardNightMood(1, false), 'smug');
  assert.equal(bardNightMood(3, false), 'smug');
  assert.equal(bardNightMood(4, false), 'ominous');
  assert.equal(bardNightMood(5, false), 'ominous');
  assert.equal(bardNightMood(6, false), 'delighted');
  assert.equal(bardNightMood(2, true), 'ominous');
  assert.equal(bardAvatarSrc('smug'), '/play/assets/avatars/bard/smug.webp');
  assert.equal(bardAvatarSrc('nope'), '/play/assets/avatars/bard/calm.webp');
  for (const name of ['calm', 'smug', 'ominous', 'delighted']) {
    assert.equal(fs.existsSync('play/assets/avatars/bard/' + name + '.webp'), true);
  }
  for (const path of [
    'play/assets/hero/bard.webp',
    'play/assets/avatars/bard.webp',
    'play/assets/portraits/bard.webp',
    'play/assets/emotions/bard-sheet.webp'
  ]) {
    assert.equal(fs.existsSync(path), true);
  }
});
