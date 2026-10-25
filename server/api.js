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
  PLAN_SOL,
  solToLamports,
  parseSquadsMultisig,
  sameMemberSet,
  decodeBase64,
  collectTreasuryLamports,
  squadsVaultAddress,
  squadsTransactionAddress,
  squadsProposalAddress,
  associatedTokenAddress,
} from './chain.js';
import {
  DRAW_SLOT_OFFSET,
  assertDrawStep,
  computePayouts,
  deriveWinners,
  findFinalizedBlockhash,
  payoutRawAmount,
  planReservation,
  subDecimal,
  accountKeysOf,
  parsedTransfers,
} from './settlement.js';

const FEES_ENABLED = false;
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

function handleConfig(env) {
  return json({
    bardSignerPubkey: env.BARD_SIGNER_PUBKEY || '',
    feesEnabled: FEES_ENABLED,
    feeTreasury: FEE_TREASURY,
  });
}

const PREMIUM_TYPES = { hold: true, refer: true, custom: true };
const PREMIUM_REWARDS = { top3: true, pool: true, growing: true };
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
  const plan = admin.project.plan || 'free';
  if (plan !== 'pro' && (PREMIUM_TYPES[type] || PREMIUM_REWARDS[rewardMode])) {
    return json({ error: 'premium plan required' }, 402);
  }
  const days = (body.days === 0 || body.days === '0') ? 0 : (parseInt(body.days, 10) || 7);
  const created = await insert(env, 'campaigns', {
    project_id: body.projectId,
    title,
    type,
    rule_text: rule,
    reward: body.reward || null,
    reward_unit: body.unit || 'SOL',
    pool_size: body.pool || null,
    duration_days: days,
    status: 'active',
    fee_paid: !FEES_ENABLED,
    fee_amount_sol: PLAN_SOL.campaign,
    access_mode: body.accessMode || 'open',
    raid_mode: body.raidMode || null,
    reward_mode: rewardMode,
    post_url: body.postUrl || null,
    targets: body.targets || null,
    bonus_handle: body.bonusHandle || null,
    config: body.config || {},
  });
  const campaign = Array.isArray(created) ? created[0] : created;
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
    plan: FEES_ENABLED ? 'free' : plan,
    fee_paid: !FEES_ENABLED,
    fee_amount_sol: PLAN_SOL[plan],
    plan_paid_at: FEES_ENABLED ? null : now,
  };
  const created = await insert(env, 'projects', row);
  const project = Array.isArray(created) ? created[0] : created;
  return json({ project });
}

async function handleSetPlan(request, env, projectId) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const admin = await projectForAdmin(env, projectId, session.wallet);
  if (admin.error) return admin.error;
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  if (body.plan !== 'starter' && body.plan !== 'pro' && body.plan !== 'free') return json({ error: 'unknown plan' }, 400);
  if (FEES_ENABLED && body.plan !== 'free') return json({ error: 'plan payment required' }, 402);
  const patchRow = { plan: body.plan };
  if (body.plan !== 'free') patchRow.plan_paid_at = new Date().toISOString();
  if (!FEES_ENABLED && body.plan !== 'free') patchRow.fee_paid = true;
  const updated = await patch(env, 'projects', 'id=eq.' + encodeURIComponent(projectId), patchRow);
  const project = Array.isArray(updated) ? updated[0] : updated;
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

