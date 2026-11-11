import { isBase58Address, verifyJwt } from './auth.js';
import { normalizeConfig } from './money.js';
import { decimalToRaw } from './settlement.js';
import { scoreRuleFromCampaign } from '../scoring.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BALANCE_TTL_MS = 60 * 1000;
const balanceCache = new Map();
let nowMs = () => Date.now();

export function setQueueClock(fn) {
  nowMs = typeof fn === 'function' ? fn : () => Date.now();
}

export function clearHolderBalanceCache() {
  balanceCache.clear();
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
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
  if (!res.ok) {
    const err = new Error((data && (data.message || data.error)) || 'supabase write failed');
    err.status = res.status;
    throw err;
  }
  return data;
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

async function sessionWallet(request, env) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) return { error: json({ error: 'missing session' }, 401) };
  if (!env.SUPABASE_JWT_SECRET) return { error: json({ error: 'auth is not configured' }, 500) };
  const claims = await verifyJwt(env.SUPABASE_JWT_SECRET, match[1]);
  if (!claims) return { error: json({ error: 'invalid session' }, 401) };
  return { wallet: claims.wallet };
}

function numericMinBalance(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    value = String(value);
  }
  const text = String(value == null ? '' : value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return text;
}

function numericTarget(value) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) return null;
    return value;
  }
  const text = String(value == null ? '' : value).trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

function kindOf(type) {
  const kind = String(type || '').toLowerCase();
  if (kind === 'hold' || kind === 'raid' || kind === 'refer') return kind;
  return 'custom';
}

function prizeMint(campaign, project) {
  const fromCampaign = String((campaign && campaign.prize_mint) || '').trim();
  if (fromCampaign) return fromCampaign;
  const fromVault = String((project && project.vault_mint) || '').trim();
  if (fromVault) return fromVault;
  return String((project && project.mint) || '').trim();
}

async function loadCampaign(env, campaignId) {
  if (!UUID.test(String(campaignId || ''))) return { error: json({ error: 'campaign not found' }, 404) };
  const rows = await sb(env, 'GET', '/campaigns?id=eq.' + encodeURIComponent(campaignId) + '&select=*');
  const campaign = Array.isArray(rows) ? rows[0] : null;
  if (!campaign) return { error: json({ error: 'campaign not found' }, 404) };
  return { campaign };
}

async function loadProject(env, projectId) {
  if (!projectId) return { error: json({ error: 'project not found' }, 404) };
  const rows = await sb(env, 'GET', '/projects?id=eq.' + encodeURIComponent(projectId) + '&select=*');
  const project = Array.isArray(rows) ? rows[0] : null;
  if (!project) return { error: json({ error: 'project not found' }, 404) };
  return { project };
}

async function adminCampaign(env, campaignId, wallet) {
  const loaded = await loadCampaign(env, campaignId);
  if (loaded.error) return loaded;
  const project = await loadProject(env, loaded.campaign.project_id);
  if (project.error) return project;
  if (project.project.admin_wallet !== wallet) {
    return { error: json({ error: 'not the project admin' }, 403) };
  }
  return { campaign: loaded.campaign, project: project.project };
}

async function joinsFor(env, campaignId) {
  const rows = await sb(
    env,
    'GET',
    '/campaign_joins?campaign_id=eq.' + encodeURIComponent(campaignId)
      + '&select=id,campaign_id,wallet,x_handle,status,progress,qualified,evidence_url,referred_by,joined_at'
  );
  return Array.isArray(rows) ? rows : [];
}

function visible(joins) {
  return (joins || []).filter((row) => row && row.wallet && row.status !== 'rejected');
}

function referralCount(joins, wallet) {
  let n = 0;
  for (const row of joins || []) {
    if (!row || row.status === 'rejected') continue;
    if (row.referred_by && row.referred_by === wallet) n += 1;
  }
  return n;
}

const UNREAD = 'could not read';

function tokenDecimals(value) {
  const n = value == null ? null : Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 18 ? n : null;
}

