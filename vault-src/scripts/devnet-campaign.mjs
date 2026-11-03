/**
 * One Bard campaign on public devnet, with a made-up team and a test-token prize.
 *
 *   npm run campaign:devnet
 *
 * Prints PASS or FAIL for each step and exits non-zero on the first failure.
 * There is no model call. Chain reads and the payout go to https://api.devnet.solana.com
 * only. The database is this process, not production. Mainnet and Supabase are refused.
 *
 * Keys stay in ~/.bard-devnet-rehearsal (or BARD_REHEARSAL_KEY_DIR). The file is a
 * Solana keypair JSON array and is never printed.
 */
import http from 'node:http';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transferChecked,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { handleRequest, rewriteCampaignRequest } from '../../server/api.js';
import { FEE_TREASURY } from '../../server/chain.js';
import { signerConfigProblem } from '../../server/config.js';
import { DEVNET_GENESIS } from '../../server/network.js';
import { lockNeed } from '../../server/money.js';
import { DEVNET_RPC, assertDevnetUrl } from '../src/rpc-guard.js';
import {
  createTwoOfTwo,
  createPayoutProposal,
  teamApprove,
  executePayout,
} from '../src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DECIMALS = 6;
const PRIZE_RAW = 1_000_000n;
const CUT_BPS = 500n;
const JWT_SECRET = 'devnet-campaign-local-secret-not-production';
const STATIC = new Map([
  ['/platform.js', 'platform.js'],
  ['/campaign.html', 'campaign.html'],
  ['/receipt.html', 'receipt.html'],
  ['/favicon.png', 'favicon.png'],
]);

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url);
  assertOutbound(url);
  return realFetch(input, init);
};

function assertOutbound(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error('Refusing malformed URL');
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'supabase.co' || host.endsWith('.supabase.co')) {
    throw new Error('Refusing request to Supabase');
  }
  if (host === 'api.mainnet-beta.solana.com' || host.includes('mainnet')) {
    throw new Error('Refusing mainnet RPC: ' + host);
  }
  if (host === '127.0.0.1' || host === 'localhost') {
    if (parsed.protocol !== 'http:') throw new Error('Refusing non-http local URL');
    return;
  }
  assertDevnetUrl(url);
}

function accountHome() {
  try {
    return os.userInfo().homedir;
  } catch {
    return os.homedir();
  }
}

function keyDirectory() {
  const chosen = process.env.BARD_REHEARSAL_KEY_DIR
    ? path.resolve(process.env.BARD_REHEARSAL_KEY_DIR)
    : path.join(accountHome(), '.bard-devnet-rehearsal');
  const relative = path.relative(root, chosen);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('the key directory must be outside the repository');
  }
  return chosen;
}

function loadOrCreateKey(dir, role) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = path.join(dir, role + '.json');
  if (!existsSync(file)) {
    const created = Keypair.generate();
    writeFileSync(file, JSON.stringify(Array.from(created.secretKey)), { mode: 0o600, flag: 'wx' });
    return created;
  }
  chmodSync(file, 0o600);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(raw) || raw.length !== 64) throw new Error(role + ' key file is not a 64-byte keypair');
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function devnetFetch(url, opts, attempt = 0) {
  const res = await realFetch(url, opts);
  if (attempt >= 8) return res;
  const text = await res.clone().text();
  if (res.status === 429 || /rate limit/i.test(text)) {
    await sleep(400 * (attempt + 1));
    return devnetFetch(url, opts, attempt + 1);
  }
  return res;
}

function rawBig(value) {
  if (value == null || value === '') return 0n;
  return BigInt(String(value));
}