async function handleFeeConfirm(request, env) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  const kind = String(body.kind || '');
  const price = PLAN_SOL[kind];
  if (price == null) return json({ error: 'unknown fee kind' }, 400);
  const signature = String(body.signature || '').trim();
  if (!isBase58Address(signature) && !/^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(signature)) {
    return json({ error: 'invalid signature' }, 400);
  }
  const projectId = body.projectId || null;
  let campaignProjectId = null;
  if (kind === 'campaign') {
    if (!body.campaignId) return json({ error: 'campaign is required' }, 400);
    const rows = await select(env, 'campaigns', 'id=eq.' + encodeURIComponent(body.campaignId) + '&select=id,project_id');
    const campaign = Array.isArray(rows) ? rows[0] : null;
    if (!campaign) return json({ error: 'campaign not found' }, 404);
    const admin = await projectForAdmin(env, campaign.project_id, session.wallet);
    if (admin.error) return admin.error;
    if (projectId && projectId !== campaign.project_id) return json({ error: 'campaign is not in that project' }, 400);
    campaignProjectId = campaign.project_id;
  } else if (projectId) {
    const admin = await projectForAdmin(env, projectId, session.wallet);
    if (admin.error) return admin.error;
  }
  const existing = await select(env, 'fee_payments', 'tx_signature=eq.' + encodeURIComponent(signature) + '&select=id');
  if (Array.isArray(existing) && existing.length) return json({ error: 'signature already used' }, 400);
  const tx = await rpc(env, 'getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
  const lamports = collectTreasuryLamports(tx, { treasury: FEE_TREASURY, payer: session.wallet });
  if (lamports == null) return json({ error: 'transaction is not confirmed' }, 400);
  if (lamports < solToLamports(price)) return json({ error: 'payment is below the plan price' }, 400);
  let payment;
  try {
    payment = await insert(env, 'fee_payments', {
      kind,
      amount_sol: price,
      payer_wallet: session.wallet,
      tx_signature: signature,
      status: 'confirmed',
      project_id: campaignProjectId || projectId,
      campaign_id: body.campaignId || null,
      claim_id: body.claimId || null,
      confirmed_at: new Date().toISOString(),
      meta: {},
    });
  } catch (err) {
    if (err.code === '23505') return json({ error: 'signature already used' }, 400);
    throw err;
  }
  const fee = Array.isArray(payment) ? payment[0] : payment;
  if (projectId && (kind === 'starter' || kind === 'pro' || kind === 'onboard')) {
    const row = { fee_paid: true, fee_tx: signature, fee_amount_sol: price };
    if (kind === 'starter' || kind === 'pro') {
      row.plan = kind;
      row.plan_tx = signature;
      row.plan_paid_at = new Date().toISOString();
    }
    await patch(env, 'projects', 'id=eq.' + encodeURIComponent(projectId), row);
  }
  if (campaignProjectId) {
    await patch(env, 'campaigns', 'id=eq.' + encodeURIComponent(body.campaignId), {
      fee_paid: true,
      fee_tx: signature,
      fee_amount_sol: price,
    });
  }
  return json({ ok: true, fee });
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

async function handleClaim(request, env) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  const admin = await campaignForAdmin(env, body.campaignId, session.wallet);
  if (admin.error) return admin.error;
  if (!isBase58Address(body.wallet)) return json({ error: 'invalid wallet' }, 400);
  const created = await insert(env, 'platform_claims', {
    project_id: admin.project.id,
    campaign_id: body.campaignId,
    wallet: body.wallet,
    x_handle: body.xHandle || null,
    amount: body.amount == null ? null : String(body.amount),
    unit: body.unit || 'SOL',
    settled: true,
    settled_at: new Date().toISOString(),
    fee_paid: false,
    fee_amount_sol: PLAN_SOL.claim,
  });
  const claim = Array.isArray(created) ? created[0] : created;
  return json({ claim });
}

async function handleTeamSign(request, env, settlementId) {
  const session = await sessionWallet(request, env);
  if (session.error) return session.error;
  const body = await readJson(request);
  if (body == null) return json({ error: 'invalid json' }, 400);
  const rows = await select(env, 'vault_settlements', 'id=eq.' + encodeURIComponent(settlementId) + '&select=*');
  const current = Array.isArray(rows) ? rows[0] : null;
  if (!current) return json({ error: 'settlement not found' }, 404);
  const admin = await projectForAdmin(env, current.project_id, session.wallet);
  if (admin.error) return admin.error;
  if (current.status === 'executed' || current.status === 'cancelled') return json({ error: 'settlement is closed' }, 400);
  const linkedMultisig = admin.project.vault_multisig || '';
  if (!isBase58Address(linkedMultisig)) return json({ error: 'project vault is not linked' }, 400);
  const status = current.bard_signed ? 'both_signed' : 'awaiting_bard';
  const updated = await patch(env, 'vault_settlements', 'id=eq.' + encodeURIComponent(settlementId), {
    team_signed: true,
    team_signed_at: new Date().toISOString(),
    status,
    cosigned_wallet: session.wallet,
    cosign_sig: body.sig || null,
    tx_index: body.txIndex == null ? current.tx_index : String(body.txIndex),
    vault_multisig: linkedMultisig,
  });
  const settlement = Array.isArray(updated) ? updated[0] : updated;
  return json({ settlement });
}

