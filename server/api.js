import {
  SIGNIN_DOMAIN,
  createNonce,
  readNonce,
  signInMessage,
  verifyWalletSignature,
  signJwt,
  verifyJwt,
  isBase58Address,
} from './auth.js';
import {
  FEE_TREASURY,
  SQUADS_PROGRAM,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  parseSquadsMultisig,
  sameMemberSet,
  decodeBase64,
  squadsVaultAddress,
  squadsTransactionAddress,
  squadsProposalAddress,
  associatedTokenAddress,
} from './chain.js';
import {
  DRAW_SLOT_OFFSET,
  assertDrawStep,
  computePayouts,
  decimalToRaw,
  deriveWinners,
  findFinalizedBlockhash,
  payoutHash,
  payoutRawAmount,
  planReservation,
  rawToDecimal,
  settlementLines,
  subDecimal,
  accountKeysOf,
  parsedTransfers,
} from './settlement.js';
import { handleCampaignState } from './campaign_state.js';
import { decodeVaultTransactionAccount, verifyVaultTransactionMessage } from './approve.js';
import { decodeProposal, decodeVaultTransaction, diffTransfers } from './accounts.js';
import { covered, lockNeed, resolvePrizeRaw, settlementCut } from './money.js';
const CAMPAIGN_PAGE = /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const RECEIPT_PAGE = /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/receipt$/i;

export function rewriteCampaignRequest(request) {
  const url = new URL(request.url);
  if (CAMPAIGN_PAGE.test(url.pathname)) url.pathname = '/campaign.html';
  else if (RECEIPT_PAGE.test(url.pathname)) url.pathname = '/receipt.html';
  else return request;
  return new Request(url.toString(), request);
}

const JSON_HEADERS = { 'cache-control': 'no-store' };

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
    const err = new Error('conflict');
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

function select(env, table, query) {
  return sb(env, 'GET', '/' + table + '?' + query);
}

function insert(env, table, row) {
  return sb(env, 'POST', '/' + table, row, 'return=representation');
}

function patch(env, table, query, row) {
  return sb(env, 'PATCH', '/' + table + '?' + query, row, 'return=representation');
}

