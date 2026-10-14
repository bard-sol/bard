import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleApi } from '../worker/handlers.js';
import { sha256Hex } from '../lib/bytes.js';
import { bannerStack } from '../ui/view.js';
import { buildRecap } from '../lib/recap.js';
import {
  A3_RATIO,
  ANNOTATION_IDS,
  CHAMPION_CARRY,
  DEVIATION_CLUE,
  FIELD_MAP,
  SEASON_SEALS,
  a4Holds,
  annotationCommit,
  canonicalAnnotationText,
  evaluateAnnotations,
  scoresWithin,
  sealMemo,
  turnoutLeader,
  verifyAnnotationReveal
} from '../lib/annotations.js';
import { simulateAnnotationSeason } from '../lib/annotation-sim.js';

const PLACEHOLDER = {
  A1: 'c5b824ff47c1734d1cb639fda50449b9cb3a29df94f6e80a143a1ac5b4ac62d9',
  A2: 'd4781aac391c31fde38f4aadf23ba035475f2b9ed4bba65773b7a0f55f3f338f',
  A3: '7029c76ec94fb64d6a7c8b93bb41fa4e9f5853d100f1cf3ccf708f302f7bbd02',
  A4: '064ee064e9725c431086d85eb121aa30e578519aa02597018fc8ebad90b37512',
  A5: 'f734f39a0a4630d0b12d99dc585dc3e13587259e3beec8c21281eef9a9b0ce13',
  A6: '7d1df4edc0cc82e5d70f69fc511add938259a1b0cd62b9f57403ff89d6782a11'
};

function snap(chapter, scores, extra) {
  return {
    chapter,
    scores,
    alive: scores.map((row) => row.id),
    marked: [],
    trainSpend: {},
    revivalBurn: 0,
    holders: {},
    ...extra
  };
}

async function call(path, env) {
  const res = await handleApi(new Request('http://season.local' + path), env || { SEASON_ALLOW_DEMO: '1' });
  return res.json();
}

test('commit is sha256 of the salt hex plus the canonical line', async () => {
  const salt = 'ab'.repeat(32);
  const text = canonicalAnnotationText('s0', 'A9', 'hello\n');
  assert.equal(text, 'BARD|S0|ANN|A9|hello');
  const hash = await annotationCommit(salt, text);
  assert.equal(hash, await sha256Hex(salt + text));
  assert.equal(await verifyAnnotationReveal({ season: 's0', id: 'A9', text: 'hello', salt, commit: hash }), true);
});

