import { defaultConfig, DEVNET_RPC, eligibilityMinSol } from '../lib/config.js';
import { assertDevnetEndpoint, assertNotLiveSupabase } from '../lib/cluster.js';
import { hmacHex, sha256Hex, timingSafeEqual } from '../lib/bytes.js';
import { splitTrain, actionMemo, toBaseUnits, revivalTarget } from '../lib/spend.js';
import { matchSpend, instructionsFromParsed } from '../lib/matchspend.js';
import { scoreCast, twapPrice, snapshotFromRandomness, reaperSeedMaterial } from '../lib/score.js';
import { scoreTap } from '../lib/strike.js';
import { filterLastWords, reviewLastWords, resolveLastWords } from '../lib/filter.js';
import { pickCounts } from '../lib/predict.js';
import { isEligible } from '../lib/eligibility.js';
import { voidReason, voidMemo, unstakeMemo, batchStakeReturns, VOID_COPY } from '../lib/voidchapter.js';
import { publishPlan, mirrorLinks } from '../lib/statefile.js';
import { fromHex } from '../lib/bytes.js';
import { canonicalMessage, verifyWalletSignature } from './sig.js';
import { consumeNonce, rememberNonce, takeNonce } from './store.js';
import { bardSign } from './bard-sign.js';

let ephemeralSecret = null;

function seasonSecret(env) {
  if (env && env.BARD_SEASON_SECRET) return env.BARD_SEASON_SECRET;
  if (!ephemeralSecret) ephemeralSecret = crypto.randomUUID() + crypto.randomUUID();
  return ephemeralSecret;
}

function json(body, status) {
  return Response.json(body, {
    status: status || 200,
    headers: { 'cache-control': 'no-store' }
  });
}

function bad(reason, extra) {
  return json(Object.assign({ ok: false, reason }, extra || {}), 400);
}

async function readBody(request) {
  if (request.method === 'GET') return {};
  const text = await request.text();
  if (!text) return {};
  return JSON.parse(text);
}

function randomNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function configResponse(env) {
  const cfg = defaultConfig();
  if (env && env.LEGACY_EARLY_BUY_ENABLED === '0') cfg.legacy_early_buy_enabled = false;
  if (env && env.LEGACY_EARLY_BUY_ENABLED === '1') cfg.legacy_early_buy_enabled = true;
  return cfg;
}

async function issueNonce(env, body, ttlSec) {
  const nonce = randomNonce();
  const exp = Date.now() + ttlSec * 1000;
  const record = {
    nonce,
    exp,
    wallet: body.wallet,
    action: body.action || body.kind,
    charId: body.charId || '-',
    chapter: body.chapter == null ? '-' : body.chapter,
    amount: body.amount == null ? 0 : body.amount,
    usedBy: null
  };
  const mac = await hmacHex(seasonSecret(env), JSON.stringify(record));
  record.mac = mac;
  rememberNonce(nonce, record);
  return record;
}

function freshNonce(record, now) {
  if (!record) return 'unknown_nonce';
  if (record.exp < now) return 'nonce_expired';
  if (record.usedBy) return 'nonce_used';
  return null;
}

async function onConfig(env) {
  const cfg = configResponse(env);
  return json({
    ok: true,
    cluster: 'devnet',
    rpc: DEVNET_RPC,
    config: cfg,
    eligibility_min_sol: cfg.eligibility_min_sol,
    legacy_early_buy_enabled: cfg.legacy_early_buy_enabled,
    comeback_vote_enabled: false,
    relic_burn_enabled: false,
    state_storage: 'supabase+github',
    irys_on_devnet: false,
    secretConfigured: !!(env && env.BARD_SEASON_SECRET),
    vaultSignerConfigured: !!(env && env.BARD_VAULT_SECRET)
  });
}