function applyVaultRpc(tables, name, body) {
  const project = (tables.projects || []).find((row) => row.id === body.p_project_id);
  if (name === 'reserve_vault_raw') {
    if (!project) return { ok: false, reason: 'missing' };
    const balance = rawBig(body.p_balance_raw);
    const locked = rawBig(body.p_locked_raw);
    const current = rawBig(project.vault_reserved_raw);
    if (locked <= 0n || current + locked > balance) return { ok: false, reason: 'short_balance' };
    project.vault_reserved_raw = (current + locked).toString();
    return { ok: true, vault_reserved_raw: project.vault_reserved_raw, campaign_reserved_raw: null };
  }
  if (name === 'release_vault_raw') {
    if (!project) return { ok: false, reason: 'missing' };
    const locked = rawBig(body.p_locked_raw);
    const current = rawBig(project.vault_reserved_raw);
    const next = current > locked ? current - locked : 0n;
    project.vault_reserved_raw = next.toString();
    return { ok: true, vault_reserved_raw: next.toString() };
  }
  if (name === 'release_campaign_vault') {
    const campaign = (tables.campaigns || []).find((row) => row.id === body.p_campaign_id && row.project_id === body.p_project_id);
    if (!project || !campaign) return { ok: false, reason: 'missing' };
    const released = rawBig(campaign.vault_reserved_raw);
    const current = rawBig(project.vault_reserved_raw);
    const next = current > released ? current - released : 0n;
    project.vault_reserved_raw = next.toString();
    campaign.vault_reserved_raw = '0';
    for (const row of tables.vault_reservations || []) {
      if (row.campaign_id === campaign.id && row.status === 'reserved') row.status = 'settled';
    }
    return { ok: true, vault_reserved_raw: next.toString(), released_raw: released.toString() };
  }
  return { ok: false, reason: 'missing' };
}

function parseFilters(search) {
  const filters = [];
  for (const [key, value] of search) {
    if (key === 'select' || key === 'on_conflict') continue;
    if (value.startsWith('not.in.')) {
      filters.push({ key, op: 'not.in', val: value.slice('not.in.'.length) });
      continue;
    }
    const dot = value.indexOf('.');
    filters.push({ key, op: value.slice(0, dot), val: value.slice(dot + 1) });
  }
  return filters;
}

function listValues(text) {
  return String(text || '').replace(/^\(/, '').replace(/\)$/, '').split(',').map((part) => part.trim().replace(/^"|"$/g, ''));
}

function matches(row, filters) {
  return filters.every((filter) => {
    const got = row[filter.key] == null ? '' : String(row[filter.key]);
    if (filter.op === 'eq') return got === filter.val;
    if (filter.op === 'lt') return got < filter.val;
    if (filter.op === 'is' && filter.val === 'null') return row[filter.key] == null;
    if (filter.op === 'not.in') return !listValues(filter.val).includes(got);
    if (filter.op === 'in') return listValues(filter.val).includes(got);
    return false;
  });
}

function createEnv(signer) {
  const tables = {
    projects: [],
    campaigns: [],
    campaign_joins: [],
    platform_claims: [],
    fee_payments: [],
    vault_settlements: [],
    vault_reservations: [],
    auth_nonces: [],
    holders: [],
  };
  const env = {
    SUPABASE_URL: 'http://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'devnet-campaign-local-db',
    SUPABASE_JWT_SECRET: JWT_SECRET,
    BARD_SIGNER_PUBKEY: signer,
    BARD_CUT_BPS: CUT_BPS.toString(),
    SOLANA_RPC: DEVNET_RPC,
    fetch: async (url, opts = {}) => {
      const u = new URL(url);
      if (u.hostname === 'supabase.test') return supabaseFetch(tables, u, opts);
      assertOutbound(url);
      return devnetFetch(url, opts);
    },
  };
  return { env, tables };
}

function supabaseFetch(tables, url, opts) {
  const method = (opts.method || 'GET').toUpperCase();
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const name = url.pathname.replace(/^\/rest\/v1\/rpc\//, '');
    const body = opts.body ? JSON.parse(opts.body) : {};
    return Response.json(applyVaultRpc(tables, name, body));
  }
  const table = url.pathname.replace(/^\/rest\/v1\//, '');
  const rows = tables[table];
  if (!rows) return Response.json({ message: 'missing ' + table }, { status: 500 });
  const filters = parseFilters(url.searchParams);
  if (method === 'GET') return Response.json(rows.filter((row) => matches(row, filters)));
  if (method === 'DELETE') {
    for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], filters)) rows.splice(i, 1);
    return new Response(null, { status: 204 });
  }
  const body = opts.body ? JSON.parse(opts.body) : {};
  if (method === 'POST') {
    if (table === 'auth_nonces' && rows.some((row) => row.jti === body.jti)) {
      return Response.json({ code: '23505', message: 'duplicate' }, { status: 409 });
    }
    if (table === 'vault_settlements' && body.campaign_id && rows.some((row) => row.campaign_id === body.campaign_id && row.status !== 'cancelled')) {
      return Response.json({ code: '23505', message: 'duplicate' }, { status: 409 });
    }
    const conflict = url.searchParams.get('on_conflict');
    if (conflict) {
      const keys = conflict.split(',');
      const existing = rows.find((row) => keys.every((key) => String(row[key]) === String(body[key])));
      if (existing) {
        Object.assign(existing, body);
        return Response.json([existing]);
      }
    }
    const stored = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      ...body,
    };
    rows.push(stored);
    return Response.json([stored], { status: 201 });
  }
  if (method === 'PATCH') {
    const updated = rows.filter((row) => matches(row, filters));
    if (table === 'vault_settlements' && body.tx_signature) {
      const ids = new Set(updated.map((row) => row.id));
      if (rows.some((row) => row.tx_signature === body.tx_signature && !ids.has(row.id))) {
        return Response.json({ code: '23505', message: 'duplicate' }, { status: 409 });
      }
    }
    updated.forEach((row) => Object.assign(row, body));
    return Response.json(updated);
  }
  return Response.json({ message: 'bad method' }, { status: 500 });
}

