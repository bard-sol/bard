import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../worker/handlers.js';
import { rememberOnChain, resetMemory } from '../worker/store.js';
import { sha256Hex } from '../lib/bytes.js';
import {
  TRIAL_CARDS,
  TRIAL_LIMITS,
  accuraciesInWindow,
  encounterFromSeed,
  meanAccuracy,
  replayTrial,
  shareGrid,
  trialSeed,
  trialTimeOk
} from '../lib/trial.js';
import { openChest, publishedOdds } from '../lib/chest.js';
import { buildRecap, recapOpen } from '../lib/recap.js';
import { allowPush } from '../lib/notify.js';
import { advanceStreak } from '../lib/morale.js';
import { earlyBuyCopy, seasonLegacy } from '../lib/legacy.js';
import { scoreCast } from '../lib/score.js';
import { cardUpgradeOffer } from '../lib/trial.js';

const env = { SEASON_ALLOW_DEMO: '1', SEASON_DEV_SKIP_TURNSTILE: '1' };
const day = '2026-10-16T12:00:00.000Z';
const dayMs = Date.parse(day);

async function call(path, body, extraEnv) {
  const res = await handleApi(new Request('http://season.local' + path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  }), extraEnv || env);
  return { status: res.status, body: await res.json() };
}

test('trial seed, hand, caps, and deterministic replay', async () => {
  assert.equal(TRIAL_CARDS.length, 24);
  assert.deepEqual(TRIAL_LIMITS, { turns: 8, moves: 30, seconds: 60, energy: 3, bossHp: 100 });
  const seed = await trialSeed('s0', '2026-10-16');
  assert.equal(seed, await sha256Hex('s0|2026-10-16|trial'));
  assert.notEqual(seed, await trialSeed('s0', '2026-10-17'));
  const encounter = encounterFromSeed(seed);
  assert.equal(encounter.hand.length, 3);
  assert.equal(encounter.intents.length, 8);
  const moves = [{ type: 'play', card: 0 }, { type: 'end' }];
  const first = replayTrial(seed, moves);
  const second = replayTrial(seed, moves);
  assert.equal(first.ok, true);
  assert.equal(first.damage, second.damage);
  assert.equal(first.accuracy, Math.min(1, first.damage / 100));
  const card = encounter.hand[0];
  const expected = encounter.intents[0] === 'guard' ? Math.floor(card.power / 2) : card.power;
  assert.equal(first.damage, expected);
  assert.match(first.grid, /^Bard Trial \d+%\n/);
  assert.equal(shareGrid([['👊']], 1), 'Bard Trial 100%\n👊');
  assert.equal(trialTimeOk(60000), true);
  assert.equal(trialTimeOk(60001), false);
  assert.equal(replayTrial(seed, Array.from({ length: 31 }, () => ({ type: 'end' }))).reason, 'move_cap');
  const eight = Array.from({ length: 8 }, () => ({ type: 'end' }));
  assert.equal(replayTrial(seed, eight.concat([{ type: 'play', card: 0 }])).reason, 'turn_cap');
  assert.equal(replayTrial(seed, [{ type: 'play', card: 0 }, { type: 'play', card: 0 }, { type: 'play', card: 0 }, { type: 'play', card: 0 }]).reason, 'energy');
});