function upsert(env, table, row, onConflict) {
  return sb(env, 'POST', '/' + table + '?on_conflict=' + encodeURIComponent(onConflict), row, 'resolution=merge-duplicates,return=representation');
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

async function projectForAdmin(env, projectId, wallet) {
  if (!projectId) return { error: json({ error: 'project not found' }, 404) };
  const rows = await select(env, 'projects', 'id=eq.' + encodeURIComponent(projectId) + '&select=*');
  const project = Array.isArray(rows) ? rows[0] : null;
  if (!project) return { error: json({ error: 'project not found' }, 404) };
  if (project.admin_wallet !== wallet) return { error: json({ error: 'not the project admin' }, 403) };
  return { project };
}

async function campaignForAdmin(env, campaignId, wallet) {
  const rows = await select(env, 'campaigns', 'id=eq.' + encodeURIComponent(campaignId) + '&select=id,project_id');
  const campaign = Array.isArray(rows) ? rows[0] : null;
  if (!campaign) return { error: json({ error: 'campaign not found' }, 404) };
  const admin = await projectForAdmin(env, campaign.project_id, wallet);
  if (admin.error) return admin;
  return { campaign, project: admin.project };
}

async function rpc(env, method, params) {
  if (!env.SOLANA_RPC) throw new Error('SOLANA_RPC is not set');
  const res = await remoteFetch(env)(env.SOLANA_RPC, {
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

function firstRow(rows) {
  return Array.isArray(rows) ? rows[0] : null;
}

function badRequest(err) {
  return json({ error: err && err.message ? err.message : 'invalid request' }, 400);
}

function isSignature(value) {
  return /^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(String(value || '').trim());
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

export async function readVaultTokenRaw(env, address, mint) {
  const mintInfo = await readMint(env, mint);
  const result = await rpc(env, 'getTokenAccountsByOwner', [
    address,
    { mint },
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ]);
  let raw = 0n;
  let decimals = mintInfo.decimals;
  for (const acc of (result && result.value) || []) {
    const info = acc && acc.account && acc.account.data && acc.account.data.parsed && acc.account.data.parsed.info;
    if (!info || info.mint !== mint || !info.tokenAmount) continue;
    raw += BigInt(info.tokenAmount.amount || '0');
    if (info.tokenAmount.decimals != null) decimals = Number(info.tokenAmount.decimals);
  }
  return { raw: raw.toString(), decimals, tokenProgram: mintInfo.tokenProgram };
}

async function loadCampaign(env, campaignId) {
  if (!campaignId) return null;
  return firstRow(await select(env, 'campaigns', 'id=eq.' + encodeURIComponent(campaignId) + '&select=*'));
}

async function joinsForCampaign(env, campaignId) {
  const rows = await select(env, 'campaign_joins', 'campaign_id=eq.' + encodeURIComponent(campaignId) + '&select=wallet,qualified,status,progress,x_handle');
  return Array.isArray(rows) ? rows : [];
}

async function handleNonce(request, env) {
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  if (!env.SUPABASE_JWT_SECRET) return json({ error: 'auth is not configured' }, 500);
  try {
    const issued = await createNonce(env.SUPABASE_JWT_SECRET, body.wallet);
    return json({
      nonce: issued.nonce,
      issuedAt: issued.issuedAt,
      domain: issued.domain,
      expiresAt: issued.expiresAt,
      message: issued.message,
    });
  } catch (err) {
    return json({ error: err.message || 'invalid wallet' }, 400);
  }
}

async function handleVerify(request, env) {
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  if (!env.SUPABASE_JWT_SECRET) return json({ error: 'auth is not configured' }, 500);
  if (body.domain && body.domain !== SIGNIN_DOMAIN) return json({ error: 'wrong domain' }, 400);
  const nonce = await readNonce(env.SUPABASE_JWT_SECRET, body.nonce);
  if (!nonce.ok) return json({ error: nonce.error }, 400);
  if (nonce.payload.wallet !== body.wallet || nonce.payload.issuedAt !== body.issuedAt) {
    return json({ error: 'bad signature' }, 400);
  }
  const message = signInMessage({
    domain: SIGNIN_DOMAIN,
    wallet: body.wallet,
    nonce: body.nonce,
    issuedAt: body.issuedAt,
  });
  if (!verifyWalletSignature(body.wallet, message, body.signature)) return json({ error: 'bad signature' }, 400);
  try {
    try {
      await sb(env, 'DELETE', '/auth_nonces?expires_at=lt.' + encodeURIComponent(new Date().toISOString()));
    } catch (cleanupErr) { /* a failed sweep must not block sign-in */ }
    const row = await insert(env, 'auth_nonces', {
      jti: nonce.payload.jti,
      wallet: body.wallet,
      expires_at: new Date(nonce.payload.exp).toISOString(),
    });
    if (!row || (Array.isArray(row) && !row.length)) return json({ error: 'nonce already used' }, 400);
  } catch (err) {
    if (err.code === '23505') return json({ error: 'nonce already used' }, 400);
    return json({ error: 'nonce store failed' }, 500);
  }
  const jwt = await signJwt(env.SUPABASE_JWT_SECRET, body.wallet);
  return json({ token: jwt.token, expiresAt: jwt.exp, wallet: body.wallet });
}

function cutSettings(env) {
  const bpsText = String(env.BARD_CUT_BPS == null || env.BARD_CUT_BPS === '' ? '500' : env.BARD_CUT_BPS).trim();
  if (!/^\d+$/.test(bpsText) || BigInt(bpsText) > 10000n) throw new Error('BARD_CUT_BPS is invalid');
  const wallet = String(env.BARD_CUT_WALLET || FEE_TREASURY).trim();
  if (!isBase58Address(wallet)) throw new Error('BARD_CUT_WALLET is invalid');
  return { cutBps: bpsText, cutWallet: wallet };
}

function handleConfig(env) {
  const cut = cutSettings(env);
  return json({
    bardSignerPubkey: env.BARD_SIGNER_PUBKEY || '',
    cutBps: Number(cut.cutBps),
    cutWallet: cut.cutWallet,
  });
}

const CAMPAIGN_TYPES = ['hold', 'raid', 'refer', 'custom'];

async function handleCreateCampaign(request, env) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  const admin = await projectForAdmin(env, body.projectId, session.wallet);
  if (admin.error) return admin.error;
  const title = String(body.title || '').trim();
  const type = String(body.type || '').trim();
  const rule = String(body.rule || '');
  const rewardMode = body.rewardMode || 'fixed';
  if (!title || !rule) return json({ error: 'title and rule are required' }, 400);
  if (CAMPAIGN_TYPES.indexOf(type) < 0) return json({ error: 'unknown campaign type' }, 400);
  if (['fixed', 'top3', 'pool', 'growing'].indexOf(rewardMode) < 0) return json({ error: 'unknown reward mode' }, 400);
  const project = admin.project;
  if (project.vault_status !== 'linked' || !isBase58Address(project.vault_address || '') || !isBase58Address(project.vault_mint || project.mint || '')) {
    return json({ error: 'Link a vault before a campaign can go live' }, 409);
  }
  let settings;
  try { settings = cutSettings(env); } catch (err) { return json({ error: err.message }, 500); }
  const mint = project.vault_mint || project.mint;
  let balance;
  try {
    balance = await readVaultTokenRaw(env, project.vault_address, mint);
  } catch (err) {
    return badRequest(err);
  }
  let prizeRaw;
  try {
    prizeRaw = resolvePrizeRaw({
      rewardMode,
      reward: body.reward,
      prize: body.prize,
      pool: body.pool,
      config: body.config,
      decimals: balance.decimals,
    });
  } catch (err) {
    return badRequest(err);
  }
  const lock = lockNeed(prizeRaw, settings.cutBps);
  const reservedRaw = decimalToRaw(project.vault_reserved || 0, balance.decimals);
  if (!covered(balance.raw, reservedRaw, lock.lockedRaw)) {
    return json({ error: 'Vault balance does not cover the prize plus Bard\'s cut' }, 409);
  }
  const days = (body.days === 0 || body.days === '0') ? 0 : (parseInt(body.days, 10) || 7);
  const now = new Date().toISOString();
  const lockedDecimal = rawToDecimal(lock.lockedRaw, balance.decimals);
  const created = await insert(env, 'campaigns', {
    project_id: body.projectId,
    title,
    type,
    rule_text: rule,
    reward: body.reward == null ? null : String(body.reward),
    reward_unit: 'TOKEN',
    pool_size: body.pool == null ? (body.prize == null ? null : String(body.prize)) : String(body.pool),
    duration_days: days,
    status: 'active',
    fee_paid: true,
    fee_amount_sol: 0,
    access_mode: body.accessMode || 'open',
    raid_mode: type === 'raid' ? (body.raidMode || null) : null,
    reward_mode: rewardMode,
    post_url: body.postUrl || null,
    targets: body.targets || null,
    bonus_handle: body.bonusHandle || null,
    config: body.config || {},
    prize_raw: lock.prizeRaw.toString(),
    cut_bps: Number(settings.cutBps),
    cut_raw: lock.cutRaw.toString(),
    locked_raw: lock.lockedRaw.toString(),
    cut_wallet: settings.cutWallet,
    prize_mint: mint,
    lock_checked_at: now,
    lock_balance_raw: balance.raw,
    vault_reserved: lockedDecimal,
  });
  const campaign = Array.isArray(created) ? created[0] : created;
  const nextReserved = reservedRaw + lock.lockedRaw;
  await patch(env, 'projects', 'id=eq.' + encodeURIComponent(project.id), {
    vault_reserved: rawToDecimal(nextReserved, balance.decimals),
  });
  await insert(env, 'vault_reservations', {
    project_id: project.id,
    campaign_id: campaign.id,
    amount: lockedDecimal,
    status: 'reserved',
  });
  return json({ campaign });
}

async function handleCreateProject(request, env) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  const name = String(body.name || '').trim();
  const ticker = String(body.ticker || '').trim();
  const mint = String(body.mint || '').trim();
  const plan = body.plan === 'pro' ? 'pro' : 'starter';
  if (!name || !ticker || !isBase58Address(mint)) return json({ error: 'name, ticker, and mint are required' }, 400);
  const now = new Date().toISOString();
  const row = {
    name,
    ticker,
    mint,
    chain: body.chain || 'solana',
    admin_wallet: session.wallet,
    created_by: session.wallet,
    plan,
    fee_paid: true,
    fee_amount_sol: 0,
    plan_paid_at: now,
  };
  const created = await insert(env, 'projects', row);
  const project = Array.isArray(created) ? created[0] : created;
  return json({ project });
}

async function handleLinkVault(request, env, projectId) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const admin = await projectForAdmin(env, projectId, session.wallet);
  if (admin.error) return admin.error;
  const signer = env.BARD_SIGNER_PUBKEY || '';
  if (!isBase58Address(signer)) return json({ error: 'BARD_SIGNER_PUBKEY is not set' }, 500);
  if (signer === FEE_TREASURY) return json({ error: 'bard signer must not be the fee treasury' }, 500);
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  const multisig = String(body.multisig || '').trim();
  const address = String(body.address || '').trim();
  const mint = body.mint ? String(body.mint).trim() : null;
  if (!isBase58Address(multisig) || !isBase58Address(address)) return json({ error: 'vault address looks invalid' }, 400);
  const result = await rpc(env, 'getAccountInfo', [multisig, { encoding: 'base64', commitment: 'confirmed' }]);
  const value = result && result.value;
  if (!value || value.owner !== SQUADS_PROGRAM || !value.data || !value.data[0]) {
    return json({ error: 'vault is not a Squads multisig' }, 400);
  }
  const parsed = await parseSquadsMultisig(decodeBase64(value.data[0]));
  if (!parsed || parsed.threshold !== 2 || !sameMemberSet(parsed.members, [admin.project.admin_wallet, signer])) {
    return json({ error: 'vault must be 2-of-2 with the project admin and the Bard signer' }, 400);
  }
  const vault = await squadsVaultAddress(multisig);
  if (address !== vault) return json({ error: 'deposit address is not the Squads vault' }, 400);
  const updated = await patch(env, 'projects', 'id=eq.' + encodeURIComponent(projectId), {
    vault_address: address,
    vault_multisig: multisig,
    vault_mint: mint,
    vault_status: 'linked',
    vault_linked_at: new Date().toISOString(),
  });
  const project = Array.isArray(updated) ? updated[0] : updated;
  return json({ project });
}

async function handleJoinStatus(request, env) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  if (['pending', 'approved', 'rejected'].indexOf(body.status) < 0) return json({ error: 'invalid join status' }, 400);
  const admin = await campaignForAdmin(env, body.campaignId, session.wallet);
  if (admin.error) return admin.error;
  const updated = await patch(
    env,
    'campaign_joins',
    'campaign_id=eq.' + encodeURIComponent(body.campaignId) + '&wallet=eq.' + encodeURIComponent(body.wallet),
    { status: body.status }
  );
  const join = Array.isArray(updated) ? updated[0] : updated;
  if (!join) return json({ error: 'join not found' }, 404);
  return json({ join });
}

async function handleJoinProgress(request, env) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  const admin = await campaignForAdmin(env, body.campaignId, session.wallet);
  if (admin.error) return admin.error;
  const progress = Math.max(0, parseInt(body.progress, 10) || 0);
  const row = { progress };
  if (body.note != null) row.note = String(body.note);
  const updated = await patch(
    env,
    'campaign_joins',
    'campaign_id=eq.' + encodeURIComponent(body.campaignId) + '&wallet=eq.' + encodeURIComponent(body.wallet),
    row
  );
  const join = Array.isArray(updated) ? updated[0] : updated;
  if (!join) return json({ error: 'join not found' }, 404);
  return json({ join });
}