function contentType(file) {
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
  return 'text/html; charset=utf-8';
}

async function startServer(env) {
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const url = 'http://127.0.0.1:' + server.address().port + req.url;
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      });
      const rewritten = rewriteCampaignRequest(request);
      const apiResponse = await handleRequest(rewritten, env);
      if (apiResponse) {
        const bytes = Buffer.from(await apiResponse.arrayBuffer());
        const headers = {};
        apiResponse.headers.forEach((value, key) => { headers[key] = value; });
        if (apiResponse.status >= 500) console.error('api', rewritten.url, apiResponse.status, bytes.toString('utf8').slice(0, 500));
        res.writeHead(apiResponse.status, headers);
        res.end(bytes);
        return;
      }
      const pathname = new URL(rewritten.url).pathname;
      const file = STATIC.get(pathname);
      if (!file) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      const bytes = readFileSync(path.join(root, file));
      res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
      res.end(bytes);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(err && err.message ? err.message : 'server error');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    server,
    base: 'http://127.0.0.1:' + port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function api(base, method, pathname, body, token) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  const res = await realFetch(base + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { text }; }
  }
  return { status: res.status, data, text };
}

function signMessage(keypair, message) {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey));
}

async function signIn(base, keypair) {
  const wallet = keypair.publicKey.toBase58();
  const nonce = await api(base, 'POST', '/api/auth/nonce', { wallet });
  if (nonce.status !== 200) throw new Error('nonce ' + nonce.status + ' ' + JSON.stringify(nonce.data));
  const verified = await api(base, 'POST', '/api/auth/verify', {
    wallet,
    nonce: nonce.data.nonce,
    issuedAt: nonce.data.issuedAt,
    signature: signMessage(keypair, nonce.data.message),
    domain: nonce.data.domain,
  });
  if (verified.status !== 200 || !verified.data.token) {
    throw new Error('verify ' + verified.status + ' ' + JSON.stringify(verified.data));
  }
  return verified.data.token;
}

async function confirm(connection, signature, block) {
  await connection.confirmTransaction({
    signature,
    blockhash: block.blockhash,
    lastValidBlockHeight: block.lastValidBlockHeight,
  }, 'confirmed');
}

const results = [];

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    const shown = detail == null ? '' : (typeof detail === 'string' ? detail : (detail.text || ''));
    const line = 'PASS  ' + name + (shown ? '  ' + shown : '') + '  ' + (Date.now() - started) + 'ms';
    results.push(line);
    console.log(line);
    return detail;
  } catch (err) {
    const line = 'FAIL  ' + name + '  ' + (err && err.message ? err.message : err);
    results.push(line);
    console.log(line);
    throw err;
  }
}