async function onSpendCode(env, body) {
  const action = body.action;
  if (!['train', 'revive', 'stake'].includes(action)) return bad('bad_action');
  if (!body.wallet || !body.charId || body.chapter == null) return bad('missing_fields');
  const amount = Number(body.amount);
  const cfg = configResponse(env);
  if (!Number.isInteger(amount)) return bad('amount_not_integer');
  if (action === 'train' && (amount < cfg.train_min || amount > cfg.train_max)) return bad('amount_out_of_range');
  if (action === 'revive' && amount < cfg.revival_min) return bad('amount_out_of_range');
  if (action === 'stake' && amount < 1) return bad('amount_out_of_range');
  const record = await issueNonce(env, { ...body, action, amount }, cfg.spend_nonce_ttl_s);
  record.discount = action === 'train' && !!body.discount;
  const memo = actionMemo({ action, charId: body.charId, chapter: body.chapter, nonce: record.nonce });
  const decimals = cfg.decimals;
  let split = null;
  if (action === 'train') {
    const parts = splitTrain(amount);
    split = {
      burn: toBaseUnits(parts.burn, decimals).toString(),
      liq: toBaseUnits(parts.liq, decimals).toString(),
      pot: toBaseUnits(parts.pot, decimals).toString()
    };
  }
  return json({
    ok: true,
    nonce: record.nonce,
    mac: record.mac,
    expiresAt: record.exp,
    memo,
    amountBase: toBaseUnits(amount, decimals).toString(),
    split,
    cluster: 'devnet'
  });
}

async function onVerifySpend(env, body) {
  const record = takeNonce(body.nonce);
  if (!record) return bad('unknown_nonce');
  if (record.exp < Date.now() && record.usedBy !== body.signature) return bad('nonce_expired');
  if (!body.mac || !timingSafeEqual(record.mac, body.mac)) return bad('bad_mac');
  const memo = actionMemo({ action: record.action, charId: record.charId, chapter: record.chapter, nonce: record.nonce });
  if (!body.signature) return bad('missing_signature');
  if (!body.instructions) {
    assertDevnetEndpoint(DEVNET_RPC);
    const web3 = await import('@solana/web3.js');
    const connection = new web3.Connection(DEVNET_RPC, 'finalized');
    const tx = await connection.getTransaction(body.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!tx) return json({ ok: false, reason: 'not_finalized' });
    body.instructions = instructionsFromParsed(tx);
  }
  const decimals = defaultConfig().decimals;
  const amount = toBaseUnits(record.amount, decimals).toString();
  let expected;
  if (record.action === 'revive') {
    expected = { kind: 'revive', memo, mint: body.mint, wallet: record.wallet, amount };
  } else if (record.action === 'stake') {
    expected = { kind: 'stake', memo, mint: body.mint, wallet: record.wallet, amount, escrow: body.escrow };
  } else {
    const split = splitTrain(record.amount);
    expected = {
      kind: 'train',
      memo,
      mint: body.mint,
      wallet: record.wallet,
      burn: toBaseUnits(split.burn, decimals).toString(),
      liqAmount: toBaseUnits(split.liq, decimals).toString(),
      potAmount: toBaseUnits(split.pot, decimals).toString(),
      liqDestination: body.liq,
      potDestination: body.pot
    };
  }
  const check = matchSpend(body.instructions, expected);
  if (!check.ok) return json(check);
  const consumed = consumeNonce(record.nonce, body.signature);
  if (!consumed.ok) return json(consumed);
  const creditTokens = record.action === 'train' && record.discount ? record.amount * 1.5 : record.amount;
  return json({ ok: true, ...check, creditTokens, memo, signature: body.signature, cluster: 'devnet' });
}

async function onStrikeSession(env, body) {
  if (!body.wallet || !body.charId || body.chapter == null) return bad('missing_fields');
  const cfg = configResponse(env);
  const record = await issueNonce(env, { ...body, action: 'strike' }, cfg.action_nonce_ttl_s);
  const material = await sha256Hex(record.mac);
  const speed = 0.9 + (parseInt(material.slice(0, 2), 16) / 255) * 0.4;
  const phase = parseInt(material.slice(2, 4), 16) / 255;
  record.speed = Math.round(speed * 1000) / 1000;
  record.phase = Math.round(phase * 1000) / 1000;
  record.tIssue = Date.now();
  return json({
    ok: true,
    nonce: record.nonce,
    mac: record.mac,
    speed: record.speed,
    phase: record.phase,
    tIssue: record.tIssue,
    expiresAt: record.exp
  });
}

