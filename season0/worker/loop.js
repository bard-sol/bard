import { trialSeed, utcDateKey, replayTrial, trialTimeOk, trialContext, accuraciesInWindow, meanAccuracy, cardUpgradeOffer, simulateTrialMedian } from '../lib/trial.js';
import { openChest, publishedOdds, chestSeed } from '../lib/chest.js';
import { contributionPoints, contributorPool, impactReadout } from '../lib/contribution.js';
import { simulateSeason } from '../lib/survival.js';
import { buildRecap, castCrowdVote, CROWD_OPTIONS } from '../lib/recap.js';
import {
  SIM_ALLIES,
  allyPool,
  castAllyVote,
  lineupPayment,
  pickProposer,
  resolveDeckAllies,
  sharedPenaltyIds,
  slateLegal,
  tallyVeto
} from '../lib/allies.js';
import { allowPush } from '../lib/notify.js';
import { advanceStreak, utcDay } from '../lib/morale.js';
import { seasonLegacy } from '../lib/legacy.js';
import { suggestCharacter, storyPage, QUIZ } from '../lib/quiz.js';
import { loopMemory } from './store.js';

const LETTERS = ['feed', 'comfort', 'spar'];

function json(body, status) {
  return Response.json(body, { status: status || 200, headers: { 'cache-control': 'no-store' } });
}

function bad(reason) {
  return json({ ok: false, reason }, 400);
}

function walletOf(body) {
  return String((body && body.wallet) || '');
}

function touch(wallet, nowMs) {
  const memory = loopMemory();
  const next = advanceStreak(memory.streaks.get(wallet), nowMs);
  memory.streaks.set(wallet, next);
  return next;
}

export async function handleLoop(path, request, env, body) {
  const url = new URL(request.url);
  if (path === '/api/season/raid' || path.startsWith('/api/season/raid/')) {
    return json({ ok: false, reason: 'not_in_season_0' }, 404);
  }
  if (path === '/api/season/card-upgrade' && request.method === 'GET') return json({ ok: true, ...cardUpgradeOffer() });
  if (path === '/api/season/trial/start' && request.method === 'POST') return onTrialStart(body);
  if (path === '/api/season/trial/finish' && request.method === 'POST') return onTrialFinish(body);
  if (path === '/api/season/trial/k' && request.method === 'POST') return onTrialK(body);
  if (path === '/api/season/trial/sim' && request.method === 'GET') return onTrialSim(url);
  if (path === '/api/season/impact' && request.method === 'POST') return onImpact(body);
  if (path === '/api/season/contrib-pool' && request.method === 'POST') return onPool(body);
  if (path === '/api/season/survival' && request.method === 'GET') return onSurvival();
  if (path === '/api/season/letter' && request.method === 'POST') return onLetter(body);
  if (path === '/api/season/touch' && request.method === 'POST') return onTouch(body);
  if (path === '/api/season/chest/odds' && request.method === 'GET') {
    return json({ ok: true, odds: publishedOdds(), pity: 10, purchasable: false });
  }
  if (path === '/api/season/chest/open' && request.method === 'POST') return onChest(body);
  if (path === '/api/season/crowd-vote' && request.method === 'POST') return onCrowd(body);
  if (path === '/api/season/crowd-vote' && request.method === 'GET') return json({ ok: true, options: CROWD_OPTIONS, narrationOnly: true });
  if (path === '/api/season/allies' && request.method === 'GET') return onAllies(url);
  if (path === '/api/season/allies/propose' && request.method === 'POST') return onAllyPropose(body);
  if (path === '/api/season/allies/vote' && request.method === 'POST') return onAllyVote(body);
  if (path === '/api/season/recap' && request.method === 'GET') return onRecap(url);
  if (path === '/api/season/push/vapid' && request.method === 'GET') {
    const key = env && env.BARD_VAPID_PUBLIC;
    return json({ ok: !!key, publicKey: key || null, capPerDay: 3, reason: key ? undefined : 'push_not_configured' });
  }
  if (path === '/api/season/push/subscribe' && request.method === 'POST') return onSubscribe(body);
  if (path === '/api/season/push/send' && request.method === 'POST') return onPush(env, body);
  if (path === '/api/season/turnstile' && request.method === 'POST') return onTurnstile(env, body);
  if (path === '/api/season/legacy' && request.method === 'POST') return onLegacy(body);
  if (path === '/api/season/quiz' && request.method === 'POST') return onQuiz(body);
  if (path === '/api/season/story' && request.method === 'GET') {
    const page = storyPage(url.searchParams.get('id'));
    if (!page) return bad('unknown_character');
    return json({ ok: true, story: page });
  }
  return json({ ok: false, reason: 'not_found' }, 404);
}