// One batched read for every holder not already cached. A holder whose balance cannot be read
// carries an error instead of a null, so the team sees "could not read" and can retry.
async function balancesFor(env, reader, wallets, mint, fresh) {
  const unique = [...new Set((wallets || []).filter(Boolean))];
  const now = nowMs();
  const reads = new Map();
  let decimals = null;
  const missing = [];
  for (const wallet of unique) {
    const hit = fresh ? null : balanceCache.get(wallet + '|' + mint);
    if (hit && now - hit.at < BALANCE_TTL_MS) {
      reads.set(wallet, hit.value);
      if (decimals == null) decimals = hit.value.decimals;
    } else {
      missing.push(wallet);
    }
  }
  if (!missing.length) return { decimals, reads };
  let found = null;
  try {
    found = await reader(env, missing, mint);
  } catch {
    found = null;
  }
  const readDecimals = tokenDecimals(found && found.decimals);
  if (readDecimals != null) decimals = readDecimals;
  const stamp = new Date(now).toISOString();
  for (const wallet of missing) {
    const got = found && found.balances instanceof Map ? found.balances.get(wallet) : null;
    const raw = got && got.raw != null ? String(got.raw).trim() : '';
    if (readDecimals == null || !/^\d+$/.test(raw)) {
      reads.set(wallet, { error: got && typeof got.error === 'string' ? got.error : UNREAD });
      continue;
    }
    const stored = { raw, decimals: readDecimals, at: stamp };
    balanceCache.set(wallet + '|' + mint, { at: now, value: stored });
    reads.set(wallet, stored);
  }
  return { decimals, reads };
}

function meetsHold(raw, minRaw) {
  if (raw == null || minRaw == null) return null;
  try {
    return BigInt(raw) >= BigInt(minRaw);
  } catch {
    return null;
  }
}

function holdMinRaw(human, decimals) {
  if (human == null) return { error: 'hold campaign needs a numeric minimum' };
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    return { error: 'could not read the reward token' };
  }
  try {
    return { raw: decimalToRaw(human, decimals).toString() };
  } catch {
    return { error: 'minimum does not fit the reward token' };
  }
}

function blankEvidence(kind) {
  return {
    kind,
    balance_raw: null,
    balance_as_of: null,
    balance_error: null,
    min_balance_raw: null,
    meets_min: null,
    post_url: null,
    referral_count: null,
  };
}

