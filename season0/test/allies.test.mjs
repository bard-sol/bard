import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLY_POOL,
  ALLY_QUORUM,
  SIM_ALLIES,
  allyPool,
  autoAllies,
  cardsForAllies,
  castAllyVote,
  lineupPayment,
  pickProposer,
  resolveDeckAllies,
  sharedPenaltyIds,
  slateLegal,
  tallyVeto
} from '../lib/allies.js';
import { TRIAL_CARDS, replayTrial, trialContext } from '../lib/trial.js';
import { handleApi } from '../worker/handlers.js';
import { resetMemory } from '../worker/store.js';

const open = () => trialContext({ charId: 'twins', chapter: 1, now: Date.parse('2026-10-16T10:00:00.000Z') });
const ally = (id) => ALLY_POOL.find((row) => row.entity_id === id).card;
const jab = TRIAL_CARDS.find((card) => card.id === 'jab');

function play(cards, moves, extra) {
  return replayTrial('ab'.repeat(32), moves, { ...open(), fixedDeck: cards, ...extra });
}

test('twelve numbered allies and the shared penalty', () => {
  assert.equal(ALLY_POOL.length, 12);
  assert.deepEqual(ALLY_POOL.map((row) => row.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(SIM_ALLIES, ['hob', 'wren']);
  assert.equal(ALLY_POOL.every((row) => row.entity_type === 'ally' && !row.placeholder && row.art.endsWith('.webp')), true);
  assert.deepEqual(ALLY_POOL.map((row) => row.name), [
    'Hob the Bookbinder',
    'Sister Wren',
    'Juniper the fox',
    'Sir Footnote',
    'Old Mother Index',
    'Baron Croak',
    'Mira the Cartographer',
    'Brannoc the Ferryman',
    'Lumen, the Moth Queen',
    'Grub the troll',
    'Tilde the hedge-witch',
    'Corvin the raven'
  ]);
  assert.deepEqual(ALLY_POOL.map((row) => row.card.name), [
    'Stitch Up', 'Lamplight', 'Pick the Lock', 'Tiny Charge', 'Cross-Reference', 'Royal Leap',
    'Mark the Map', 'Toll Paid', 'Dusk Swarm', 'Moss Wall', 'Hedge Hex', 'Urgent Delivery'
  ]);
  assert.equal(ally('hob').text, 'Block 6. Keep 3 Block into next turn.');
  assert.equal(ally('wren').text, '+1 Combo. Reveal boss\'s next two intents.');
  assert.equal(ally('wren').draw, undefined);
  assert.equal(ally('corvin').dealDuringFinisher, 10);
  assert.equal(ally('tilde').bossCutPct, 20);
  assert.equal(ally('tilde').text, 'Boss\'s next attack deals 20% less (floor).');
  assert.equal(ally('grub').cost, 2);
  assert.equal(ally('grub').combo, 1);
  assert.equal(ally('croak').deal, 7);
  assert.equal(ally('croak').keepComboHalf, true);
  assert.equal(ally('juniper').stripGuard, 6);
  assert.equal(ally('brannoc').block, 9);
  assert.equal(ally('brannoc').fullBlockDraw, 1);
  assert.equal(ally('footnote').deal, 4);
  assert.equal(ally('footnote').dealIfStaggered, 8);
  assert.equal(ally('lumen').deal, 3);
  assert.equal(ally('lumen').hits, 3);
  assert.equal(TRIAL_CARDS.find((card) => card.id === 'footnote').name, 'Gloss');
  const pool = allyPool({ eliminated: ['thorn'] });
  assert.equal(pool.length, 13);
  assert.equal(pool.find((row) => row.entity_id === 'thorn').ghost, true);
  const tired = slateLegal({ slate: ['hob', 'wren'], previous: ['hob'], pool });
  assert.equal(tired.reason, 'fatigued');
  const fresh = slateLegal({ slate: ['hob', 'wren'], previous: ['juniper'], pool });
  assert.equal(fresh.ok, true);
  const picks = [
    { charId: 'pip', allies: ['hob', 'wren'] },
    { charId: 'twins', allies: ['hob', 'juniper'] },
    { charId: 'vey', allies: ['grub', 'hob'] }
  ];
  assert.deepEqual(sharedPenaltyIds(picks), ['hob']);
  const penalized = cardsForAllies(['hob'], { penalized: ['hob'] })[0];
  assert.equal(penalized.block, 5);
  assert.equal(penalized.keepBlock, 2);
  assert.equal(penalized.sharedPenalty, true);
  const footnote = cardsForAllies(['footnote'], { penalized: ['footnote'] })[0];
  assert.equal(footnote.deal, 3);
  assert.equal(footnote.dealIfStaggered, 7);
});

test('auto-fill skips last chapter and needs five wallets', () => {
  assert.equal(ALLY_QUORUM, 5);
  assert.deepEqual(autoAllies({}), ['hob', 'wren']);
  assert.deepEqual(autoAllies({ previous: ['hob', 'wren'] }), ['juniper', 'footnote']);
  assert.deepEqual(autoAllies({ previous: ['juniper', 'corvin'] }), ['hob', 'wren']);
  const few = ['a', 'b', 'c', 'd'].map((wallet) => ({ wallet }));
  const held = resolveDeckAllies({ allies: ['grub', 'tilde'], votes: few, previous: [] });
  assert.equal(held.autoPicked, true);
  assert.deepEqual(held.allies, ['hob', 'wren']);
  const five = few.concat([{ wallet: 'e' }]);
  const voted = resolveDeckAllies({ allies: ['grub', 'tilde'], votes: five, previous: ['hob'] });
  assert.equal(voted.autoPicked, false);
  assert.deepEqual(voted.allies, ['grub', 'tilde']);
  const scripted = resolveDeckAllies({ allies: ['lumen', 'mira'] });
  assert.equal(scripted.autoPicked, false);
  assert.deepEqual(scripted.allies, ['lumen', 'mira']);
});

test('ally cards do what the content doc says', () => {
  const hob = play([ally('hob')], [{ type: 'play', card: 0 }, { type: 'end' }]);
  assert.equal(hob.turn, 2);
  assert.equal(hob.playerBlock, 3);
  assert.equal(hob.playerHp, 30);
  assert.equal(hob.staggered, true);

  const wren = play([ally('grub'), ally('grub'), ally('grub'), ally('wren')], [{ type: 'play', card: 0 }]);
  assert.equal(wren.combo, 1);
  assert.equal(wren.hand.length, 2);
  assert.deepEqual(wren.revealed.map((row) => row.label), ['🛡 8', '⚔ 9']);

  const juniper = play([ally('juniper')], [{ type: 'play', card: 0 }], { variant: 'D2' });
  assert.equal(juniper.bossGuard, 4);
  assert.equal(juniper.combo, 1);

  const footnote = play(
    [ally('footnote'), ally('hob'), ally('hob'), ally('hob')],
    [{ type: 'play', card: 0 }, { type: 'end' }, { type: 'play', card: 0 }]
  );
  assert.equal(footnote.dealt, 13);

  const index = play([jab, ally('grub'), ally('grub'), ally('index')], [{ type: 'play', card: 0 }]);
  assert.equal(index.combo, 2);
  const indexBlock = play([ally('grub'), ally('grub'), ally('grub'), ally('index')], [{ type: 'play', card: 0 }]);
  assert.equal(indexBlock.combo, 1);

  const croak = play(
    [ally('croak'), ally('wren'), ally('juniper')],
    [{ type: 'play', card: 0 }, { type: 'play', card: 0 }, { type: 'play', card: 0 }]
  );
  assert.equal(croak.combo, 1);
  assert.equal(croak.dealt, 16);

  const mira = play([jab, ally('mira')], [{ type: 'play', card: 0 }, { type: 'play', card: 0 }]);
  assert.equal(mira.dealt, 15);

  const brannoc = play(
    [ally('grub'), ally('grub'), ally('grub'), ally('grub'), ally('brannoc')],
    [{ type: 'play', card: 0 }, { type: 'end' }]
  );
  assert.equal(brannoc.energy, 3);
  assert.equal(brannoc.playerBlock, 0);
  assert.equal(brannoc.playerHp, 30);
  assert.equal(brannoc.hand.length, 4);
  assert.equal(brannoc.staggered, true);

  const lumen = play([ally('lumen')], [{ type: 'play', card: 0 }]);
  assert.equal(lumen.dealt, 10);

  const grub = play([ally('grub')], [{ type: 'play', card: 0 }]);
  assert.equal(grub.playerBlock, 12);
  assert.equal(grub.combo, 1);

  const tilde = play([ally('tilde')], [{ type: 'play', card: 0 }]);
  assert.equal(tilde.intent.n, 4);
  const tildeHit = play([ally('tilde')], [{ type: 'play', card: 0 }, { type: 'end' }]);
  assert.equal(tildeHit.playerHp, 26);
  const tildeFades = play(
    [ally('grub'), ally('grub'), ally('grub'), ally('tilde')],
    [{ type: 'play', card: 0 }, { type: 'end' }, { type: 'end' }]
  );
  assert.equal(tildeFades.turn, 3);
  assert.equal(tildeFades.intent.n, 9);
  const tildeHolds = play(
    [ally('tilde'), ally('grub'), ally('grub'), ally('grub'), ally('grub'), ally('grub')],
    [{ type: 'end' }, { type: 'play', card: 2 }, { type: 'end' }]
  );
  assert.equal(tildeHolds.turn, 3);
  assert.equal(tildeHolds.intent.n, 7);

  const finisher = play([ally('corvin')], [{ type: 'play', card: 0 }], { openingBossHp: 36 });
  assert.equal(finisher.dealt, 16);
  const early = play([ally('corvin')], [{ type: 'play', card: 0 }], { openingBossHp: 100 });
  assert.equal(early.dealt, 5);
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

test('every deck is 12 cards, and a short vote is auto-picked', async () => {
  const bare = replayTrial('ab'.repeat(32), [], open());
  assert.equal(bare.boss, 'The First Stain');
  assert.equal(replayTrial('ab'.repeat(32), [], { ...open(), chapter: 7 }).boss, 'The Closing Hand');
  assert.equal(bare.deckSize, 12);
  assert.equal(bare.autoPicked, true);
  assert.deepEqual(bare.allies, ['hob', 'wren']);
  const withAllies = replayTrial('ab'.repeat(32), [], { ...open(), allies: ['lumen', 'grub'] });
  assert.equal(withAllies.deckSize, 12);
  assert.deepEqual(withAllies.allies, ['lumen', 'grub']);
  resetMemory();
  const env = { SEASON_ALLOW_DEMO: '1' };
  const roster = [
    { wallet: 'beta', cp: 9, held: true, cluster: 'desk' },
    { wallet: 'alpha', cp: 5, held: true, cluster: 'desk' },
    { wallet: 'gamma', cp: 4, held: true, cluster: 'gamma' }
  ];
  const propose = await handleApi(new Request('http://season.local/api/season/allies/propose', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: 'beta', charId: 'twins', chapter: 1, slate: ['grub', 'tilde'], roster })
  }), env);
  assert.equal((await propose.json()).ok, true);
  const paid = await handleApi(new Request('http://season.local/api/season/allies/propose', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: 'beta', charId: 'pip', chapter: 1, slate: ['grub', 'tilde'], sol: 1 })
  }), env);
  assert.equal((await paid.json()).reason, 'lineup_is_free');
  const start = async (chapter) => {
    const res = await handleApi(new Request('http://season.local/api/season/trial/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: 'beta', charId: 'twins', chapter, now: Date.parse('2026-10-16T12:00:00.000Z') })
    }), env);
    return res.json();
  };
  const short = await start(1);
  assert.equal(short.context.autoPicked, true);
  assert.deepEqual(short.context.allies, ['hob', 'wren']);
  for (const wallet of ['w1', 'w2', 'w3', 'w4']) {
    const vote = await handleApi(new Request('http://season.local/api/season/allies/vote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet, charId: 'twins', chapter: 1, veto: false })
    }), env);
    assert.equal((await vote.json()).ok, true);
  }
  const stillShort = await start(1);
  assert.equal(stillShort.context.autoPicked, true);
  assert.deepEqual(stillShort.context.allies, ['hob', 'wren']);
  const fifth = await handleApi(new Request('http://season.local/api/season/allies/vote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: 'w5', charId: 'twins', chapter: 1, veto: false })
  }), env);
  assert.equal((await fifth.json()).passed, true);
  const chosen = await start(1);
  assert.equal(chosen.context.autoPicked, false);
  assert.deepEqual(chosen.context.allies, ['grub', 'tilde']);
  const next = await start(2);
  assert.equal(next.context.autoPicked, true);
  assert.deepEqual(next.context.allies, ['hob', 'wren']);
  const sheet = await handleApi(new Request('http://season.local/api/season/allies?charId=pip&chapter=1'), env);
  const body = await sheet.json();
  assert.equal(body.autoPicked, true);
  assert.deepEqual(body.deckAllies, ['hob', 'wren']);
});
