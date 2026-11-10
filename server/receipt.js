import { isBase58Address } from './auth.js';
import { decodeVaultTransactionAccount, verifyVaultTransactionMessage } from './approve.js';
import {
  SQUADS_PROGRAM,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  decodeBase64,
  squadsTransactionAddress,
} from './chain.js';
import { shortWallet } from './campaign_state.js';
import {
  canonicalPayoutText,
  rawToDecimal,
  settlementBatchLines,
  settlementLines,
  sha256Hex,
} from './settlement.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAIN_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;

function noStore(data, status) {
  return Response.json(data, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function unverified(reason) {
  return noStore({ error: 'unverified', reason }, 409);
}

function cacheDefault(env) {
  if (env && env.caches && env.caches.default) return env.caches.default;
  if (typeof caches !== 'undefined' && caches && caches.default) return caches.default;
  return null;
}

export function receiptCacheUrl(requestUrl) {
  const url = new URL(requestUrl);
  return url.origin + url.pathname;
}

async function sbGet(env, pathAndQuery) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('SUPABASE_URL is not set');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
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

async function rpc(env, method, params) {
  if (!env.SOLANA_RPC) throw new Error('SOLANA_RPC is not set');
  const fetcher = env.fetch || fetch;
  const res = await fetcher(env.SOLANA_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) {
    const err = new Error(data.error.message || 'rpc failed');
    err.code = data.error.code;
    throw err;
  }
  return data.result;
}

async function readMint(env, mint) {
  const result = await rpc(env, 'getAccountInfo', [mint, { encoding: 'base64', commitment: 'confirmed' }]);
  const value = result && result.value;
  if (!value || !value.data || !value.data[0]) throw new Error('Mint account not found');
  if (value.owner !== TOKEN_PROGRAM && value.owner !== TOKEN_2022_PROGRAM) {
    throw new Error('Mint owner is not SPL Token or Token-2022');
  }
  const data = decodeBase64(value.data[0]);
  if (data.length < 45) throw new Error('Mint account is too small');
  return { decimals: data[44], tokenProgram: value.owner };
}

async function readSquadsAccount(env, address) {
  const info = await rpc(env, 'getAccountInfo', [address, { encoding: 'base64', commitment: 'confirmed' }]);
  const value = info && info.value;
  if (!value || !value.data || !value.data[0]) return null;
  if (value.owner !== SQUADS_PROGRAM) return null;
  return decodeBase64(value.data[0]);
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function truthy(value) {
  return value === true || value === 'true';
}

function integerText(value) {
  const text = String(value == null ? '' : value).trim();
  return /^\d+$/.test(text) ? text : null;
}

function pickExecuted(rows) {
  const list = (rows || []).filter((row) => row && row.status === 'executed');
  list.sort((a, b) => String(b.executed_at || '').localeCompare(String(a.executed_at || '')));
  return list[0] || null;
}

function signatureProblem(value) {
  const sig = String(value == null ? '' : value).trim();
  if (!sig || sig === 'released' || !CHAIN_SIGNATURE.test(sig)) return 'no_chain_signature';
  return '';
}

function recomputedHash(settlement) {
  const waived = truthy(settlement.cut_waived);
  const lines = settlementLines(
    asList(settlement.payouts),
    waived ? null : settlement.cut_wallet,
    waived ? '0' : settlement.cut_raw
  );
  return sha256Hex(canonicalPayoutText(lines));
}

function explorerTx(signature, rpcUrl) {
  const devnet = String(rpcUrl || '').includes('devnet');
  return 'https://solscan.io/tx/' + signature + (devnet ? '?cluster=devnet' : '');
}

function holderHandle(holder) {
  if (!holder) return null;
  const show = holder.show_handle === true || holder.show_handle === 'true';
  if (!show || holder.x_via !== 'oauth' || !holder.x_handle) return null;
  return String(holder.x_handle);
}

async function holdersByWallet(env, wallets) {
  const unique = [...new Set((wallets || []).filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;
  const list = unique.map((wallet) => '"' + String(wallet).replace(/"/g, '') + '"').join(',');
  const rows = await sbGet(env, '/holders?select=wallet,x_handle,show_handle,x_via&wallet=in.(' + list + ')');
  for (const row of rows) {
    if (row && row.wallet) map.set(row.wallet, row);
  }
  return map;
}

function positiveHolders(payouts) {
  const rows = [];
  for (const row of asList(payouts)) {
    if (!row || !row.wallet) continue;
    const raw = integerText(row.amountRaw);
    if (!raw || raw === '0') continue;
    rows.push({ wallet: String(row.wallet), amountRaw: raw });
  }
  return rows;
}

function amountText(raw, decimals) {
  return rawToDecimal(BigInt(raw), decimals);
}

// The verify route also refuses a campaign that is already paid. That guard
// stops a second signature. A receipt is read after the campaign is paid, so
// this uses the same vault-transaction decode and skips that write guard.
async function vaultDecodeMatches(env, settlement, project, txIndex, batch) {
  const multisig = String((project && project.vault_multisig) || settlement.vault_multisig || '').trim();
  if (!isBase58Address(multisig) || txIndex == null || String(txIndex).trim() === '') {
    return { matches: false };
  }
  let txAddress;
  try {
    txAddress = await squadsTransactionAddress(multisig, txIndex);
  } catch {
    return { matches: false };
  }
  const data = await readSquadsAccount(env, txAddress);
  const decoded = data ? decodeVaultTransactionAccount(data) : null;
  let index;
  try { index = BigInt(String(txIndex).trim()); } catch { index = null; }
  if (!decoded || decoded.multisig !== multisig || index == null || decoded.index !== index) {
    return { matches: false };
  }
  const mint = String((project && (project.vault_mint || project.mint)) || '').trim();
  let mintInfo;
  try {
    mintInfo = await readMint(env, mint);
  } catch {
    return { matches: false };
  }
  if (!project || !project.vault_address) return { matches: false };
  const verdict = await verifyVaultTransactionMessage(decoded, settlement, {
    multisig,
    vaultAddress: project.vault_address,
    mint,
    decimals: mintInfo.decimals,
    tokenProgram: mintInfo.tokenProgram,
    batch,
  });
  return { matches: verdict.ok === true, decimals: mintInfo.decimals };
}

function drawBlock(campaign) {
  if (!campaign || campaign.draw_seed == null || String(campaign.draw_seed).trim() === '') return null;
  const winners = asList(campaign.draw_winners).map((row) => {
    const wallet = typeof row === 'string' ? row : (row && row.wallet);
    return shortWallet(wallet);
  }).filter((value) => value && value !== '—');
  const slot = Number(campaign.draw_slot);
  const seedSlot = Number(campaign.draw_seed_slot);
  return {
    slot: Number.isInteger(slot) ? slot : null,
    seed: String(campaign.draw_seed),
    seed_slot: Number.isInteger(seedSlot) ? seedSlot : null,
    winners,
  };
}

function cutRawText(settlement, waived) {
  if (waived) return '0';
  return integerText(settlement.cut_raw) || '0';
}

function totalRaw(settlement, holders, waived) {
  const cut = cutRawText(settlement, waived);
  const stored = integerText(settlement.holder_total_raw);
  const holder = stored || holders.reduce((sum, row) => sum + BigInt(row.amountRaw), 0n).toString();
  return (BigInt(holder) + BigInt(cut)).toString();
}

// The vault transactions that paid a settlement: the settlement row itself, or one per batch
// (settlement.js) with batch 0's signature on the settlement row. A string is the unverified reason.
async function paidTransactions(env, settlement) {
  let count;
  try {
    count = settlementBatchLines(settlement).length;
  } catch {
    return 'hash_mismatch';
  }
  const signature = String(settlement.tx_signature).trim();
  if (count <= 1) return [{ batch: 0, tx_index: settlement.tx_index, tx_signature: signature }];
  const rows = await sbGet(
    env,
    '/vault_settlement_batches?settlement_id=eq.' + encodeURIComponent(settlement.id)
      + '&select=batch,tx_index,tx_signature&order=batch.asc'
  );
  const out = [];
  for (let batch = 0; batch < count; batch++) {
    const row = rows.find((r) => r && Number(r.batch) === batch);
    if (!row || signatureProblem(row.tx_signature)) return 'no_chain_signature';
    out.push({ batch, tx_index: row.tx_index, tx_signature: String(row.tx_signature).trim() });
  }
  if (out[0].tx_signature !== signature) return 'chain_mismatch';
  return out;
}

async function buildReceipt(env, campaignId) {
  if (!UUID.test(String(campaignId || ''))) return noStore({ error: 'not found' }, 404);
  const id = String(campaignId);
  const settlements = await sbGet(
    env,
    '/vault_settlements?campaign_id=eq.' + encodeURIComponent(id)
      + '&status=eq.executed&select=id,status,tx_signature,executed_at,payouts,payout_hash,cut_raw,cut_wallet,cut_bps,cut_waived,holder_total_raw,tx_index,vault_multisig,project_id,campaign_id,unit'
  );
  const settlement = pickExecuted(settlements);
  if (!settlement) return noStore({ error: 'not found' }, 404);
  const problem = signatureProblem(settlement.tx_signature);
  if (problem) return unverified(problem);
  let hash = '';
  try {
    hash = recomputedHash(settlement);
  } catch {
    return unverified('hash_mismatch');
  }
  if (!settlement.payout_hash || String(settlement.payout_hash).trim().toLowerCase() !== hash) {
    return unverified('hash_mismatch');
  }
  const campaigns = await sbGet(
    env,
    '/campaigns?id=eq.' + encodeURIComponent(id)
      + '&select=id,title,project_id,draw_seed,draw_slot,draw_seed_slot,draw_winners'
  );
  const campaign = campaigns[0];
  if (!campaign) return noStore({ error: 'not found' }, 404);
  const projects = await sbGet(
    env,
    '/projects?id=eq.' + encodeURIComponent(campaign.project_id)
      + '&select=id,name,ticker,vault_address,vault_multisig,vault_mint,mint'
  );
  const project = projects[0];
  if (!project) return unverified('chain_mismatch');
  const signature = String(settlement.tx_signature).trim();
  const paid = await paidTransactions(env, settlement);
  if (typeof paid === 'string') return unverified(paid);
  // Every vault transaction of the payout must match its lines and have landed.
  let decimals = null;
  let tx = null;
  const transactions = [];
  for (const entry of paid) {
    const decoded = await vaultDecodeMatches(env, settlement, project, entry.tx_index, entry.batch);
    if (!decoded.matches) return unverified('chain_mismatch');
    const landed = await rpc(env, 'getTransaction', [entry.tx_signature, { maxSupportedTransactionVersion: 0 }]);
    if (!landed) return unverified('not_on_chain');
    if (!landed.meta || landed.meta.err != null) return unverified('failed_on_chain');
    if (entry.batch === 0) {
      decimals = decoded.decimals;
      tx = landed;
    }
    transactions.push({
      batch: entry.batch,
      tx_signature: entry.tx_signature,
      explorer_url: explorerTx(entry.tx_signature, env.SOLANA_RPC),
      slot: landed.slot == null ? null : Number(landed.slot),
    });
  }

  const waived = truthy(settlement.cut_waived);
  const holders = positiveHolders(settlement.payouts);
  const people = await holdersByWallet(env, holders.map((row) => row.wallet));
  const rows = holders.map((row, index) => ({
    rank: index + 1,
    wallet_short: shortWallet(row.wallet),
    wallet_hash: sha256Hex(row.wallet),
    handle: holderHandle(people.get(row.wallet)),
    amount: amountText(row.amountRaw, decimals),
    amount_raw: row.amountRaw,
    is_platform_cut: false,
  }));
  const cutRaw = cutRawText(settlement, waived);
  let platformCut = null;
  if (waived) {
    platformCut = {
      bps: settlement.cut_bps == null || settlement.cut_bps === '' ? null : Number(settlement.cut_bps),
      amount_raw: '0',
      waived: true,
    };
  } else if (BigInt(cutRaw) > 0n && settlement.cut_wallet) {
    platformCut = {
      bps: settlement.cut_bps == null || settlement.cut_bps === '' ? null : Number(settlement.cut_bps),
      amount_raw: cutRaw,
      waived: false,
    };
    rows.push({
      rank: rows.length + 1,
      wallet_short: shortWallet(settlement.cut_wallet),
      wallet_hash: sha256Hex(settlement.cut_wallet),
      handle: null,
      amount: amountText(cutRaw, decimals),
      amount_raw: cutRaw,
      is_platform_cut: true,
    });
  }
  const blockTime = tx.blockTime == null ? null : new Date(Number(tx.blockTime) * 1000).toISOString();
  const ticker = project.ticker || settlement.unit || 'TOKEN';
  return {
    campaign: {
      id: campaign.id,
      title: campaign.title || '',
      project: { name: project.name || '', ticker },
    },
    settlement: {
      tx_signature: signature,
      explorer_url: explorerTx(signature, env.SOLANA_RPC),
      executed_at: settlement.executed_at || null,
      slot: tx.slot == null ? null : Number(tx.slot),
      block_time: blockTime,
      payout_hash: hash,
      hash_recomputed_ok: true,
      transactions,
    },
    unit: ticker,
    decimals,
    total_raw: totalRaw(settlement, holders, waived),
    rows,
    platform_cut: platformCut,
    draw: drawBlock(campaign),
  };
}

export async function handleCampaignReceipt(request, env, campaignId) {
  const cache = cacheDefault(env);
  const key = new Request(receiptCacheUrl(request.url), { method: 'GET' });
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return hit;
    } catch { /* a missing cache must not block the read */ }
  }
  let built;
  try {
    built = await buildReceipt(env, campaignId);
  } catch (err) {
    if (err && err.status === 404) return noStore({ error: 'not found' }, 404);
    throw err;
  }
  if (built instanceof Response) return built;
  // 300 s, not immutable: a holder can switch off an opted-in X handle after this is cached (cache.put reads this header).
  const response = Response.json(built, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
  if (cache) {
    try { await cache.put(key, response.clone()); } catch { /* wrangler dev does not persist the Cache API */ }
  }
  return response;
}
