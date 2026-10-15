import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { handleApi } from '../worker/handlers.js';
import { resetMemory } from '../worker/store.js';
import { buildSeasonCurve } from '../lib/dbc-curve.js';
import { matchSpend } from '../lib/matchspend.js';

const env = { SEASON_ALLOW_DEMO: '1' };

async function call(path, opts) {
  const res = await handleApi(new Request('http://season.local' + path, opts), env);
  return { status: res.status, body: await res.json() };
}

test('config is devnet, early-buy on, comeback and relic burns off, no Irys', async () => {
  const { body } = await call('/api/season/config');
  assert.equal(body.cluster, 'devnet');
  assert.equal(body.eligibility_min_sol.devnet, 0);
  assert.equal(body.eligibility_min_sol.mainnet, 0.05);
  assert.equal(body.legacy_early_buy_enabled, true);
  assert.equal(body.comeback_vote_enabled, false);
  assert.equal(body.relic_burn_enabled, false);
  assert.equal(body.irys_on_devnet, false);
});

test('bard-sign without a secret stays waiting and does not touch a chain', async () => {
  const { body } = await call('/api/vault/bard-sign', { method: 'POST', body: JSON.stringify({ multisig: 'x', txIndex: '1' }) });
  assert.equal(body.ok, false);
  assert.equal(body.waiting, true);
  assert.equal(body.reason, 'bard_signer_offline');
});

test('live supabase project is refused', async () => {
  const res = await handleApi(new Request('http://season.local/api/season/config'), {
    SEASON_SUPABASE_URL: 'https://pxdiyukxgnphxlknhmke.supabase.co'
  });
  assert.equal(res.status, 403);
});

test('spend code verifies a 50/30/20 transaction once', async () => {
  resetMemory();
  const issued = await call('/api/season/nonce', {
    method: 'POST',
    body: JSON.stringify({ action: 'train', wallet: 'WALLET', charId: 'pip', chapter: 1, amount: 100, discount: true })
  });
  assert.equal(issued.body.memo, 'bard:v1:train:pip:1:' + issued.body.nonce);
  assert.equal(issued.body.split.burn, '50000000');
  assert.equal(issued.body.split.liq, '30000000');
  assert.equal(issued.body.split.pot, '20000000');
  const instructions = [
    { type: 'burn', mint: 'MINT', authority: 'WALLET', amount: '50000000' },
    { type: 'transfer', mint: 'MINT', authority: 'WALLET', destination: 'LIQ', amount: '30000000' },
    { type: 'transfer', mint: 'MINT', authority: 'WALLET', destination: 'POT', amount: '20000000' },
    { type: 'memo', text: issued.body.memo }
  ];
  const verified = await call('/api/season/verify-spend', {
    method: 'POST',
    body: JSON.stringify({
      nonce: issued.body.nonce,
      mac: issued.body.mac,
      signature: 'sig-1',
      mint: 'MINT',
      liq: 'LIQ',
      pot: 'POT',
      instructions
    })
  });
  assert.equal(verified.body.ok, true);
  assert.equal(verified.body.creditTokens, 150);
  const replay = await call('/api/season/verify-spend', {
    method: 'POST',
    body: JSON.stringify({
      nonce: issued.body.nonce,
      mac: issued.body.mac,
      signature: 'sig-2',
      mint: 'MINT',
      liq: 'LIQ',
      pot: 'POT',
      instructions
    })
  });
  assert.equal(replay.body.ok, false);
});

test('a prediction counts only when the receipt is before the lock', async () => {
  resetMemory();
  const session = await call('/api/season/strike-session', {
    method: 'POST',
    body: JSON.stringify({ wallet: 'WALLET', charId: 'pip', chapter: 1 })
  });
  const late = await call('/api/season/action', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'predict',
      wallet: 'WALLET',
      charId: 'pip',
      chapter: 1,
      nonce: session.body.nonce,
      signedAt: Date.now(),
      lockAt: Date.now() - 1000,
      signature: 'demo',
      extra: 'pip'
    })
  });
  assert.equal(late.body.reason, 'after_lock');
});

