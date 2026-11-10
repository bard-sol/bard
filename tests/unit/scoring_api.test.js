import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { signJwt } from '../../server/auth.js';
import { handleRequest } from '../../server/api.js';
import { TOKEN_PROGRAM } from '../../server/chain.js';
import { freezeConfig, seasonJoinsFromRows } from '../../server/score_api.js';
import { hashScoreInputs, recomputeScoreNote, settlementScoreLine } from '../../receipt_score.js';
import { RULE_V1, canonicalJson, log2Milli, scoreCampaign, snowflakeId } from '../../scoring.js';
import { sha256Hex } from '../../server/settlement.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SECRET = 'score-test-secret-score-test-secret';
const POSTED = '2026-06-02T12:00:00.000Z';
const CREATED = '2026-06-01T00:00:00.000Z';

function keypair() {
  const pair = nacl.sign.keyPair();
  return { publicKey: bs58.encode(pair.publicKey) };
}

function installFetchGuard() {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => { throw new Error('live network blocked: ' + url); };
  return () => { globalThis.fetch = orig; };
}

function mintAccount(decimals) {
  const data = Buffer.alloc(82);
  data[44] = decimals;
  return { value: { owner: TOKEN_PROGRAM, data: [data.toString('base64'), 'base64'] } };
}

function ownedTokens(mint, amount, decimals) {
  return {
    value: [{
      account: {
        data: { parsed: { info: { mint, tokenAmount: { amount: String(amount), decimals } } } },
      },
    }],
  };
}

