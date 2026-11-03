import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { OFFERED_CAMPAIGN_TYPES as SERVER_OFFERED } from '../../server/api.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (name) => readFileSync(path.join(root, name), 'utf8');

function loadPlatform() {
  const sandbox = {
    console, URL, Date, Math, Number, String, parseInt, JSON, Object, Array, Error, Promise,
    encodeURIComponent, isNaN, BigInt, Uint8Array, Uint32Array, DataView, TextEncoder,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('platform.js'), sandbox, { filename: 'platform.js' });
  return sandbox.BardPlatform;
}

const BP = loadPlatform();
const admin = read('admin.html');
const adminApp = read('admin_app.js');
const campaignPage = read('campaign.html');
const dashboard = read('dashboard.html');
const home = read('index.html');
const serverApi = read('server/api.js');

test('the builder and the server offer the same types, and raid is not one of them', () => {
  assert.deepEqual([...SERVER_OFFERED], ['hold', 'refer', 'custom']);
  assert.deepEqual([...BP.OFFERED_CAMPAIGN_TYPES], [...SERVER_OFFERED]);
  for (const type of ['hold', 'refer', 'custom']) assert.equal(BP.isOfferedCampaignType(type), true, type);
  for (const type of ['raid', 'post', 'reply', 'social', '', null, undefined]) {
    assert.equal(BP.isOfferedCampaignType(type), false, String(type));
  }
});

test('the exported list cannot be changed from outside', () => {
  assert.equal(Object.isFrozen(BP.OFFERED_CAMPAIGN_TYPES), true);
  assert.throws(() => BP.OFFERED_CAMPAIGN_TYPES.push('raid'), { name: 'TypeError' });
  assert.equal(BP.isOfferedCampaignType('raid'), false);
  assert.deepEqual([...BP.OFFERED_CAMPAIGN_TYPES], ['hold', 'refer', 'custom']);
});

test('a holder never needs X to join a campaign the builder can create', () => {
  for (const type of BP.OFFERED_CAMPAIGN_TYPES) assert.equal(BP.needsX(type), false, type);
  assert.equal(BP.needsX('raid'), true, 'the raid code path is kept, only hidden');
});

test('the hold rule says the team decides, on the page and in the copy', () => {
  assert.equal(BP.holdQualifyNote('hold'), 'The team checks balances and decides who qualifies.');
  assert.equal(BP.holdQualifyNote('HOLD'), 'The team checks balances and decides who qualifies.');
  for (const type of ['refer', 'custom', 'raid', '', undefined]) assert.equal(BP.holdQualifyNote(type), '', String(type));

  const state = (type) => ({
    campaign: { type },
    prize: { locked: true, prize_raw: '1000000', locked_raw: '1050000', decimals: 6, symbol: 'BARD', cut_bps: 500 },
    vault: { address: 'vault', balance_raw: '2000000', below_locked: false },
    clock: { state: 'live', no_end: true },
    counts: { qualified: 0 },
  });
  assert.equal(BP.campaignPublicCopy(state('hold')).qualify, 'The team checks balances and decides who qualifies.');
  assert.equal(BP.campaignPublicCopy(state('refer')).qualify, '');
  assert.equal(BP.campaignPublicCopy({ prize: { locked: false, symbol: 'BARD', decimals: 6 }, vault: {}, clock: {}, counts: {} }).qualify, '');

  assert.match(campaignPage, /id="qualify-line"/);
  assert.match(campaignPage, /setText\('qualify-line', copy\.qualify\)/);
  assert.match(dashboard, /BardPlatform\.holdQualifyNote\(c\.type\)/);
  assert.match(admin, /id="hold-team-hint"[^>]*>Your team checks balances on the review screen and decides who qualifies\. Bard does not do it for you\./);
  assert.match(admin, /id="rule-qualify-hint"[^>]*>Holders also see: “The team checks balances and decides who qualifies\.”/);
  assert.match(admin, /<option value="hold" selected>Hold — keep the token\. The team checks balances\.<\/option>/);
  assert.doesNotMatch(admin, /We use it to see who holds/);
});

test('the home page and the vault panel say only what is true', () => {
  assert.doesNotMatch(home, /in minutes/i);
  assert.doesNotMatch(home, /No complicated setup/i);
  assert.match(home, /Set up in a few steps/);
  assert.match(home, /The prize is locked before holders join\./);
  assert.match(home, /Leaderboards, hold and refer campaigns, custom challenges\./);

  assert.doesNotMatch(adminApp, /You sign\. Bard signs\./);
  assert.match(adminApp, /You sign\. Then Bard signs\. For now Bard’s signature is a manual check by a person, not an automatic one\./);
});

test('the leftovers are gone from the builder, the vault panel, the dashboard and the server', () => {
  assert.doesNotMatch(admin, /Starter can run this/);
  assert.doesNotMatch(admin, /id="p-plan"/);
  assert.doesNotMatch(admin, /plan=starter|value="starter"/);
  assert.doesNotMatch(adminApp, /p-plan|vault-go-starter|Starter can run this/);
  assert.doesNotMatch(dashboard, /vested/i);
  assert.doesNotMatch(serverApi, /body\.plan\b/);
  assert.doesNotMatch(read('platform.js'), /plan: *input\.plan|plan: *plan\b/);

  const unit = admin.match(/<select[^>]*id="c-unit"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(unit, 'the paid-in select exists');
  assert.deepEqual(unit[1].match(/<option[^>]*value="([^"]*)"/g).map((o) => o.match(/value="([^"]*)"/)[1]), ['TOKEN']);
  assert.doesNotMatch(unit[1], /SOL/);
});

test('linking X is optional everywhere a holder is told about it', () => {
  assert.match(dashboard, /Linking X is optional\./);
  assert.match(dashboard, /Optional\. Link X to show your handle on a campaign page\. Hold, refer, and custom campaigns work with your wallet alone\./);
  assert.match(dashboard, /A wallet is enough\./);
  assert.doesNotMatch(dashboard, /required to join|you must link X|X is required/i);
});

test('the builder script removes every type the list does not offer', () => {
  assert.match(adminApp, /BardPlatform\.OFFERED_CAMPAIGN_TYPES/);
  assert.match(adminApp, /applyOfferedTypes\(\);/);
  assert.match(adminApp, /sel\.removeChild\(opt\)/);
  assert.match(adminApp, /offered\.indexOf\('raid'\)<0&&raid&&raid\.parentNode/);
});
