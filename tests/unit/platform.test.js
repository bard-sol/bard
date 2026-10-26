import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { computePayouts as serverPayouts, deriveWinners as serverWinners } from '../../server/settlement.js';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadPlatform() {
  const code = readFileSync(path.join(root, 'platform.js'), 'utf8');
  const sandbox = {
    console,
    URL,
    Date,
    Math,
    Number,
    String,
    parseInt,
    JSON,
    Object,
    Array,
    Error,
    Promise,
    encodeURIComponent,
    isNaN,
    BigInt,
    parseInt,
    Uint8Array,
    Uint32Array,
    DataView,
    TextEncoder,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'platform.js' });
  return sandbox.BardPlatform;
}

const BP = loadPlatform();

test('escapeHtml covers the required cases', () => {
  assert.equal(BP.escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(BP.escapeHtml('"'), '&quot;');
  assert.equal(BP.escapeHtml("'"), '&#39;');
  assert.equal(BP.escapeHtml('&'), '&amp;');
  assert.equal(BP.escapeHtml('&lt;'), '&amp;lt;');
  assert.equal(BP.escapeHtml(null), '');
  assert.equal(BP.escapeHtml(undefined), '');
  assert.equal(BP.escapeHtml(12), '12');
  assert.equal(
    BP.escapeHtml('<img src=x onerror="window.__xss=1">'),
    '&lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;'
  );
});

test('safeHttpUrl keeps http(s) and drops everything else', () => {
  assert.equal(BP.safeHttpUrl('https://x.com/i/status/1'), 'https://x.com/i/status/1');
  assert.equal(BP.safeHttpUrl('http://example.com/a'), 'http://example.com/a');
  assert.equal(BP.safeHttpUrl('javascript:alert(1)'), '');
  assert.equal(BP.safeHttpUrl('data:text/html,hi'), '');
  assert.equal(BP.safeHttpUrl('/relative'), '');
  assert.equal(BP.safeHttpUrl(null), '');
});

test('growing pool math', () => {
  const now = Date.now();
  const fresh = {
    createdAt: new Date(now).toISOString(),
    reward: 3,
    config: { growStart: 10, growAdd: 5, growEvery: 'day', growCap: 20 },
  };
  assert.equal(BP.growingNow(fresh), 10);

  const aged = {
    createdAt: new Date(now - (3 * 86400000 + 1000)).toISOString(),
    config: { growStart: 10, growAdd: 5, growEvery: 'day', growCap: 20 },
  };
  assert.equal(BP.growingNow(aged), 20);
  const meta = BP.growingMeta(aged);
  assert.equal(meta.now, 20);
  assert.match(meta.line, /caps at 20/);
  assert.match(meta.line, /Now 20/);
});

test('computePayouts fixed, top3, growing, and shared pool', () => {
  const joins = [
    { wallet: 'low', qualified: true, status: 'approved', progress: 1 },
    { wallet: 'high', qualified: true, status: 'approved', progress: 9 },
    { wallet: 'mid', qualified: true, status: 'approved', progress: 5 },
    { wallet: 'out', qualified: false, status: 'rejected', progress: 100 },
  ];
  const fixed = BP.computePayouts({ rewardMode: 'fixed', reward: 2, unit: 'SOL' }, joins);
  assert.equal(fixed.payouts.length, 3);
  assert.equal(fixed.total, '6');
  assert.ok(fixed.payouts.every((row) => row.amount === '2' && row.amountRaw === '2'));

  const top = BP.computePayouts({ rewardMode: 'top3', pool: 100, unit: 'TOKEN', config: {} }, joins);
  assert.deepEqual(top.payouts.map((row) => row.wallet), ['high', 'mid', 'low']);
  assert.deepEqual(top.payouts.map((row) => row.amount), ['50', '30', '20']);
  assert.equal(top.total, '100');

  const now = Date.now();
  const growing = BP.computePayouts({
    rewardMode: 'growing',
    unit: 'TOKEN',
    createdAt: new Date(now).toISOString(),
    config: { growStart: 12, growEvery: 'week', growAdd: 1 },
  }, joins);
  assert.equal(growing.payouts.length, 1);
  assert.equal(growing.payouts[0].wallet, 'high');
  assert.equal(growing.payouts[0].amount, '12');

  const shared = BP.computePayouts({ rewardMode: 'pool', pool: 9, unit: 'SOL' }, joins);
  assert.equal(shared.payouts.length, 3);
  assert.ok(shared.payouts.every((row) => row.amount === '3'));
  assert.equal(shared.total, '9');
});

test('cut config is readable and not a plan gate', () => {
  assert.equal(typeof BP.getCutBps(), 'number');
  assert.equal(BP.getCutBps(), 500);
  assert.equal(typeof BP.getCutWallet(), 'string');
  assert.equal(BP.getCutWallet().length > 30, true);
  assert.equal(BP.isPremiumPlan, undefined);
  assert.equal(BP.isPremiumType, undefined);
  assert.equal(BP.isPremiumReward, undefined);
  assert.equal(BP.payFee, undefined);
  assert.equal(BP.setProjectPlan, undefined);
  assert.equal(BP.recordFee, undefined);
});

test('dashboard cannot qualify or score itself', () => {
  const html = readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  assert.equal(html.includes('markQualified'), false);
  assert.equal(html.includes('setJoinProgress'), false);
  assert.equal(html.includes('Mark qualified'), false);
});

test('restore workflow is gone and escapeHtml is shared', () => {
  assert.equal(existsSync(path.join(root, '.github/workflows/restore-vest-removal.yml')), false);
  for (const file of ['admin_app.js', 'dashboard.html', 'explore.html']) {
    const text = readFileSync(path.join(root, file), 'utf8');
    assert.equal(text.includes('function escapeHtml'), false, file);
  }
  const platform = readFileSync(path.join(root, 'platform.js'), 'utf8');
  assert.match(platform, /function escapeHtml/);
  assert.match(platform, /\/vendor\/supabase\/supabase\.js/);
});

test('sign-in is required and the treasury is not the vault signer', () => {
  const src = readFileSync(path.join(root, 'platform.js'), 'utf8');
  const admin = readFileSync(path.join(root, 'admin_app.js'), 'utf8');
  assert.equal(src.includes('setFeesEnabled'), false);
  assert.match(src, /function getVaultBardMember\(\) \{ return bardSignerPubkey; \}/);
  assert.equal(admin.includes('Release payment'), false);
  assert.equal(admin.includes("tx='released'"), false);
  assert.match(src, /eq\('admin_wallet', sessionWallet \|\| '1'\)/);
  assert.match(src, /Sign in with your wallet first/);
});

test('team writes refuse local mode', () => {
  const src = readFileSync(path.join(root, 'platform.js'), 'utf8');
  const names = [
    'createProject', 'createCampaign', 'updateProjectVault', 'reserveVault',
    'updateCampaignStatus', 'proposeSettlement', 'signSettlement', 'cosignSettlement', 'executeSettlement',
    'upsertRoster', 'removeRoster', 'drawAirdrop', 'commitDraw', 'finalizeDraw',
    'setJoinStatus', 'setJoinProgress', 'markQualified',
  ];
  for (const name of names) {
    const at = src.indexOf('async function ' + name + '(');
    assert.ok(at > 0, name);
    const slice = src.slice(at, at + 400);
    assert.match(slice, /refuseLocalTeamWrite\(\)/, name);
  }
});

test('payout hash is sha256 of sorted raw wallet lines', () => {
  const joins = [
    { wallet: 'WalletB', qualified: true, status: 'approved', progress: 1 },
    { wallet: 'WalletA', qualified: true, status: 'approved', progress: 2 },
  ];
  const forward = BP.computePayouts({ rewardMode: 'fixed', reward: '1.5', unit: 'TOKEN' }, joins, 6);
  const backward = BP.computePayouts({ rewardMode: 'fixed', reward: '1.5', unit: 'TOKEN' }, joins.slice().reverse(), 6);
  assert.equal(forward.payouts[0].amountRaw, '1500000');
  assert.equal(forward.hash, backward.hash);
  assert.equal(forward.hash, createHash('sha256').update(BP.canonicalPayoutText(forward.payouts), 'utf8').digest('hex'));
  assert.equal(BP.canonicalPayoutText(forward.payouts), 'WalletA:1500000\nWalletB:1500000');
  const server = serverPayouts({ reward_mode: 'fixed', reward: '1.5', reward_unit: 'TOKEN' }, joins, 6);
  assert.equal(server.hash, forward.hash);
  assert.deepEqual(server.payouts.map((row) => row.amountRaw), forward.payouts.map((row) => row.amountRaw));
  const shifted = BP.computePayouts({ rewardMode: 'fixed', reward: '1.500001', unit: 'TOKEN' }, joins, 6);
  assert.equal(shifted.payouts[0].amountRaw, '1500001');
  assert.notEqual(shifted.hash, forward.hash);
  assert.match(forward.hash, /^[0-9a-f]{64}$/);
});

test('reservation refuses an over-balance and accumulates the campaign', () => {
  assert.throws(
    () => BP.planReservation('5', '1', '6', '10', 0),
    /exceeds vault token balance/
  );
  const next = BP.planReservation('2', '2', '3', '100', 0);
  assert.equal(next.projectReserved, '5');
  assert.equal(next.campaignReserved, '5');
  assert.notEqual(next.campaignReserved, '3');
});

test('draw winners are deterministic and a second draw is refused', () => {
  const joins = [
    { wallet: 'C', qualified: true, status: 'approved' },
    { wallet: 'A', status: 'approved' },
    { wallet: 'B', qualified: false, status: 'rejected' },
  ];
  const first = BP.deriveWinners(joins, 'FutureBlockhash111', 0);
  const second = BP.deriveWinners(joins.slice().reverse(), 'FutureBlockhash111', 0);
  assert.deepEqual(first.map((row) => row.wallet), second.map((row) => row.wallet));
  assert.deepEqual(first.map((row) => row.wallet).sort(), ['A', 'C']);
  assert.deepEqual(serverWinners(joins, 'FutureBlockhash111', 0).map((row) => row.wallet), first.map((row) => row.wallet));
  const campaign = { drawSeed: 'FutureBlockhash111', drawCount: 0, drawWinners: first, drawSlot: 150 };
  assert.equal(BP.verifyDraw(campaign, joins).ok, true);
  assert.equal(BP.verifyDraw({ ...campaign, drawWinners: first.slice().reverse() }, joins).ok, false);
  assert.throws(() => BP.assertDrawStep({ drawSlot: 10 }, 'commit'), /already committed/);
  assert.throws(() => BP.assertDrawStep({ drawSeed: 'x', drawWinners: first }, 'finalize'), /already finalized/);
});

test('draw seed waits for the committed slot and skips a missing block', async () => {
  const blocks = { 1151: { blockhash: 'SeedHashFromNextSlot' } };
  let slot = 1149;
  const conn = {
    async getSlot() { return slot; },
    async getBlock(target) {
      if (target === 1150) throw new Error('Slot 1150 was skipped');
      if (!blocks[target]) return null;
      return blocks[target];
    },
  };
  await assert.rejects(() => BP.resolveDrawSeed(conn, 1150), /not final yet/);
  slot = 1152;
  const found = await BP.resolveDrawSeed(conn, 1150);
  assert.equal(found.slot, 1151);
  assert.equal(found.blockhash, 'SeedHashFromNextSlot');
  const campaign = { drawSeed: found.blockhash, drawCount: 0, drawWinners: BP.deriveWinners([{ wallet: 'A', status: 'approved' }], found.blockhash, 0), drawSlot: 1150, drawSeedSlot: found.slot };
  assert.equal(BP.verifyDraw(campaign, [{ wallet: 'A', status: 'approved' }]).ok, true);
});