async function handleQualify(request, env) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  const admin = await campaignForAdmin(env, body.campaignId, session.wallet);
  if (admin.error) return admin.error;
  const updated = await patch(
    env,
    'campaign_joins',
    'campaign_id=eq.' + encodeURIComponent(body.campaignId) + '&wallet=eq.' + encodeURIComponent(body.wallet),
    { qualified: true, qualified_at: new Date().toISOString(), status: 'approved' }
  );
  const join = Array.isArray(updated) ? updated[0] : updated;
  if (!join) return json({ error: 'join not found' }, 404);
  return json({ join });
}

async function readSquadsAccount(env, address) {
  const info = await rpc(env, 'getAccountInfo', [address, { encoding: 'base64', commitment: 'confirmed' }]);
  const value = info && info.value;
  if (!value || !value.data || !value.data[0]) return null;
  if (value.owner !== SQUADS_PROGRAM) return null;
  return decodeBase64(value.data[0]);
}

async function vaultMessageVerdict(env, settlement, project) {
  const multisig = String((project && project.vault_multisig) || settlement.vault_multisig || '').trim();
  if (!isBase58Address(multisig)) throw new Error('project vault is not linked');
  if (settlement.tx_index == null || String(settlement.tx_index).trim() === '') {
    throw new Error('settlement has no vault transaction');
  }
  let txIndex;
  try {
    txIndex = BigInt(String(settlement.tx_index).trim());
  } catch {
    throw new Error('settlement has no vault transaction');
  }
  const mint = (project && (project.vault_mint || project.mint)) || '';
  if (!mint || !project.vault_address) throw new Error('Vault mint is missing');
  const transactionPda = await squadsTransactionAddress(multisig, txIndex);
  const data = await readSquadsAccount(env, transactionPda);
  if (!data) throw new Error('vault transaction is missing');
  const decoded = decodeVaultTransactionAccount(data);
  if (!decoded) throw new Error('vault transaction account');
  if (decoded.multisig !== multisig) throw new Error('vault transaction multisig');
  if (decoded.index !== txIndex) throw new Error('vault transaction index');
  const mintInfo = await readMint(env, mint);
  const verdict = await verifyVaultTransactionMessage(decoded, settlement, {
    multisig,
    vaultAddress: project.vault_address,
    mint,
    decimals: mintInfo.decimals,
    tokenProgram: mintInfo.tokenProgram,
  });
  if (!verdict.ok) throw new Error('vault transaction does not match the payout');
  return { multisig, txIndex };
}