function handleBardSign() {
  return json({ ok: false, waiting: true, reason: 'bard_signer_not_wired' });
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
  try {
    built = computePayouts(stored, joins, decimals);
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
  });
  const settlement = firstRow(created);
  return json({ settlement });
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
  if (!expected.size) throw new Error('settlement has no payout amounts');
  const actual = new Map();
  for (const transfer of parsedTransfers(tx)) {
    if (transfer.mint !== mint || transfer.source !== vaultAta) continue;
    if (transfer.authority && transfer.authority !== project.vault_address) {
      throw new Error('payout authority is not the project vault');
    }
    if (!expected.has(transfer.destination)) throw new Error('payout pays an unexpected account');
    actual.set(transfer.destination, (actual.get(transfer.destination) || 0n) + BigInt(transfer.amount || '0'));
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
      fee_paid: !FEES_ENABLED,
      fee_amount_sol: PLAN_SOL.claim,
    }, 'campaign_id,wallet');
  }
  await patch(
    env,
    'vault_reservations',
    'campaign_id=eq.' + encodeURIComponent(current.campaign_id) + '&status=eq.reserved',
    { status: 'settled' }
  );
  if (current.total != null) {
    const reserved = admin.project.vault_reserved || 0;
    await patch(env, 'projects', 'id=eq.' + encodeURIComponent(current.project_id), {
      vault_reserved: subDecimal(reserved, current.total),
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
    if (path === '/api/fees/confirm' && method === 'POST') return await handleFeeConfirm(request, env);
    if (path === '/api/joins/status' && method === 'POST') return await handleJoinStatus(request, env);
    if (path === '/api/joins/progress' && method === 'POST') return await handleJoinProgress(request, env);
    if (path === '/api/joins/qualify' && method === 'POST') return await handleQualify(request, env);
    if (path === '/api/claims' && method === 'POST') return await handleClaim(request, env);
    if (path === '/api/vault/bard-sign' && method === 'POST') return handleBardSign();
    if (path === '/api/vault/reserve' && method === 'POST') return await handleReserve(request, env);
    if (path === '/api/settlements/propose' && method === 'POST') return await handlePropose(request, env);
    const plan = path.match(/^\/api\/projects\/([^/]+)\/plan$/);
    if (plan && method === 'POST') return await handleSetPlan(request, env, decodeURIComponent(plan[1]));
    const vault = path.match(/^\/api\/projects\/([^/]+)\/vault$/);
    if (vault && method === 'POST') return await handleLinkVault(request, env, decodeURIComponent(vault[1]));
    const team = path.match(/^\/api\/settlements\/([^/]+)\/team-sign$/);
    if (team && method === 'POST') return await handleTeamSign(request, env, decodeURIComponent(team[1]));
    const execute = path.match(/^\/api\/settlements\/([^/]+)\/execute$/);
    if (execute && method === 'POST') return await handleExecute(request, env, decodeURIComponent(execute[1]));
    const drawCommit = path.match(/^\/api\/campaigns\/([^/]+)\/draw\/commit$/);
    if (drawCommit && method === 'POST') return await handleDrawCommit(request, env, decodeURIComponent(drawCommit[1]));
    const drawFinal = path.match(/^\/api\/campaigns\/([^/]+)\/draw\/finalize$/);
    if (drawFinal && method === 'POST') return await handleDrawFinalize(request, env, decodeURIComponent(drawFinal[1]));
    if (path.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return null;
  } catch (err) {
    return json({ error: err.message || 'request failed' }, err.status && err.status >= 400 ? err.status : 500);
  }
}
