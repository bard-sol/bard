import { trialSeed, utcDateKey, encounterFromSeed, replayTrial, trialTimeOk, accuraciesInWindow, meanAccuracy, cardUpgradeOffer } from '../lib/trial.js';
import { openChest, publishedOdds } from '../lib/chest.js';
import { buildRecap, castCrowdVote, CROWD_OPTIONS } from '../lib/recap.js';
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
  if (path === '/api/season/letter' && request.method === 'POST') return onLetter(body);
  if (path === '/api/season/touch' && request.method === 'POST') return onTouch(body);
  if (path === '/api/season/chest/odds' && request.method === 'GET') {
    return json({ ok: true, odds: publishedOdds(), pity: 10, purchasable: false });
  }
  if (path === '/api/season/chest/open' && request.method === 'POST') return onChest(body);
  if (path === '/api/season/crowd-vote' && request.method === 'POST') return onCrowd(body);
  if (path === '/api/season/crowd-vote' && request.method === 'GET') return json({ ok: true, options: CROWD_OPTIONS, narrationOnly: true });
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
  const seed = await trialSeed('s0', day);
  const encounter = encounterFromSeed(seed);
  const countedKey = wallet + '|' + day;
  const already = loopMemory().trials.has(countedKey);
  return json({
    ok: true,
    seed,
    day,
    practice: !!body.practice || already,
    alreadyCounted: already,
    startedAt: now,
    boss: encounter.boss,
    bossHp: encounter.bossHp,
    hand: encounter.hand,
    intents: encounter.intents,
    intent: encounter.intents[0]
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
  const replay = replayTrial(seed, body.moves || []);
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
    damage: replay.damage,
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

function onLetter(body) {
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
  const chest = rollChest(wallet);
  return json({ ok: true, choice: body.choice, streak, chest, activeForScore: false });
}

function onTouch(body) {
  const wallet = walletOf(body);
  if (!wallet) return bad('missing_wallet');
  if (!['cheer', 'vote', 'trial', 'letter'].includes(body.kind)) return bad('bad_kind');
  const streak = touch(wallet, Number(body.now) || Date.now());
  return json({ ok: true, kind: body.kind, streak, repairPurchasable: false, activeForScore: false });
}

function rollChest(wallet) {
  const memory = loopMemory();
  const state = memory.chests.get(wallet) || { sinceRare: 0, items: [] };
  const opened = openChest({
    rng: Math.random,
    sinceRare: state.sinceRare,
    pay: null
  });
  if (!opened.ok) return opened;
  state.sinceRare = opened.sinceRare;
  state.items.push({ item: opened.item, rarity: opened.rarity, transferable: false, nft: false });
  memory.chests.set(wallet, state);
  return opened;
}

function onChest(body) {
  const wallet = walletOf(body);
  if (!wallet) return bad('missing_wallet');
  if (body.pay != null || body.price != null || body.buy) return json({ ok: false, reason: 'chests_are_free' });
  const memory = loopMemory();
  const state = memory.chests.get(wallet) || { sinceRare: 0, items: [] };
  const opened = openChest({ rng: Math.random, sinceRare: state.sinceRare, pay: body.pay });
  if (!opened.ok) return json(opened);
  state.sinceRare = opened.sinceRare;
  state.items.push({ item: opened.item, rarity: opened.rarity, transferable: false, nft: false });
  memory.chests.set(wallet, state);
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

function onQuiz(body) {
  if (!Array.isArray(body.answers) || body.answers.length !== 4) return bad('four_answers');
  const character = suggestCharacter(body.answers);
  return json({ ok: true, character: { id: character.id, name: character.name, hook: character.hook }, story: storyPage(character.id) });
}