async function memberApproved(env, multisig, txIndex, wallet) {
  if (!isBase58Address(wallet)) return null;
  const proposalAddress = await squadsProposalAddress(multisig, txIndex);
  const data = await readSquadsAccount(env, proposalAddress);
  if (!data) return null;
  const proposal = decodeProposal(data);
  if (!proposal) return null;
  if (proposal.multisig !== multisig || proposal.transactionIndex !== BigInt(txIndex)) return null;
  if (!proposal.approved.includes(wallet)) return null;
  return proposal;
}

async function handleMemberSigned(request, env, settlementId, kind) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  const current = firstRow(await select(env, 'vault_settlements', 'id=eq.' + encodeURIComponent(settlementId) + '&select=*'));
  if (!current) return json({ error: 'settlement not found' }, 404);
  const project = firstRow(await select(env, 'projects', 'id=eq.' + encodeURIComponent(current.project_id) + '&select=*'));
  if (!project) return json({ error: 'project not found' }, 404);
  if (kind === 'bard') {
    const signer = env.BARD_SIGNER_PUBKEY || '';
    if (!isBase58Address(signer) || session.wallet !== signer) return json({ error: 'not the Bard signer' }, 403);
  } else if (project.admin_wallet !== session.wallet) {
    return json({ error: 'not the project admin' }, 403);
  }
  if (current.status === 'executed' || current.status === 'cancelled') return json({ error: 'settlement is closed' }, 400);
  const linkedMultisig = project.vault_multisig || '';
  if (!isBase58Address(linkedMultisig)) return json({ error: 'project vault is not linked' }, 400);
  const txIndexText = body.txIndex == null || String(body.txIndex).trim() === '' ? current.tx_index : body.txIndex;
  const pending = Object.assign({}, current, { tx_index: txIndexText, vault_multisig: linkedMultisig });
  let checked;
  try {
    checked = await vaultMessageVerdict(env, pending, project);
  } catch (err) {
    return badRequest(err);
  }
  const proposal = await memberApproved(env, checked.multisig, checked.txIndex, session.wallet);
  if (!proposal) return json({ error: 'approval is not on the vault proposal' }, 400);
  const teamSigned = kind === 'team' ? true : !!current.team_signed;
  const bardSigned = kind === 'bard' ? true : !!current.bard_signed;
  const status = teamSigned && bardSigned ? 'both_signed' : (teamSigned ? 'awaiting_bard' : 'awaiting_team');
  const row = {
    team_signed: teamSigned,
    bard_signed: bardSigned,
    status,
    tx_index: String(checked.txIndex),
    vault_multisig: linkedMultisig,
  };
  if (kind === 'team') {
    row.team_signed_at = new Date().toISOString();
    row.cosigned_wallet = session.wallet;
    row.cosign_sig = body.sig || null;
  } else {
    row.bard_signed_at = new Date().toISOString();
  }
  const updated = await patch(env, 'vault_settlements', 'id=eq.' + encodeURIComponent(settlementId), row);
  const settlement = firstRow(updated);
  return json({ settlement });
}

function signerWaiting() {
  return json({ ok: false, waiting: true, reason: 'bard_signer_not_wired' });
}

function signerReject(reason, status = 400) {
  return json({ ok: false, reason }, status);
}

