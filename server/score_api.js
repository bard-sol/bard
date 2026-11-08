import { verifyJwt } from './auth.js';
import { computePayouts, payoutHash, settlementLines, sha256Hex } from './settlement.js';
import {
  RULE_V1,
  canonicalJson,
  normalizeHandle,
  postedAtFromId,
  scoreCampaign,
  scoreRuleFromCampaign,
} from '../scoring.js';

const JSON_HEADERS = { 'cache-control': 'no-store' };
const SCORE_KEYS = new Set(['score', 'score_milli', 'scoreMilli', 'progress']);
const KINDS = new Set(['quote', 'reply', 'repost', 'like']);
const OVERRIDE_ACTIONS = new Set(['exclude_person', 'exclude_post', 'bot', 'include_person']);
const HOUR72 = 72 * 3600 * 1000;
const DAY = 86400000;

function json(data, status = 200) {
  return Response.json(data, { status, headers: JSON_HEADERS });
}

function remoteFetch(env) {
  return env.fetch || fetch;
}

async function sb(env, method, path, body, prefer) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('SUPABASE_URL is not set');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    accept: 'application/json',
    'content-type': 'application/json',
    range: '0-49999',
  };
  if (prefer) headers.prefer = prefer;
  const res = await remoteFetch(env)(base + '/rest/v1' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { message: text }; }
  }
  if (res.status === 409 || (data && data.code === '23505')) {
    const err = new Error((data && (data.message || data.error)) || 'conflict');
    err.code = '23505';
    throw err;
  }
  if (!res.ok) {
    const err = new Error((data && (data.message || data.error)) || 'supabase write failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

function rowsOf(data) {
  return Array.isArray(data) ? data : [];
}

async function readJson(request) {
  try {
    const data = await request.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return data;
  } catch {
    return null;
  }
}

function hasTypedScore(value) {
  if (!value || typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value)) {
    if (SCORE_KEYS.has(key)) return true;
    if (child && typeof child === 'object' && hasTypedScore(child)) return true;
  }
  return false;
}

export function scoredOn(env) {
  const value = String(env && env.SCORED_CAMPAIGNS || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

function ruleSnapshot(bestN) {
  return {
    version: RULE_V1.version,
    bestN,
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

export function freezeConfig(env, body, days) {
  const raw = body && body.config && typeof body.config === 'object' && !Array.isArray(body.config) ? { ...body.config } : {};
  delete raw.scoreRule;
  if (!scoredOn(env)) return { config: raw, error: null };
  const picked = Number(body && body.bestN);
  const bestN = Number.isInteger(picked) && picked >= 1 && picked <= 10 ? picked : 5;
  const span = Number(days);
  if (!Number.isInteger(span) || span < 1) return { config: raw, error: 'a scored campaign needs an end' };
  raw.scoreRule = ruleSnapshot(bestN);
  return { config: raw, error: null };
}

function iso(value) {
  if (value == null || value === '') return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return new Date(at).toISOString();
}

function dayText(value) {
  if (value == null || value === '') return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function whole(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function endMs(campaign) {
  const days = Number(campaign && (campaign.duration_days != null ? campaign.duration_days : campaign.durationDays));
  const created = Date.parse(campaign && (campaign.created_at || campaign.createdAt));
  if (!Number.isInteger(days) || days < 1 || !Number.isFinite(created)) return null;
  return created + days * DAY;
}

function seasonKey(ms) {
  const at = new Date(ms);
  return at.getUTCFullYear() + '-Q' + (Math.floor(at.getUTCMonth() / 3) + 1);
}

export function settlementOpensAt(campaign) {
  const ends = endMs(campaign);
  if (ends == null) return null;
  return new Date(ends + HOUR72);
}

export function scoreOpenError(campaign, now = Date.now()) {
  const opens = settlementOpensAt(campaign);
  if (!opens) return 'a scored campaign needs an end';
  if (now < opens.getTime()) return 'settlement opens ' + opens.toISOString();
  return null;
}

function compareId(a, b) {
  const as = String(a || '');
  const bs = String(b || '');
  if (/^\d+$/.test(as) && /^\d+$/.test(bs)) {
    const aa = BigInt(as);
    const bb = BigInt(bs);
    if (aa < bb) return -1;
    if (aa > bb) return 1;
    return 0;
  }
  if (as < bs) return -1;
  if (as > bs) return 1;
  return 0;
}

export function seasonJoinsFromRows({ campaign, campaigns, joins, holders }) {
  const ends = endMs(campaign);
  if (ends == null) return [];
  const season = seasonKey(ends);
  const scored = new Set((campaigns || []).filter((row) => row && row.id !== campaign.id && scoreRuleFromCampaign(row)).map((row) => row.id));
  const holderByWallet = new Map((holders || []).filter((row) => row && row.wallet).map((row) => [row.wallet, row]));
  const out = [];
  for (const join of joins || []) {
    if (!join || !scored.has(join.campaign_id)) continue;
    if (!join.handle_consent_at || join.handle_consent_version !== RULE_V1.consentVersion) continue;
    const joined = Date.parse(join.joined_at);
    if (!Number.isFinite(joined) || joined > ends) continue;
    if (seasonKey(joined) !== season) continue;
    const holder = holderByWallet.get(join.wallet);
    if (!holder || holder.x_via !== 'oauth' || holder.x_user_id == null || String(holder.x_user_id).trim() === '') continue;
    const handle = normalizeHandle(join.x_handle || holder.x_handle);
    if (!handle) continue;
    out.push({
      handle,
      x_user_id: String(holder.x_user_id),
      campaign_id: String(join.campaign_id),
      joined_at: new Date(joined).toISOString(),
    });
  }
  out.sort((a, b) => (a.campaign_id + '\0' + a.handle).localeCompare(b.campaign_id + '\0' + b.handle));
  return out;
}

async function sessionWallet(request, env) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) return { error: json({ error: 'missing session' }, 401) };
  if (!env.SUPABASE_JWT_SECRET) return { error: json({ error: 'auth is not configured' }, 500) };
  const claims = await verifyJwt(env.SUPABASE_JWT_SECRET, match[1]);
  if (!claims) return { error: json({ error: 'invalid session' }, 401) };
  return { wallet: claims.wallet };
}

async function optionalWallet(request, env) {
  try {
    const header = request.headers.get('authorization') || '';
    const match = header.match(/^Bearer\s+(\S+)$/i);
    if (!match || !env.SUPABASE_JWT_SECRET) return null;
    const claims = await verifyJwt(env.SUPABASE_JWT_SECRET, match[1]);
    return claims && claims.wallet ? claims.wallet : null;
  } catch {
    return null;
  }
}

async function loadCampaign(env, campaignId) {
  const found = rowsOf(await sb(env, 'GET', '/campaigns?id=eq.' + encodeURIComponent(campaignId) + '&select=*'));
  return found[0] || null;
}

async function adminCampaign(request, env, campaignId) {
  const session = await sessionWallet(request, env);
  if (session.error) return session;
  const campaign = await loadCampaign(env, campaignId);
  if (!campaign) return { error: json({ error: 'campaign not found' }, 404) };
  const project = rowsOf(await sb(env, 'GET', '/projects?id=eq.' + encodeURIComponent(campaign.project_id) + '&select=*'))[0];
  if (!project) return { error: json({ error: 'project not found' }, 404) };
  if (project.admin_wallet !== session.wallet) return { error: json({ error: 'not the project admin' }, 403) };
  return { campaign, project, wallet: session.wallet };
}

export async function writeScoreAudit(env, row) {
  await sb(env, 'POST', '/score_audit', {
    campaign_id: row.campaign_id || null,
    action: row.action,
    entity: row.entity,
    before: row.before == null ? null : row.before,
    after: row.after == null ? null : row.after,
    reason: row.reason == null || row.reason === '' ? null : String(row.reason),
    actor: row.actor || null,
    subject_wallet: row.subject_wallet || null,
    subject_handle: row.subject_handle || null,
  }, 'return=minimal');
}

function accountFact(row) {
  return {
    handle: normalizeHandle(row.handle),
    created_on: dayText(row.x_created_on != null ? row.x_created_on : row.created_on),
    followers: whole(row.followers) || 0,
    following: whole(row.following) || 0,
    is_bot: row.is_bot === true,
  };
}

function holderFact(row) {
  return {
    wallet: String(row.wallet),
    handle: normalizeHandle(row.x_handle != null ? row.x_handle : row.handle),
    x_user_id: row.x_user_id == null || String(row.x_user_id).trim() === '' ? null : String(row.x_user_id),
    x_via: row.x_via == null ? null : String(row.x_via),
  };
}

export async function buildScoreInputs(env, campaign) {
  const rule = scoreRuleFromCampaign(campaign);
  if (!rule) throw new Error('campaign is not scored');
  const ends = endMs(campaign);
  if (ends == null) throw new Error('a scored campaign needs an end');
  const created = Date.parse(campaign.created_at || campaign.createdAt);
  const id = campaign.id;
  const [accounts, posts, engagements, audits, campaigns, joins, holders] = await Promise.all([
    sb(env, 'GET', '/score_accounts?campaign_id=eq.' + encodeURIComponent(id) + '&select=*'),
    sb(env, 'GET', '/score_posts?campaign_id=eq.' + encodeURIComponent(id) + '&select=*'),
    sb(env, 'GET', '/score_engagements?campaign_id=eq.' + encodeURIComponent(id) + '&select=*'),
    sb(env, 'GET', '/score_audit?campaign_id=eq.' + encodeURIComponent(id) + '&select=action,actor,created_at,subject_wallet,subject_handle,after'),
    sb(env, 'GET', '/campaigns?select=id,config,created_at,duration_days,status'),
    sb(env, 'GET', '/campaign_joins?select=campaign_id,wallet,x_handle,status,joined_at,score_override,handle_consent_at,handle_consent_version'),
    sb(env, 'GET', '/holders?select=wallet,x_handle,x_via,x_user_id'),
  ]);
  const postRows = rowsOf(posts);
  const postIdByRow = new Map(postRows.map((row) => [row.id, String(row.post_id)]));
  const holderRows = rowsOf(holders).map(holderFact);
  const joinRows = rowsOf(joins);
  const mine = joinRows.filter((row) => row && row.campaign_id === id);
  const season = seasonJoinsFromRows({
    campaign,
    campaigns: rowsOf(campaigns),
    joins: joinRows,
    holders: rowsOf(holders),
  });
  const wanted = new Set(mine.map((row) => row.wallet));
  for (const post of postRows) if (post.wallet) wanted.add(post.wallet);
  const ids = new Set();
  for (const holder of holderRows) {
    if (wanted.has(holder.wallet) && holder.x_via === 'oauth' && holder.x_user_id) ids.add(holder.x_user_id);
  }
  for (const row of season) ids.add(row.x_user_id);
  const holderOut = [];
  const seen = new Set();
  for (const holder of holderRows) {
    if (seen.has(holder.wallet)) continue;
    const relevant = wanted.has(holder.wallet) || (holder.x_via === 'oauth' && holder.x_user_id && ids.has(holder.x_user_id));
    if (!relevant) continue;
    seen.add(holder.wallet);
    holderOut.push(holder);
  }
  holderOut.sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  const holderByWallet = new Map(holderOut.map((row) => [row.wallet, row]));
  const auditsRows = rowsOf(audits).filter((row) => row && OVERRIDE_ACTIONS.has(row.action));
  function latest(action, wallet) {
    const hits = auditsRows.filter((row) => row.action === action && row.subject_wallet === wallet);
    hits.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    return hits[hits.length - 1] || null;
  }
  const inputs = {
    rule,
    campaign: {
      id: String(id),
      starts_at: new Date(created).toISOString(),
      ends_at: new Date(ends).toISOString(),
      season: seasonKey(ends),
    },
    accounts: rowsOf(accounts).map(accountFact).filter((row) => row.handle).sort((a, b) => a.handle.localeCompare(b.handle)),
    posts: postRows.map((row) => ({
      post_id: String(row.post_id),
      wallet: String(row.wallet),
      handle: normalizeHandle(row.handle),
      posted_at: postedAtFromId(row.post_id),
      text: row.text == null ? '' : String(row.text),
      deleted: row.deleted === true,
      checked_at: iso(row.checked_at),
      excluded: row.excluded === true,
    })).sort((a, b) => compareId(a.post_id, b.post_id)),
    engagements: rowsOf(engagements).map((row) => ({
      post_id: postIdByRow.get(row.post_row_id) || '',
      handle: normalizeHandle(row.engager_handle),
      kind: String(row.kind || ''),
    })).filter((row) => row.post_id && row.handle && KINDS.has(row.kind)).sort((a, b) => {
      const idOrder = compareId(a.post_id, b.post_id);
      if (idOrder) return idOrder;
      if (a.handle !== b.handle) return a.handle.localeCompare(b.handle);
      return a.kind.localeCompare(b.kind);
    }),
    joins: mine.map((row) => {
      const holder = holderByWallet.get(row.wallet);
      const action = row.score_override === 'include' || row.score_override === 'exclude' ? (row.score_override === 'include' ? 'include_person' : 'exclude_person') : null;
      const audit = action ? latest(action, row.wallet) : null;
      return {
        wallet: String(row.wallet),
        handle: normalizeHandle(row.x_handle),
        x_user_id: holder && holder.x_user_id ? holder.x_user_id : null,
        status: row.status == null ? null : String(row.status),
        joined_at: iso(row.joined_at),
        score_override: row.score_override === 'include' || row.score_override === 'exclude' ? row.score_override : null,
        override_at: audit ? iso(audit.created_at) : null,
        override_by: audit && audit.actor ? String(audit.actor) : null,
        consent: !!(row.handle_consent_at && row.handle_consent_version === RULE_V1.consentVersion),
      };
    }).sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0)),
    season_joins: season,
    holders: holderOut,
    overrides: auditsRows.map((row) => ({
      action: row.action,
      wallet: row.subject_wallet || null,
      handle: row.subject_handle ? normalizeHandle(row.subject_handle) : null,
      post_id: row.after && row.after.post_id ? String(row.after.post_id) : null,
      actor: row.actor || null,
      at: iso(row.created_at),
    })).sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')) || String(a.action).localeCompare(String(b.action)) || String(a.wallet || '').localeCompare(String(b.wallet || '')) || compareId(a.post_id, b.post_id)),
  };
  return inputs;
}

export function joinsForPayout(inputs, scored) {
  const byWallet = new Map((scored.results || []).map((row) => [row.wallet, row]));
  return (inputs.joins || []).map((join) => {
    const result = byWallet.get(join.wallet);
    const score = result ? result.score_milli : 0;
    return {
      wallet: join.wallet,
      status: join.status,
      progress: score,
      qualified: false,
      score_override: join.score_override || null,
      scoreExcluded: join.score_override === 'exclude',
      scoreIncluded: !!(result && result.included),
    };
  });
}

function payoutHashFrom(campaign, settlement, inputs, decimals) {
  const scored = scoreCampaign(inputs);
  const joins = joinsForPayout(inputs, scored);
  const built = computePayouts(campaign, joins, decimals);
  const waived = settlement && settlement.cut_waived === true;
  const cutWallet = waived ? null : (settlement && settlement.cut_wallet);
  const cutRaw = waived ? 0 : (settlement && settlement.cut_raw);
  return { hash: payoutHash(settlementLines(built.payouts, cutWallet, cutRaw)), built, scored };
}

export async function lockScoreSettlement(env, campaign) {
  const inputs = await buildScoreInputs(env, campaign);
  const scored = scoreCampaign(inputs);
  return {
    inputs,
    results: scored.results,
    hash: sha256Hex(canonicalJson(inputs)),
    joins: joinsForPayout(inputs, scored),
  };
}

function storedInputs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  if (typeof value === 'object') return value;
  return null;
}

export async function assertFrozenScore(env, settlement, campaign, getDecimals) {
  const rule = scoreRuleFromCampaign(campaign);
  const stored = storedInputs(settlement && settlement.score_inputs);
  if (!rule && !stored) return null;
  if (!stored) return 'score_inputs_changed';
  let live;
  try {
    live = await buildScoreInputs(env, campaign);
  } catch {
    return 'score_inputs_changed';
  }
  if (canonicalJson(live) !== canonicalJson(stored)) return 'score_inputs_changed';
  let decimals = 0;
  if (typeof getDecimals === 'function') decimals = await getDecimals();
  const again = payoutHashFrom(campaign, settlement, stored, decimals);
  if (again.hash !== settlement.payout_hash) return 'score_inputs_changed';
  return null;
}

function publicEngager(row) {
  return {
    handle: row.handle,
    kind: row.kind,
    created_on: row.created_on,
    followers: row.followers,
    following: row.following,
    class: row.class,
    weight: row.weight,
    label: row.label,
    source: row.source,
  };
}

function publicResults(results) {
  return (results || []).map((row) => ({
    wallet: row.wallet,
    handle: row.handle,
    score_milli: row.score_milli,
    excluded: row.excluded,
    included: row.included,
    gate: row.gate,
    override: row.override,
    posts: (row.posts || []).map((post) => ({
      post_id: post.post_id,
      wallet: post.wallet,
      handle: post.handle,
      posted_at: post.posted_at,
      text: post.text,
      deleted: post.deleted,
      excluded: post.excluded,
      checked_at: post.checked_at,
      T: post.T,
      score_milli: post.score_milli,
      kept: post.kept,
      reason: post.reason,
      near_duplicate_of: post.near_duplicate_of,
      engagers: (post.engagers || []).map(publicEngager),
    })),
  }));
}

async function reasonRows(env, campaignId) {
  return rowsOf(await sb(env, 'GET', '/score_audit?campaign_id=eq.' + encodeURIComponent(campaignId) + '&select=action,reason,actor,created_at,subject_wallet,subject_handle,after'));
}

function visibleReasons(rows, viewer, adminWallet, joins) {
  if (!viewer) return null;
  const mine = new Set();
  if (viewer === adminWallet) {
    return rows.filter((row) => row.reason).map(reasonFact);
  }
  for (const join of joins || []) {
    if (join.wallet === viewer) {
      mine.add(viewer);
      if (join.handle) mine.add(join.handle);
    }
  }
  if (!mine.size) return null;
  return rows.filter((row) => row.reason && (mine.has(row.subject_wallet) || mine.has(normalizeHandle(row.subject_handle)))).map(reasonFact);
}

function reasonFact(row) {
  return {
    action: row.action,
    reason: String(row.reason),
    actor: row.actor || null,
    at: iso(row.created_at),
    wallet: row.subject_wallet || null,
    handle: row.subject_handle ? normalizeHandle(row.subject_handle) : null,
    post_id: row.after && row.after.post_id ? String(row.after.post_id) : null,
  };
}

async function publicScore(request, env, campaignId) {
  const campaign = await loadCampaign(env, campaignId);
  if (!campaign || !scoreRuleFromCampaign(campaign)) return json({ error: 'not found' }, 404);
  const inputs = await buildScoreInputs(env, campaign);
  const scored = scoreCampaign(inputs);
  const settlements = rowsOf(await sb(
    env,
    'GET',
    '/vault_settlements?campaign_id=eq.' + encodeURIComponent(campaignId) + '&select=id,status,payout_hash,score_hash'
  )).map((row) => ({
    id: row.id,
    status: row.status,
    payout_hash: row.payout_hash || null,
    score_hash: row.score_hash || null,
  }));
  const body = {
    rule: inputs.rule,
    inputs,
    results: publicResults(scored.results),
    score_hash: sha256Hex(canonicalJson(inputs)),
    settlements,
  };
  const viewer = await optionalWallet(request, env);
  const project = rowsOf(await sb(env, 'GET', '/projects?id=eq.' + encodeURIComponent(campaign.project_id) + '&select=admin_wallet'))[0];
  const reasons = visibleReasons(await reasonRows(env, campaignId), viewer, project && project.admin_wallet, inputs.joins);
  if (reasons) body.reasons = reasons;
  return json(body);
}

function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const cells = line.split(',').map((cell) => cell.trim());
    if (cells[0] && cells[0].toLowerCase() === 'handle') continue;
    if (cells.length < 5) throw new Error('csv needs handle,kind,created_on,followers,following');
    out.push({
      handle: cells[0],
      kind: cells[1].toLowerCase(),
      created_on: cells[2],
      followers: cells[3],
      following: cells[4],
    });
  }
  return out;
}

