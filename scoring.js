// Bard scoring rule v1. Pure module: no imports. The worker, the admin page,
// and the receipt page all load this file. scoreCampaign never reads a database.

export const SNOWFLAKE_EPOCH_MS = 1288834974657;

export const LABEL_SAME_CAMPAIGN = 'joined this campaign (weight 0)';
export const LABEL_OTHER_CAMPAIGN = 'member of another Bard campaign this season (half weight)';

export const CONSENT_TEXT = 'On this campaign\'s public receipt anyone can see your X handle, your posts, the engagement on them and your payout, and can link your handle to your wallet. If you engage with another Bard campaign this season, that campaign\'s receipt shows your handle as a Bard member and counts your engagement at half weight.';

const KIND_WEIGHT = { quote: 3, reply: 3, repost: 2, like: 0 };
const KIND_TIE = { quote: 3, reply: 2, repost: 1, like: 0 };

export const RULE_V1 = Object.freeze({
  version: 'bard-score-v1',
  bestN: 5,
  minAccountDays: 90,
  minFollowers: 50,
  minEngagerFollowers: 10,
  ageZeroDays: 30,
  ageSpanDays: 335,
  checkHours: 72,
  shingle: 5,
  nearDupNum: 3,
  nearDupDen: 5,
  kinds: Object.freeze({ quote: 3, reply: 3, repost: 2, like: 0 }),
  consentVersion: 'bard-score-v1',
  consentText: CONSENT_TEXT,
  labels: Object.freeze({
    sameCampaign: LABEL_SAME_CAMPAIGN,
    otherCampaign: LABEL_OTHER_CAMPAIGN,
  }),
});

const THOUSAND = 1000n;
const THOUSAND_POW = THOUSAND ** THOUSAND;

function finiteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  const text = String(value == null ? '' : value).trim();
  if (!/^-?\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

function whole(value) {
  const n = finiteNumber(value);
  if (n == null || n < 0) return 0;
  return Math.trunc(n);
}

export function normalizeHandle(value) {
  return String(value == null ? '' : value).trim().replace(/^@+/, '').toLowerCase();
}

export function scoreRuleOf(config) {
  let cfg = config;
  if (typeof cfg === 'string') {
    try { cfg = JSON.parse(cfg); } catch { return null; }
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null;
  const rule = cfg.scoreRule;
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null;
  return rule;
}

export function scoreRuleFromCampaign(campaign) {
  return scoreRuleOf(campaign && campaign.config);
}

export function postedAtFromId(id) {
  const text = String(id == null ? '' : id).trim();
  if (!/^\d+$/.test(text)) throw new Error('post id is not a snowflake');
  const ms = (BigInt(text) >> 22n) + BigInt(SNOWFLAKE_EPOCH_MS);
  const asNum = Number(ms);
  if (!Number.isSafeInteger(asNum)) throw new Error('posted_at out of range');
  return new Date(asNum).toISOString();
}

export function snowflakeId(ms, seq = 0) {
  const at = BigInt(ms);
  const n = ((at - BigInt(SNOWFLAKE_EPOCH_MS)) << 22n) + BigInt(seq);
  if (n < 0n) throw new Error('snowflake time is before the epoch');
  return n.toString();
}

export function log2Milli(T) {
  const text = String(T == null ? '' : T).trim();
  if (!/^\d+$/.test(text)) throw new Error('T must be a non-negative integer');
  const n = BigInt(text);
  if (n === 0n) return 0;
  const right = (THOUSAND + n) ** THOUSAND;
  let lo = 0n;
  let hi = BigInt(right.toString(2).length);
  while (lo < hi) {
    const mid = (lo + hi + 1n) >> 1n;
    if ((1n << mid) * THOUSAND_POW <= right) lo = mid;
    else hi = mid - 1n;
  }
  const out = Number(lo);
  if (!Number.isSafeInteger(out)) throw new Error('score out of range');
  return out;
}

function canonicalize(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalJson rejects non-finite numbers');
    return value;
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  throw new Error('canonicalJson rejects ' + typeof value);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function normalizeText(text) {
  let s = String(text == null ? '' : text).toLowerCase();
  s = s.replace(/https?:\/\/\S+/g, ' ');
  s = s.replace(/[@#$][\p{L}\p{N}_]+/gu, ' ');
  s = s.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function shingleSet(norm, size) {
  const set = new Set();
  if (norm.length < size) return set;
  for (let i = 0; i <= norm.length - size; i++) set.add(norm.slice(i, i + size));
  return set;
}

export function nearDuplicate(a, b) {
  const size = RULE_V1.shingle;
  const left = normalizeText(a);
  const right = normalizeText(b);
  const A = shingleSet(left, size);
  const B = shingleSet(right, size);
  if (A.size === 0 && B.size === 0) {
    if (left === '' && right === '') return false;
    return left === right;
  }
  if (A.size === 0 || B.size === 0) return false;
  let inter = 0;
  for (const piece of A) if (B.has(piece)) inter += 1;
  const union = A.size + B.size - inter;
  // Jaccard |A∩B| / |A∪B| >= nearDupNum/nearDupDen (3/5 = 0.6).
  return inter * RULE_V1.nearDupDen >= union * RULE_V1.nearDupNum;
}

function list(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(name + ' must be an array');
  return value;
}

function postKey(id) {
  return String(id == null ? '' : id).trim();
}

function comparePostId(a, b) {
  const as = postKey(a);
  const bs = postKey(b);
  const aNum = /^\d+$/.test(as);
  const bNum = /^\d+$/.test(bs);
  if (aNum && bNum) {
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

function utcDayCount(createdOn, postedAtIso) {
  const day = String(createdOn == null ? '' : createdOn).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const created = Date.parse(day + 'T00:00:00.000Z');
  const posted = Date.parse(postedAtIso);
  if (!Number.isFinite(created) || !Number.isFinite(posted)) return null;
  const at = new Date(posted);
  const postedDay = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  return Math.floor((postedDay - created) / 86400000);
}

function ruleOf(inputs) {
  const given = inputs && inputs.rule;
  if (given == null) return RULE_V1;
  if (typeof given !== 'object') throw new Error('unknown score rule');
  if (given.version !== RULE_V1.version) throw new Error('unknown score rule');
  const bestN = finiteNumber(given.bestN);
  if (bestN == null || bestN !== Math.trunc(bestN) || bestN < 1 || bestN > 10) {
    throw new Error('bestN must be from 1 to 10');
  }
  return {
    version: RULE_V1.version,
    bestN,
    minAccountDays: whole(given.minAccountDays == null ? RULE_V1.minAccountDays : given.minAccountDays) || RULE_V1.minAccountDays,
    minFollowers: given.minFollowers == null ? RULE_V1.minFollowers : whole(given.minFollowers),
    minEngagerFollowers: given.minEngagerFollowers == null ? RULE_V1.minEngagerFollowers : whole(given.minEngagerFollowers),
    ageZeroDays: given.ageZeroDays == null ? RULE_V1.ageZeroDays : whole(given.ageZeroDays),
    ageSpanDays: given.ageSpanDays == null ? RULE_V1.ageSpanDays : whole(given.ageSpanDays),
    checkHours: given.checkHours == null ? RULE_V1.checkHours : whole(given.checkHours),
    kinds: given.kinds && typeof given.kinds === 'object' ? given.kinds : RULE_V1.kinds,
  };
}

function kindWeight(kinds, kind) {
  if (!Object.prototype.hasOwnProperty.call(KIND_WEIGHT, kind)) return null;
  const fromRule = kinds && kinds[kind];
  const n = fromRule == null ? KIND_WEIGHT[kind] : whole(fromRule);
  return n;
}

function emptyEngager(handle, kind) {
  return {
    handle,
    kind,
    created_on: null,
    followers: null,
    following: null,
    class: 'outside',
    weight: 0,
    label: '',
    source: 'entered by the team',
  };
}

export function scoreCampaign(inputs) {
  const src = inputs && typeof inputs === 'object' ? inputs : {};
  const rule = ruleOf(src);
  const campaign = src.campaign && typeof src.campaign === 'object' ? src.campaign : {};
  const starts = Date.parse(campaign.starts_at);
  const ends = Date.parse(campaign.ends_at);
  const checkMs = rule.checkHours * 3600 * 1000;
  const accounts = new Map();
  for (const row of list(src.accounts, 'accounts')) {
    if (!row || typeof row !== 'object') continue;
    const handle = normalizeHandle(row.handle);
    if (!handle) continue;
    accounts.set(handle, row);
  }
  const holders = list(src.holders, 'holders').filter((row) => row && typeof row === 'object');
  const joins = list(src.joins, 'joins').filter((row) => row && typeof row === 'object' && row.wallet);
  const seasonJoins = list(src.season_joins, 'season_joins').filter((row) => row && typeof row === 'object');
  const posts = list(src.posts, 'posts').filter((row) => row && typeof row === 'object');
  const engagements = list(src.engagements, 'engagements').filter((row) => row && typeof row === 'object');
  const overrideRows = list(src.overrides, 'overrides').filter((row) => row && typeof row === 'object');

  const joinedHandles = new Set(joins.map((row) => normalizeHandle(row.handle)).filter(Boolean));
  const joinByWallet = new Map();
  for (const row of joins) {
    if (!joinByWallet.has(row.wallet)) joinByWallet.set(row.wallet, row);
  }

  function oauthIds(handle) {
    const ids = [];
    for (const holder of holders) {
      if (holder.x_via !== 'oauth' || holder.x_user_id == null || String(holder.x_user_id).trim() === '') continue;
      if (normalizeHandle(holder.handle) !== handle) continue;
      ids.push(String(holder.x_user_id));
    }
    return [...new Set(ids)];
  }

  function inOtherCampaign(handle) {
    const ids = oauthIds(handle);
    if (ids.length !== 1) return false;
    return seasonJoins.some((row) => String(row.x_user_id) === ids[0]);
  }

  function accountGate(wallet, handle) {
    const holder = holders.find((row) => row.wallet === wallet);
    if (!holder || holder.x_via !== 'oauth' || holder.x_user_id == null || String(holder.x_user_id).trim() === '') {
      return 'unverified';
    }
    if (normalizeHandle(holder.handle) !== handle) return 'unverified';
    const id = String(holder.x_user_id);
    const owners = holders.filter((row) => row.x_via === 'oauth' && String(row.x_user_id) === id);
    if (owners.length !== 1 || owners[0].wallet !== wallet) return 'not_one_wallet';
    const account = accounts.get(handle);
    if (!account || whole(account.followers) < rule.minFollowers) return 'followers';
    return null;
  }

  const dupOf = new Map();
  const ordered = posts.slice().sort((a, b) => comparePostId(a.post_id, b.post_id));
  for (let i = 0; i < ordered.length; i++) {
    const later = ordered[i];
    const laterId = postKey(later.post_id);
    for (let j = 0; j < i; j++) {
      if (nearDuplicate(ordered[j].text, later.text)) {
        dupOf.set(laterId, postKey(ordered[j].post_id));
        break;
      }
    }
  }

  const engagersByPost = new Map();
  for (const row of engagements) {
    const kind = String(row.kind || '');
    const weight = kindWeight(rule.kinds, kind);
    if (weight == null) continue;
    const handle = normalizeHandle(row.handle);
    const postId = postKey(row.post_id);
    if (!handle || !postId) continue;
    if (!engagersByPost.has(postId)) engagersByPost.set(postId, new Map());
    const bucket = engagersByPost.get(postId);
    const prev = bucket.get(handle);
    const rank = weight * 10 + (KIND_TIE[kind] || 0);
    const prevRank = prev ? prev.rank : -1;
    if (!prev || rank > prevRank) bucket.set(handle, { handle, kind, weight, rank });
  }

  function scorePost(post) {
    const handle = normalizeHandle(post.handle);
    const postId = postKey(post.post_id);
    let postedAt = null;
    let badId = false;
    try {
      postedAt = postedAtFromId(postId);
    } catch {
      badId = true;
    }
    const postedMs = postedAt ? Date.parse(postedAt) : NaN;
    const checkedMs = Date.parse(post.checked_at);
    const engagers = [];
    const bucket = engagersByPost.get(postId);
    if (bucket) {
      for (const item of [...bucket.values()].sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0))) {
        const built = emptyEngager(item.handle, item.kind);
        const account = accounts.get(item.handle);
        let w = 0;
        if (account) {
          built.created_on = String(account.created_on == null ? '' : account.created_on).slice(0, 10) || null;
          built.followers = whole(account.followers);
          built.following = whole(account.following);
          const days = postedAt ? utcDayCount(built.created_on, postedAt) : null;
          let age = 0;
          if (days != null && rule.ageSpanDays > 0) {
            age = Math.floor((1000 * (days - rule.ageZeroDays)) / rule.ageSpanDays);
            if (age < 0) age = 0;
            if (age > 1000) age = 1000;
          }
          let ratio = 0;
          if (built.followers >= rule.minEngagerFollowers) {
            const denom = Math.max(built.following, 1);
            ratio = Math.min(1000, Math.floor((2000 * built.followers) / denom));
          }
          w = Math.floor((age * ratio) / 1000);
        }
        if (item.handle === handle) {
          built.class = 'poster';
          w = 0;
        } else if (joinedHandles.has(item.handle)) {
          built.class = 'same_campaign';
          built.label = LABEL_SAME_CAMPAIGN;
          w = 0;
        } else if (account && account.is_bot === true) {
          built.class = 'bot';
          w = 0;
        } else if (inOtherCampaign(item.handle)) {
          built.class = 'other_campaign';
          built.label = LABEL_OTHER_CAMPAIGN;
          w = Math.floor(w / 2);
        }
        built.weight = w;
        built.kind_weight = item.weight;
        engagers.push(built);
      }
    }
    let T = 0;
    for (const row of engagers) T += row.kind_weight * row.weight;
    let reason = null;
    if (post.excluded === true) reason = 'excluded';
    else if (post.deleted === true) reason = 'deleted';
    else if (badId || !Number.isFinite(postedMs)) reason = 'bad_post_id';
    else if (!Number.isFinite(starts) || !Number.isFinite(ends) || postedMs < starts || postedMs > ends) reason = 'outside_window';
    else if (!Number.isFinite(checkedMs) || checkedMs - postedMs < checkMs) reason = 'unchecked_72h';
    else {
      const gate = accountGate(post.wallet, handle);
      if (gate) reason = gate;
      else {
        const days = utcDayCount(accounts.get(handle) && accounts.get(handle).created_on, postedAt);
        if (days == null || days < rule.minAccountDays) reason = 'account_age';
        else if (dupOf.has(postId)) reason = 'near_duplicate';
      }
    }
    const score = reason ? 0 : log2Milli(T);
    return {
      post_id: postId,
      wallet: post.wallet,
      handle,
      posted_at: postedAt,
      text: post.text == null ? '' : String(post.text),
      deleted: post.deleted === true,
      excluded: post.excluded === true,
      checked_at: post.checked_at == null ? null : String(post.checked_at),
      T,
      score_milli: score,
      kept: reason == null,
      reason,
      near_duplicate_of: reason === 'near_duplicate' ? dupOf.get(postId) : null,
      engagers,
    };
  }

  const scoredPosts = posts.map(scorePost);
  const wallets = new Set();
  for (const row of joins) wallets.add(row.wallet);
  for (const row of scoredPosts) if (row.wallet) wallets.add(row.wallet);

  function overrideFor(action, wallet, postId) {
    const hits = overrideRows.filter((row) => {
      if (row.action !== action) return false;
      if (wallet && row.wallet && row.wallet !== wallet) return false;
      if (postId && row.post_id && postKey(row.post_id) !== postId) return false;
      if (action === 'exclude_person' || action === 'include_person') return row.wallet === wallet;
      if (action === 'exclude_post') return postKey(row.post_id) === postId;
      return true;
    });
    hits.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    const last = hits[hits.length - 1];
    if (!last) return null;
    return { action: last.action, actor: last.actor == null ? null : String(last.actor), at: last.at == null ? null : String(last.at) };
  }

  const results = [...wallets].sort().map((wallet) => {
    const join = joinByWallet.get(wallet) || null;
    const mine = scoredPosts.filter((row) => row.wallet === wallet).sort((a, b) => comparePostId(a.post_id, b.post_id));
    const handle = normalizeHandle((join && join.handle) || (mine[0] && mine[0].handle) || '');
    const ranked = mine.slice().sort((a, b) => {
      if (b.score_milli !== a.score_milli) return b.score_milli - a.score_milli;
      return comparePostId(a.post_id, b.post_id);
    });
    let score = 0;
    for (const row of ranked.slice(0, rule.bestN)) score += row.score_milli;
    const excluded = !!(join && join.score_override === 'exclude');
    if (excluded) score = 0;
    const wantInclude = !!(join && join.score_override === 'include');
    const included = wantInclude && !excluded && score === 0;
    const gateReason = handle ? accountGate(wallet, handle) : 'unverified';
    const account = handle ? accounts.get(handle) : null;
    const holder = holders.find((row) => row.wallet === wallet) || null;
    let action = null;
    if (excluded) action = 'exclude_person';
    else if (included) action = 'include_person';
    return {
      wallet,
      handle,
      score_milli: score,
      excluded,
      included,
      gate: {
        ok: gateReason == null,
        reason: gateReason,
        created_on: account ? String(account.created_on == null ? '' : account.created_on).slice(0, 10) || null : null,
        followers: account ? whole(account.followers) : null,
        following: account ? whole(account.following) : null,
        x_user_id: holder && holder.x_user_id != null ? String(holder.x_user_id) : null,
        x_via: holder && holder.x_via ? String(holder.x_via) : null,
      },
      override: action ? overrideFor(action, wallet, null) : null,
      posts: mine,
    };
  });

  return { results };
}

if (typeof window !== 'undefined') {
  window.BardScore = {
    RULE_V1,
    scoreCampaign,
    log2Milli,
    nearDuplicate,
    canonicalJson,
    postedAtFromId,
    CONSENT_TEXT,
    LABEL_SAME_CAMPAIGN,
    LABEL_OTHER_CAMPAIGN,
  };
}