async function handleBardSign(request, env) {
  if (!isBase58Address(env.BARD_SIGNER_PUBKEY || '')) return signerWaiting();
  const body = await readJson(request);
  if (body == null) return signerReject('invalid json');
  const settlementId = body.settlementId ? String(body.settlementId) : '';
  if (!settlementId) return signerReject('settlement not found', 404);
  const current = firstRow(await select(env, 'vault_settlements', 'id=eq.' + encodeURIComponent(settlementId) + '&select=*'));
  if (!current) return signerReject('settlement not found', 404);
  const multisig = String(current.vault_multisig || '').trim();
  if (!isBase58Address(multisig)) return signerReject('project vault is not linked');
  if (current.tx_index == null || String(current.tx_index).trim() === '') {
    return signerReject('settlement has no vault transaction');
  }
  let txIndex;
  try {
    txIndex = BigInt(String(current.tx_index).trim());
  } catch {
    return signerReject('settlement has no vault transaction');
  }
  const project = firstRow(await select(env, 'projects', 'id=eq.' + encodeURIComponent(current.project_id) + '&select=*'));
  if (!project || !project.vault_address) return signerReject('project vault is not linked');
  const mint = project.vault_mint || project.mint;
  if (!mint) return signerReject('Vault mint is missing');
  let accountInfo;
  try {
    const transactionPda = await squadsTransactionAddress(multisig, txIndex);
    accountInfo = await rpc(env, 'getAccountInfo', [transactionPda, { encoding: 'base64', commitment: 'confirmed' }]);
  } catch (err) {
    return signerReject(err && err.message ? err.message : 'vault transaction is missing');
  }
  const value = accountInfo && accountInfo.value;
  if (!value || value.owner !== SQUADS_PROGRAM || !value.data || !value.data[0]) {
    return signerReject('vault transaction is missing');
  }
  const decoded = decodeVaultTransactionAccount(decodeBase64(value.data[0]));
  if (!decoded) return signerReject('vault transaction account');
  if (decoded.multisig !== multisig) return signerReject('vault transaction multisig');
  if (decoded.index !== txIndex) return signerReject('vault transaction index');
  let mintInfo;
  try {
    mintInfo = await readMint(env, mint);
  } catch (err) {
    return signerReject(err && err.message ? err.message : 'Vault mint is missing');
  }
  const verdict = await verifyVaultTransactionMessage(decoded, current, {
    multisig,
    vaultAddress: project.vault_address,
    mint,
    decimals: mintInfo.decimals,
    tokenProgram: mintInfo.tokenProgram,
  });
  if (!verdict.ok) return signerReject(verdict.reason);
  return signerWaiting();
}

async function handleReserve(request, env) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  const admin = await projectForAdmin(env, body.projectId, session.wallet);
  if (admin.error) return admin.error;
  const project = admin.project;
  if (!project.vault_address) return json({ error: 'Link a vault first' }, 400);
  const mint = project.vault_mint || project.mint;
  if (!mint) return json({ error: 'Vault mint is missing' }, 400);
  let campaign = null;
  if (body.campaignId) {
    campaign = await loadCampaign(env, body.campaignId);
    if (!campaign) return json({ error: 'campaign not found' }, 404);
    if (campaign.project_id !== project.id) return json({ error: 'campaign is not in that project' }, 400);
  }
  let bal;
  try {
    bal = await readVaultTokenRaw(env, project.vault_address, mint);
  } catch (err) {
    return badRequest(err);
  }
  let plan;
  try {
    plan = planReservation(
      project.vault_reserved || 0,
      campaign ? campaign.vault_reserved || 0 : 0,
      body.amount,
      bal.raw,
      bal.decimals
    );
  } catch (err) {
    return badRequest(err);
  }
  const updated = await patch(env, 'projects', 'id=eq.' + encodeURIComponent(project.id), {
    vault_reserved: plan.projectReserved,
  });
  const saved = firstRow(updated);
  if (!saved) return json({ error: 'project not found' }, 404);
  if (campaign) {
    await patch(env, 'campaigns', 'id=eq.' + encodeURIComponent(campaign.id), {
      vault_reserved: plan.campaignReserved,
    });
    await insert(env, 'vault_reservations', {
      project_id: project.id,
      campaign_id: campaign.id,
      amount: plan.added,
      status: 'reserved',
    });
  }
  return json({ reserved: plan.projectReserved, added: plan.added, campaignReserved: plan.campaignReserved });
}

async function handlePropose(request, env) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  const campaign = await loadCampaign(env, body.campaignId);
  if (!campaign) return json({ error: 'campaign not found' }, 404);
  if (body.projectId && body.projectId !== campaign.project_id) return json({ error: 'campaign is not in that project' }, 400);
  const admin = await projectForAdmin(env, campaign.project_id, session.wallet);
  if (admin.error) return admin.error;
  const project = admin.project;
  const joins = await joinsForCampaign(env, campaign.id);
  const mint = project.vault_mint || project.mint || '';
  let decimals = 0;
  try {
    if (mint) {
      const bal = await readVaultTokenRaw(env, project.vault_address, mint);
      decimals = bal.decimals;
    } else if (String(campaign.reward_unit || '').toUpperCase() === 'SOL') {
      decimals = 9;
    }
  } catch (err) {
    return badRequest(err);
  }
  const stored = Object.assign({}, campaign, {
    vaultReserved: campaign.vault_reserved,
    mint,
    vaultAddress: project.vault_address || '',
    vaultMultisig: project.vault_multisig || '',
  });
  let built;
  let cut;
  try {
    built = computePayouts(stored, joins, decimals);
    const bps = campaign.cut_bps == null || String(campaign.cut_bps).trim() === '' ? 0 : campaign.cut_bps;
    cut = settlementCut(built.payouts, campaign.prize_raw, bps, campaign.cut_wallet);
    built.hash = payoutHash(settlementLines(built.payouts, cut.cutWallet, cut.cutRaw));
  } catch (err) {
    return badRequest(err);
  }
  const created = await insert(env, 'vault_settlements', {
    project_id: project.id,
    campaign_id: campaign.id,
    payouts: built.payouts,
    total: built.total,
    unit: built.unit,
    payout_hash: built.hash,
    status: 'proposed',
    team_signed: false,
    bard_signed: false,
    vault_multisig: project.vault_multisig || null,
    cut_raw: cut.cutRaw.toString(),
    cut_wallet: cut.cutWaived ? null : cut.cutWallet,
    cut_bps: campaign.cut_bps == null || campaign.cut_bps === '' ? null : Number(campaign.cut_bps),
    cut_waived: cut.cutWaived,
    holder_total_raw: cut.holderTotalRaw.toString(),
  });
  const settlement = firstRow(created);
  return json({ settlement });
}