async function onTrialStart(body) {
  const wallet = walletOf(body);
  if (!wallet) return bad('missing_wallet');
  const now = Number(body.now) || Date.now();
  const day = body.day || utcDateKey(now);
  const ctx = trialContext({
    charId: body.charId,
    chapter: body.chapter,
    now,
    train: body.train,
    inDanger: body.inDanger
  });
  applyAllies(ctx, body.charId, body.chapter);
  const seed = await trialSeed('s0', day);
  const view = replayTrial(seed, [], ctx);
  const countedKey = wallet + '|' + day;
  const already = loopMemory().trials.has(countedKey);
  return json({
    ok: true,
    seed,
    day,
    context: ctx,
    practice: !!body.practice || already,
    alreadyCounted: already,
    startedAt: now,
    boss: view.boss,
    bossHp: view.bossMax,
    art: view.art,
    variant: view.variant,
    chapter: view.chapter,
    hand: view.hand,
    intent: view.intent,
    playerHp: view.playerHp,
    passive: view.passive
  });
}

async function onTrialFinish(body) {
  const wallet = walletOf(body);
  if (!wallet) return bad('missing_wallet');
  const now = Number(body.now) || Date.now();
  const day = body.day || utcDateKey(now);
  const seed = await trialSeed('s0', day);
  if (body.seed && body.seed !== seed) return bad('seed_mismatch');
  if (!trialTimeOk(body.elapsedMs)) return bad('time_cap');
  const ctx = trialContext({
    charId: body.charId,
    chapter: body.chapter,
    now,
    train: body.train,
    inDanger: body.inDanger
  });
  applyAllies(ctx, body.charId, body.chapter);
  const replay = replayTrial(seed, body.moves || [], ctx);
  if (!replay.ok) return json(replay);
  const key = wallet + '|' + day;
  const memory = loopMemory();
  const practice = !!body.practice;
  let counted = false;
  if (!practice && !memory.trials.has(key)) {
    memory.trials.set(key, { day, accuracy: replay.accuracy, wallet });
    counted = true;
  }
  const streak = touch(wallet, now);
  return json({
    ok: true,
    accuracy: replay.accuracy,
    damagePercent: replay.damagePercent,
    damage: replay.dealt,
    ended: replay.ended,
    timeCapped: Number(body.elapsedMs) > 60000,
    grid: replay.grid,
    counted,
    practice: practice || !counted,
    alreadyCounted: !practice && !counted,
    streak,
    clientMatched: body.clientAccuracy == null || Math.abs(Number(body.clientAccuracy) - replay.accuracy) < 1e-9
  });
}

function onTrialK(body) {
  const values = accuraciesInWindow(Number(body.t0), Number(body.snapshot), body.byDay || {});
  return json({ ok: true, days: values, k: meanAccuracy(values) });
}

async function onLetter(body) {
  const wallet = walletOf(body);
  if (!wallet) return bad('missing_wallet');
  if (!LETTERS.includes(body.choice)) return bad('bad_choice');
  const now = Number(body.now) || Date.now();
  const day = utcDay(now);
  const key = wallet + '|' + day;
  const memory = loopMemory();
  if (memory.letters.has(key)) return json({ ok: false, reason: 'already', streak: memory.streaks.get(wallet) || null });
  memory.letters.set(key, body.choice);
  const streak = touch(wallet, now);
  const chest = await rollChest(wallet, now, streak);
  let bonus = null;
  if (streak.advanced && (streak.streak === 7 || streak.streak === 14)) {
    bonus = await rollChest(wallet, now, streak);
  }
  return json({ ok: true, choice: body.choice, streak, chest, bonus, activeForScore: false });
}

function onTouch(body) {
  const wallet = walletOf(body);
  if (!wallet) return bad('missing_wallet');
  if (!['cheer', 'vote', 'trial', 'letter'].includes(body.kind)) return bad('bad_kind');
  const streak = touch(wallet, Number(body.now) || Date.now());
  return json({ ok: true, kind: body.kind, streak, repairPurchasable: false, activeForScore: false });
}