async function upsertAccount(env, campaignId, actor, input, preserveBot) {
  const handle = normalizeHandle(input.handle);
  if (!handle) throw new Error('handle is required');
  const created = dayText(input.created_on);
  if (!created) throw new Error('created_on must be YYYY-MM-DD');
  const followers = whole(input.followers);
  const following = whole(input.following);
  if (followers == null || following == null) throw new Error('followers and following must be whole numbers');
  const existing = rowsOf(await sb(
    env,
    'GET',
    '/score_accounts?campaign_id=eq.' + encodeURIComponent(campaignId) + '&handle=eq.' + encodeURIComponent(handle) + '&select=*'
  ))[0] || null;
  const row = {
    campaign_id: campaignId,
    handle,
    x_created_on: created,
    followers,
    following,
    is_bot: preserveBot && existing ? existing.is_bot === true : false,
    bot_reason: preserveBot && existing ? (existing.bot_reason || null) : null,
    entered_by: actor,
    entered_at: new Date().toISOString(),
  };
  const saved = rowsOf(await sb(
    env,
    'POST',
    '/score_accounts?on_conflict=campaign_id,handle',
    row,
    'resolution=merge-duplicates,return=representation'
  ));
  await writeScoreAudit(env, {
    campaign_id: campaignId,
    action: existing ? 'edit_account' : 'enter_account',
    entity: 'account',
    before: existing ? accountFact(existing) : null,
    after: accountFact(row),
    actor,
    subject_handle: handle,
  });
  return saved[0] || row;
}

