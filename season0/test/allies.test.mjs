import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLY_POOL,
  SIM_ALLIES,
  allyPool,
  cardsForAllies,
  castAllyVote,
  lineupPayment,
  pickProposer,
  sharedPenaltyIds,
  slateLegal,
  tallyVeto
} from '../lib/allies.js';
import { replayTrial, trialContext } from '../lib/trial.js';
import { handleApi } from '../worker/handlers.js';
import { resetMemory } from '../worker/store.js';

test('twelve margin allies, fatigue, and the shared penalty', () => {
  assert.equal(ALLY_POOL.length, 12);
  assert.equal(ALLY_POOL.every((row) => row.entity_type === 'ally' && row.placeholder), true);
  const pool = allyPool({ eliminated: ['thorn'] });
  assert.equal(pool.length, 13);
  assert.equal(pool.find((row) => row.entity_id === 'thorn').ghost, true);
  assert.equal(pool.find((row) => row.entity_id === 'thorn').entity_type, 'character');
  const tired = slateLegal({ slate: ['mouse', 'moth'], previous: ['mouse'], pool });
  assert.equal(tired.reason, 'fatigued');
  const fresh = slateLegal({ slate: ['mouse', 'moth'], previous: ['imp'], pool });
  assert.equal(fresh.ok, true);
  const picks = [
    { charId: 'pip', allies: ['mouse', 'moth'] },
    { charId: 'twins', allies: ['mouse', 'imp'] },
    { charId: 'vey', allies: ['cat', 'mouse'] }
  ];
  assert.deepEqual(sharedPenaltyIds(picks), ['mouse']);
  assert.deepEqual(sharedPenaltyIds(picks.slice(0, 2)), []);
  const [mouse] = cardsForAllies(['mouse'], { penalized: ['mouse'] });
  assert.equal(mouse.draw, 1);
  const [moth] = cardsForAllies(SIM_ALLIES, { penalized: ['moth'] });
  assert.equal(moth.entity_id, 'mouse');
  const penalized = cardsForAllies(['moth'], { penalized: ['moth'] })[0];
  assert.equal(penalized.deal, 4);
  assert.equal(penalized.sharedPenalty, true);
});

test('the proposer rotates by cluster-deduped CP and holders can veto', () => {
  const wallets = [
    { wallet: 'alpha', cp: 5, held: true, cluster: 'desk' },
    { wallet: 'beta', cp: 9, held: true, cluster: 'desk' },
    { wallet: 'gamma', cp: 4, held: true, cluster: 'gamma' },
    { wallet: 'delta', cp: 8, held: false, cluster: 'delta' }
  ];
  const first = pickProposer({ wallets, chapter: 1 });
  assert.equal(first.wallet, 'beta');
  assert.equal(first.cp, 14);
  assert.equal(first.entity_type, 'cluster');
  const second = pickProposer({ wallets, chapter: 2 });
  assert.equal(second.wallet, 'gamma');
  const roster = [
    { wallet: 'a', weight: 10 },
    { wallet: 'b', weight: 10 },
    { wallet: 'c', weight: 10 }
  ];
  assert.equal(tallyVeto(roster, [{ wallet: 'a', veto: true }]).passed, true);
  assert.equal(tallyVeto(roster, [{ wallet: 'a', veto: true }, { wallet: 'b', veto: true }]).passed, false);
  assert.equal(tallyVeto(roster, []).cap, 0.02);
  assert.equal(lineupPayment({ fee: 1 }).reason, 'lineup_is_free');
  assert.equal(castAllyVote({ already: true, veto: true }).reason, 'already');
  assert.equal(castAllyVote({ already: false, veto: false }).payout, false);
});

test('a voted slate makes a 12-card deck and a payment cannot buy one', async () => {
  const open = trialContext({ charId: 'twins', chapter: 1, now: Date.parse('2026-10-16T10:00:00.000Z') });
  const bare = replayTrial('ab'.repeat(32), [], open);
  assert.equal(bare.deckSize, 10);
  const withAllies = replayTrial('ab'.repeat(32), [], { ...open, allies: SIM_ALLIES });
  assert.equal(withAllies.deckSize, 12);
  resetMemory();
  const env = { SEASON_ALLOW_DEMO: '1' };
  const propose = await handleApi(new Request('http://season.local/api/season/allies/propose', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      wallet: 'beta',
      charId: 'twins',
      chapter: 1,
      slate: ['mouse', 'moth'],
      roster: [
        { wallet: 'beta', cp: 9, held: true, cluster: 'desk' },
        { wallet: 'alpha', cp: 5, held: true, cluster: 'desk' },
        { wallet: 'gamma', cp: 4, held: true, cluster: 'gamma' }
      ]
    })
  }), env);
  const proposed = await propose.json();
  assert.equal(proposed.ok, true);
  assert.equal(proposed.fee, false);
  const paid = await handleApi(new Request('http://season.local/api/season/allies/propose', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: 'beta', charId: 'pip', chapter: 1, slate: ['cat', 'imp'], sol: 1 })
  }), env);
  assert.equal((await paid.json()).reason, 'lineup_is_free');
  const start = await handleApi(new Request('http://season.local/api/season/trial/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: 'beta', charId: 'twins', chapter: 1, now: Date.parse('2026-10-16T12:00:00.000Z') })
  }), env);
  const started = await start.json();
  assert.deepEqual(started.context.allies, ['mouse', 'moth']);
});
