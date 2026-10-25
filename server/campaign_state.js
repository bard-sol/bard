import { sha256Hex } from './settlement.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAIN_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;
const BOARD_CAP = 200;

function noStore(data, status) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

function cacheDefault(env) {
  if (env && env.caches && env.caches.default) return env.caches.default;
  if (typeof caches !== 'undefined' && caches && caches.default) return caches.default;
  return null;
}

async function sbGet(env, pathAndQuery) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) {
    const err = new Error('SUPABASE_URL is not set');
    err.status = 500;
    throw err;
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    const err = new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    err.status = 500;
    throw err;
  }
  const fetcher = env.fetch || fetch;
  const res = await fetcher(base + '/rest/v1' + pathAndQuery, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      accept: 'application/json',
    },
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { message: text }; }
  }
  if (!res.ok) {
    const err = new Error((data && (data.message || data.error)) || 'supabase read failed');
    err.status = res.status;
    throw err;
  }
  return Array.isArray(data) ? data : [];
}

function hasField(row, key) {
  return !!row && Object.prototype.hasOwnProperty.call(row, key) && row[key] != null && row[key] !== '';
}

function integerString(row, key) {
  if (!hasField(row, key)) return null;
  const value = String(row[key]).trim();
  return /^\d+$/.test(value) ? value : null;
}

function cutBps(row) {
  if (!hasField(row, 'cut_bps')) return null;
  const n = Number(row.cut_bps);
  if (!Number.isInteger(n) || n < 0 || n > 10000) return null;
  return n;
}

export function shortWallet(addr) {
  if (!addr) return '—';
  const s = String(addr);
  if (s.length < 10) return s;
  return s.slice(0, 4) + '…' + s.slice(-4);
}