test('published seals are generic seal commits, not placeholder hashes or plaintext', () => {
  const src = readFileSync(new URL('../data/annotation-seals.js', import.meta.url), 'utf8');
  assert.equal(src.includes('fourth turn'), false);
  assert.equal(src.includes('old blood'), false);
  assert.equal(SEASON_SEALS.kind, 'seal');
  assert.equal(SEASON_SEALS.seals.length, 6);
  assert.deepEqual(SEASON_SEALS.seals.map((row) => row.id), ANNOTATION_IDS);
  for (const row of SEASON_SEALS.seals) {
    assert.equal(row.kind, 'seal');
    assert.match(row.commit, /^[0-9a-f]{64}$/);
    assert.notEqual(row.commit, PLACEHOLDER[row.id]);
  }
  assert.equal(sealMemo('s0', SEASON_SEALS.seals).startsWith('bard:v1:seal:s0:'), true);
  assert.equal(sealMemo('s0', SEASON_SEALS.seals).includes('annotation'), false);
  assert.match(readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8'), /season0\/\.secrets\//);
  assert.equal(FIELD_MAP.some((row) => row.handoff === 'A6 relic holders' && row.state === 'missing'), true);
});

test('A1 fires on a pre-chapter-4 bar of 50 and ignores later ticks', () => {
  const quiet = evaluateAnnotations({
    revivalTicks: [{ chapter: 3, pct: 49 }, { chapter: 4, pct: 90 }],
    snapshots: [snap(1, [{ id: 'pip', S: 0.2, U: 0.2 }])],
    finale: false
  });
  assert.equal(quiet.fired.A1, undefined);
  const hit = evaluateAnnotations({
    revivalTicks: [{ chapter: 3, pct: 50 }, { chapter: 3, pct: 80 }],
    snapshots: [snap(3, [{ id: 'pip', S: 0.2, U: 0.2 }])],
    finale: false
  });
  assert.equal(hit.fired.A1.chapter, 3);
});

test('A2 uses chapter-1 turnout, breaks ties by lowest id, and waits for the finale', () => {
  const scores = [{ id: 'wick', S: 0.4, U: 0.5 }, { id: 'pip', S: 0.9, U: 0.5 }];
  assert.equal(turnoutLeader(scores), 'pip');
  const early = evaluateAnnotations({
    snapshots: [snap(1, scores)],
    championId: 'wick',
    finale: false
  });
  assert.equal(early.fired.A2, undefined);
  const fired = evaluateAnnotations({
    snapshots: [snap(1, scores), snap(7, [{ id: 'wick', S: 0.4, U: 0.2 }])],
    championId: 'wick',
    finale: true
  });
  assert.equal(fired.fired.A2.chapter, 7);
  const same = evaluateAnnotations({
    snapshots: [snap(1, scores)],
    championId: 'pip',
    finale: true
  });
  assert.equal(same.fired.A2, undefined);
});

test('A3 module uses 1% at any snapshot and the other two readings stay separate', () => {
  assert.equal(A3_RATIO, 0.01);
  const close = snap(1, [{ id: 'a', S: 1, U: 0.1 }, { id: 'b', S: 1.009, U: 0.1 }]);
  const far = snap(2, [{ id: 'a', S: 1, U: 0.1 }, { id: 'b', S: 1.02, U: 0.1 }]);
  assert.equal(scoresWithin(close.scores, close.alive, 0.01), true);
  assert.equal(scoresWithin(far.scores, far.alive, 0.01), false);
  assert.equal(scoresWithin([{ id: 'a', S: 1 }, { id: 'b', S: 1.006 }], ['a', 'b'], 0.005), false);
  const mid = evaluateAnnotations({ snapshots: [close, far], finale: false });
  assert.equal(mid.fired.A3.chapter, 1);
  assert.equal(mid.variants.a3Within1pctAny, true);
  assert.equal(mid.variants.a3Within1pctFinal, false);
  const onlyFinal = evaluateAnnotations({
    snapshots: [far, snap(3, [{ id: 'a', S: 1, U: 0 }, { id: 'b', S: 1.008, U: 0 }])],
    finale: false
  });
  assert.equal(onlyFinal.variants.a3Within1pctFinal, true);
  assert.equal(onlyFinal.variants.a3WithinHalfpctAny, false);
});

test('A4 fires only when the first revived hero survives the next snapshot', () => {
  const base = {
    snapshots: [
      snap(2, [{ id: 'pip', S: 0.1, U: 0.1 }, { id: 'wick', S: 0.4, U: 0.2 }], { marked: ['pip'] }),
      snap(3, [{ id: 'pip', S: 0.3, U: 0.2 }, { id: 'wick', S: 0.4, U: 0.2 }], { marked: ['wick'], doublePage: true })
    ]
  };
  assert.equal(a4Holds({ ...base, revivals: [] }), null);
  assert.equal(a4Holds({ ...base, revivals: [{ afterChapter: 2, heroId: 'pip', success: false }] }), null);
  const lives = evaluateAnnotations({ ...base, revivals: [{ afterChapter: 2, heroId: 'pip', success: true }] });
  assert.equal(lives.fired.A4.heroId, 'pip');
  assert.equal(lives.fired.A4.chapter, 3);
  const falls = evaluateAnnotations({
    snapshots: [
      base.snapshots[0],
      snap(3, [{ id: 'pip', S: 0.1, U: 0.1 }, { id: 'wick', S: 0.4, U: 0.2 }], { marked: ['pip', 'grenna'], doublePage: true })
    ],
    revivals: [{ afterChapter: 2, heroId: 'pip', success: true }]
  });
  assert.equal(falls.fired.A4, undefined);
});

test('A5 compares chapter burn with chapter train, and A6 uses relic holders', () => {
  const burn = evaluateAnnotations({
    snapshots: [snap(2, [{ id: 'pip', S: 0.2, U: 0.2 }], { trainSpend: { pip: 10, wick: 5 }, revivalBurn: 16 })],
    finale: false
  });
  assert.equal(burn.fired.A5.chapter, 2);
  const tied = evaluateAnnotations({
    snapshots: [snap(2, [{ id: 'pip', S: 0.2, U: 0.2 }], { trainSpend: { pip: 10 }, revivalBurn: 10 })],
    finale: false
  });
  assert.equal(tied.fired.A5, undefined);
  const kept = evaluateAnnotations({
    snapshots: [
      snap(1, [{ id: 'pip', S: 0.1, U: 0.1 }], { marked: ['pip'], holders: { pip: 10 } }),
      snap(2, [{ id: 'wick', S: 0.4, U: 0.2 }], { holders: { pip: 9 } })
    ],
    finale: false
  });
  assert.equal(kept.fired.A6.heroId, 'pip');
  const left = evaluateAnnotations({
    snapshots: [
      snap(1, [{ id: 'pip', S: 0.1, U: 0.1 }], { marked: ['pip'], holders: { pip: 10 } }),
      snap(2, [{ id: 'wick', S: 0.4, U: 0.2 }], { holders: { pip: 8 } })
    ],
    finale: false
  });
  assert.equal(left.fired.A6, undefined);
  const saved = evaluateAnnotations({
    snapshots: [
      snap(1, [{ id: 'pip', S: 0.1, U: 0.1 }], { marked: ['pip'], holders: { pip: 10 } }),
      snap(2, [{ id: 'pip', S: 0.2, U: 0.2 }, { id: 'grenna', S: 0.3, U: 0.2 }], { marked: ['grenna'], holders: { pip: 1, grenna: 10 } }),
      snap(3, [{ id: 'pip', S: 0.2, U: 0.2 }], { holders: { grenna: 10 } })
    ],
    revivals: [{ afterChapter: 1, heroId: 'pip', success: true }],
    finale: false
  });
  assert.equal(saved.fired.A6.heroId, 'grenna');
});

test('finale deviations share one cosmetic clue and the champion has no immunity', () => {
  const done = evaluateAnnotations({
    revivalTicks: [{ chapter: 1, pct: 50 }],
    snapshots: [snap(1, [{ id: 'pip', S: 0.2, U: 0.4 }]), snap(7, [{ id: 'pip', S: 0.5, U: 0.4 }])],
    championId: 'pip',
    finale: true
  });
  assert.equal(done.fired.A1.chapter, 1);
  assert.equal(done.deviations.includes('A1'), false);
  assert.equal(done.deviations.length, 5);
  assert.equal(done.clue, DEVIATION_CLUE);
  assert.equal(DEVIATION_CLUE.equalForAll, true);
  assert.equal(DEVIATION_CLUE.affectsScore, false);
  assert.equal(done.championCarry, CHAMPION_CARRY);
  assert.equal(CHAMPION_CARRY.immunity, false);
  assert.equal(CHAMPION_CARRY.cosmetic, 'frontispiece-frame');
  assert.equal(done.affectsScore, false);
});

test('the play banner carries the memo and a verify control', () => {
  const stack = bannerStack({
    phase: 'P7',
    danger: [],
    annotations: [{ id: 'A1', text: 'sample line', memo: 'bard:v1:seal:s0:A1:abc', href: null }]
  });
  const banner = stack.all.find((row) => row.id === 'annotation-A1');
  assert.equal(banner.body, 'sample line');
  assert.equal(banner.sealId, 'A1');
  assert.match(banner.memo, /^bard:v1:seal:/);
  const ended = bannerStack({ phase: 'ended', danger: [], deviations: [{ id: 'A2' }] });
  assert.equal(ended.all.some((row) => row.id === 'frontispiece'), true);
  assert.match(ended.all.find((row) => row.id === 'frontispiece').body, /not immune/);
  assert.match(ended.all.find((row) => row.id === 'deviations').body, /Author margin note/);
});

test('recap can carry an opened annotation without touching the score', () => {
  const recap = buildRecap({ chapter: 2, nowMs: Date.parse('2026-10-16T18:30:00.000Z'), annotations: [{ id: 'A1' }] });
  assert.equal(recap.affectsScore, false);
  assert.deepEqual(recap.annotations, [{ id: 'A1' }]);
});

test('the annotations route publishes hashes and withholds text until an open id is asked for', async () => {
  const bare = await call('/api/season/annotations', {});
  assert.equal(bare.ok, true);
  assert.equal(bare.kind, 'seal');
  assert.equal(bare.opened.length, 0);
  assert.equal(bare.deviations.length, 0);
  assert.equal(bare.championCarry.immunity, false);
  const leaked = await call('/api/season/annotations?open=A1', {});
  assert.equal(leaked.opened.length, 0);
  const demo = await call('/api/season/annotations?open=A1');
  if (demo.opened.length) {
    const row = demo.opened[0];
    assert.equal(await verifyAnnotationReveal({ season: 's0', id: row.id, text: row.text, salt: row.salt, commit: row.commit }), true);
    const finale = await call('/api/season/annotations?open=A1&finale=1');
    assert.equal(finale.deviations.length, 5);
    assert.equal(new Set(finale.deviations.map((row) => row.clue.id)).size, 1);
  }
});

test('a read-only season sim names a champion and keeps A3 on the 1% predicate', async () => {
  const season = await simulateAnnotationSeason(4);
  assert.equal(typeof season.championId, 'string');
  assert.equal(season.affectsScore, false);
  assert.equal(season.variants.a3Within1pctAny, !!season.fired.A3);
});