async function enterAccounts(request, env, campaign, actor, body) {
  const list = Array.isArray(body.accounts) ? body.accounts : [];
  if (!list.length) return json({ error: 'accounts are required' }, 400);
  const saved = [];
  for (const row of list) saved.push(await upsertAccount(env, campaign.id, actor, row, true));
  return json({ accounts: saved.map(accountFact) });
}

async function enterPosts(request, env, campaign, actor, body, now) {
  const list = Array.isArray(body.posts) ? body.posts : [];
  if (!list.length) return json({ error: 'posts are required' }, 400);
  const starts = Date.parse(campaign.created_at);
  const ends = endMs(campaign);
  const saved = [];
  for (const input of list) {
    const postId = String(input.post_id || '').trim();
    if (!/^\d+$/.test(postId)) return json({ error: 'post id is not a snowflake' }, 400);
    let postedAt;
    try { postedAt = postedAtFromId(postId); } catch (err) { return json({ error: err.message }, 400); }
    const postedMs = Date.parse(postedAt);
    if (now - postedMs < HOUR72) return json({ error: 'post is younger than 72 hours' }, 400);
    if (!Number.isFinite(starts) || ends == null || postedMs < starts || postedMs > ends) {
      return json({ error: 'post is outside the campaign window' }, 400);
    }
    const handle = normalizeHandle(input.handle);
    const wallet = String(input.wallet || '').trim();
    if (!handle || !wallet) return json({ error: 'post needs a wallet and handle' }, 400);
    const existingRows = rowsOf(await sb(env, 'GET', '/score_posts?post_id=eq.' + encodeURIComponent(postId) + '&select=*'));
    const other = existingRows.find((row) => row.campaign_id !== campaign.id);
    if (other) return json({ error: 'this post is already used in a campaign' }, 409);
    const existing = existingRows.find((row) => row.campaign_id === campaign.id) || null;
    const row = {
      campaign_id: campaign.id,
      wallet: existing ? existing.wallet : wallet,
      handle,
      post_id: postId,
      posted_at: postedAt,
      text: input.text == null ? '' : String(input.text),
      deleted: input.deleted === true || (input.deleted == null && existing ? existing.deleted === true : false),
      checked_at: new Date(now).toISOString(),
      excluded: existing ? existing.excluded === true : false,
      exclude_reason: existing ? (existing.exclude_reason || null) : null,
      entered_by: actor,
      entered_at: existing ? existing.entered_at : new Date(now).toISOString(),
    };
    let savedRow;
    try {
      if (existing) {
        savedRow = rowsOf(await sb(
          env,
          'PATCH',
          '/score_posts?id=eq.' + encodeURIComponent(existing.id),
          row,
          'return=representation'
        ))[0];
      } else {
        savedRow = rowsOf(await sb(env, 'POST', '/score_posts', row, 'return=representation'))[0];
      }
    } catch (err) {
      if (err && err.code === '23505') return json({ error: 'this post is already used in a campaign' }, 409);
      throw err;
    }
    await writeScoreAudit(env, {
      campaign_id: campaign.id,
      action: existing ? 'edit_post' : 'enter_post',
      entity: 'post',
      before: existing ? { post_id: existing.post_id, text: existing.text, deleted: existing.deleted === true } : null,
      after: { post_id: postId, text: row.text, deleted: row.deleted },
      actor,
      subject_wallet: row.wallet,
      subject_handle: handle,
    });
    saved.push(savedRow || row);
  }
  return json({ posts: saved });
}

