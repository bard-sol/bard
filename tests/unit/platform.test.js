import assert from 'node:assert/strict';
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
  assert.equal(fixed.total, 6);
  assert.ok(fixed.payouts.every((row) => row.amount === 2));

  const top = BP.computePayouts({ rewardMode: 'top3', pool: 100, unit: 'TOKEN', config: {} }, joins);
  assert.deepEqual(top.payouts.map((row) => row.wallet), ['high', 'mid', 'low']);
  assert.deepEqual(top.payouts.map((row) => row.amount), [50, 30, 20]);
  assert.equal(top.total, 100);

  const now = Date.now();
  const growing = BP.computePayouts({
    rewardMode: 'growing',
    unit: 'TOKEN',
    createdAt: new Date(now).toISOString(),
    config: { growStart: 12, growEvery: 'week', growAdd: 1 },
  }, joins);
  assert.equal(growing.payouts.length, 1);
  assert.equal(growing.payouts[0].wallet, 'high');
  assert.equal(growing.payouts[0].amount, 12);

  const shared = BP.computePayouts({ rewardMode: 'pool', pool: 9, unit: 'SOL' }, joins);
  assert.equal(shared.payouts.length, 3);
  assert.ok(shared.payouts.every((row) => row.amount === 3));
  assert.equal(shared.total, 9);
});

test('plan gating', () => {
  assert.equal(BP.isPremiumPlan('pro'), true);
  assert.equal(BP.isPremiumPlan('starter'), false);
  assert.equal(BP.isPremiumPlan('free'), false);
  assert.equal(BP.planLabel('pro'), 'Premium');
  assert.equal(BP.planLabel('starter'), 'Starter');
  assert.equal(BP.isPremiumType('hold'), true);
  assert.equal(BP.isPremiumType('raid'), false);
  assert.equal(BP.isPremiumReward('growing'), true);
  assert.equal(BP.isPremiumReward('top3'), true);
  assert.equal(BP.isPremiumReward('fixed'), false);
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

test('team writes refuse local mode', () => {
  const src = readFileSync(path.join(root, 'platform.js'), 'utf8');
  const names = [
    'createProject', 'createCampaign', 'updateProjectVault', 'reserveVault', 'setProjectPlan',
    'updateCampaignStatus', 'proposeSettlement', 'signSettlement', 'cosignSettlement', 'executeSettlement',
    'upsertRoster', 'removeRoster', 'drawAirdrop', 'recordFee', 'markFeeConfirmed', 'markFeeFailed',
    'payFee', 'setJoinStatus', 'setJoinProgress', 'markQualified',
  ];
  for (const name of names) {
    const at = src.indexOf('async function ' + name + '(');
    assert.ok(at > 0, name);
    const slice = src.slice(at, at + 400);
    assert.match(slice, /refuseLocalTeamWrite\(\)/, name);
  }
});
