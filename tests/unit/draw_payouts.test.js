import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePayouts } from '../../server/settlement.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadPlatform() {
  const sandbox = { console, URL, Date, Math, Number, String, JSON, Object, Array, Error, Promise, BigInt, parseInt, isNaN, encodeURIComponent, Uint8Array, Uint32Array, DataView, TextEncoder };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(root, 'platform.js'), 'utf8'), sandbox, { filename: 'platform.js' });
  return sandbox.BardPlatform;
}

// TRAA-2319: the launch simulation drew winners, then the proposed payout ignored them. With no
// one qualified it refused to pay at all; with qualified holders it paid them, not the winners.
const joins = [
  { wallet: 'Aaaa', status: 'approved', qualified: true, progress: 90 },
  { wallet: 'Bbbb', status: 'approved', qualified: false, progress: 0 },
  { wallet: 'Cccc', status: 'approved', qualified: false, progress: 0 },
  { wallet: 'Dddd', status: 'approved', qualified: true, progress: 50 },
  { wallet: 'Eeee', status: 'rejected', qualified: false, progress: 0 },
];

function drawn(extra) {
  return {
    reward_mode: 'fixed',
    reward: '2',
    prize_raw: '6',
    draw_count: 3,
    draw_seed: 'seed',
    draw_winners: [{ wallet: 'Cccc', x_handle: null }, { wallet: 'Bbbb', x_handle: null }, { wallet: 'Eeee', x_handle: null }],
    ...extra,
  };
}

test('a drawn campaign pays its draw winners in draw order, and a rejected winner drops out', () => {
  const out = computePayouts(drawn(), joins, 0);
  assert.deepEqual(out.payouts.map((p) => [p.wallet, p.amountRaw]), [['Cccc', '2'], ['Bbbb', '2']]);
});

test('a drawn campaign splits a pool and ranks top 3 by the draw', () => {
  const pool = computePayouts(drawn({ reward_mode: 'pool', reward: null, prize_raw: '5' }), joins, 0);
  assert.deepEqual(pool.payouts.map((p) => [p.wallet, p.amountRaw]), [['Cccc', '3'], ['Bbbb', '2']]);
  const top = computePayouts(drawn({ reward_mode: 'top3', reward: null, prize_raw: '100' }), joins, 0);
  assert.deepEqual(top.payouts.map((p) => [p.wallet, p.amountRaw]), [['Cccc', '50'], ['Bbbb', '30']]);
});

test('a committed draw that is not finalized cannot be paid', () => {
  assert.throws(() => computePayouts(drawn({ draw_winners: null }), joins, 0), /Finalize the draw/);
  assert.throws(() => computePayouts(drawn({ draw_winners: [{ wallet: 'Eeee' }] }), joins, 0), /No draw winner/);
});

test('without a draw, payouts still follow rank', () => {
  const out = computePayouts(drawn({ draw_count: 0, draw_winners: null }), joins, 0);
  assert.deepEqual(out.payouts.map((p) => p.wallet), ['Aaaa', 'Dddd']);
});

test('the browser copy of computePayouts applies the same draw rule', () => {
  const BP = loadPlatform();
  const camp = { rewardMode: 'fixed', reward: '2', prizeRaw: '6', drawCount: 3, drawWinners: drawn().draw_winners };
  const out = BP.computePayouts(camp, joins, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(out.payouts.map((p) => [p.wallet, p.amountRaw]))), [['Cccc', '2'], ['Bbbb', '2']]);
  assert.throws(() => BP.computePayouts({ ...camp, drawWinners: null }, joins, 0), /Finalize the draw/);
});