test('one counted trial per day, practice excluded, K fills missed days with 0', async () => {
  resetMemory();
  const start = await call('/api/season/trial/start', { wallet: 'W', now: dayMs });
  assert.equal(start.body.ok, true);
  assert.equal(start.body.hand.length, 3);
  assert.equal(start.body.practice, false);
  const moves = [{ type: 'play', card: 0 }];
  const finish = await call('/api/season/trial/finish', {
    wallet: 'W', day: start.body.day, seed: start.body.seed, moves, elapsedMs: 1200, now: dayMs
  });
  assert.equal(finish.body.ok, true);
  assert.equal(finish.body.counted, true);
  assert.equal(finish.body.streak.streak, 1);
  assert.equal(finish.body.streak.repairPurchasable, false);
  const again = await call('/api/season/trial/finish', {
    wallet: 'W', day: start.body.day, seed: start.body.seed, moves, elapsedMs: 800, now: dayMs
  });
  assert.equal(again.body.counted, false);
  assert.equal(again.body.alreadyCounted, true);
  const practice = await call('/api/season/trial/finish', {
    wallet: 'W', day: start.body.day, seed: start.body.seed, moves, elapsedMs: 800, practice: true, now: dayMs
  });
  assert.equal(practice.body.counted, false);
  const mismatch = await call('/api/season/trial/finish', {
    wallet: 'W2', seed: 'nope', moves, elapsedMs: 10, now: dayMs
  });
  assert.equal(mismatch.body.reason, 'seed_mismatch');
  const slow = await call('/api/season/trial/finish', {
    wallet: 'W3', moves, elapsedMs: 60001, now: dayMs
  });
  assert.equal(slow.body.reason, 'time_cap');
  const values = accuraciesInWindow(Date.parse('2026-10-16T10:00:00.000Z'), Date.parse('2026-10-18T01:00:00.000Z'), {
    '2026-10-16': finish.body.accuracy
  });
  assert.deepEqual(values, [finish.body.accuracy, 0, 0]);
  assert.equal(meanAccuracy(values), finish.body.accuracy / 3);
  const k = await call('/api/season/trial/k', {
    t0: Date.parse('2026-10-16T10:00:00.000Z'),
    snapshot: Date.parse('2026-10-18T01:00:00.000Z'),
    byDay: { '2026-10-16': 1 }
  });
  assert.deepEqual(k.body.days, [1, 0, 0]);
  assert.equal(k.body.k, 1 / 3);
  const scored = scoreCast([
    { id: 'a', twap: 1, supply: 1, trainCredited: 0, wallets: [], dailyAccuracies: [1, 0] }
  ]);
  assert.equal(scored[0].K, 0.5);
});

test('streak advances once per UTC day and repair is not for sale', () => {
  const first = advanceStreak(null, dayMs);
  assert.equal(first.advanced, true);
  assert.equal(first.streak, 1);
  assert.equal(first.repairPurchasable, false);
  const same = advanceStreak(first, dayMs + 1000);
  assert.equal(same.advanced, false);
  assert.equal(same.streak, 1);
  const next = advanceStreak(same, dayMs + 86400000);
  assert.equal(next.streak, 2);
});

test('push stays under 3 and does not count a send without a VAPID key', async () => {
  resetMemory();
  assert.equal(allowPush({ sent: 3 }).reason, 'cap');
  const blocked = await call('/api/season/push/send', { wallet: 'W', now: dayMs });
  assert.equal(blocked.body.reason, 'push_not_configured');
  assert.equal(blocked.body.sent, 0);
  const still = await call('/api/season/push/send', { wallet: 'W', now: dayMs });
  assert.equal(still.body.sent, 0);
  const withKey = { ...env, BARD_VAPID_PRIVATE: 'test-key' };
  for (let i = 1; i <= 3; i++) {
    const sent = await call('/api/season/push/send', { wallet: 'W', now: dayMs }, withKey);
    assert.equal(sent.body.sent, i);
    assert.equal(sent.body.reason, 'push_worker_not_deployed');
  }
  const fourth = await call('/api/season/push/send', { wallet: 'W', now: dayMs }, withKey);
  assert.equal(fourth.body.reason, 'cap');
  const sub = await call('/api/season/push/subscribe', { wallet: 'W', subscription: { endpoint: 'local' } });
  assert.equal(sub.body.capPerDay, 3);
});

test('chests are free, published, pity a rare on the 10th, and never NFTs', async () => {
  const odds = publishedOdds();
  assert.equal(odds.reduce((sum, row) => sum + row.chance, 0), 1);
  assert.equal(odds.every((row) => row.nft === false && row.transferable === false), true);
  const forced = openChest({ rng: () => 0.99, sinceRare: 9, pay: null });
  assert.equal(forced.rarity, 'rare');
  assert.equal(forced.pity, true);
  assert.equal(forced.nft, false);
  assert.equal(forced.transferable, false);
  assert.equal(forced.tradeable, false);
  assert.equal(openChest({ rng: () => 0, sinceRare: 0, pay: 5 }).reason, 'chests_are_free');
  resetMemory();
  const bought = await call('/api/season/chest/open', { wallet: 'W', pay: 1 });
  assert.equal(bought.body.reason, 'chests_are_free');
  const extra = await call('/api/season/chest/open', { wallet: 'W', buy: true });
  assert.equal(extra.body.reason, 'chests_are_free');
  const free = await call('/api/season/chest/open', { wallet: 'W' });
  assert.equal(free.body.ok, true);
  assert.equal(free.body.nft, false);
  const listed = await call('/api/season/chest/odds');
  assert.equal(listed.body.purchasable, false);
  assert.equal(listed.body.pity, 10);
});

