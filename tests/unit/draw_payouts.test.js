import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDrawStep, computePayouts, drawInUse } from '../../server/settlement.js';

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

// TRAA-2335: the team's draw button commits draw_count 0, which keeps the whole roster in draw
// order. The payout ignored the stored winners and paid the qualified by rank instead.
test('the draw button (draw_count 0) pays the stored winners in draw order', () => {
  const out = computePayouts(drawn({ draw_count: 0, draw_slot: 1234, prize_raw: '4', draw_winners: [{ wallet: 'Cccc' }, { wallet: 'Bbbb' }, { wallet: 'Aaaa' }] }), joins, 0);
  assert.deepEqual(out.payouts.map((p) => [p.wallet, p.amountRaw]), [['Cccc', '2'], ['Bbbb', '2']]);
  const noSlot = computePayouts(drawn({ draw_count: 0, draw_winners: [{ wallet: 'Cccc' }, { wallet: 'Bbbb' }] }), joins, 0);
  assert.deepEqual(noSlot.payouts.map((p) => p.wallet), ['Cccc', 'Bbbb']);
});

test('a slot committed by the draw button cannot be paid before the reveal', () => {
  assert.throws(() => computePayouts(drawn({ draw_count: 0, draw_slot: 1234, draw_seed: null, draw_winners: null }), joins, 0), /Finalize the draw/);
});

test('a scored campaign refuses a draw and pays by score', () => {
  const scored = { reward_mode: 'fixed', reward: '2', prize_raw: '4', config: { scoreRule: { version: 1 } } };
  assert.throws(() => assertDrawStep(scored, 'commit'), /scored campaign/);
  assert.throws(() => loadPlatform().assertDrawStep({ config: scored.config }, 'commit'), /scored campaign/);
  assert.equal(drawInUse({ ...scored, draw_count: 2, draw_winners: [{ wallet: 'Cccc' }] }), false);
  const out = computePayouts({ ...scored, draw_count: 2, draw_winners: [{ wallet: 'Cccc' }, { wallet: 'Bbbb' }] }, joins, 0);
  assert.deepEqual(out.payouts.map((p) => p.wallet), ['Aaaa', 'Dddd']);
});

test('the browser copy of computePayouts applies the same draw rule', () => {
  const BP = loadPlatform();
  const camp = { rewardMode: 'fixed', reward: '2', prizeRaw: '6', drawCount: 3, drawWinners: drawn().draw_winners };
  const out = BP.computePayouts(camp, joins, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(out.payouts.map((p) => [p.wallet, p.amountRaw]))), [['Cccc', '2'], ['Bbbb', '2']]);
  assert.throws(() => BP.computePayouts({ ...camp, drawWinners: null }, joins, 0), /Finalize the draw/);
  const button = BP.computePayouts({ ...camp, drawCount: 0, drawSlot: 1234, prizeRaw: '4', drawWinners: [{ wallet: 'Cccc' }, { wallet: 'Bbbb' }, { wallet: 'Aaaa' }] }, joins, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(button.payouts.map((p) => p.wallet))), ['Cccc', 'Bbbb']);
  assert.throws(() => BP.computePayouts({ ...camp, drawCount: 0, drawSlot: 1234, drawWinners: null }, joins, 0), /Finalize the draw/);
  const plain = BP.computePayouts({ ...camp, drawCount: 0, drawWinners: null }, joins, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(plain.payouts.map((p) => p.wallet))), ['Aaaa', 'Dddd']);
});