function parsedTokenProgramOk(transfer, tokenProgram) {
  const program = transfer.program || '';
  const programId = transfer.programId || '';
  if (!program || !programId || programId !== tokenProgram) return false;
  if (program === 'spl-token') return true;
  return tokenProgram === TOKEN_2022_PROGRAM && (program === 'spl-token-2022' || program === 'spl-token2022');
}

export async function verifyExecutedPayout(env, settlement, project, signature) {
  const multisig = project.vault_multisig || settlement.vault_multisig || '';
  if (!multisig) throw new Error('project vault is not linked');
  if (settlement.tx_index == null || String(settlement.tx_index).trim() === '') {
    throw new Error('settlement has no vault transaction');
  }
  const mint = project.vault_mint || project.mint;
  if (!mint || !project.vault_address) throw new Error('Vault mint is missing');
  const tx = await rpc(env, 'getTransaction', [signature, {
    encoding: 'jsonParsed',
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  }]);
  if (!tx || !tx.meta || tx.meta.err) throw new Error('transaction is not confirmed');
  const logs = tx.meta.logMessages || [];
  if (!logs.some((line) => String(line).includes('VaultTransactionExecute'))) {
    throw new Error('transaction is not a Squads vault execute');
  }
  const mintInfo = await readMint(env, mint);
  const index = BigInt(String(settlement.tx_index).trim());
  const transactionPda = await squadsTransactionAddress(multisig, index);
  const proposalPda = await squadsProposalAddress(multisig, index);
  const keys = new Set(accountKeysOf(tx));
  if (!keys.has(SQUADS_PROGRAM) || !keys.has(multisig) || !keys.has(transactionPda) || !keys.has(proposalPda)) {
    throw new Error('transaction does not execute this settlement');
  }
  const vaultAta = await associatedTokenAddress(project.vault_address, mint, mintInfo.tokenProgram);
  const expected = new Map();
  for (const payout of settlement.payouts || []) {
    const raw = payoutRawAmount(payout, mintInfo.decimals);
    if (raw <= 0n) continue;
    const ata = await associatedTokenAddress(payout.wallet, mint, mintInfo.tokenProgram);
    expected.set(ata, (expected.get(ata) || 0n) + raw);
  }
  if (settlement.cut_waived !== true) {
    const cutText = String(settlement.cut_raw == null ? '' : settlement.cut_raw).trim();
    if (cutText) {
      if (!/^\d+$/.test(cutText)) throw new Error('Cut amount is invalid');
      const cut = BigInt(cutText);
      if (cut > 0n) {
        const cutWallet = settlement.cut_wallet;
        if (!cutWallet) throw new Error('Cut wallet is missing');
        const cutAta = await associatedTokenAddress(cutWallet, mint, mintInfo.tokenProgram);
        expected.set(cutAta, (expected.get(cutAta) || 0n) + cut);
      }
    }
  }
  if (!expected.size) throw new Error('settlement has no payout amounts');
  const actual = new Map();
  for (const transfer of parsedTransfers(tx)) {
    if (!transfer.mint || transfer.mint !== mint) continue;
    if (!transfer.source || transfer.source !== vaultAta) continue;
    if (!parsedTokenProgramOk(transfer, mintInfo.tokenProgram)) {
      throw new Error('payout program is not the vault token program');
    }
    if (!transfer.authority || transfer.authority !== project.vault_address) {
      throw new Error('payout authority is not the project vault');
    }
    if (!transfer.destination || !expected.has(transfer.destination)) {
      throw new Error('payout pays an unexpected account');
    }
    if (!transfer.amount) throw new Error('payout amount is missing');
    actual.set(transfer.destination, (actual.get(transfer.destination) || 0n) + BigInt(transfer.amount));
  }
  if (actual.size !== expected.size) throw new Error('on-chain payouts do not match the settlement');
  for (const [ata, raw] of expected) {
    if (actual.get(ata) !== raw) throw new Error('on-chain payouts do not match the settlement');
  }
}

