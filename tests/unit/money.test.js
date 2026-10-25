import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  ceilCut,
  computePayouts,
  covered,
  decimalToRaw,
  floorCut,
  hashLines,
  lockNeed,
  payoutHash,
  resolvePrizeRaw,
  settlementCut,
  canonicalPayoutText,
} from '../../server/money.js';

test('lock uses ceil and payout uses floor, including a one-raw-unit pool', () => {
  assert.equal(ceilCut(1000n, 500), 50n);
  assert.equal(floorCut(1000n, 500), 50n);
  assert.equal(ceilCut(1n, 500), 1n);
  assert.equal(floorCut(1n, 500), 0n);
  assert.equal(ceilCut(1n, 0), 0n);
  assert.equal(floorCut(0n, 500), 0n);
  const locked = lockNeed(1n, 500);
  assert.equal(locked.prizeRaw, 1n);
  assert.equal(locked.cutRaw, 1n);
  assert.equal(locked.lockedRaw, 2n);
  assert.equal(covered(1n, 0n, locked.lockedRaw), false);
  assert.equal(covered(2n, 0n, locked.lockedRaw), true);
  assert.equal(covered(5n, 3n, locked.lockedRaw), true);
  assert.equal(covered(4n, 3n, locked.lockedRaw), false);
});

test('a zero payout cut is waived and stays out of the hash', async () => {
  const payouts = [{ wallet: 'Holder1111111111111111111111111111111111', amountRaw: '1' }];
  const cut = settlementCut(payouts, 1n, 500, 'Treasury11111111111111111111111111111111');
  assert.equal(cut.holderTotalRaw, 1n);
  assert.equal(cut.cutRaw, 0n);
  assert.equal(cut.cutWaived, true);
  assert.equal(cut.cutWallet, null);
  assert.equal(cut.lines.length, 1);
  const hash = await payoutHash(cut.lines);
  const expected = createHash('sha256').update(canonicalPayoutText(payouts), 'utf8').digest('hex');
  assert.equal(hash, expected);
});

test('the hash covers holder lines plus the cut line', async () => {
  const payouts = [
    { wallet: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', amountRaw: '30' },
    { wallet: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', amountRaw: '70' },
  ];
  const cut = settlementCut(payouts, 100n, 500, 'cccccccccccccccccccccccccccccccccccccccccc');
  assert.equal(cut.holderTotalRaw, 100n);
  assert.equal(cut.cutRaw, 5n);
  assert.equal(cut.cutWaived, false);
  const lines = hashLines(payouts, cut.cutWallet, cut.cutRaw);
  const text = [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:70',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:30',
    'cccccccccccccccccccccccccccccccccccccccccc:5',
  ].join('\n');
  assert.equal(canonicalPayoutText(lines), text);
  const hash = await payoutHash(lines);
  assert.equal(hash, createHash('sha256').update(text, 'utf8').digest('hex'));
});

test('top 3 shares must sum to 100 and growing pools need a cap', () => {
  assert.throws(
    () => resolvePrizeRaw({ rewardMode: 'top3', prize: '10', config: { top3First: 50, top3Second: 30, top3Third: 10 }, decimals: 0 }),
    /sum to 100/
  );
  const top = resolvePrizeRaw({ rewardMode: 'top3', prize: '10', config: { top3First: 50, top3Second: 30, top3Third: 20 }, decimals: 0 });
  assert.equal(top, 10n);
  assert.throws(
    () => resolvePrizeRaw({ rewardMode: 'growing', config: { growStart: '5', growAdd: '1' }, decimals: 0 }),
    /cap/
  );
  const cap = resolvePrizeRaw({ rewardMode: 'growing', config: { growCap: '1.5', growStart: '1' }, decimals: 6 });
  assert.equal(cap, 1_500_000n);
});

test('fixed prize is the per-holder reward times the expected count', () => {
  const raw = resolvePrizeRaw({ rewardMode: 'fixed', reward: '2', config: { holderCount: 3 }, decimals: 6 });
  assert.equal(raw, decimalToRaw('2', 6) * 3n);
});

test('computePayouts uses prize_raw, dedupes wallets, and refuses an over-prize total', () => {
  const joins = [
    { wallet: 'alice', qualified: true, status: 'approved', progress: 1 },
    { wallet: 'alice', qualified: true, status: 'approved', progress: 9 },
    { wallet: 'bob', qualified: true, status: 'approved', progress: 2 },
  ];
  const built = computePayouts({
    rewardMode: 'fixed',
    reward: '2',
    prize_raw: '4',
    unit: 'TOKEN',
  }, joins, 0);
  assert.equal(built.payouts.length, 2);
  assert.equal(built.payouts.find((row) => row.wallet === 'alice').amountRaw, '2');
  assert.equal(built.totalRaw, '4');
  assert.throws(
    () => settlementCut(built.payouts, 3n, 500, 'treasury'),
    /larger than the locked prize/
  );
});

test('a one-raw shared pool pays the holder and waives the cut', () => {
  const built = computePayouts({
    rewardMode: 'pool',
    prize_raw: '1',
    unit: 'TOKEN',
  }, [{ wallet: 'only', qualified: true, status: 'approved', progress: 1 }], 0);
  assert.equal(built.totalRaw, '1');
  const cut = settlementCut(built.payouts, 1n, 500, 'treasury');
  assert.equal(cut.cutWaived, true);
  assert.equal(cut.lines.some((line) => line.wallet === 'treasury'), false);
});