async function onAction(env, body) {
  const record = takeNonce(body.nonce);
  const stale = freshNonce(record, Date.now());
  if (stale) return bad(stale);
  const cfg = configResponse(env);
  const signedAt = Number(body.signedAt);
  const receivedAt = Date.now();
  if (!Number.isFinite(signedAt)) return bad('missing_signed_at');
  if (Math.abs(receivedAt - signedAt) > cfg.action_nonce_ttl_s * 1000) return bad('signed_at_skew');
  const message = canonicalMessage({
    kind: body.kind,
    season: cfg.season_id,
    chapter: body.chapter,
    charId: body.charId,
    nonce: body.nonce,
    signedAt,
    extra: body.extra || '-'
  });
  if (body.message && body.message !== message) return bad('message_mismatch');
  const demo = env && env.SEASON_ALLOW_DEMO === '1' && body.signature === 'demo';
  const verified = demo || verifyWalletSignature({ publicKey: body.wallet, message, signature: body.signature });
  if (!verified) return bad('bad_signature');
  let counts = true;
  if (body.kind === 'predict') {
    const lockAt = Number(body.lockAt);
    counts = pickCounts({ signedAt, receivedAt, lockAt });
    if (!counts) return json({ ok: false, reason: 'after_lock', signedAt, receivedAt, lockAt, counts: false });
  }
  const consumed = consumeNonce(body.nonce, body.signature || 'demo');
  if (!consumed.ok) return json(consumed);
  let strike = null;
  if (body.kind === 'strike') {
    strike = scoreTap({
      phase: record.phase,
      speed: record.speed,
      clientElapsedMs: body.clientElapsedMs,
      serverElapsedMs: receivedAt - record.tIssue,
      tapped: body.tapped !== false
    });
    if (!strike.ok) return json(strike);
  }
  return json({ ok: true, receivedAt, signedAt, counts, message, strike, cluster: 'devnet' });
}

async function onReview(body) {
  const review = reviewLastWords(body.text || '');
  const filter = filterLastWords(body.text || '');
  return json({ ok: true, filter, review });
}

async function onResolve(body) {
  return json({ ok: true, ...resolveLastWords(body) });
}

async function onScore(body) {
  const scores = scoreCast(body.characters || [], body.weights);
  return json({ ok: true, scores });
}

async function onTwap(body) {
  const price = twapPrice(body.swaps || [], Number(body.startTs), Number(body.endTs));
  return json({ ok: true, twap: price, note: 'Rebuilt from swaps. Five-minute samples are not this number.' });
}

function onEligibility(url, body) {
  const q = url.searchParams;
  const src = Object.keys(body || {}).length ? body : Object.fromEntries(q.entries());
  const cluster = src.cluster || 'devnet';
  const cfg = defaultConfig();
  const minSol = eligibilityMinSol(cfg, cluster);
  const eligible = isEligible({
    balance: Number(src.balance),
    heldSinceMs: src.heldSince == null || src.heldSince === '' ? null : Number(src.heldSince),
    snapshotMs: Number(src.snapshot || Date.now()),
    valueSol: Number(src.valueSol || 0),
    minSol,
    holdMs: cfg.elig_hold_s * 1000
  });
  return json({
    ok: true,
    eligible,
    eligibility_min_sol: minSol,
    cluster,
    value_sol: Number(src.valueSol || 0),
    note: 'Free tBard pays for actions. It never makes you eligible. Holding the character for 24h does.'
  });
}

async function onVoid(env, body) {
  const reason = body.reason || voidReason(body);
  if (!reason) return bad('no_void_trigger');
  const state = Object.assign({}, body.state || {}, {
    season: body.season || 's0',
    chapter: body.chapter,
    status: 'void',
    void_reason: reason
  });
  const plan = await publishPlan(state);
  const stakes = body.stakes || [];
  const batches = batchStakeReturns(stakes, 8).map((group) => group.map((stake) => ({
    wallet: stake.wallet,
    amount: stake.amount,
    memo: unstakeMemo(state.season, state.chapter, stake.sig)
  })));
  return json({
    ok: true,
    reason,
    copy: VOID_COPY[reason],
    memo: plan.memo,
    hash: plan.hash,
    status: 'void',
    irys: null,
    supabasePath: plan.supabasePath,
    githubPath: plan.githubPath,
    githubUrl: plan.githubUrl,
    ...mirrorLinks(plan, env && env.SEASON_SUPABASE_URL),
    batches,
    effects: {
      returnStakes: true,
      keepTrainCredit: true,
      voidPicks: true,
      legacyPoints: false
    }
  });
}