async function enterEngagements(request, env, campaign, actor, body) {
  const postId = String(body.post_id || '').trim();
  if (!/^\d+$/.test(postId)) return json({ error: 'post id is not a snowflake' }, 400);
  let parsed;
  try {
    parsed = body.csv != null ? parseCsv(body.csv) : (Array.isArray(body.rows) ? body.rows : []);
  } catch (err) {
    return json({ error: err.message }, 400);
  }
  if (!parsed.length) return json({ error: 'engagements are required' }, 400);
  const post = rowsOf(await sb(
    env,
    'GET',
    '/score_posts?campaign_id=eq.' + encodeURIComponent(campaign.id) + '&post_id=eq.' + encodeURIComponent(postId) + '&select=*'
  ))[0];
  if (!post) return json({ error: 'post is not entered' }, 404);
  const saved = [];
  for (const input of parsed) {
    const handle = normalizeHandle(input.handle);
    const kind = String(input.kind || '').toLowerCase();
    if (!KINDS.has(kind)) return json({ error: 'kind must be quote, reply, repost, or like' }, 400);
    await upsertAccount(env, campaign.id, actor, input, true);
    const row = {
      post_row_id: post.id,
      campaign_id: campaign.id,
      engager_handle: handle,
      kind,
      entered_by: actor,
      entered_at: new Date().toISOString(),
    };
    await sb(env, 'POST', '/score_engagements?on_conflict=post_row_id,engager_handle,kind', row, 'resolution=merge-duplicates,return=minimal');
    await writeScoreAudit(env, {
      campaign_id: campaign.id,
      action: 'enter_engagement',
      entity: 'engagement',
      before: null,
      after: { post_id: postId, handle, kind, created_on: dayText(input.created_on), followers: whole(input.followers), following: whole(input.following) },
      actor,
      subject_handle: handle,
    });
    saved.push({ post_id: postId, handle, kind });
  }
  return json({ engagements: saved });
}

