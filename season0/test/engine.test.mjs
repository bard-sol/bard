import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex, fromHex, u64le } from '../lib/bytes.js';
import { defaultConfig, eligibilityMinSol, DEVNET_RPC } from '../lib/config.js';
import { assertDevnetEndpoint, assertDevnetGenesis, assertNotLiveSupabase } from '../lib/cluster.js';
import { twapPrice, turnout, scoreCast, margin, chooseMarked, snapshotFromRandomness, reaperSeedMaterial, trainedBonus } from '../lib/score.js';
import { triangle, strikeAccuracy, strikePower, scoreTap } from '../lib/strike.js';
import { applyVoteCap, winningChoice, encounterOutcome } from '../lib/vote.js';
import { splitTrain, actionMemo, revivalTarget, trainCredit } from '../lib/spend.js';
import { pickCounts, predictionPoints } from '../lib/predict.js';
import { voidReason, voidMemo, unstakeMemo, batchStakeReturns, voidEffects, VOID_COPY } from '../lib/voidchapter.js';
import { isEligible, nextHeldSince } from '../lib/eligibility.js';
import { phaseAt } from '../lib/phase.js';
import { assignSquad, rankSquads, removalAfterSnapshot, handlerRanks, cosmeticWinner } from '../lib/squad.js';
import { filterLastWords, reviewLastWords, resolveLastWords, graphemeLength } from '../lib/filter.js';
import { earlyBuyCopy, chapterLegacy } from '../lib/legacy.js';
import { publishPlan } from '../lib/statefile.js';
import { contributorPool } from '../lib/contribution.js';
import { applyCheer } from '../lib/morale.js';
import { dbcConfigParams, CHARACTER_POOLS } from '../lib/dbc.js';
import { transactionAllowed } from '../lib/allowlist.js';
import { CAST, statTotal } from '../lib/cast.js';
import { CHAPTERS } from '../lib/chapters.js';
import { PROGRAMS } from '../lib/config.js';