async function rollChest(wallet, now, streak) {
  const memory = loopMemory();
  const state = memory.chests.get(wallet) || { sinceRare: 0, items: [], owned: [] };
  const day = utcDateKey(now);
  const seedHex = await chestSeed(wallet, day + ':' + state.owned.length);
  const opened = await openChest({
    seedHex,
    sinceRare: state.sinceRare,
    owned: state.owned,
    streak: streak && streak.streak,
    dayOfSeason: dayOfSeason(now),
    pay: null
  });
  if (!opened.ok) return opened;
  state.sinceRare = opened.sinceRare;
  state.owned.push(opened.id);
  state.items.push({ item: opened.item, id: opened.id, rarity: opened.rarity, transferable: false, nft: false });
  memory.chests.set(wallet, state);
  return opened;
}

function dayOfSeason(now) {
  const start = Date.parse('2026-10-16T00:00:00.000Z');
  return Math.floor((Number(now) - start) / 86400000) + 1;
}

async function onChest(body) {
  const wallet = walletOf(body);
  if (!wallet) return bad('missing_wallet');
  if (body.pay != null || body.price != null || body.buy) return json({ ok: false, reason: 'chests_are_free' });
  const now = Number(body.now) || Date.now();
  const opened = await rollChest(wallet, now, null);
  if (!opened.ok) return json(opened);
  return json({ ok: true, ...opened, odds: publishedOdds() });
}

function onCrowd(body) {
  const wallet = walletOf(body);
  if (!wallet || body.chapter == null) return bad('missing_fields');
  const key = wallet + '|' + body.chapter;
  const memory = loopMemory();
  const vote = castCrowdVote({ already: memory.crowd.has(key), optionId: body.option });
  if (!vote.ok) return json(vote);
  memory.crowd.set(key, vote.option.id);
  const streak = touch(wallet, Number(body.now) || Date.now());
  memory.streaks.get(wallet).legacyCrowd = (memory.streaks.get(wallet).legacyCrowd || 0) + 1;
  return json({ ok: true, ...vote, streak });
}

function allyKey(charId, chapter) {
  return String(charId || '') + '|' + String(chapter);
}

function eliminatedOf(body) {
  const raw = body && (body.eliminated || body.ghosts) || [];
  return Array.isArray(raw) ? raw : String(raw).split(',').filter(Boolean);
}

function previousOf(charId, chapter, body) {
  if (body && Array.isArray(body.previousAllies)) return body.previousAllies;
  const ch = Number(chapter) || 1;
  if (ch <= 1) return [];
  return alliesFor(charId, ch - 1).allies;
}

function acceptedSlate(record) {
  if (!record || !Array.isArray(record.slate) || record.slate.length !== 2) return [];
  const tally = tallyVeto(record.roster || [], record.votes || []);
  if (!tally.passed) return [];
  return record.slate;
}

/** Voted slate only counts with 5 or more wallets. Otherwise the lowest unfatigued numbers fill the deck. */
function alliesFor(charId, chapter) {
  const ch = Number(chapter) || 1;
  const previous = ch <= 1 ? [] : alliesFor(charId, ch - 1).allies;
  const record = loopMemory().allies.get(allyKey(charId, ch));
  return resolveDeckAllies({
    allies: acceptedSlate(record),
    votes: record && Array.isArray(record.votes) ? record.votes : [],
    previous
  });
}

function rosterOf(body, wallet) {
  if (body && Array.isArray(body.roster) && body.roster.length) return body.roster;
  const lead = wallet || 'demo';
  return [
    { wallet: lead, cp: 12, held: true, cluster: lead },
    { wallet: 'margin-fan', cp: 5, held: true, cluster: 'margin-fan' },
    { wallet: 'ink-fan', cp: 4, held: true, cluster: 'ink-fan' },
    { wallet: lead + '-desk', cp: 9, held: true, cluster: lead }
  ];
}

function chapterPicks(chapter) {
  const picks = [];
  for (const [key, row] of loopMemory().allies) {
    if (!row) continue;
    const parts = key.split('|');
    if (Number(parts[1]) !== Number(chapter)) continue;
    const allies = Array.isArray(row.fielded) ? row.fielded : alliesFor(parts[0], chapter).allies;
    picks.push({ entity_id: parts[0], entity_type: 'character', allies });
  }
  return picks;
}