async function handleExecute(request, env, settlementId) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  const current = firstRow(await select(env, 'vault_settlements', 'id=eq.' + encodeURIComponent(settlementId) + '&select=*'));
  if (!current) return json({ error: 'settlement not found' }, 404);
  const admin = await projectForAdmin(env, current.project_id, session.wallet);
  if (admin.error) return admin.error;
  const signature = String(body.signature || '').trim();
  if (!isSignature(signature)) return json({ error: 'invalid signature' }, 400);
  if (!current.payout_hash) return json({ error: 'settlement has no canonical hash' }, 400);
  if (current.status === 'cancelled') return json({ error: 'settlement is closed' }, 400);
  if (current.status === 'executed') {
    if (current.tx_signature === signature) return json({ settlement: current });
    return json({ error: 'settlement is closed' }, 400);
  }
  const used = await select(env, 'vault_settlements', 'tx_signature=eq.' + encodeURIComponent(signature) + '&select=id');
  if (Array.isArray(used) && used.some((row) => row.id !== current.id)) return json({ error: 'signature already used' }, 400);
  try {
    await verifyExecutedPayout(env, current, admin.project, signature);
    await vaultMessageVerdict(env, current, admin.project);
  } catch (err) {
    return badRequest(err);
  }
  const now = new Date().toISOString();
  const payouts = Array.isArray(current.payouts) ? current.payouts : [];
  for (const payout of payouts) {
    if (!payout || !payout.wallet) continue;
    await patch(
      env,
      'campaign_joins',
      'campaign_id=eq.' + encodeURIComponent(current.campaign_id) + '&wallet=eq.' + encodeURIComponent(payout.wallet),
      { qualified: true, qualified_at: now }
    );
    await upsert(env, 'platform_claims', {
      project_id: current.project_id,
      campaign_id: current.campaign_id,
      wallet: payout.wallet,
      amount: String(payout.amount),
      unit: current.unit,
      settled: true,
      settled_at: now,
      fee_paid: true,
      fee_amount_sol: 0,
    }, 'campaign_id,wallet');
  }
  await patch(
    env,
    'vault_reservations',
    'campaign_id=eq.' + encodeURIComponent(current.campaign_id) + '&status=eq.reserved',
    { status: 'settled' }
  );
  const campaign = await loadCampaign(env, current.campaign_id);
  if (campaign && campaign.locked_raw != null && String(campaign.locked_raw).trim() !== '') {
    await patch(env, 'projects', 'id=eq.' + encodeURIComponent(current.project_id), {
      vault_reserved: subDecimal(admin.project.vault_reserved || 0, campaign.vault_reserved || 0),
    });
    await patch(env, 'campaigns', 'id=eq.' + encodeURIComponent(campaign.id), {
      status: 'paid',
      vault_reserved: '0',
    });
  } else if (current.total != null) {
    await patch(env, 'projects', 'id=eq.' + encodeURIComponent(current.project_id), {
      vault_reserved: subDecimal(admin.project.vault_reserved || 0, current.total),
    });
  }
  const updated = await patch(env, 'vault_settlements', 'id=eq.' + encodeURIComponent(settlementId), {
    status: 'executed',
    tx_signature: signature,
    executed_at: now,
  });
  const settlement = firstRow(updated) || Object.assign({}, current, { status: 'executed', tx_signature: signature, executed_at: now });
  return json({ settlement });
}

async function handleDrawCommit(request, env, campaignId) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  const campaign = await loadCampaign(env, campaignId);
  if (!campaign) return json({ error: 'campaign not found' }, 404);
  const admin = await projectForAdmin(env, campaign.project_id, session.wallet);
  if (admin.error) return admin.error;
  try {
    assertDrawStep(campaign, 'commit');
  } catch (err) {
    return badRequest(err);
  }
  let current;
  try {
    current = Number(await rpc(env, 'getSlot', [{ commitment: 'finalized' }]));
  } catch (err) {
    return badRequest(err);
  }
  if (!Number.isInteger(current) || current < 0) return json({ error: 'slot is unavailable' }, 400);
  let count = parseInt(body.topN, 10);
  if (Number.isNaN(count) || count < 0) count = 0;
  const updated = await patch(env, 'campaigns', 'id=eq.' + encodeURIComponent(campaignId), {
    draw_slot: current + DRAW_SLOT_OFFSET,
    draw_count: count,
    draw_committed_at: new Date().toISOString(),
  });
  const saved = firstRow(updated);
  if (!saved) return json({ error: 'campaign not found' }, 404);
  return json({ campaign: saved });
}

async function handleDrawFinalize(request, env, campaignId) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  const campaign = await loadCampaign(env, campaignId);
  if (!campaign) return json({ error: 'campaign not found' }, 404);
  const admin = await projectForAdmin(env, campaign.project_id, session.wallet);
  if (admin.error) return admin.error;
  let view;
  try {
    view = assertDrawStep(campaign, 'finalize');
  } catch (err) {
    return badRequest(err);
  }
  let found;
  try {
    found = await findFinalizedBlockhash(
      () => rpc(env, 'getSlot', [{ commitment: 'finalized' }]),
      (slot) => rpc(env, 'getBlock', [slot, {
        commitment: 'finalized',
        transactionDetails: 'none',
        rewards: false,
        maxSupportedTransactionVersion: 0,
      }]),
      view.drawSlot
    );
  } catch (err) {
    return badRequest(err);
  }
  const joins = await joinsForCampaign(env, campaignId);
  const winners = deriveWinners(joins, found.blockhash, view.drawCount || 0);
  const updated = await patch(env, 'campaigns', 'id=eq.' + encodeURIComponent(campaignId), {
    draw_seed: found.blockhash,
    draw_seed_slot: found.slot,
    draw_at: new Date().toISOString(),
    draw_winners: winners,
  });
  const saved = firstRow(updated);
  if (!saved) return json({ error: 'campaign not found' }, 404);
  return json({ campaign: saved });
}