async function main() {
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const dir = keyDirectory();
  const team = loadOrCreateKey(dir, 'team');
  const bard = loadOrCreateKey(dir, 'bard');
  const holder = Keypair.generate();
  const teamWallet = team.publicKey.toBase58();
  const bardWallet = bard.publicKey.toBase58();
  const holderWallet = holder.publicKey.toBase58();
  console.log('devnet campaign');
  console.log('team', teamWallet);
  console.log('bard signer', bardWallet);
  console.log('holder', holderWallet);

  await step('network-guard', async () => {
    const genesis = await connection.getGenesisHash();
    if (genesis !== DEVNET_GENESIS) throw new Error('genesis ' + genesis + ' is not devnet');
    assertOutbound(DEVNET_RPC);
    let refused = false;
    try { assertOutbound('https://api.mainnet-beta.solana.com'); } catch { refused = true; }
    if (!refused) throw new Error('mainnet RPC was accepted');
    try { assertOutbound('https://example.supabase.co/rest/v1/campaigns'); } catch { refused = true; }
    if (!refused) throw new Error('Supabase was accepted');
    return genesis;
  });

  const { env, tables } = createEnv(bardWallet);
  await step('signer-guard', async () => {
    if (bardWallet === FEE_TREASURY) throw new Error('signer is the fee wallet');
    if (bardWallet === teamWallet) throw new Error('signer is the team wallet');
    const problem = signerConfigProblem(env);
    if (problem) throw new Error(problem);
    if (env.BARD_SIGNER_PUBKEY !== bardWallet) throw new Error('signer was not the devnet key');
    return 'signer is not the fee wallet';
  });

  const local = await startServer(env);
  const base = local.base;
  try {
    const mintAndLock = await step('test-token', async () => {
      const balance = await connection.getBalance(team.publicKey, 'confirmed');
      if (balance < 200_000_000) throw new Error('team devnet SOL is below 0.2; not requesting a faucet');
      const bardBalance = await connection.getBalance(bard.publicKey, 'confirmed');
      if (bardBalance < 5_000_000) throw new Error('bard devnet SOL is below 0.005; not requesting a faucet');
      const created = await createMint(
        connection, team, team.publicKey, null, DECIMALS, Keypair.generate(), { commitment: 'confirmed' }, TOKEN_PROGRAM_ID
      );
      const locked = lockNeed(PRIZE_RAW, CUT_BPS);
      return { mint: created.toBase58(), lock: locked, text: created.toBase58() };
    });
    await runCampaign({
      connection, team, bard, holder, teamWallet, bardWallet, holderWallet, env, tables, base,
      mint: mintAndLock.mint,
      lock: mintAndLock.lock,
    });
  } finally {
    await local.close();
  }
  console.log('devnet campaign passed');
}