function createEnv() {
  const tables = {
    projects: [],
    campaigns: [],
    campaign_joins: [],
    vault_settlements: [],
    vault_reservations: [],
    score_accounts: [],
    score_posts: [],
    score_engagements: [],
    score_audit: [],
    holders: [],
    auth_nonces: [],
  };
  const rpcLog = [];
  const env = {
    SUPABASE_URL: 'http://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    SUPABASE_JWT_SECRET: SECRET,
    BARD_SIGNER_PUBKEY: '',
    BARD_CUT_BPS: '0',
    SOLANA_RPC: 'http://rpc.test/solana',
    fetch: async (url, opts = {}) => {
      const u = new URL(url);
      if (/supabase\.co|mainnet|api\.x\.com|api\.twitter\.com/i.test(u.hostname)) throw new Error('live network blocked');
      if (u.pathname.startsWith('/rest/v1/rpc/')) {
        const body = opts.body ? JSON.parse(opts.body) : {};
        return Response.json({ ok: true, vault_reserved_raw: body.p_locked_raw || '0' });
      }
      if (u.hostname === 'rpc.test') {
        const payload = JSON.parse(opts.body);
        rpcLog.push(payload);
        if (payload.method === 'getAccountInfo') {
          const mint = payload.params[0];
          return Response.json({ jsonrpc: '2.0', id: 1, result: env.accounts[mint] || { value: null } });
        }
        if (payload.method === 'getTokenAccountsByOwner') {
          const mint = payload.params[1] && payload.params[1].mint;
          const key = payload.params[0] + '|' + mint;
          return Response.json({ jsonrpc: '2.0', id: 1, result: env.tokenAccounts[key] || { value: [] } });
        }
        return Response.json({ jsonrpc: '2.0', id: 1, error: { message: 'unknown rpc' } });
      }
      const table = u.pathname.replace(/^\/rest\/v1\//, '');
      const rows = tables[table];
      if (!rows) return Response.json({ message: 'missing ' + table }, { status: 500 });
      const filters = [];
      for (const [key, value] of u.searchParams) {
        if (key === 'select' || key === 'on_conflict' || key === 'order') continue;
        const dot = value.indexOf('.');
        filters.push({ key, op: value.slice(0, dot), val: value.slice(dot + 1) });
      }
      const matches = (row) => filters.every((filter) => {
        if (filter.op === 'is' && filter.val === 'null') return row[filter.key] == null;
        const got = row[filter.key] == null ? '' : String(row[filter.key]);
        if (filter.op === 'eq') return got === filter.val;
        if (filter.op === 'not.in') {
          const list = filter.val.replace(/^\(/, '').replace(/\)$/, '').split(',');
          return !list.includes(got);
        }
        return false;
      });
      if ((opts.method || 'GET') === 'GET') return Response.json(rows.filter(matches));
      const body = opts.body ? JSON.parse(opts.body) : {};
      if (opts.method === 'POST') {
        const conflict = u.searchParams.get('on_conflict');
        if (conflict) {
          const keys = conflict.split(',');
          const existing = rows.find((row) => keys.every((key) => String(row[key]) === String(body[key])));
          if (existing) {
            Object.assign(existing, body);
            return Response.json([existing]);
          }
        }
        const stored = { id: crypto.randomUUID(), ...body };
        rows.push(stored);
        return Response.json([stored], { status: 201 });
      }
      if (opts.method === 'PATCH') {
        const updated = rows.filter(matches);
        updated.forEach((row) => Object.assign(row, body));
        return Response.json(updated);
      }
      return Response.json({ message: 'bad method' }, { status: 500 });
    },
  };
  env.accounts = {};
  env.tokenAccounts = {};
  return { env, tables, rpcLog };
}

async function call(env, method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await handleRequest(new Request('http://127.0.0.1' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

function rule() {
  return {
    version: RULE_V1.version,
    bestN: 5,
    minAccountDays: RULE_V1.minAccountDays,
    minFollowers: RULE_V1.minFollowers,
    minEngagerFollowers: RULE_V1.minEngagerFollowers,
    ageZeroDays: RULE_V1.ageZeroDays,
    ageSpanDays: RULE_V1.ageSpanDays,
    checkHours: RULE_V1.checkHours,
    shingle: RULE_V1.shingle,
    nearDupNum: RULE_V1.nearDupNum,
    nearDupDen: RULE_V1.nearDupDen,
    kinds: { quote: 3, reply: 3, repost: 2, like: 0 },
    consentVersion: RULE_V1.consentVersion,
    consentText: RULE_V1.consentText,
    labels: { sameCampaign: RULE_V1.labels.sameCampaign, otherCampaign: RULE_V1.labels.otherCampaign },
  };
}

test('season joins keep only consented oauth members of scored campaigns', () => {
  const campaign = { id: 'this', created_at: CREATED, duration_days: 14 };
  const campaigns = [
    campaign,
    { id: 'other', config: { scoreRule: { version: 'bard-score-v1' } } },
    { id: 'plain', config: {} },
  ];
  const joins = [
    { campaign_id: 'other', wallet: 'good', x_handle: '@Good', joined_at: '2026-06-01T00:00:00.000Z', handle_consent_at: CREATED, handle_consent_version: 'bard-score-v1' },
    { campaign_id: 'other', wallet: 'hold', x_handle: '@Hold', joined_at: '2026-06-01T00:00:00.000Z', handle_consent_at: CREATED, handle_consent_version: 'bard-score-v1' },
    { campaign_id: 'other', wallet: 'old', x_handle: '@Old', joined_at: '2026-06-01T00:00:00.000Z', handle_consent_at: CREATED, handle_consent_version: 'bard-score-v1' },
    { campaign_id: 'other', wallet: 'shy', x_handle: '@Shy', joined_at: '2026-06-01T00:00:00.000Z', handle_consent_at: null, handle_consent_version: null },
    { campaign_id: 'plain', wallet: 'plain', x_handle: '@Plain', joined_at: '2026-06-01T00:00:00.000Z', handle_consent_at: CREATED, handle_consent_version: 'bard-score-v1' },
  ];
  const holders = [
    { wallet: 'good', x_handle: '@Good', x_via: 'oauth', x_user_id: '501' },
    { wallet: 'hold', x_handle: '@Hold', x_via: 'manual', x_user_id: null },
    { wallet: 'old', x_handle: '@Old', x_via: 'unverified', x_user_id: '502' },
    { wallet: 'shy', x_handle: '@Shy', x_via: 'oauth', x_user_id: '503' },
    { wallet: 'plain', x_handle: '@Plain', x_via: 'oauth', x_user_id: '504' },
  ];
  const rows = seasonJoinsFromRows({ campaign, campaigns, joins, holders });
  assert.deepEqual(rows.map((row) => row.handle), ['good']);
  assert.equal(rows[0].x_user_id, '501');
});

test('the flag freezes a rule at creation and strips one when scoring is off', () => {
  const on = freezeConfig({ SCORED_CAMPAIGNS: 'on' }, {
    bestN: 3,
    days: 14,
    config: { note: 'keep', scoreRule: { version: 'evil' } },
  }, 14);
  assert.equal(on.error, null);
  assert.equal(on.config.note, 'keep');
  assert.equal(on.config.scoreRule.version, 'bard-score-v1');
  assert.equal(on.config.scoreRule.bestN, 3);
  const needsEnd = freezeConfig({ SCORED_CAMPAIGNS: '1' }, { config: { note: 'keep' } }, 0);
  assert.equal(needsEnd.error, 'a scored campaign needs an end');
  assert.equal(needsEnd.config.scoreRule, undefined);
  const off = freezeConfig({}, { config: { note: 'keep', scoreRule: { version: 'evil' } } }, 0);
  assert.equal(off.error, null);
  assert.equal(off.config.note, 'keep');
  assert.equal(off.config.scoreRule, undefined);
});

test('scored entry, the public score, and a payout refuse a changed input', async () => {
  const restore = installFetchGuard();
  const admin = keypair();
  const holder = keypair();
  const signer = keypair();
  const mint = keypair().publicKey;
  const vault = keypair().publicKey;
  const multisig = keypair().publicKey;
  const { env, tables, rpcLog } = createEnv();
  env.BARD_SIGNER_PUBKEY = signer.publicKey;
  env.SCORED_CAMPAIGNS = '1';
  env.accounts[mint] = mintAccount(0);
  env.tokenAccounts[vault + '|' + mint] = ownedTokens(mint, 1000, 0);
  const token = (await signJwt(SECRET, admin.publicKey)).token;
  const projectId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const postRowId = crypto.randomUUID();
  const postId = snowflakeId(Date.parse(POSTED), 1);
  tables.projects.push({
    id: projectId,
    admin_wallet: admin.publicKey,
    mint,
    vault_status: 'linked',
    vault_address: vault,
    vault_mint: mint,
    vault_multisig: multisig,
    vault_reserved_raw: '0',
  });
  tables.campaigns.push({
    id: campaignId,
    project_id: projectId,
    title: 'Scored',
    type: 'hold',
    status: 'active',
    reward_mode: 'fixed',
    reward: '10',
    reward_unit: 'TOKEN',
    duration_days: 14,
    created_at: CREATED,
    config: { scoreRule: rule() },
    prize_raw: '10',
    locked_raw: '10',
    cut_bps: 0,
    cut_raw: '0',
    cut_wallet: null,
    prize_mint: mint,
    vault_reserved: '10',
  });
  tables.campaigns.push({
    id: otherId,
    project_id: projectId,
    title: 'Other',
    status: 'active',
    created_at: CREATED,
    duration_days: 14,
    config: { scoreRule: rule() },
  });
  tables.campaign_joins.push({
    id: crypto.randomUUID(),
    campaign_id: campaignId,
    project_id: projectId,
    wallet: holder.publicKey,
    x_handle: '@Honest',
    status: 'approved',
    qualified: false,
    progress: 0,
    joined_at: CREATED,
    handle_consent_at: CREATED,
    handle_consent_version: 'bard-score-v1',
    score_override: null,
  });
  tables.campaign_joins.push({
    campaign_id: otherId,
    wallet: 'season-wallet',
    x_handle: '@Season',
    status: 'approved',
    joined_at: CREATED,
    handle_consent_at: CREATED,
    handle_consent_version: 'bard-score-v1',
  });
  tables.campaign_joins.push({
    campaign_id: otherId,
    wallet: 'hold-wallet',
    x_handle: '@HoldOnly',
    status: 'approved',
    joined_at: CREATED,
    handle_consent_at: CREATED,
    handle_consent_version: 'bard-score-v1',
  });
  tables.holders.push(
    { wallet: holder.publicKey, x_handle: '@Honest', x_via: 'oauth', x_user_id: '1001' },
    { wallet: 'season-wallet', x_handle: '@Season', x_via: 'oauth', x_user_id: '1002' },
    { wallet: 'hold-wallet', x_handle: '@HoldOnly', x_via: 'manual', x_user_id: null },
  );
  tables.score_accounts.push(
    { campaign_id: campaignId, handle: 'honest', x_created_on: '2025-04-28', followers: 800, following: 300, is_bot: false },
    { campaign_id: campaignId, handle: 'e1', x_created_on: '2024-01-01', followers: 100, following: 100, is_bot: false },
  );
  tables.score_posts.push({
    id: postRowId,
    campaign_id: campaignId,
    wallet: holder.publicKey,
    handle: 'honest',
    post_id: postId,
    text: 'a real post',
    deleted: false,
    checked_at: '2026-06-06T12:00:00.000Z',
    excluded: false,
  });
  tables.score_engagements.push({
    id: crypto.randomUUID(),
    campaign_id: campaignId,
    post_row_id: postRowId,
    engager_handle: 'e1',
    kind: 'repost',
  });
  try {
    const config = await call(env, 'GET', '/api/config');
    assert.equal(config.data.scoredCampaigns, true);

    const tooSoon = await call(env, 'POST', '/api/campaigns', {
      projectId, title: 'Early', rule: 'rule', type: 'hold', rewardMode: 'fixed', reward: '1', days: 0,
    }, token);
    assert.equal(tooSoon.status, 400, JSON.stringify(tooSoon.data));
    assert.equal(tooSoon.data.error, 'a scored campaign needs an end');

    const made = await call(env, 'POST', '/api/campaigns', {
      projectId, title: 'Live', rule: 'rule', type: 'hold', rewardMode: 'fixed', reward: '1', days: 14,
      bestN: 3, config: { note: 'keep', scoreRule: { version: 'evil' } },
    }, token);
    assert.equal(made.status, 200, JSON.stringify(made.data));
    assert.equal(made.data.campaign.config.note, 'keep');
    assert.equal(made.data.campaign.config.scoreRule.version, 'bard-score-v1');
    assert.equal(made.data.campaign.config.scoreRule.bestN, 3);

    env.SCORED_CAMPAIGNS = '';
    const stripped = await call(env, 'POST', '/api/campaigns', {
      projectId, title: 'Hand', rule: 'rule', type: 'hold', rewardMode: 'fixed', reward: '1', days: 0,
      config: { note: 'keep', scoreRule: { version: 'evil' } },
    }, token);
    assert.equal(stripped.status, 200, JSON.stringify(stripped.data));
    assert.equal(stripped.data.campaign.config.scoreRule, undefined);
    assert.equal(stripped.data.campaign.config.note, 'keep');
    assert.equal(stripped.data.campaign.duration_days, 0);
    env.SCORED_CAMPAIGNS = '1';

    const typed = await call(env, 'POST', '/api/campaigns/' + campaignId + '/score/accounts', {
      accounts: [{ handle: 'z', created_on: '2024-01-01', followers: 10, following: 10 }],
      score: 5,
    }, token);
    assert.equal(typed.status, 400);
    assert.equal(typed.data.error, 'a score cannot be typed');

    const young = await call(env, 'POST', '/api/campaigns/' + campaignId + '/score/posts', {
      posts: [{ post_id: snowflakeId(Date.now() - 60 * 60 * 1000, 1), wallet: holder.publicKey, handle: 'honest', text: 'new' }],
    }, token);
    assert.equal(young.status, 400);
    assert.equal(young.data.error, 'post is younger than 72 hours');

    const outside = await call(env, 'POST', '/api/campaigns/' + campaignId + '/score/posts', {
      posts: [{ post_id: snowflakeId(Date.parse('2020-01-02T00:00:00.000Z'), 1), wallet: holder.publicKey, handle: 'honest', text: 'old' }],
    }, token);
    assert.equal(outside.status, 400);
    assert.equal(outside.data.error, 'post is outside the campaign window');

    tables.score_posts.push({
      id: crypto.randomUUID(),
      campaign_id: otherId,
      wallet: holder.publicKey,
      handle: 'honest',
      post_id: snowflakeId(Date.parse(POSTED), 9),
      text: 'used',
      deleted: false,
      checked_at: '2026-06-06T12:00:00.000Z',
      excluded: false,
    });
    const used = await call(env, 'POST', '/api/campaigns/' + campaignId + '/score/posts', {
      posts: [{ post_id: snowflakeId(Date.parse(POSTED), 9), wallet: holder.publicKey, handle: 'honest', text: 'copy' }],
    }, token);
    assert.equal(used.status, 409);
    assert.equal(used.data.error, 'this post is already used in a campaign');

    const progress = await call(env, 'POST', '/api/joins/progress', {
      campaignId, wallet: holder.publicKey, progress: 1,
    }, token);
    assert.equal(progress.status, 409);
    assert.equal(progress.data.error, 'a scored campaign has no hand score');

    const qualify = await call(env, 'POST', '/api/campaigns/' + campaignId + '/qualify-matching', {}, token);
    assert.equal(qualify.status, 409);
    assert.equal(qualify.data.error, 'a scored campaign has no hand score');

    const anon = await call(env, 'GET', '/api/campaigns/' + campaignId + '/score');
    assert.equal(anon.status, 200, JSON.stringify(anon.data));
    assert.equal(anon.data.reasons, undefined);
    const badToken = await call(env, 'GET', '/api/campaigns/' + campaignId + '/score', undefined, 'not-a-jwt');
    assert.equal(badToken.status, 200);
    const honest = anon.data.results.find((row) => row.wallet === holder.publicKey);
    assert.equal(honest.score_milli, log2Milli(2000));
    assert.equal(anon.data.score_hash, sha256Hex(canonicalJson(anon.data.inputs)));
    assert.deepEqual(anon.data.inputs.season_joins.map((row) => row.handle), ['season']);
    assert.equal(JSON.stringify(anon.data.inputs).includes('reason'), false);

    const include = await call(env, 'POST', '/api/campaigns/' + campaignId + '/score/overrides', {
      action: 'include_person', wallet: holder.publicKey, reason: 'already scored',
    }, token);
    assert.equal(include.status, 400);
    assert.equal(include.data.error, 'include is only for a person who scored 0');

    const early = JSON.parse(JSON.stringify(tables.campaigns[0]));
    tables.campaigns[0].created_at = new Date(Date.now() - 2 * 86400000).toISOString();
    const closed = await call(env, 'POST', '/api/settlements/propose', { campaignId, projectId }, token);
    assert.equal(closed.status, 409, JSON.stringify(closed.data));
    assert.match(closed.data.error, /^settlement opens /);
    tables.campaigns[0].created_at = early.created_at;

    const proposed = await call(env, 'POST', '/api/settlements/propose', { campaignId, projectId }, token);
    assert.equal(proposed.status, 200, JSON.stringify(proposed.data));
    const settlement = proposed.data.settlement;
    assert.equal(settlement.score_hash, anon.data.score_hash);
    assert.equal(canonicalJson(settlement.score_inputs), canonicalJson(anon.data.inputs));
    assert.equal(tables.campaign_joins[0].score_milli, log2Milli(2000));

    tables.score_engagements.push({
      id: crypto.randomUUID(),
      campaign_id: campaignId,
      post_row_id: postRowId,
      engager_handle: 'e1',
      kind: 'quote',
    });
    tables.vault_settlements[0].status = 'awaiting_bard';
    tables.vault_settlements[0].team_signed = true;
    tables.vault_settlements[0].tx_index = '1';
    tables.vault_settlements[0].vault_multisig = multisig;
    const before = rpcLog.length;
    const bard = await call(env, 'POST', '/api/vault/bard-sign', { settlementId: settlement.id }, token);
    assert.equal(bard.status, 409, JSON.stringify(bard.data));
    assert.equal(bard.data.reason, 'score_inputs_changed');
    assert.equal(bard.data.error, 'score_inputs_changed');
    assert.equal(rpcLog.length, before);

    const frozen = await call(env, 'POST', '/api/campaigns/' + campaignId + '/score/rule', {}, token);
    assert.equal(frozen.status, 409);
    assert.equal(frozen.data.error, 'score rule is frozen');
  } finally {
    restore();
  }
});

function loadPlatform() {
  const code = readFileSync(path.join(root, 'platform.js'), 'utf8');
  const sandbox = {
    console, URL, Date, Math, Number, String, parseInt, JSON, Object, Array, Error, Promise,
    encodeURIComponent, isNaN, BigInt, Uint8Array, Uint32Array, DataView, TextEncoder,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'platform.js' });
  return sandbox.BardPlatform;
}

function receiptView(body, sha) {
  const inputHash = hashScoreInputs(body.inputs, canonicalJson, sha);
  const again = scoreCampaign(body.inputs);
  return {
    inputHash,
    lines: (body.settlements || []).map((item) => settlementScoreLine(item, inputHash)),
    note: recomputeScoreNote(body, again, inputHash),
    scoresMatch: (body.results || []).every((row) => {
      const found = (again.results || []).find((item) => item.wallet === row.wallet);
      return found && found.score_milli === row.score_milli;
    }),
  };
}

test('the receipt shows when a locked score hash no longer matches the inputs', async () => {
  const page = readFileSync(path.join(root, 'receipt.html'), 'utf8');
  const helper = readFileSync(path.join(root, 'receipt_score.js'), 'utf8');
  assert.equal(page.includes('src="/scoring.js"'), true);
  assert.equal(page.includes('src="/receipt_score.js"'), true);
  assert.equal(page.includes('BardScore.canonicalJson'), true);
  assert.equal(page.includes('BardPlatform.sha256Hex'), true);
  assert.equal(page.includes('hashScoreInputs'), true);
  assert.equal(page.includes('settlementScoreLine'), true);
  assert.equal(page.includes('recomputeScoreNote'), true);
  assert.equal(page.includes('body.score_hash'), false);
  assert.equal(helper.includes('body.score_hash'), false);

  const browserSha = loadPlatform().sha256Hex;
  assert.equal(browserSha('abc'), createHash('sha256').update('abc').digest('hex'));
  assert.equal(browserSha('abc'), sha256Hex('abc'));

  const fixture = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/scoring/campaign.json'), 'utf8'));
  const lockedHash = browserSha(canonicalJson(fixture.inputs));
  assert.equal(lockedHash, sha256Hex(canonicalJson(fixture.inputs)));
  const scored = scoreCampaign(fixture.inputs);
  assert.equal(scored.results.length, 8);
  const hand = { id: 'hand-scored', status: 'executed', payout_hash: 'hand', score_hash: null };
  const locked = { id: 'locked-1', status: 'proposed', payout_hash: 'pay', score_hash: lockedHash };
  const untouched = {
    inputs: fixture.inputs,
    results: scored.results,
    score_hash: 'server-said-something-else',
    settlements: [locked, hand],
  };
  const clean = receiptView(untouched, browserSha);
  assert.equal(clean.scoresMatch, true);
  assert.equal(clean.note, 'all 8 scores match');
  assert.equal(clean.lines[0].includes('proposed'), true);
  assert.equal(clean.lines[0].includes('score inputs match'), true);
  assert.equal(clean.lines[0].includes('locked score hash does not match'), false);
  assert.equal(clean.lines[1].includes('score inputs match'), false);
  assert.equal(clean.lines[1].includes('locked score hash does not match'), false);
  assert.equal(clean.lines[1], 'executed · payout hand · score ');

  const changedInputs = structuredClone(fixture.inputs);
  const engager = changedInputs.accounts.find((row) => row.handle === 'e1');
  engager.followers = 9;
  const changedHash = browserSha(canonicalJson(changedInputs));
  assert.notEqual(changedHash, lockedHash);
  const drifted = {
    inputs: changedInputs,
    results: scoreCampaign(changedInputs).results,
    score_hash: lockedHash,
    settlements: [locked, hand],
  };
  const drift = receiptView(drifted, browserSha);
  assert.equal(drift.scoresMatch, true);
  assert.equal(/all \d+ scores match/.test(drift.note), false);
  assert.equal(drift.note.includes('proposed locked-1'), true);
  assert.equal(drift.note.includes('locked score hash does not match'), true);
  assert.equal(drift.lines[0].includes('proposed'), true);
  assert.equal(drift.lines[0].includes(lockedHash), true);
  assert.equal(drift.lines[0].includes('locked score hash does not match the current inputs'), true);
  assert.equal(drift.lines[0].includes('score inputs match'), false);
  assert.equal(drift.lines[1].includes('score inputs match'), false);
  assert.equal(drift.lines[1].includes('locked score hash does not match'), false);

  const restore = installFetchGuard();
  const admin = keypair();
  const holder = keypair();
  const signer = keypair();
  const mint = keypair().publicKey;
  const vault = keypair().publicKey;
  const multisig = keypair().publicKey;
  const { env, tables, rpcLog } = createEnv();
  env.BARD_SIGNER_PUBKEY = signer.publicKey;
  env.SCORED_CAMPAIGNS = '1';
  env.accounts[mint] = mintAccount(0);
  env.tokenAccounts[vault + '|' + mint] = ownedTokens(mint, 1000, 0);
  const token = (await signJwt(SECRET, admin.publicKey)).token;
  const projectId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const postRowId = crypto.randomUUID();
  const postId = snowflakeId(Date.parse(POSTED), 2);
  tables.projects.push({
    id: projectId,
    admin_wallet: admin.publicKey,
    mint,
    vault_status: 'linked',
    vault_address: vault,
    vault_mint: mint,
    vault_multisig: multisig,
    vault_reserved_raw: '0',
  });
  tables.campaigns.push({
    id: campaignId,
    project_id: projectId,
    title: 'Scored',
    type: 'hold',
    status: 'active',
    reward_mode: 'fixed',
    reward: '10',
    reward_unit: 'TOKEN',
    duration_days: 14,
    created_at: CREATED,
    config: { scoreRule: rule() },
    prize_raw: '10',
    locked_raw: '10',
    cut_bps: 0,
    cut_raw: '0',
    cut_wallet: null,
    prize_mint: mint,
    vault_reserved: '10',
  });
  tables.campaign_joins.push({
    id: crypto.randomUUID(),
    campaign_id: campaignId,
    project_id: projectId,
    wallet: holder.publicKey,
    x_handle: '@Honest',
    status: 'approved',
    qualified: false,
    progress: 0,
    joined_at: CREATED,
    handle_consent_at: CREATED,
    handle_consent_version: 'bard-score-v1',
    score_override: null,
  });
  tables.holders.push({ wallet: holder.publicKey, x_handle: '@Honest', x_via: 'oauth', x_user_id: '1001' });
  tables.score_accounts.push(
    { campaign_id: campaignId, handle: 'honest', x_created_on: '2025-04-28', followers: 800, following: 300, is_bot: false },
    { campaign_id: campaignId, handle: 'e1', x_created_on: '2024-01-01', followers: 100, following: 100, is_bot: false },
  );
  tables.score_posts.push({
    id: postRowId,
    campaign_id: campaignId,
    wallet: holder.publicKey,
    handle: 'honest',
    post_id: postId,
    text: 'a real post',
    deleted: false,
    checked_at: '2026-06-06T12:00:00.000Z',
    excluded: false,
  });
  tables.score_engagements.push({
    id: crypto.randomUUID(),
    campaign_id: campaignId,
    post_row_id: postRowId,
    engager_handle: 'e1',
    kind: 'repost',
  });
  try {
    const proposed = await call(env, 'POST', '/api/settlements/propose', { campaignId, projectId }, token);
    assert.equal(proposed.status, 200, JSON.stringify(proposed.data));
    const settlement = proposed.data.settlement;
    const e1 = tables.score_accounts.find((row) => row.handle === 'e1');
    e1.followers = 9;
    const live = await call(env, 'GET', '/api/campaigns/' + campaignId + '/score');
    assert.equal(live.status, 200, JSON.stringify(live.data));
    assert.notEqual(live.data.score_hash, settlement.score_hash);
    const shown = receiptView({ ...live.data, score_hash: settlement.score_hash }, browserSha);
    assert.equal(shown.inputHash, browserSha(canonicalJson(live.data.inputs)));
    assert.notEqual(shown.inputHash, settlement.score_hash);
    assert.equal(shown.scoresMatch, true);
    assert.equal(/all \d+ scores match/.test(shown.note), false);
    const row = live.data.settlements.find((item) => item.id === settlement.id);
    assert.equal(row.score_hash, settlement.score_hash);
    assert.equal(shown.note.includes(row.status + ' ' + row.id), true);
    assert.equal(shown.note.includes('locked score hash does not match'), true);
    const line = shown.lines.find((text) => text.includes(row.status) && text.includes(row.score_hash));
    assert.equal(line.includes(row.status), true);
    assert.equal(line.includes('locked score hash does not match the current inputs'), true);
    assert.equal(line.includes('score inputs match'), false);

    tables.vault_settlements[0].status = 'awaiting_bard';
    tables.vault_settlements[0].team_signed = true;
    tables.vault_settlements[0].tx_index = '1';
    tables.vault_settlements[0].vault_multisig = multisig;
    const before = rpcLog.length;
    const bard = await call(env, 'POST', '/api/vault/bard-sign', { settlementId: settlement.id }, token);
    assert.equal(bard.status, 409, JSON.stringify(bard.data));
    assert.equal(bard.data.reason, 'score_inputs_changed');
    assert.equal(bard.data.error, 'score_inputs_changed');
    const executed = await call(env, 'POST', '/api/settlements/' + settlement.id + '/execute', { signature: '6'.repeat(88) }, token);
    assert.equal(executed.status, 409, JSON.stringify(executed.data));
    assert.equal(executed.data.error, 'score_inputs_changed');
    assert.equal(executed.data.reason, 'score_inputs_changed');
    assert.equal(rpcLog.length, before);
  } finally {
    restore();
  }
});

// TRAA-2319 (B10, B11), found by the launch simulation.
test('score entry stops once a payout is proposed, and re-entering a post keeps its owner', async () => {
  const restore = installFetchGuard();
  const admin = keypair();
  const owner = keypair();
  const other = keypair();
  const { env, tables } = createEnv();
  env.SCORED_CAMPAIGNS = '1';
  const token = (await signJwt(SECRET, admin.publicKey)).token;
  const projectId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const postId = snowflakeId(Date.parse(POSTED), 7);
  tables.projects.push({ id: projectId, admin_wallet: admin.publicKey });
  tables.campaigns.push({
    id: campaignId, project_id: projectId, title: 'Scored', status: 'active',
    duration_days: 14, created_at: CREATED, config: { scoreRule: rule() },
  });
  tables.score_posts.push({
    id: crypto.randomUUID(), campaign_id: campaignId, wallet: owner.publicKey, handle: 'owner',
    post_id: postId, text: 'mine', deleted: false, excluded: false, entered_at: CREATED,
  });
  const account = { accounts: [{ handle: 'fan', created_on: '2024-01-01', followers: 100, following: 100 }] };
  try {
    const moved = await call(env, 'POST', '/api/campaigns/' + campaignId + '/score/posts', {
      posts: [{ post_id: postId, wallet: other.publicKey, handle: '@Other', text: 'edited' }],
    }, token);
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    const stored = tables.score_posts.find((row) => row.post_id === postId);
    assert.deepEqual([stored.wallet, stored.handle, stored.text], [owner.publicKey, 'owner', 'edited']);

    tables.vault_settlements.push({ id: crypto.randomUUID(), campaign_id: campaignId, status: 'cancelled' });
    assert.equal((await call(env, 'POST', '/api/campaigns/' + campaignId + '/score/accounts', account, token)).status, 200);
    for (const status of ['proposed', 'awaiting_bard', 'executed']) {
      tables.vault_settlements.push({ id: crypto.randomUUID(), campaign_id: campaignId, status });
      const late = await call(env, 'POST', '/api/campaigns/' + campaignId + '/score/accounts', account, token);
      assert.equal(late.status, 409, status);
      assert.equal(late.data.error, 'scores are frozen once a payout is proposed');
      tables.vault_settlements.pop();
    }
    tables.campaigns[0].status = 'paid';
    assert.equal((await call(env, 'POST', '/api/campaigns/' + campaignId + '/score/overrides', { action: 'bot', handle: 'fan', reason: 'x' }, token)).status, 409);
  } finally {
    restore();
  }
});