function allyView(charId, chapter, body) {
  const eliminated = eliminatedOf(body);
  const pool = allyPool({ eliminated });
  const record = loopMemory().allies.get(allyKey(charId, chapter)) || null;
  const roster = (record && record.roster) || rosterOf(body, record && record.wallet);
  const proposer = pickProposer({ wallets: roster, chapter, skip: record ? record.failed : [] });
  const resolved = alliesFor(charId, chapter);
  const picks = chapterPicks(chapter);
  if (!picks.some((row) => row.entity_id === charId)) {
    picks.push({ entity_id: charId, entity_type: 'character', allies: resolved.allies });
  }
  const penalized = sharedPenaltyIds(picks);
  const tally = record && record.slate ? tallyVeto(roster, record.votes) : null;
  const passed = !!(record && record.slate && tally && tally.passed && resolved.wallets >= 5 && !resolved.autoPicked);
  return {
    ok: true,
    charId,
    chapter: Number(chapter),
    pool,
    proposer,
    slate: passed ? resolved.allies : null,
    proposal: record ? record.slate : null,
    deckAllies: resolved.allies,
    autoPicked: resolved.autoPicked,
    voteWallets: resolved.wallets,
    quorum: 5,
    failed: record ? record.failed : [],
    votes: record ? record.votes : [],
    tally,
    passed,
    penalized,
    previousAllies: previousOf(charId, chapter, body),
    payout: false,
    fee: false,
    cosmetic: true,
    cap: 0.02,
    simAllies: SIM_ALLIES
  };
}

function onAllies(url) {
  const charId = url.searchParams.get('charId') || 'pip';
  const chapter = Number(url.searchParams.get('chapter') || 1);
  const eliminated = (url.searchParams.get('eliminated') || '').split(',').filter(Boolean);
  return json(allyView(charId, chapter, { eliminated }));
}

function onAllyPropose(body) {
  const paid = lineupPayment(body);
  if (!paid.ok) return json(paid);
  const wallet = walletOf(body);
  if (!wallet || !body.charId || body.chapter == null) return bad('missing_fields');
  const chapter = Number(body.chapter);
  const pool = allyPool({ eliminated: eliminatedOf(body) });
  const legal = slateLegal({ slate: body.slate, previous: previousOf(body.charId, chapter, body), pool });
  if (!legal.ok) return json(legal);
  const memory = loopMemory();
  const key = allyKey(body.charId, chapter);
  const record = memory.allies.get(key) || { slate: null, votes: [], failed: [], passed: false, wallet };
  if (record.passed) return json({ ok: false, reason: 'already' });
  const roster = rosterOf(body, wallet);
  const proposer = pickProposer({ wallets: roster, chapter, skip: record.failed });
  if (!proposer) return json({ ok: false, reason: 'no_proposer' });
  if (proposer.wallet !== wallet) return json({ ok: false, reason: 'not_proposer', proposer: proposer.wallet });
  if (record.slate) return json({ ok: false, reason: 'already' });
  record.slate = legal.slate;
  record.votes = [];
  record.passed = false;
  record.wallet = wallet;
  record.proposer = proposer.wallet;
  record.roster = roster;
  memory.allies.set(key, record);
  return json({ ok: true, ...paid, proposer, slate: legal.slate, tally: tallyVeto(roster, []), passed: false });
}

function onAllyVote(body) {
  const paid = lineupPayment(body);
  if (!paid.ok) return json(paid);
  const wallet = walletOf(body);
  if (!wallet || !body.charId || body.chapter == null) return bad('missing_fields');
  const chapter = Number(body.chapter);
  const key = allyKey(body.charId, chapter);
  const record = loopMemory().allies.get(key);
  if (!record || !record.slate) return json({ ok: false, reason: 'no_proposal' });
  const vote = castAllyVote({ already: record.votes.some((row) => row.wallet === wallet), veto: body.veto });
  if (!vote.ok) return json(vote);
  record.votes.push({ wallet, veto: vote.veto, weight: Number(body.weight) || 1 });
  const roster = record.roster || rosterOf(body, record.wallet);
  const tally = tallyVeto(roster, record.votes);
  if (!tally.passed) {
    record.failed.push(record.proposer);
    record.slate = null;
    record.votes = [];
    record.passed = false;
  } else {
    record.passed = true;
  }
  const streak = touch(wallet, Number(body.now) || Date.now());
  return json({ ok: true, ...vote, tally, passed: record.passed, slate: record.slate, streak });
}