async function runCampaign(ctx) {
  const { connection, team, bard, teamWallet, bardWallet, holderWallet, tables, base } = ctx;
  const mint = new PublicKey(ctx.mint);
  const lock = ctx.lock;

  const vault = await step('vault', async () => {
    const created = await createTwoOfTwo(connection, team, teamWallet, bardWallet);
    const vaultKey = new PublicKey(created.vault);
    const block = await connection.getLatestBlockhash('confirmed');
    const fund = new Transaction({ feePayer: team.publicKey, recentBlockhash: block.blockhash }).add(
      SystemProgram.transfer({ fromPubkey: team.publicKey, toPubkey: vaultKey, lamports: 50_000_000 })
    );
    fund.sign(team);
    const fundSig = await connection.sendRawTransaction(fund.serialize());
    await confirm(connection, fundSig, block);
    return { multisig: created.multisig, vault: created.vault, fundSig };
  });

  await step('deposit', async () => {
    const teamAta = await getOrCreateAssociatedTokenAccount(
      connection, team, mint, team.publicKey, false, 'confirmed', undefined, TOKEN_PROGRAM_ID
    );
    await mintTo(
      connection, team, mint, teamAta.address, team, lock.lockedRaw, [], { commitment: 'confirmed' }, TOKEN_PROGRAM_ID
    );
    const vaultAta = await getOrCreateAssociatedTokenAccount(
      connection, team, mint, new PublicKey(vault.vault), true, 'confirmed', undefined, TOKEN_PROGRAM_ID
    );
    const signature = await transferChecked(
      connection, team, teamAta.address, mint, vaultAta.address, team, lock.lockedRaw, DECIMALS, [], { commitment: 'confirmed' }, TOKEN_PROGRAM_ID
    );
    return signature + ' raw ' + lock.lockedRaw.toString();
  });

  const teamToken = await signIn(base, team);
  const project = await step('project', async () => {
    const created = await api(base, 'POST', '/api/projects', {
      name: 'Test team',
      ticker: 'TEST',
      mint: mint.toBase58(),
    }, teamToken);
    if (created.status !== 200 || !created.data.project) throw new Error(JSON.stringify(created.data));
    return created.data.project;
  });

  await step('link-vault', async () => {
    const linked = await api(base, 'POST', '/api/projects/' + project.id + '/vault', {
      multisig: vault.multisig,
      address: vault.vault,
      mint: mint.toBase58(),
    }, teamToken);
    if (linked.status !== 200) throw new Error(linked.status + ' ' + JSON.stringify(linked.data));
    return linked.data.project.vault_status;
  });

  const campaign = await step('campaign-lock', async () => {
    const created = await api(base, 'POST', '/api/campaigns', {
      projectId: project.id,
      title: 'Devnet test campaign',
      type: 'hold',
      rule: 'Hold the test token. Made-up team, devnet only.',
      rewardMode: 'fixed',
      reward: '1',
      config: { holderCount: '1' },
      days: 7,
      accessMode: 'open',
    }, teamToken);
    if (created.status !== 200 || !created.data.campaign) throw new Error(created.status + ' ' + JSON.stringify(created.data));
    const row = created.data.campaign;
    if (row.prize_raw !== lock.prizeRaw.toString()) throw new Error('prize_raw ' + row.prize_raw);
    if (row.locked_raw !== lock.lockedRaw.toString()) throw new Error('locked_raw ' + row.locked_raw);
    return row.id;
  });

  await step('public-page', async () => {
    const page = await realFetch(base + '/c/' + campaign);
    const html = await page.text();
    if (page.status !== 200 || !html.includes('id="prize-line"') || !html.includes('/api/campaigns/')) {
      throw new Error('campaign page ' + page.status);
    }
    const state = await api(base, 'GET', '/api/campaigns/' + campaign + '/state');
    if (state.status !== 200) throw new Error('state ' + state.status + ' ' + JSON.stringify(state.data));
    if (state.data.campaign.title !== 'Devnet test campaign') throw new Error('title missing');
    if (state.data.prize.locked !== true) throw new Error('prize is not locked on the public state');
    if (state.data.prize.prize_raw !== lock.prizeRaw.toString()) throw new Error('public prize ' + state.data.prize.prize_raw);
    return 'locked prize ' + state.data.prize.prize_raw;
  });

  await step('entry', async () => {
    tables.campaign_joins.push({
      id: crypto.randomUUID(),
      project_id: project.id,
      campaign_id: campaign,
      wallet: holderWallet,
      x_handle: null,
      status: 'pending',
      qualified: false,
      progress: 0,
      joined_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
    const state = await api(base, 'GET', '/api/campaigns/' + campaign + '/state');
    if (state.status !== 200) throw new Error('state ' + state.status + ' ' + JSON.stringify(state.data));
    if (state.data.counts.joined !== 1) throw new Error('joined ' + state.data.counts.joined);
    if (!state.data.board || state.data.board.length !== 1) throw new Error('board empty');
    return holderWallet;
  });

  await step('qualify', async () => {
    const qualified = await api(base, 'POST', '/api/joins/qualify', {
      campaignId: campaign,
      wallet: holderWallet,
    }, teamToken);
    if (qualified.status !== 200 || qualified.data.join.qualified !== true) {
      throw new Error(qualified.status + ' ' + JSON.stringify(qualified.data));
    }
    return 'qualified';
  });

  const draw = await step('winner-draw', async () => {
    const committed = await api(base, 'POST', '/api/campaigns/' + campaign + '/draw/commit', { topN: 1 }, teamToken);
    if (committed.status !== 200) throw new Error(committed.status + ' ' + JSON.stringify(committed.data));
    const slot = committed.data.campaign.draw_slot;
    const deadline = Date.now() + 180000;
    let last = 'not started';
    while (Date.now() < deadline) {
      const finalized = await api(base, 'POST', '/api/campaigns/' + campaign + '/draw/finalize', {}, teamToken);
      if (finalized.status === 200) {
        const winners = finalized.data.campaign.draw_winners || [];
        if (!winners.length || winners[0].wallet !== holderWallet) {
          throw new Error('winner ' + JSON.stringify(winners));
        }
        return 'slot ' + slot + ' winner ' + holderWallet;
      }
      last = (finalized.data && finalized.data.error) || String(finalized.status);
      if (!/not final|No block|Block not available|skipped|Blockhash/i.test(last)) {
        throw new Error(last);
      }
      await sleep(2000);
    }
    throw new Error('draw did not finalize: ' + last);
  });

  const settlement = await step('propose', async () => {
    const proposed = await api(base, 'POST', '/api/settlements/propose', { campaignId: campaign }, teamToken);
    if (proposed.status !== 200 || !proposed.data.settlement) {
      throw new Error(proposed.status + ' ' + JSON.stringify(proposed.data));
    }
    const row = proposed.data.settlement;
    if (!Array.isArray(row.payouts) || row.payouts.length !== 1) throw new Error('payouts ' + JSON.stringify(row.payouts));
    if (row.payouts[0].wallet !== holderWallet) throw new Error('payout wallet ' + row.payouts[0].wallet);
    return row;
  });

  const chain = await step('team-sign', async () => {
    const cut = settlement.cut_waived === true ? null : {
      wallet: settlement.cut_wallet,
      amountRaw: String(settlement.cut_raw),
    };
    const proposed = await createPayoutProposal(
      connection, team, teamWallet, vault.multisig, mint.toBase58(), settlement.payouts, cut
    );
    const approved = await teamApprove(connection, team, teamWallet, vault.multisig, proposed.transactionIndex);
    const recorded = await api(base, 'POST', '/api/settlements/' + settlement.id + '/team-signed', {
      txIndex: proposed.transactionIndex,
      sig: approved,
    }, teamToken);
    if (recorded.status !== 200 || recorded.data.settlement.team_signed !== true) {
      throw new Error(recorded.status + ' ' + JSON.stringify(recorded.data));
    }
    return 'tx ' + proposed.transactionIndex + ' ' + approved;
  });

  await step('bard-sign', async () => {
    const index = chain.split(' ')[1];
    const approved = await teamApprove(connection, bard, bardWallet, vault.multisig, index);
    const bardToken = await signIn(base, bard);
    const recorded = await api(base, 'POST', '/api/settlements/' + settlement.id + '/bard-signed', {
      txIndex: index,
    }, bardToken);
    if (recorded.status !== 200 || recorded.data.settlement.bard_signed !== true) {
      throw new Error(recorded.status + ' ' + JSON.stringify(recorded.data));
    }
    if (recorded.data.settlement.status !== 'both_signed') throw new Error(recorded.data.settlement.status);
    return approved;
  });

  const executed = await step('execute', async () => {
    const index = chain.split(' ')[1];
    const signature = await executePayout(connection, team, teamWallet, vault.multisig, index);
    const recorded = await api(base, 'POST', '/api/settlements/' + settlement.id + '/execute', {
      signature,
    }, teamToken);
    if (recorded.status !== 200 || recorded.data.settlement.status !== 'executed') {
      throw new Error(recorded.status + ' ' + JSON.stringify(recorded.data));
    }
    if (recorded.data.settlement.tx_signature !== signature) throw new Error('signature was not stored');
    return signature;
  });

  await step('public-receipt', async () => {
    const state = await api(base, 'GET', '/api/campaigns/' + campaign + '/state');
    if (state.status !== 200) throw new Error('state ' + state.status);
    if (!state.data.clock || state.data.clock.state !== 'paid') throw new Error('clock ' + (state.data.clock && state.data.clock.state));
    if (state.data.links.receipt !== '/c/' + campaign + '/receipt') throw new Error('receipt link ' + state.data.links.receipt);
    const page = await realFetch(base + state.data.links.receipt);
    const html = await page.text();
    if (page.status !== 200 || !html.includes('Bard — receipt') || !html.includes('/receipt')) {
      throw new Error('receipt page ' + page.status);
    }
    const receipt = await api(base, 'GET', '/api/campaigns/' + campaign + '/receipt');
    if (receipt.status !== 200) throw new Error(receipt.status + ' ' + JSON.stringify(receipt.data));
    if (!receipt.data.settlement || receipt.data.settlement.tx_signature !== executed) {
      throw new Error('receipt signature ' + JSON.stringify(receipt.data.settlement));
    }
    if (receipt.data.draw == null || !receipt.data.draw.winners || !receipt.data.draw.winners.length) {
      throw new Error('receipt has no winner');
    }
    return executed;
  });

  return draw;
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