function notFound() {
  const err = new Error('campaign not found');
  err.status = 404;
  throw err;
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function isChainSignature(value) {
  const sig = String(value || '').trim();
  if (!sig || sig === 'released') return false;
  return CHAIN_SIGNATURE.test(sig);
}

function pickSettlement(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return null;
  const executed = list.filter((row) => row.status === 'executed');
  const pool = executed.length ? executed : list;
  pool.sort((a, b) => String(b.executed_at || b.created_at || '').localeCompare(String(a.executed_at || a.created_at || '')));
  return pool[0];
}

function clockFor(campaign, settlement, now) {
  const created = campaign.created_at ? new Date(campaign.created_at) : new Date(now);
  const startsAt = iso(created);
  const days = Number(campaign.duration_days);
  const growing = campaign.reward_mode === 'growing';
  const noEnd = growing || !(days > 0);
  const endsAt = noEnd ? null : iso(new Date(created.getTime() + days * 86400000));
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const paid = campaign.status === 'paid' || (
    settlement && settlement.status === 'executed' && isChainSignature(settlement.tx_signature)
  );
  let state = 'live';
  if (paid) state = 'paid';
  else if (campaign.status === 'ended' || (endsAt && t >= new Date(endsAt).getTime())) state = 'ended';
  else if (Number.isFinite(created.getTime()) && t < created.getTime()) state = 'upcoming';
  return {
    state,
    starts_at: startsAt,
    ends_at: endsAt,
    no_end: noEnd,
    ends_at_source: 'derived',
    server_time: iso(t),
  };
}

function whoGetsPaid(campaign, ticker) {
  const count = Number(campaign.draw_count);
  if (Number.isFinite(count) && count > 0) {
    return {
      who: 'draw',
      text: 'draw of ' + String(count) + ' from the qualified, seed committed to a Solana slot',
    };
  }
  const mode = campaign.reward_mode || 'fixed';
  const symbol = ticker || 'TOKEN';
  if (mode === 'pool') return { who: 'pool', text: 'pool split among the qualified' };
  if (mode === 'top3') return { who: 'top3', text: 'top 3 by progress: 50 / 30 / 20' };
  if (mode === 'growing') return { who: 'growing', text: 'growing pool to the top holder' };
  const amount = campaign.reward == null || String(campaign.reward).trim() === '' ? '0' : String(campaign.reward).trim();
  return { who: 'everyone', text: 'every qualified holder gets ' + amount + ' ' + symbol };
}

function boardSort(a, b) {
  if (!!b.qualified !== !!a.qualified) return b.qualified ? 1 : -1;
  const progress = (Number(b.progress) || 0) - (Number(a.progress) || 0);
  if (progress) return progress;
  if (String(a.wallet) < String(b.wallet)) return -1;
  if (String(a.wallet) > String(b.wallet)) return 1;
  return 0;
}

function boardEntry(rank, wallet, holder, progress, qualified) {
  const show = !!holder && (holder.show_handle === true || holder.show_handle === 'true');
  const verified = !!holder && holder.x_via === 'oauth';
  const handle = show && verified && holder.x_handle ? String(holder.x_handle) : null;
  return {
    rank,
    wallet_short: shortWallet(wallet),
    wallet_hash: sha256Hex(wallet),
    handle,
    progress: Number(progress) || 0,
    qualified: !!qualified,
  };
}

function explorerAccount(address, rpc) {
  if (!address) return null;
  const devnet = String(rpc || '').includes('devnet');
  return 'https://solscan.io/account/' + address + (devnet ? '?cluster=devnet' : '');
}

function belowLocked(balanceRaw, lockedRaw) {
  if (balanceRaw == null || lockedRaw == null) return null;
  try {
    return BigInt(balanceRaw) < BigInt(lockedRaw);
  } catch {
    return null;
  }
}

async function holdersByWallet(env, wallets) {
  const unique = [...new Set(wallets.filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;
  const list = unique.map((wallet) => '"' + String(wallet).replace(/"/g, '') + '"').join(',');
  const rows = await sbGet(env, '/holders?select=wallet,x_handle,show_handle,x_via&wallet=in.(' + list + ')');
  for (const row of rows) {
    if (row && row.wallet) map.set(row.wallet, row);
  }
  return map;
}

export async function buildCampaignState(env, campaignId, now = new Date(), readVaultTokenRaw) {
  if (!UUID.test(String(campaignId || ''))) notFound();
  const id = String(campaignId);
  const campaigns = await sbGet(env, '/campaigns?id=eq.' + encodeURIComponent(id) + '&select=*');
  const campaign = campaigns[0];
  if (!campaign) notFound();
  const projects = await sbGet(env, '/projects?id=eq.' + encodeURIComponent(campaign.project_id) + '&select=*');
  const project = projects[0];
  if (!project) notFound();
  const joins = await sbGet(env, '/campaign_joins?campaign_id=eq.' + encodeURIComponent(id) + '&select=wallet,qualified,status,progress');
  const settlements = await sbGet(env, '/vault_settlements?campaign_id=eq.' + encodeURIComponent(id) + '&select=id,status,tx_signature,executed_at,created_at,payouts');
  const settlement = pickSettlement(settlements);
  const clock = clockFor(campaign, settlement, now);
  const executed = settlement && settlement.status === 'executed' ? settlement : null;
  const payouts = executed && Array.isArray(executed.payouts) ? executed.payouts.filter((row) => row && row.wallet) : [];
  const visible = joins.filter((row) => row && row.status !== 'rejected' && row.wallet);
  const paid = clock.state === 'paid';
  const shown = paid && payouts.length
    ? payouts.slice(0, BOARD_CAP).map((row) => ({ wallet: row.wallet, progress: row.progress, qualified: true }))
    : visible.slice().sort(boardSort).slice(0, BOARD_CAP);
  const holders = await holdersByWallet(env, shown.map((row) => row.wallet));
  const board = shown.map((row, index) => boardEntry(index + 1, row.wallet, holders.get(row.wallet), row.progress, row.qualified));

  const mint = (hasField(campaign, 'prize_mint') && String(campaign.prize_mint).trim())
    || project.vault_mint
    || project.mint
    || null;
  let balanceRaw = null;
  let decimals = null;
  let balanceAsOf = null;
  if (mint && project.vault_address) {
    if (typeof readVaultTokenRaw !== 'function') throw new Error('vault reader is missing');
    const bal = await readVaultTokenRaw(env, project.vault_address, mint);
    balanceRaw = String(bal.raw);
    decimals = bal.decimals;
    balanceAsOf = iso(now);
  }
  const lockedRaw = integerString(campaign, 'locked_raw');
  const verified = project.vault_status === 'verified' && !!project.vault_address;
  const address = verified ? project.vault_address : null;
  const ticker = project.ticker || '';
  const who = whoGetsPaid(campaign, ticker);
  const receipt = executed && isChainSignature(executed.tx_signature);
  const stamp = iso(now);

  return {
    as_of: stamp,
    campaign: {
      id: campaign.id,
      title: campaign.title || '',
      type: campaign.type || 'hold',
      rule_text: campaign.rule_text || '',
      reward_mode: campaign.reward_mode || 'fixed',
      access_mode: campaign.access_mode || 'open',
      status: campaign.status || 'active',
      project: { id: project.id, name: project.name || '', ticker },
    },
    clock,
    prize: {
      mint,
      symbol: ticker,
      decimals,
      locked: lockedRaw != null,
      prize_raw: integerString(campaign, 'prize_raw'),
      locked_raw: lockedRaw,
      cut_bps: cutBps(campaign),
      cut_raw: integerString(campaign, 'cut_raw'),
      who_gets_paid: who.who,
      who_gets_paid_text: who.text,
    },
    vault: {
      address,
      explorer_url: explorerAccount(address, env.SOLANA_RPC),
      balance_raw: balanceRaw,
      balance_as_of: balanceAsOf,
      below_locked: belowLocked(balanceRaw, lockedRaw),
    },
    counts: {
      joined: visible.length,
      qualified: visible.filter((row) => row.qualified === true || row.qualified === 'true').length,
      paid: payouts.length,
    },
    board,
    settlement: settlement ? {
      id: settlement.id,
      status: settlement.status,
      tx_signature: settlement.tx_signature || null,
      executed_at: settlement.executed_at || null,
    } : null,
    links: {
      page: '/c/' + id,
      receipt: receipt ? '/c/' + id + '/receipt' : null,
    },
  };
}

export function campaignStateCacheUrl(requestUrl) {
  const url = new URL(requestUrl);
  return url.origin + url.pathname;
}

export async function handleCampaignState(request, env, campaignId, readVaultTokenRaw) {
  const cache = cacheDefault(env);
  const key = new Request(campaignStateCacheUrl(request.url), { method: 'GET' });
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return hit;
    } catch { /* a missing cache must not block the read */ }
  }
  let body;
  try {
    body = await buildCampaignState(env, campaignId, new Date(), readVaultTokenRaw);
  } catch (err) {
    if (err && err.status === 404) return noStore({ error: 'campaign not found' }, 404);
    throw err;
  }
  const response = Response.json(body, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60, stale-while-revalidate=30',
    },
  });
  if (cache) {
    try { await cache.put(key, response.clone()); } catch { /* wrangler dev does not persist the Cache API */ }
  }
  return response;
}