async function handleSettlementVerify(env, settlementId) {
  const settlement = firstRow(await select(env, 'vault_settlements', 'id=eq.' + encodeURIComponent(settlementId) + '&select=*'));
  if (!settlement) return json({ error: 'settlement not found' }, 404);
  const project = firstRow(await select(env, 'projects', 'id=eq.' + encodeURIComponent(settlement.project_id) + '&select=*'));
  if (!project) return json({ error: 'project not found' }, 404);
  const multisig = project.vault_multisig || settlement.vault_multisig || '';
  const txIndex = settlement.tx_index;
  if (!isBase58Address(multisig) || txIndex == null || String(txIndex).trim() === '') {
    return json({ matches: false, diff: { reason: 'vault transaction is not recorded yet' } });
  }
  let txAddress;
  try {
    txAddress = await squadsTransactionAddress(multisig, txIndex);
  } catch (err) {
    return json({ matches: false, diff: { reason: err.message || 'vault transaction is missing' } });
  }
  const data = await readSquadsAccount(env, txAddress);
  const decoded = data ? decodeVaultTransaction(data) : null;
  let index;
  try { index = BigInt(String(txIndex).trim()); } catch { index = null; }
  if (!decoded || decoded.multisig !== multisig || index == null || decoded.index !== index) {
    return json({ matches: false, diff: { reason: 'on-chain vault transaction does not match this payout' }, transaction: txAddress });
  }
  const mint = project.vault_mint || project.mint;
  let tokenProgram = TOKEN_PROGRAM;
  try {
    tokenProgram = (await readMint(env, mint)).tokenProgram;
  } catch (err) {
    return json({ matches: false, diff: { reason: err.message || 'could not read the mint' }, transaction: txAddress });
  }
  let lines;
  try {
    lines = settlementLines(
      settlement.payouts,
      settlement.cut_waived ? null : settlement.cut_wallet,
      settlement.cut_waived ? 0 : settlement.cut_raw
    );
  } catch (err) {
    return json({ matches: false, diff: { reason: err.message || 'payout lines are invalid' }, transaction: txAddress });
  }
  const expected = [];
  for (const line of lines) {
    expected.push({
      destination: await associatedTokenAddress(line.wallet, mint, tokenProgram),
      amountRaw: line.amountRaw,
    });
  }
  const actual = (decoded.transfers || []).filter((row) => row.mint === mint).map((row) => ({
    destination: row.destination,
    amountRaw: row.amountRaw,
  }));
  const diff = diffTransfers(expected, actual);
  return json({ matches: diff.matches, diff, transaction: txAddress });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  try {
    if (path === '/api/auth/nonce' && method === 'POST') return await handleNonce(request, env);
    if (path === '/api/auth/verify' && method === 'POST') return await handleVerify(request, env);
    if (path === '/api/config' && method === 'GET') return handleConfig(env);
    if (path === '/api/projects' && method === 'POST') return await handleCreateProject(request, env);
    if (path === '/api/campaigns' && method === 'POST') return await handleCreateCampaign(request, env);
    if (path === '/api/joins/status' && method === 'POST') return await handleJoinStatus(request, env);
    if (path === '/api/joins/progress' && method === 'POST') return await handleJoinProgress(request, env);
    if (path === '/api/joins/qualify' && method === 'POST') return await handleQualify(request, env);
    if (path === '/api/vault/bard-sign' && method === 'POST') return await handleBardSign(request, env);
    if (path === '/api/vault/reserve' && method === 'POST') return await handleReserve(request, env);
    if (path === '/api/settlements/propose' && method === 'POST') return await handlePropose(request, env);
    const vault = path.match(/^\/api\/projects\/([^/]+)\/vault$/);
    if (vault && method === 'POST') return await handleLinkVault(request, env, decodeURIComponent(vault[1]));
    const verify = path.match(/^\/api\/settlements\/([^/]+)\/verify$/);
    if (verify && method === 'GET') return await handleSettlementVerify(env, decodeURIComponent(verify[1]));
    const teamSigned = path.match(/^\/api\/settlements\/([^/]+)\/team-signed$/);
    if (teamSigned && method === 'POST') return await handleMemberSigned(request, env, decodeURIComponent(teamSigned[1]), 'team');
    const team = path.match(/^\/api\/settlements\/([^/]+)\/team-sign$/);
    if (team && method === 'POST') return await handleMemberSigned(request, env, decodeURIComponent(team[1]), 'team');
    const bardSigned = path.match(/^\/api\/settlements\/([^/]+)\/bard-signed$/);
    if (bardSigned && method === 'POST') return await handleMemberSigned(request, env, decodeURIComponent(bardSigned[1]), 'bard');
    const executed = path.match(/^\/api\/settlements\/([^/]+)\/executed$/);
    if (executed && method === 'POST') return await handleExecute(request, env, decodeURIComponent(executed[1]));
    const execute = path.match(/^\/api\/settlements\/([^/]+)\/execute$/);
    if (execute && method === 'POST') return await handleExecute(request, env, decodeURIComponent(execute[1]));
    const drawCommit = path.match(/^\/api\/campaigns\/([^/]+)\/draw\/commit$/);
    if (drawCommit && method === 'POST') return await handleDrawCommit(request, env, decodeURIComponent(drawCommit[1]));
    const drawFinal = path.match(/^\/api\/campaigns\/([^/]+)\/draw\/finalize$/);
    if (drawFinal && method === 'POST') return await handleDrawFinalize(request, env, decodeURIComponent(drawFinal[1]));
    const stateRoute = path.match(/^\/api\/campaigns\/([^/]+)\/state$/);
    if (stateRoute && method === 'GET') return await handleCampaignState(request, env, decodeURIComponent(stateRoute[1]), readVaultTokenRaw);
    if (path.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return null;
  } catch (err) {
    return json({ error: err.message || 'request failed' }, err.status && err.status >= 400 ? err.status : 500);
  }
}