async function enterOverride(request, env, campaign, actor, body) {
  const action = String(body.action || '');
  if (!OVERRIDE_ACTIONS.has(action)) return json({ error: 'unknown override' }, 400);
  const reason = String(body.reason || '').trim();
  if (!reason) return json({ error: 'a reason is required' }, 400);
  if (action === 'exclude_post') {
    const postId = String(body.post_id || '').trim();
    const post = rowsOf(await sb(
      env,
      'GET',
      '/score_posts?campaign_id=eq.' + encodeURIComponent(campaign.id) + '&post_id=eq.' + encodeURIComponent(postId) + '&select=*'
    ))[0];
    if (!post) return json({ error: 'post is not entered' }, 404);
    await sb(env, 'PATCH', '/score_posts?id=eq.' + encodeURIComponent(post.id), { excluded: true, exclude_reason: reason }, 'return=minimal');
    await writeScoreAudit(env, {
      campaign_id: campaign.id,
      action,
      entity: 'post',
      before: { excluded: post.excluded === true },
      after: { post_id: postId, excluded: true },
      reason,
      actor,
      subject_wallet: post.wallet,
      subject_handle: post.handle,
    });
    return json({ ok: true });
  }
  if (action === 'bot') {
    const handle = normalizeHandle(body.handle);
    const account = rowsOf(await sb(
      env,
      'GET',
      '/score_accounts?campaign_id=eq.' + encodeURIComponent(campaign.id) + '&handle=eq.' + encodeURIComponent(handle) + '&select=*'
    ))[0];
    if (!account) return json({ error: 'account is not entered' }, 404);
    await sb(env, 'PATCH', '/score_accounts?campaign_id=eq.' + encodeURIComponent(campaign.id) + '&handle=eq.' + encodeURIComponent(handle), {
      is_bot: true,
      bot_reason: reason,
    }, 'return=minimal');
    await writeScoreAudit(env, {
      campaign_id: campaign.id,
      action,
      entity: 'account',
      before: { is_bot: account.is_bot === true },
      after: { handle, is_bot: true },
      reason,
      actor,
      subject_handle: handle,
    });
    return json({ ok: true });
  }
  const wallet = String(body.wallet || '').trim();
  const join = rowsOf(await sb(
    env,
    'GET',
    '/campaign_joins?campaign_id=eq.' + encodeURIComponent(campaign.id) + '&wallet=eq.' + encodeURIComponent(wallet) + '&select=*'
  ))[0];
  if (!join) return json({ error: 'join not found' }, 404);
  if (action === 'include_person') {
    const inputs = await buildScoreInputs(env, campaign);
    const trialJoins = inputs.joins.map((row) => row.wallet === wallet ? { ...row, score_override: null } : row);
    const trial = scoreCampaign({ ...inputs, joins: trialJoins });
    const mine = trial.results.find((row) => row.wallet === wallet);
    if (mine && mine.score_milli > 0) return json({ error: 'include is only for a person who scored 0' }, 400);
  }
  const override = action === 'include_person' ? 'include' : 'exclude';
  await sb(env, 'PATCH', '/campaign_joins?campaign_id=eq.' + encodeURIComponent(campaign.id) + '&wallet=eq.' + encodeURIComponent(wallet), {
    score_override: override,
    override_reason: reason,
  }, 'return=minimal');
  await writeScoreAudit(env, {
    campaign_id: campaign.id,
    action,
    entity: 'join',
    before: { score_override: join.score_override || null },
    after: { score_override: override },
    reason,
    actor,
    subject_wallet: wallet,
    subject_handle: normalizeHandle(join.x_handle),
  });
  return json({ ok: true });
}