// Only an http(s) link is a proof the team can open. A script URL stays stored
// and is not returned as post_url.
function proofLink(value) {
  const text = value == null ? '' : String(value).trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function viewJoin(row) {
  return {
    wallet: row.wallet,
    x_handle: row.x_handle ? String(row.x_handle) : null,
    status: row.status === 'pending' ? 'pending' : 'approved',
    progress: Number(row.progress) || 0,
    qualified: row.qualified === true || row.qualified === 'true',
  };
}

function sortJoins(rows) {
  return rows.slice().sort((a, b) => {
    const ta = new Date(a.joined_at || 0).getTime();
    const tb = new Date(b.joined_at || 0).getTime();
    const da = Number.isFinite(ta) ? ta : 0;
    const db = Number.isFinite(tb) ? tb : 0;
    if (db !== da) return db - da;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
}

async function buildQueue(env, reader, campaign, project, joins, fresh) {
  const kind = kindOf(campaign.type);
  const cfg = normalizeConfig(campaign.config);
  const rows = sortJoins(visible(joins));
  const human = numericMinBalance(cfg.minBalance);
  const target = numericTarget(cfg.targets);
  let decimals = null;
  let minRaw = null;
  const reads = new Map();
  if (kind === 'hold') {
    const mint = prizeMint(campaign, project);
    if (mint && rows.length && typeof reader === 'function') {
      const found = await balancesFor(env, reader, rows.map((row) => row.wallet), mint, fresh);
      for (const [wallet, value] of found.reads) reads.set(wallet, value);
      decimals = found.decimals;
    }
    if (human != null && decimals != null) {
      const converted = holdMinRaw(human, decimals);
      if (!converted.error) minRaw = converted.raw;
    }
  }
  const built = rows.map((row) => {
    const evidence = blankEvidence(kind);
    if (kind === 'hold') {
      const read = reads.get(row.wallet);
      evidence.balance_raw = read && read.raw != null ? read.raw : null;
      evidence.balance_as_of = read && read.at ? read.at : null;
      evidence.balance_error = read && read.error ? read.error : null;
      evidence.min_balance_raw = minRaw;
      evidence.meets_min = meetsHold(evidence.balance_raw, minRaw);
    } else if (kind === 'raid' || kind === 'custom') {
      evidence.post_url = proofLink(row.evidence_url);
      evidence.meets_min = null;
    } else if (kind === 'refer') {
      evidence.referral_count = referralCount(joins, row.wallet);
      evidence.meets_min = target == null ? null : evidence.referral_count >= target;
    }
    return Object.assign(viewJoin(row), { evidence });
  });
  return { decimals, joins: built };
}

export async function handleJoinQueue(request, env, campaignId, readHolderBalances) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const admin = await adminCampaign(env, campaignId, session.wallet);
  if (admin.error) return admin.error;
  const joins = await joinsFor(env, admin.campaign.id);
  const built = await buildQueue(env, readHolderBalances, admin.campaign, admin.project, joins, false);
  return json({ decimals: built.decimals, joins: built.joins });
}

export async function handleQualifyMatching(request, env, campaignId, readHolderBalances) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const admin = await adminCampaign(env, campaignId, session.wallet);
  if (admin.error) return admin.error;
  if (scoreRuleFromCampaign(admin.campaign)) {
    return json({ error: 'a scored campaign has no hand score' }, 409);
  }
  if (kindOf(admin.campaign.type) !== 'hold') {
    return json({ error: 'qualify matching is only for a hold campaign' }, 400);
  }
  const human = numericMinBalance(normalizeConfig(admin.campaign.config).minBalance);
  if (human == null) return json({ error: 'hold campaign needs a numeric minimum' }, 400);
  const joins = await joinsFor(env, admin.campaign.id);
  const rows = visible(joins);
  if (!rows.length) return json({ qualified: 0, skipped: 0, unread: 0 });
  const mint = prizeMint(admin.campaign, admin.project);
  if (!mint) return json({ error: 'could not read the reward token' }, 400);
  const { decimals, reads } = await balancesFor(env, readHolderBalances, rows.map((row) => row.wallet), mint, true);
  if (decimals == null) return json({ error: 'could not read the reward token' }, 400);
  const converted = holdMinRaw(human, decimals);
  if (converted.error) return json({ error: converted.error }, 400);
  const minRaw = BigInt(converted.raw);
  const ids = [];
  let skipped = 0;
  let unread = 0;
  for (const row of rows) {
    const read = reads.get(row.wallet);
    const already = row.qualified === true || row.qualified === 'true';
    if (!already && (!read || read.raw == null)) unread += 1;
    let pass = false;
    if (!already && read && read.raw != null) {
      try { pass = BigInt(read.raw) >= minRaw; } catch { pass = false; }
    }
    if (pass && row.id) ids.push(row.id);
    else skipped += 1;
  }
  if (ids.length) {
    const stamp = new Date(nowMs()).toISOString();
    await sb(
      env,
      'PATCH',
      '/campaign_joins?id=in.(' + ids.map((id) => encodeURIComponent(id)).join(',') + ')',
      { qualified: true, qualified_at: stamp, status: 'approved' },
      'return=representation'
    );
  }
  return json({ qualified: ids.length, skipped, unread });
}

export async function handleSetReferrer(request, env, campaignId) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  if (!UUID.test(String(campaignId || ''))) return json({ error: 'campaign not found' }, 404);
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  const referrer = body.referrer == null ? '' : String(body.referrer).trim();
  if (!isBase58Address(referrer)) return json({ error: 'referrer is not a wallet' }, 400);
  if (referrer === session.wallet) return json({ error: 'a wallet cannot refer itself' }, 400);
  const campaigns = await sb(env, 'GET', '/campaigns?id=eq.' + encodeURIComponent(campaignId) + '&select=id');
  const campaign = Array.isArray(campaigns) ? campaigns[0] : null;
  if (!campaign) return json({ error: 'campaign not found' }, 404);
  const joins = await joinsFor(env, campaignId);
  const mine = joins.find((row) => row && row.wallet === session.wallet && row.status !== 'rejected');
  if (!mine) return json({ error: 'join not found' }, 404);
  if (mine.referred_by && mine.referred_by !== referrer) return json({ error: 'referral already set' }, 400);
  if (mine.referred_by === referrer) return json({ ok: true });
  const ref = joins.find((row) => row && row.wallet === referrer && row.status !== 'rejected');
  if (!ref) return json({ error: 'referrer has no join in this campaign' }, 400);
  const updated = await sb(
    env,
    'PATCH',
    '/campaign_joins?id=eq.' + encodeURIComponent(mine.id) + '&wallet=eq.' + encodeURIComponent(session.wallet),
    { referred_by: referrer },
    'return=representation'
  );
  const row = Array.isArray(updated) ? updated[0] : null;
  if (!row) return json({ error: 'join not found' }, 404);
  return json({ ok: true });
}