test('void plan uses the void memo and batches stakes by 8', async () => {
  const stakes = Array.from({ length: 10 }, (_, i) => ({ sig: 'AbcdEFGH' + i, wallet: 'W' + i, amount: 5 }));
  const { body } = await call('/api/season/void', {
    method: 'POST',
    body: JSON.stringify({ season: 's0', chapter: 3, reason: 'exploit', stakes, state: { scores: [] } })
  });
  assert.match(body.memo, /^bard:v1:void:s0:3:exploit:[0-9a-f]{64}$/);
  assert.equal(body.status, 'void');
  assert.equal(body.irys, null);
  assert.deepEqual(body.batches.map((b) => b.length), [8, 2]);
  assert.match(body.batches[0][0].memo, /^bard:v1:unstake:s0:3:void:AbcdEFGH$/);
});

test('signed strike is checked, and the review hook is not a human queue', async () => {
  resetMemory();
  const priv = ed25519.utils.randomPrivateKey();
  const pub = ed25519.getPublicKey(priv);
  const wallet = bs58.encode(pub);
  const session = await call('/api/season/strike-session', {
    method: 'POST',
    body: JSON.stringify({ wallet, charId: 'thorn', chapter: 2 })
  });
  const signedAt = Date.now();
  const message = ['bard', 's0', 'strike', '2', 'thorn', session.body.nonce, String(signedAt), '-'].join('|');
  const signature = bs58.encode(ed25519.sign(new TextEncoder().encode(message), priv));
  const acted = await call('/api/season/action', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'strike',
      wallet,
      charId: 'thorn',
      chapter: 2,
      nonce: session.body.nonce,
      signedAt,
      signature,
      message,
      clientElapsedMs: 400,
      tapped: true
    })
  });
  assert.equal(acted.body.ok, true, JSON.stringify(acted.body));
  assert.equal(typeof acted.body.strike.power, 'number');
  const review = await call('/api/season/last-words/review', {
    method: 'POST',
    body: JSON.stringify({ text: 'Hold the page.' })
  });
  assert.equal(review.body.review.ok, true);
});

test('eligibility endpoint uses 0 on devnet', async () => {
  const snap = Date.now();
  const { body } = await call('/api/eligibility?cluster=devnet&balance=1&heldSince=' + (snap - 86400000) + '&snapshot=' + snap + '&valueSol=0');
  assert.equal(body.eligible, true);
  assert.equal(body.eligibility_min_sol, 0);
  const main = await call('/api/eligibility?cluster=mainnet&balance=1&heldSince=' + (snap - 86400000) + '&snapshot=' + snap + '&valueSol=0.01');
  assert.equal(main.body.eligible, false);
  assert.equal(main.body.eligibility_min_sol, 0.05);
});

test('DBC curve matches the devnet kickoff', () => {
  const curve = buildSeasonCurve();
  assert.equal(curve.collectFeeMode, 0);
  assert.equal(curve.migrationOption, 1);
  assert.equal(curve.migrationFeeOption, 6);
  assert.equal(curve.partnerPermanentLockedLiquidityPercentage, 100);
  assert.equal(curve.creatorTradingFeePercentage, 0);
  assert.equal(curve.tokenDecimal, 6);
  assert.equal(curve.tokenUpdateAuthority, 1);
  assert.equal(curve.migrationQuoteThreshold.toString(), '85000000000');
  assert.equal(curve.migratedPoolFee.poolFeeBps, 200);
  assert.equal(matchSpend([
    { type: 'burn', mint: 'M', authority: 'W', amount: '10' },
    { type: 'memo', text: 'bard:v1:revive:pip:1:n' }
  ], { kind: 'revive', mint: 'M', wallet: 'W', amount: '10', memo: 'bard:v1:revive:pip:1:n' }).ok, true);
});