async function onSnapshot(body) {
  const randomness = fromHex(body.randomness);
  const snapshot = snapshotFromRandomness(Number(body.windowStart), randomness, Number(body.windowLen || 43200));
  return json({
    ok: true,
    snapshot,
    seedMaterial: reaperSeedMaterial(body.season || 's0', body.chapter),
    note: 'Publish this only after the window has closed and the VRF has fulfilled.'
  });
}

async function onPublish(env, body) {
  const plan = await publishPlan(body.state || body);
  return json({ ok: true, ...plan, ...mirrorLinks(plan, env && env.SEASON_SUPABASE_URL), irys: null });
}

async function onFaucet(env) {
  if (!(env && env.BARD_DRIP_SECRET)) {
    return json({
      ok: false,
      reason: 'drip_not_configured',
      hint: 'Pre-fund a devnet drip wallet with season0/scripts/prefund-drip.mjs and set BARD_DRIP_SECRET in the worker. Nothing was sent.'
    });
  }
  if (!(env && env.TURNSTILE_SECRET) && !(env && env.SEASON_DEV_SKIP_TURNSTILE === '1')) {
    return json({ ok: false, reason: 'turnstile_not_configured' });
  }
  return json({
    ok: false,
    reason: 'drip_send_not_run',
    hint: 'The drip key is configured. Broadcast stays in the devnet ops script so this worker does not send on import.'
  });
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (env && env.SEASON_SUPABASE_URL) assertNotLiveSupabase(env.SEASON_SUPABASE_URL);
    if (path === '/api/vault/bard-sign' && request.method === 'POST') {
      const body = await readBody(request);
      const result = await bardSign(env || {}, body);
      return json(result, result.ok ? 200 : 200);
    }
    if (path === '/api/season/config' && request.method === 'GET') return onConfig(env);
    if (path === '/api/season/health' && request.method === 'GET') {
      return json({ ok: true, cluster: 'devnet', rpc: DEVNET_RPC });
    }
    if (path === '/api/season/nonce' && request.method === 'POST') return onSpendCode(env, await readBody(request));
    if (path === '/api/season/verify-spend' && request.method === 'POST') return onVerifySpend(env, await readBody(request));
    if (path === '/api/season/strike-session' && request.method === 'POST') return onStrikeSession(env, await readBody(request));
    if (path === '/api/season/action' && request.method === 'POST') return onAction(env, await readBody(request));
    if (path === '/api/season/last-words/review' && request.method === 'POST') return onReview(await readBody(request));
    if (path === '/api/season/last-words/resolve' && request.method === 'POST') return onResolve(await readBody(request));
    if (path === '/api/season/score' && request.method === 'POST') return onScore(await readBody(request));
    if (path === '/api/twap' && request.method === 'POST') return onTwap(await readBody(request));
    if (path === '/api/eligibility') return onEligibility(url, request.method === 'POST' ? await readBody(request) : {});
    if (path === '/api/season/void' && request.method === 'POST') return onVoid(env, await readBody(request));
    if (path === '/api/season/snapshot' && request.method === 'POST') return onSnapshot(await readBody(request));
    if (path === '/api/season/publish' && request.method === 'POST') return onPublish(env, await readBody(request));
    if (path === '/api/season/faucet' && request.method === 'POST') return onFaucet(env);
    if (path === '/api/season/revival-target' && request.method === 'GET') {
      return json({ ok: true, target: revivalTarget(Number(url.searchParams.get('train') || 0)) });
    }
    return json({ ok: false, reason: 'not_found' }, 404);
  } catch (err) {
    const message = String(err && err.message || err);
    if (/live Supabase|mainnet|not devnet/i.test(message)) return json({ ok: false, reason: message }, 403);
    return json({ ok: false, reason: message }, 500);
  }
}