test('sha256 test vector', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('reaper snapshot is retroactive inside the 12h window and unknown without r', () => {
  const windowStart = 1_700_000_000;
  const r = new Uint8Array(32);
  r[0] = 1;
  assert.equal(u64le(r), 1n);
  assert.equal(snapshotFromRandomness(windowStart, r, 43200), windowStart + 1);
  const late = fromHex('ffffffffffffffff');
  const snap = snapshotFromRandomness(windowStart, late, 43200);
  assert.ok(snap >= windowStart);
  assert.ok(snap < windowStart + 43200);
  assert.equal(reaperSeedMaterial('s0', 3), 'bard|s0|3|reaper');
});

test('square-root turnout matches the brief worked example', () => {
  const small = 40000 / 300;
  const holders = [{ balance: 60000, active: true }];
  for (let i = 0; i < 300; i++) holders.push({ balance: small, active: false });
  const whaleOnly = turnout(holders);
  assert.ok(Math.abs(whaleOnly - 0.066) < 0.002, whaleOnly);

  const smallOnly = turnout(holders.map((h, i) => ({ ...h, active: i > 0 })));
  assert.ok(Math.abs(smallOnly - 0.934) < 0.002, smallOnly);

  const split = [];
  for (let i = 0; i < 30; i++) split.push({ balance: 2000, active: true });
  for (let i = 0; i < 300; i++) split.push({ balance: small, active: false });
  const escaped = turnout(split);
  assert.ok(Math.abs(escaped - 0.279) < 0.002, escaped);
});

test('elimination score weights and margin', () => {
  const supply = 1_000_000_000;
  const scores = scoreCast([
    { id: 'a', twap: 4, supply, trainCredited: 100, encMod: 0, wallets: [{ balance: 10, eligible: true, active: true }], strikeAccuracies: [1] },
    { id: 'b', twap: 1, supply, trainCredited: 0, encMod: 0, wallets: [{ balance: 10, eligible: true, active: false }], strikeAccuracies: [] }
  ]);
  const a = scores.find((s) => s.id === 'a');
  const b = scores.find((s) => s.id === 'b');
  assert.ok(a.S > b.S);
  assert.ok(a.M > b.M);
  assert.ok(a.M < 1);
  assert.equal(a.mom, 0);
  assert.ok(a.S <= 1);
  const m = margin(a.S, b.S);
  assert.ok(m > 0);
});

test('tie goes to lower M then lower U then hash', async () => {
  const marked = await chooseMarked([
    { id: 'a', S: 0.5, M: 0.2, U: 0.4 },
    { id: 'b', S: 0.5, M: 0.2, U: 0.4 }
  ], 'abc', 1);
  assert.equal(marked.length, 1);
  assert.equal(marked[0].entity_type, 'character');
  assert.equal(marked[0].entity_id, marked[0].id);
  const both = await chooseMarked([
    { id: 'high', S: 0.9, M: 0.1, U: 0.1 },
    { id: 'low', S: 0.2, M: 0.9, U: 0.9 }
  ], 'abc', 2);
  assert.deepEqual(both.map((x) => x.id), ['low', 'high']);
});

test('a club scores and pays on the same path as a character', async () => {
  const supply = 1_000_000_000;
  const stats = { twap: 2, supply, trainCredited: 25, encMod: 0, wallets: [{ balance: 10, eligible: true, active: true }], strikeAccuracies: [0.5] };
  const [character, club] = scoreCast([
    { id: 'pip', ...stats },
    { entity_id: 'ink-well', entity_type: 'club', ...stats }
  ]);
  assert.equal(character.entity_type, 'character');
  assert.equal(character.entity_id, 'pip');
  assert.equal(character.id, 'pip');
  assert.equal(club.entity_type, 'club');
  assert.equal(club.entity_id, 'ink-well');
  assert.equal(club.S, character.S);
  const marked = await chooseMarked([character, club], 'draw', 1);
  assert.equal(marked[0].entity_type === 'character' || marked[0].entity_type === 'club', true);
  const pool = contributorPool({
    mode: 'tbard',
    daysSinceFinale: 14,
    entities: [
      { entity_id: 'ink-well', entity_type: 'club', alive: true, wallets: [{ wallet: 'a', trialAccuracy: 1 }] },
      { id: 'pip', alive: false, wallets: [{ wallet: 'z', trialAccuracy: 1 }] }
    ]
  });
  assert.equal(pool.payouts.length, 1);
  assert.equal(pool.payouts[0].entity_id, 'ink-well');
  assert.equal(pool.payouts[0].entity_type, 'club');
  assert.equal(pool.payouts[0].charId, undefined);
  const plan = await publishPlan({
    season: 's0',
    chapter: 2,
    status: 'final',
    characters: [{ id: 'pip', S: character.S }],
    scores: [{ id: 'pip', S: character.S }]
  });
  const body = JSON.parse(plan.body);
  assert.equal(body.scores[0].entity_id, 'pip');
  assert.equal(body.scores[0].entity_type, 'character');
  assert.equal(body.scores[0].id, 'pip');
  assert.equal(body.entities[0].entity_type, 'character');
  assert.equal(body.characters[0].entity_id, 'pip');
});

test('TWAP holds each swap price until the next', () => {
  const px = twapPrice([
    { blockTime: 0, price: 10 },
    { blockTime: 50, price: 30 }
  ], 0, 100);
  assert.equal(px, 20);
});

test('strike curve and timing', () => {
  assert.equal(strikeAccuracy(0.02), 1);
  assert.equal(strikeAccuracy(0.3), 0);
  assert.equal(strikePower(strikeAccuracy(0.16)), 5);
  assert.equal(triangle(0), 0);
  assert.equal(triangle(1.5), 0.5);
  const hit = scoreTap({ phase: 0, speed: 1, clientElapsedMs: 500, serverElapsedMs: 500, tapped: true });
  assert.equal(hit.ok, true);
  assert.ok(hit.accuracy >= 0 && hit.accuracy <= 1);
  const skew = scoreTap({ phase: 0, speed: 1, clientElapsedMs: 500, serverElapsedMs: 4000, tapped: true });
  assert.equal(skew.ok, false);
  const none = scoreTap({ phase: 0, speed: 1, clientElapsedMs: 10000, serverElapsedMs: 10000, tapped: false });
  assert.equal(none.accuracy, 0);
  assert.equal(none.noTap, true);
});

test('50/30/20 split and revival burn target', () => {
  assert.deepEqual(splitTrain(100), { burn: 50, liq: 30, pot: 20, total: 100 });
  assert.deepEqual(splitTrain(11), { burn: 5, liq: 3, pot: 3, total: 11 });
  assert.equal(actionMemo({ action: 'train', charId: 'pip', chapter: 2, nonce: 'abc' }), 'bard:v1:train:pip:2:abc');
  assert.equal(revivalTarget(0), 5000);
  assert.equal(revivalTarget(100000), 35000);
  assert.equal(revivalTarget(1_000_000), 60000);
  assert.equal(trainCredit(100, { discounted: true }), 150);
  assert.equal(trainedBonus(10000), 100);
});

test('vote cap relaxes under 50 voters and encounter stays inside 0.2', () => {
  const capped = applyVoteCap([100, 1, 1], { cap: 0.02, relaxUnder: 50 });
  const total = capped.reduce((a, b) => a + b, 0);
  assert.ok(capped[0] / total <= 1 / 3 + 1e-6);
  const many = applyVoteCap([1000, ...Array.from({ length: 60 }, () => 1)]);
  const t = many.reduce((a, b) => a + b, 0);
  assert.ok(many[0] / t <= 0.021);
  const win = winningChoice([
    { id: 'a', risk: 'BOLD' },
    { id: 'b', risk: 'SAFE' }
  ], {});
  assert.equal(win.apathy, true);
  assert.equal(win.choice.id, 'b');
  const out = encounterOutcome({
    randomness: 1n,
    stat: 80,
    maxStat: 80,
    luck: 50,
    maxLuck: 80,
    winningShare: 0.7,
    risk: 'BOLD',
    apathy: false
  });
  assert.ok(out.encMod <= 0.2 && out.encMod >= -0.2);
  assert.ok(['TRIUMPH', 'SUCCESS', 'SETBACK', 'DISASTER'].includes(out.tier));
});

test('prediction counts only when signed time and receipt are both before the lock', () => {
  const lock = 1_000_000;
  assert.equal(pickCounts({ signedAt: lock, receivedAt: lock, lockAt: lock }), true);
  assert.equal(pickCounts({ signedAt: lock - 1, receivedAt: lock + 1, lockAt: lock }), false);
  assert.equal(pickCounts({ signedAt: lock + 1, receivedAt: lock - 1, lockAt: lock }), false);
  assert.equal(predictionPoints({ counts: false, correct: true, qualified: true, pointsSoFar: 0 }), 0);
  assert.equal(predictionPoints({ counts: true, correct: true, qualified: true, pointsSoFar: 45 }), 5);
  assert.equal(predictionPoints({ counts: true, correct: true, qualified: true, pointsSoFar: 0, voided: true }), 0);
});

test('eligibility_min_sol is 0 on devnet and 0.05 on mainnet; faucet does not qualify', () => {
  const cfg = defaultConfig();
  assert.equal(eligibilityMinSol(cfg, 'devnet'), 0);
  assert.equal(eligibilityMinSol(cfg, 'mainnet'), 0.05);
  const hold = 24 * 3600 * 1000;
  const snap = 10_000_000_000;
  assert.equal(isEligible({ balance: 1, heldSinceMs: snap - hold, snapshotMs: snap, valueSol: 0, minSol: 0, holdMs: hold }), true);
  assert.equal(isEligible({ balance: 1, heldSinceMs: snap - hold, snapshotMs: snap, valueSol: 0.04, minSol: 0.05, holdMs: hold }), false);
  assert.equal(isEligible({ balance: 0, heldSinceMs: snap - hold, snapshotMs: snap, valueSol: 10, minSol: 0, holdMs: hold }), false);
  assert.equal(isEligible({ balance: 5, heldSinceMs: snap - hold + 1, snapshotMs: snap, valueSol: 1, minSol: 0, holdMs: hold }), false);
  assert.equal(nextHeldSince({ prevBalance: 2, nextBalance: 0, prevHeldSince: 1, nowMs: 5 }), null);
  assert.equal(nextHeldSince({ prevBalance: 0, nextBalance: 2, prevHeldSince: null, nowMs: 9 }), 9);
});

test('void memo, unstake batches of about 8, and no legacy on a void', () => {
  const hash = 'ab'.repeat(32);
  assert.equal(voidMemo('s0', 4, 'vrf', hash), 'bard:v1:void:s0:4:vrf:' + hash);
  assert.equal(voidReason({ vrfFailed: true, fallbackFailed: true }), 'vrf');
  assert.equal(voidReason({ indexerOutageHours: 6 }), null);
  assert.equal(voidReason({ indexerOutageHours: 6.1 }), 'indexer');
  assert.equal(voidReason({ exploit: true, vrfFailed: true, fallbackFailed: true }), 'exploit');
  assert.equal(unstakeMemo('s0', 4, '5KabcdefEXTRA'), 'bard:v1:unstake:s0:4:void:5Kabcdef');
  const stakes = Array.from({ length: 17 }, (_, i) => ({ sig: 'sig' + i }));
  const batches = batchStakeReturns(stakes);
  assert.deepEqual(batches.map((b) => b.length), [8, 8, 1]);
  assert.equal(voidEffects().legacyPoints, false);
  assert.equal(voidEffects().keepTrainCredit, true);
  assert.equal(VOID_COPY.exploit.includes('exploit'), true);
  const legacy = chapterLegacy({ voided: true, eligibleStrike: true, trained: true, predictionCorrect: true, predictionCounts: true, predictionQualified: true });
  assert.equal(legacy.points, 0);
});

test('state file proof is the memo; devnet does not use Irys', async () => {
  const plan = await publishPlan({
    season: 's0',
    chapter: 2,
    status: 'void',
    void_reason: 'indexer',
    scores: [{ id: 'pip', S: 0.2 }]
  });
  assert.equal(plan.irys, null);
  assert.ok(plan.memo.startsWith('bard:v1:void:s0:2:indexer:'));
  assert.equal(plan.memo.endsWith(plan.hash), true);
  assert.ok(plan.supabasePath.startsWith('season-state/'));
  assert.ok(plan.githubPath.startsWith('season0/mirror/'));
  assert.equal(plan.githubUrl, 'https://github.com/bard-sol/bard-chapters/blob/main/s0-chapter-2-void.json');
  assert.equal(plan.matches, true);
  assert.equal(plan.fileHash, plan.memoHash);
  const finalPlan = await publishPlan({ season: 's0', chapter: 2, status: 'final', scores: [] });
  assert.ok(finalPlan.memo.startsWith('bard:v1:state:s0:2:'));
});

test('pre-season buy window is 72h and prediction locks at T0+36h', () => {
  const cfg = defaultConfig();
  const t0 = Date.parse(cfg.season_start_utc);
  const pre = phaseAt(t0 - 72 * 3600 * 1000 + 60_000, cfg);
  assert.equal(pre.phase, 'P0');
  assert.equal(phaseAt(t0 - 73 * 3600 * 1000, cfg).phase, 'announced');
  assert.equal(phaseAt(t0, cfg).phase, 'P1');
  assert.equal(phaseAt(t0 + 36 * 3600 * 1000, cfg).phase, 'P2');
  assert.equal(phaseAt(t0 + 48 * 3600 * 1000, cfg).phase, 'P3');
  assert.equal(phaseAt(t0 + 60 * 3600 * 1000, cfg).phase, 'P4');
  assert.equal(phaseAt(t0 + 72 * 3600 * 1000, cfg).chapter, 2);
  assert.equal(phaseAt(t0 + 60 * 3600 * 1000, cfg).predictLock, t0 + 36 * 3600 * 1000);
});

test('last words filter then review hook then fallback', () => {
  assert.equal(filterLastWords('See you at https://evil.example').ok, false);
  assert.equal(filterLastWords('send it to So11111111111111111111111111111111111111112').category, 'address');
  assert.equal(filterLastWords('buy $BARD now').category, 'ticker');
  assert.equal(filterLastWords('hey @someone').category, 'handle');
  assert.equal(filterLastWords('a clean line for the page').ok, true);
  assert.equal(graphemeLength('é'), 1);
  const reviewed = reviewLastWords('I will find you tomorrow');
  assert.equal(reviewed.ok, false);
  assert.equal(reviewed.category, 'Harassment or threats');
  const resolved = resolveLastWords({
    submissions: [{ wallet: 'A', text: 'I will find you tomorrow', votes: 3, submittedAt: 1 }],
    fallback: 'The ink kept this line.'
  });
  assert.equal(resolved.source, 'fallback');
  assert.equal(resolved.line, 'The ink kept this line.');
  const ok = resolveLastWords({
    submissions: [
      { wallet: 'A', text: 'Hold the page.', votes: 1, submittedAt: 2 },
      { wallet: 'B', text: 'We were here.', votes: 1, submittedAt: 1 }
    ],
    fallback: 'fallback'
  });
  assert.equal(ok.line, 'We were here.');
});

test('squads, handler rank, cheer shields, and early-buy flag', () => {
  const squads = [];
  for (let i = 0; i < 26; i++) assignSquad(squads, 'w' + i, 25);
  assert.equal(squads.length, 2);
  assert.equal(squads[0].members.length, 25);
  const ranked = rankSquads([
    { number: 1, members: Array.from({ length: 5 }, () => ({ active: true, strikeAccuracy: 0.2, trained: 1 })) },
    { number: 2, members: Array.from({ length: 4 }, () => ({ active: true, strikeAccuracy: 1, trained: 100 })) }
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].squad.number, 1);
  const removal = removalAfterSnapshot({ consecutiveIneligible: 1, eligibleNow: false, chapterVoided: false });
  assert.equal(removal.removed, true);
  const ignored = removalAfterSnapshot({ consecutiveIneligible: 1, eligibleNow: false, chapterVoided: true });
  assert.equal(ignored.removed, false);
  const ranks = handlerRanks([
    { wallet: 'a', strikePower: 10, train: 0, decideWeight: 0, earliest: 5 },
    { wallet: 'b', strikePower: 10, train: 0, decideWeight: 0, earliest: 1 }
  ]);
  assert.equal(ranks[0].wallet, 'b');
  const win = cosmeticWinner([{ id: 'a' }, { id: 'b' }], { a: 1, b: 1 });
  assert.equal(win.option.id, 'a');
  assert.equal(win.tie, true);
  const day = 86400000;
  const first = applyCheer({ lastDay: null, streak: 0, shields: 0, nowMs: day });
  assert.equal(first.streak, 1);
  assert.equal(first.activeForScore, false);
  const cfg = defaultConfig();
  assert.equal(cfg.legacy_early_buy_enabled, true);
  assert.equal(cfg.comeback_vote_enabled, false);
  assert.equal(cfg.relic_burn_enabled, false);
  assert.match(earlyBuyCopy(cfg), /first buying window/);
  assert.match(earlyBuyCopy({ legacy_early_buy_enabled: false }), /switched off/);
});

test('cast is eight fair characters and chapters have three stats and risks', () => {
  assert.equal(CAST.length, 8);
  for (const c of CAST) {
    assert.equal(statTotal(c), 200);
    assert.ok(graphemeLength(c.fallback) <= 140);
    assert.equal(c.cosmetics.length, 3);
  }
  assert.equal(CHAPTERS.length, 7);
  for (const ch of CHAPTERS) {
    assert.equal(new Set(ch.choices.map((c) => c.stat)).size, 3);
    assert.equal(new Set(ch.choices.map((c) => c.risk)).size, 3);
  }
});

test('DBC params and cluster guards never accept mainnet', () => {
  const params = dbcConfigParams({ feeClaimer: 'FEE', leftoverReceiver: 'LEFT' });
  assert.equal(params.cluster, 'devnet');
  assert.equal(params.baseFeeBps, 200);
  assert.equal(params.partnerLockedLpPercentage, 100);
  assert.equal(params.creatorTradingFeePercentage, 0);
  assert.equal(params.migrationOption, 1);
  assert.equal(params.migrationFeeOption, 6);
  assert.equal(params.migrationQuoteThresholdSol, 85);
  assert.equal(params.supply, 1_000_000_000);
  assert.equal(CHARACTER_POOLS.length, 8);
  assert.equal(assertDevnetEndpoint(DEVNET_RPC), DEVNET_RPC);
  assert.throws(() => assertDevnetEndpoint('https://api.mainnet-beta.solana.com'), /mainnet/);
  assert.throws(() => assertDevnetGenesis('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'), /mainnet/);
  assert.throws(() => assertNotLiveSupabase('https://pxdiyukxgnphxlknhmke.supabase.co'), /pxdiyukxgnphxlknhmke/);
});

test('bard-sign allowlist rejects unknown programs and accepts a memo', async () => {
  assert.equal(await transactionAllowed([{ programId: PROGRAMS.memo, data: new Uint8Array([1]) }], {}), true);
  assert.equal(await transactionAllowed([{ programId: 'NotAProgram', data: new Uint8Array() }], {}), false);
  assert.equal(await transactionAllowed([{ programId: PROGRAMS.token, data: new Uint8Array([3]) }], {}), true);
  assert.equal(await transactionAllowed([{ programId: PROGRAMS.system, destination: 'DEST', data: new Uint8Array() }], { destinations: ['OTHER'] }), false);
});