test('recap is narration after 22:00 GST and a crowd vote is once per chapter', async () => {
  const before = Date.parse('2026-10-16T17:59:00.000Z');
  const at = Date.parse('2026-10-16T18:00:00.000Z');
  assert.equal(recapOpen(before), false);
  assert.equal(recapOpen(at), true);
  assert.equal(buildRecap({ chapter: 2, nowMs: before }).affectsScore, false);
  const closed = await call('/api/season/recap?chapter=2&now=' + before);
  assert.equal(closed.body.open, false);
  assert.equal(closed.body.narrationOnly, true);
  const open = await call('/api/season/recap?chapter=2&now=' + at + '&crowd=' + encodeURIComponent('The ink was already sure.'));
  assert.equal(open.body.open, true);
  assert.match(open.body.line, /The ink was already sure/);
  resetMemory();
  const vote = await call('/api/season/crowd-vote', { wallet: 'W', chapter: 2, option: 'ink', now: at });
  assert.equal(vote.body.ok, true);
  assert.equal(vote.body.narrationOnly, true);
  assert.equal(vote.body.affectsScore, false);
  assert.equal(vote.body.legacyPoints, 1);
  const twice = await call('/api/season/crowd-vote', { wallet: 'W', chapter: 2, option: 'page', now: at });
  assert.equal(twice.body.reason, 'already');
  const narrated = await call('/api/season/recap?chapter=2&wallet=W&now=' + at);
  assert.match(narrated.body.line, /The ink was already sure/);
  assert.equal(narrated.body.affectsScore, false);
});

test('legacy cap is 50 and unqualified points stay cosmetic', async () => {
  assert.match(earlyBuyCopy(), /No discount/);
  assert.match(earlyBuyCopy(), /first buying window/);
  const raw = seasonLegacy({
    events: [{ id: 'trial', points: 40 }, { id: 'crowd', points: 20 }],
    turnstile: true,
    onChain: true
  });
  assert.equal(raw.counted, 50);
  assert.equal(raw.cosmetic, 10);
  const unqualified = seasonLegacy({
    events: [{ id: 'trial', points: 40 }],
    turnstile: false,
    onChain: true
  });
  assert.equal(unqualified.qualified, false);
  assert.equal(unqualified.counted, 0);
  assert.equal(unqualified.cosmetic, 40);
  resetMemory();
  const wallet = 'LEG';
  await call('/api/season/turnstile', { wallet, token: 'dev' });
  const pending = await call('/api/season/legacy', { wallet, events: [{ id: 'trial', points: 60 }] });
  assert.equal(pending.body.qualified, false);
  assert.equal(pending.body.counted, 0);
  rememberOnChain(wallet);
  const qualified = await call('/api/season/legacy', { wallet, events: [{ id: 'trial', points: 60 }] });
  assert.equal(qualified.body.qualified, true);
  assert.equal(qualified.body.counted, 50);
  assert.equal(qualified.body.cosmetic, 10);
  const skipped = await call('/api/season/turnstile', { wallet: 'OTHER', token: 'real' });
  assert.equal(skipped.body.reason, 'turnstile_not_configured');
});

test('card upgrades stay off and there is no raid boss', async () => {
  const offer = cardUpgradeOffer();
  assert.equal(offer.enabled, false);
  assert.equal(offer.stretch, true);
  assert.equal(offer.changesTrainStat, false);
  const upgrade = await call('/api/season/card-upgrade');
  assert.equal(upgrade.body.enabled, false);
  const raid = await call('/api/season/raid');
  assert.equal(raid.status, 404);
  assert.equal(raid.body.reason, 'not_in_season_0');
});

test('quiz suggests a character and the story page is that character', async () => {
  const quiz = await call('/api/season/quiz', { answers: [0, 1, 2, 3] });
  assert.equal(quiz.body.ok, true);
  assert.equal(quiz.body.story.id, quiz.body.character.id);
  const missing = await call('/api/season/quiz', { answers: [1] });
  assert.equal(missing.body.reason, 'four_answers');
  const story = await call('/api/season/story?id=' + quiz.body.character.id);
  assert.equal(story.body.story.name, quiz.body.character.name);
});
