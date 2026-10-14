import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bossMaxHp,
  damagePercent,
  finisherAmount,
  lookaheadMoves,
  replayTrial,
  scaledValue,
  simulateTrialMedian,
  trialContext,
  trialSeed
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
  assert.equal(bossMaxHp(1, 'D1'), 105);
  assert.equal(bossMaxHp(1, 'D2'), 105);
  assert.equal(bossMaxHp(1, 'D3'), 94);
  assert.equal(bossMaxHp(7, 'D1'), 155);
  assert.equal(finisherAmount(20, 40, 80, 0), 30);
  assert.equal(finisherAmount(10, 40, 80, 0), 10);
  assert.equal(finisherAmount(16, 40, 80, 0), 24);
  assert.equal(finisherAmount(4, 28, 80, 0), 6);
  const ctx = trialContext({ charId: 'pip', chapter: 1, now: Date.parse('2026-10-17T12:00:00.000Z') });
  assert.equal(ctx.variant, 'D2');
  assert.equal(ctx.stats.LCK, 80);
});

test('combo, stagger, and the crossing Finisher are integers', async () => {
  const opts = trialContext({ charId: 'twins', chapter: 1, now: Date.parse('2026-10-16T10:00:00.000Z') });
  opts.comboBonus = 3;
  let comboChecked = false;
  let staggerChecked = false;
  for (let i = 0; i < 40 && (!comboChecked || !staggerChecked); i++) {
    const seed = await trialSeed('s0', 'rule-' + i);
    const open = replayTrial(seed, [], opts);
    if (!comboChecked) {
      const skill = open.hand.find((card) => card.type === 'skill');
      if (skill) {
        const after = replayTrial(seed, [{ type: 'play', card: skill.index }], opts);
        assert.equal(after.combo, 1);
        const attack = after.hand.find((card) => card.type === 'attack' && card.cost <= after.energy);
        if (attack) {
          const moves = [{ type: 'play', card: skill.index }, { type: 'play', card: attack.index }];
          const spent = replayTrial(seed, moves, opts);
          const plain = replayTrial(seed, moves, { ...opts, comboBonus: 0 });
          assert.equal(spent.combo, 0);
          assert.ok(spent.dealt > plain.dealt);
        }
        comboChecked = true;
      }
    }
    if (!staggerChecked) {
      const shield = open.hand.find((card) => card.id === 'shield');
      if (shield) {
        const blocked = replayTrial(seed, [{ type: 'play', card: shield.index }, { type: 'end' }], opts);
        assert.equal(blocked.staggered, true);
        assert.equal(blocked.playerHp, 30);
        staggerChecked = true;
      }
    }
  }
  assert.equal(comboChecked, true);
  assert.equal(staggerChecked, true);
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

test('greedy trial bot stays inside the tuned band', async () => {
  const report = await simulateTrialMedian(300);
  assert.equal(report.runs, 300);
  assert.equal(report.currentBaseHp, 105);
  assert.equal(report.comboBonus, 4);
  assert.equal(report.bossHp, 105);
  assert.ok(report.median >= 55 && report.median <= 70);
  const seed = await trialSeed('s0', 'sim-0000');
  const opts = trialContext({ charId: 'twins', chapter: 1, now: Date.parse('2026-10-16T10:00:00.000Z') });
  const first = lookaheadMoves(seed, opts);
  const second = lookaheadMoves(seed, opts);
  assert.deepEqual(first, second);
  assert.ok(first.length > 0);
  console.log('TRIAL_MEDIAN ' + JSON.stringify(report));
});