function applyAllies(ctx, charId, chapter) {
  const resolved = alliesFor(charId, chapter);
  ctx.allies = resolved.allies.slice();
  ctx.autoPicked = resolved.autoPicked;
  const memory = loopMemory();
  const key = allyKey(charId, chapter);
  const record = memory.allies.get(key) || { slate: null, votes: [], failed: [], passed: false };
  record.fielded = resolved.allies.slice();
  record.autoPicked = resolved.autoPicked;
  memory.allies.set(key, record);
  ctx.penalizedAllies = sharedPenaltyIds(chapterPicks(chapter));
  return ctx;
}

function onRecap(url) {
  const chapter = Number(url.searchParams.get('chapter') || 1);
  const now = Number(url.searchParams.get('now') || Date.now());
  let line = url.searchParams.get('crowd') || '';
  const wallet = url.searchParams.get('wallet') || '';
  if (!line && wallet) {
    const optionId = loopMemory().crowd.get(wallet + '|' + chapter);
    const option = CROWD_OPTIONS.find((row) => row.id === optionId);
    if (option) line = option.line;
  }
  return json({ ok: true, ...buildRecap({ chapter, nowMs: now, crowdLine: line || null }) });
}

function onSubscribe(body) {
  const wallet = walletOf(body);
  if (!wallet || !body.subscription) return bad('missing_fields');
  loopMemory().pushSubs.set(wallet, body.subscription);
  return json({ ok: true, stored: true, capPerDay: 3 });
}

function onPush(env, body) {
  const wallet = walletOf(body);
  if (!wallet) return bad('missing_wallet');
  const day = utcDateKey(Number(body.now) || Date.now());
  const key = wallet + '|' + day;
  const memory = loopMemory();
  const sent = memory.pushSent.get(key) || 0;
  const gate = allowPush({ sent, cap: 3 });
  if (!gate.ok) return json(gate);
  if (!(env && env.BARD_VAPID_PRIVATE)) {
    return json({
      ok: false,
      reason: 'push_not_configured',
      sent,
      note: 'The 3-a-day cap is enforced. Nothing was sent without a VAPID key.'
    });
  }
  memory.pushSent.set(key, gate.sent);
  return json({ ok: true, delivered: false, reason: 'push_worker_not_deployed', sent: gate.sent });
}

function onTurnstile(env, body) {
  const wallet = walletOf(body);
  if (!wallet) return bad('missing_wallet');
  const devOk = env && env.SEASON_DEV_SKIP_TURNSTILE === '1' && body.token === 'dev';
  if (!devOk && !(env && env.TURNSTILE_SECRET)) return json({ ok: false, reason: 'turnstile_not_configured' });
  if (!devOk) return json({ ok: false, reason: 'turnstile_not_checked', note: 'The dev server does not call Cloudflare.' });
  loopMemory().turnstile.add(wallet);
  return json({ ok: true, passed: true, dev: true });
}

function onLegacy(body) {
  const wallet = walletOf(body);
  const memory = loopMemory();
  const events = body.events || [];
  const streak = wallet ? memory.streaks.get(wallet) : null;
  if (streak && streak.legacyCrowd) events.push({ id: 'crowd', points: streak.legacyCrowd });
  return json({
    ok: true,
    ...seasonLegacy({
      events,
      turnstile: wallet ? memory.turnstile.has(wallet) : false,
      onChain: wallet ? memory.onchain.has(wallet) : false
    })
  });
}

async function onTrialSim(url) {
  const runs = Math.min(400, Math.max(20, Number(url.searchParams.get('runs') || 300)));
  const report = await simulateTrialMedian(runs);
  return json({ ok: true, ...report });
}

function onImpact(body) {
  const wallet = body.walletRow || { wallet: walletOf(body), trialAccuracy: body.trialAccuracy, decided: body.decided, captain: body.captain, trained: body.trained, champion: body.champion, clutch: body.clutch, balance: body.balance };
  return json({ ok: true, ...impactReadout(wallet, body.peers || [wallet]), points: contributionPoints(wallet) });
}

function onPool(body) {
  return json(contributorPool(body));
}

async function onSurvival() {
  const report = await simulateSeason('s0-survival');
  return json({ ok: true, ...report });
}

function onQuiz(body) {
  if (!Array.isArray(body.answers) || body.answers.length !== 4) return bad('four_answers');
  const character = suggestCharacter(body.answers);
  return json({ ok: true, character: { id: character.id, name: character.name, hook: character.hook }, story: storyPage(character.id) });
}
