import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bossMaxHp,
  damagePercent,
  scaledValue,
  simulateTrialMedian,
  trialContext
} from '../lib/trial.js';
import { chestPool, chestSeed, openChest } from '../lib/chest.js';
import { contributionPoints, contributorPool, impactReadout, unlockedAmount } from '../lib/contribution.js';
import { marketTerm, momentumTerm } from '../lib/score.js';
import { simulateSeason, simulateSurvivalSeeds } from '../lib/survival.js';
import { defaultConfig } from '../lib/config.js';

test('trial numbers are integers and boss HP follows the chapter curve', () => {
  assert.equal(scaledValue(6, 50), 6);
  assert.equal(scaledValue(6, 25), 5);
  assert.equal(scaledValue(6, 80), 6);
  assert.equal(scaledValue(22, 80), 25);
  assert.equal(damagePercent(45, 120), 37);
  assert.equal(damagePercent(200, 110), 100);
  assert.equal(bossMaxHp(1, 'D1'), 80);
  assert.equal(bossMaxHp(1, 'D2'), 80);
  assert.equal(bossMaxHp(1, 'D3'), 72);
  assert.equal(bossMaxHp(7, 'D1'), 118);
  const ctx = trialContext({ charId: 'pip', chapter: 1, now: Date.parse('2026-10-17T12:00:00.000Z') });
  assert.equal(ctx.variant, 'D2');
  assert.equal(ctx.stats.LCK, 80);
});

test('chest rolls are seeded, unique, and never NFTs', async () => {
  assert.equal(chestPool().length, 28);
  const day = '2026-10-16';
  const seed = await chestSeed('WALLET', day);
  assert.equal(seed, await chestSeed('WALLET', day));
  assert.notEqual(seed, await chestSeed('OTHER', day));
  const first = await openChest({ seedHex: seed, sinceRare: 0, owned: [] });
  const second = await openChest({ seedHex: seed, sinceRare: 0, owned: [] });
  assert.equal(first.id, second.id);
  assert.equal(first.nft, false);
  assert.equal(first.transferable, false);
  const owned = chestPool().filter((item) => item.rarity === 'common').map((item) => item.id);
  const moved = await openChest({ seedHex: seed, sinceRare: 0, owned });
  assert.notEqual(moved.rarity, 'common');
  const epic = await openChest({ seedHex: seed, dayOfSeason: 21, owned: [], sinceRare: 0 });
  assert.equal(epic.rarity, 'epic');
});

test('contribution ignores holdings and the pool is tBard only', () => {
  const rich = contributionPoints({ trialAccuracy: 0.5, balance: 1000000, decided: true });
  const poor = contributionPoints({ trialAccuracy: 0.5, balance: 1, decided: true });
  assert.equal(rich.cp, poor.cp);
  const champ = contributionPoints({ trialAccuracy: 0.5, champion: true, clutch: true, captain: true, decided: true, trained: true });
  assert.equal(champ.parts.trial, 300);
  assert.equal(champ.parts.decide, 2);
  const impact = impactReadout({ wallet: 'a', trialAccuracy: 1 }, [
    { wallet: 'a', trialAccuracy: 1 },
    { wallet: 'b', trialAccuracy: 1 }
  ]);
  assert.equal(impact.share, 0.5);
  const pool = contributorPool({
    mode: 'bard',
    characters: [{ id: 'pip', alive: true, wallets: [{ wallet: 'a', trialAccuracy: 1 }] }]
  });
  assert.equal(pool.reason, 'mainnet_rewards_disabled');
  const paid = contributorPool({
    mode: 'tbard',
    bardTwap: 0,
    daysSinceFinale: 7,
    characters: [
      { id: 'pip', alive: true, wallets: [
        { wallet: 'a', trialAccuracy: 1 },
        { wallet: 'b', trialAccuracy: 0.4 },
        { wallet: 'c', trialAccuracy: 0.2 }
      ] },
      { id: 'thorn', alive: false, wallets: [{ wallet: 'z', trialAccuracy: 1 }] }
    ]
  });
  assert.equal(paid.mode, 'tbard');
  assert.equal(paid.mainnet, false);
  assert.equal(paid.unlockDays, 14);
  assert.equal(paid.payouts.some((row) => row.wallet === 'z'), false);
  assert.equal(unlockedAmount(14, 7), 7);
  const weights = defaultConfig().weights;
  const sum = weights.M + weights.U + weights.B + weights.P + weights.K;
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.equal(weights.K, 0.1);
});

test('momentum is guarded and a full season still names one champion', async () => {
  assert.equal(momentumTerm({ chapter: 1, twap: 2, prevTwap: 1, swaps: 100, traders: 40 }), 0);
  assert.equal(momentumTerm({ chapter: 2, twap: 2, prevTwap: 1, swaps: 10, traders: 40 }), 0);
  assert.equal(momentumTerm({ chapter: 2, twap: 2, prevTwap: 1, swaps: 80, traders: 30, graduated: true }), 0);
  const mom = momentumTerm({ chapter: 3, twap: Math.E, prevTwap: 1, swaps: 80, traders: 30 });
  assert.ok(Math.abs(mom - 0.2) < 1e-9);
  assert.equal(marketTerm({ mc: 100, medianMc: 10, mom: 0 }), 1);
  const season = await simulateSeason('s0-survival');
  assert.equal(season.chapters.length, 7);
  assert.equal(season.remaining.length, 1);
  assert.equal(season.champion, season.remaining[0]);
  assert.equal(new Set(season.chapters.map((row) => row.marked)).size, 7);
  const many = await simulateSurvivalSeeds(500);
  assert.equal(many.seeds, 500);
  assert.equal(many.flagged.length, 0);
  const chapter1 = many.chapters[0].marked;
  const sum = Object.values(chapter1).reduce((total, share) => total + share, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  console.log('SURVIVAL ' + JSON.stringify({ chapter1, champions: many.champions, flagged: many.flagged }));
});

test('trial bot median is reported and the HP base stays unlocked', async () => {
  const report = await simulateTrialMedian(300);
  assert.equal(report.runs, 300);
  assert.equal(report.currentBaseHp, 80);
  assert.equal(report.tooStrong, false);
  assert.ok(report.median <= 70);
  assert.ok(report.killRate <= 0.35);
  console.log('TRIAL_MEDIAN ' + JSON.stringify(report));
});