async function scoredAdmin(request, env, campaignId) {
  if (!scoredOn(env)) return { error: json({ error: 'scoring is off' }, 403) };
  const admin = await adminCampaign(request, env, campaignId);
  if (admin.error) return admin;
  if (!scoreRuleFromCampaign(admin.campaign)) return { error: json({ error: 'campaign is not scored' }, 409) };
  return admin;
}

export async function handleScoreApi(request, env, now = Date.now()) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/campaigns\/([^/]+)\/score(?:\/(accounts|posts|engagements|overrides|rule))?$/);
  if (!match) return null;
  const campaignId = decodeURIComponent(match[1]);
  const leaf = match[2] || '';
  const method = request.method.toUpperCase();
  if (!leaf && method === 'GET') return publicScore(request, env, campaignId);
  if (method !== 'POST') return json({ error: 'not found' }, 404);
  if (leaf === 'rule') {
    const admin = await adminCampaign(request, env, campaignId);
    if (admin.error) return admin.error;
    return json({ error: 'score rule is frozen' }, 409);
  }
  const admin = await scoredAdmin(request, env, campaignId);
  if (admin.error) return admin.error;
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  if (hasTypedScore(body)) return json({ error: 'a score cannot be typed' }, 400);
  if (leaf === 'accounts') return enterAccounts(request, env, admin.campaign, admin.wallet, body);
  if (leaf === 'posts') return enterPosts(request, env, admin.campaign, admin.wallet, body, now);
  if (leaf === 'engagements') return enterEngagements(request, env, admin.campaign, admin.wallet, body);
  if (leaf === 'overrides') return enterOverride(request, env, admin.campaign, admin.wallet, body);
  return json({ error: 'not found' }, 404);
}

export async function walletInUnpaidScoredCampaign(env, wallet) {
  const joins = rowsOf(await sb(env, 'GET', '/campaign_joins?wallet=eq.' + encodeURIComponent(wallet) + '&select=campaign_id,status'));
  const open = joins.filter((row) => row && (row.status === 'pending' || row.status === 'approved'));
  if (!open.length) return false;
  const campaigns = rowsOf(await sb(env, 'GET', '/campaigns?select=id,status,config'));
  const ids = new Set(open.map((row) => row.campaign_id));
  return campaigns.some((row) => ids.has(row.id) && row.status !== 'paid' && scoreRuleFromCampaign(row));
}
