import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { signJwt } from '../../server/auth.js';
import { handleRequest } from '../../server/api.js';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  FEE_TREASURY,
  SQUADS_PROGRAM,
  TOKEN_PROGRAM,
  associatedTokenAddress,
  decodeBase64,
  parseSquadsMultisig,
  sameMemberSet,
  squadsMultisigDiscriminator,
  squadsProposalAddress,
  squadsTransactionAddress,
  squadsVaultAddress,
} from '../../server/chain.js';
import { encodeVaultTransactionAccount } from '../../server/approve.js';
import { computePayouts, payoutHash, settlementLines } from '../../server/settlement.js';
import { settlementCut } from '../../server/money.js';

const SECRET = 'test-secret-test-secret-test-secret';

function installFetchGuard() {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    throw new Error('live network blocked: ' + url);
  };
  return () => { globalThis.fetch = orig; };
}

function keypair() {
  const pair = nacl.sign.keyPair();
  return { publicKey: bs58.encode(pair.publicKey) };
}

function leBytes(size, method, value) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view[method](0, value, true);
  return bytes;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function craftMultisig(threshold, members) {
  const disc = await squadsMultisigDiscriminator();
  const parts = [
    disc,
    new Uint8Array(32),
    new Uint8Array(32),
    leBytes(2, 'setUint16', threshold),
    leBytes(4, 'setUint32', 0),
    leBytes(8, 'setBigUint64', 0n),
    leBytes(8, 'setBigUint64', 0n),
    new Uint8Array([0]),
    new Uint8Array([1]),
    leBytes(4, 'setUint32', members.length),
  ];
  for (const member of members) {
    parts.push(bs58.decode(member));
    parts.push(new Uint8Array([0]));
  }
  return toBase64(concat(parts));
}

function account(data) {
  return { value: { owner: SQUADS_PROGRAM, data: [data, 'base64'] } };
}

function transferTx(payer, lamports) {
  return {
    meta: { err: null, innerInstructions: [] },
    transaction: {
      message: {
        instructions: [{
          program: 'system',
          parsed: {
            type: 'transfer',
            info: { source: payer, destination: FEE_TREASURY, lamports },
          },
        }],
      },
    },
  };
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
    const next = current + locked;
    project.vault_reserved_raw = next.toString();
    let campaignRaw = null;
    if (body.p_campaign_id) {
      const campaign = tables.campaigns.find((row) => row.id === body.p_campaign_id && row.project_id === project.id);
      if (!campaign) {
        project.vault_reserved_raw = current.toString();
        return { ok: false, reason: 'missing' };
      }
      campaignRaw = rawBig(campaign.vault_reserved_raw) + locked;
      campaign.vault_reserved_raw = campaignRaw.toString();
    }
    return {
      ok: true,
      vault_reserved_raw: next.toString(),
      campaign_reserved_raw: campaignRaw == null ? null : campaignRaw.toString(),
    };
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

function createEnv({ signer, accounts, txs, tokenAccounts, chain }) {
  const tables = {
    projects: [],
    campaigns: [],
    campaign_joins: [],
    platform_claims: [],
    fee_payments: [],
    vault_settlements: [],
    vault_reservations: [],
    auth_nonces: [],
  };
  const calls = [];
  const env = {
    SUPABASE_URL: 'http://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    SUPABASE_JWT_SECRET: SECRET,
    BARD_SIGNER_PUBKEY: signer,
    SOLANA_RPC: 'http://rpc.test/solana',
    fetch: async (url, opts = {}) => {
      const u = new URL(url);
      calls.push(opts.method + ' ' + u.hostname + u.pathname);
      if (/supabase\.co|mainnet|publicnode/i.test(u.hostname)) throw new Error('live network blocked');
      if (u.pathname.startsWith('/rest/v1/rpc/')) {
        const name = u.pathname.replace(/^\/rest\/v1\/rpc\//, '');
        const body = opts.body ? JSON.parse(opts.body) : {};
        return Response.json(applyVaultRpc(tables, name, body));
      }
      if (u.hostname === 'rpc.test') {
        const payload = JSON.parse(opts.body);
        if (payload.method === 'getAccountInfo') {
          return Response.json({ jsonrpc: '2.0', id: 1, result: accounts[payload.params[0]] || { value: null } });
        }
        if (payload.method === 'getTransaction') {
          return Response.json({ jsonrpc: '2.0', id: 1, result: txs[payload.params[0]] || null });
        }
        if (payload.method === 'getTokenAccountsByOwner') {
          const mint = payload.params[1] && payload.params[1].mint;
          const key = payload.params[0] + '|' + mint;
          return Response.json({ jsonrpc: '2.0', id: 1, result: (tokenAccounts && tokenAccounts[key]) || { value: [] } });
        }
        if (payload.method === 'getSlot') {
          return Response.json({ jsonrpc: '2.0', id: 1, result: chain ? chain.slot : 0 });
        }
        if (payload.method === 'getBlock') {
          const block = chain && chain.blocks ? chain.blocks[payload.params[0]] : null;
          if (block && block.error) return Response.json({ jsonrpc: '2.0', id: 1, error: block.error });
          return Response.json({ jsonrpc: '2.0', id: 1, result: block || null });
        }
        return Response.json({ jsonrpc: '2.0', id: 1, error: { message: 'unknown rpc' } });
      }
      const table = u.pathname.replace(/^\/rest\/v1\//, '');
      const rows = tables[table];
      if (!rows) return Response.json({ message: 'missing ' + table }, { status: 500 });
      const filters = [];
      for (const [key, value] of u.searchParams) {
        if (key === 'select' || key === 'on_conflict') continue;
        const dot = value.indexOf('.');
        filters.push({ key, op: value.slice(0, dot), val: value.slice(dot + 1) });
      }
      const matches = (row) => filters.every((filter) => {
        if (filter.op === 'is' && filter.val === 'null') return row[filter.key] == null;
        const got = row[filter.key] == null ? '' : String(row[filter.key]);
        if (filter.op === 'eq') return got === filter.val;
        if (filter.op === 'lt') return got < filter.val;
        return false;
      });
      if (opts.method === 'GET') {
        let found = rows.filter(matches);
        if (table === 'vault_settlements' && typeof tables.afterSettlementRead === 'function') {
          found = found.map((row) => Object.assign({}, row));
          const hook = tables.afterSettlementRead;
          tables.afterSettlementRead = null;
          hook();
        }
        return Response.json(found);
      }
      if (opts.method === 'DELETE') {
        for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i])) rows.splice(i, 1);
        return new Response(null, { status: 204 });
      }
      const body = opts.body ? JSON.parse(opts.body) : {};
      if (opts.method === 'POST') {
        if (table === 'fee_payments' && body.tx_signature && rows.some((row) => row.tx_signature === body.tx_signature)) {
          return Response.json({ code: '23505', message: 'duplicate' }, { status: 409 });
        }
        if (table === 'auth_nonces' && rows.some((row) => row.jti === body.jti)) {
          return Response.json({ code: '23505', message: 'duplicate' }, { status: 409 });
        }
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
        const updated = rows.filter(matches).map((row) => Object.assign(row, body));
        return Response.json(updated);
      }
      return Response.json({ message: 'bad method' }, { status: 500 });
    },
  };
  return { env, tables, calls };
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
  const data = await res.json();
  return { status: res.status, data };
}

test('privileged writes require the project admin session', { timeout: 30000 }, async () => {
  const restore = installFetchGuard();
  const walletA = keypair();
  const walletB = keypair();
  const holder = keypair();
  const signer = keypair();
  const multisig = keypair().publicKey;
  const vaultAddress = await squadsVaultAddress(multisig);
  const wrongVault = keypair().publicKey;
  const other = keypair().publicKey;
  const mintA = keypair().publicKey;
  const mintB = keypair().publicKey;
  const goodSig = '1'.repeat(87);
  const shortSig = '2'.repeat(87);
  const wrongPayerSig = '3'.repeat(87);
  const deadSig = '4'.repeat(87);
  const campaignSig = '6'.repeat(87);
  const goodAccount = await craftMultisig(2, [walletA.publicKey, signer.publicKey]);
  const wrongMembers = await craftMultisig(2, [walletA.publicKey, other]);
  const lowThreshold = await craftMultisig(1, [walletA.publicKey, signer.publicKey]);
  assert.ok(sameMemberSet((await parseSquadsMultisig(decodeBase64(goodAccount))).members, [walletA.publicKey, signer.publicKey]));
  const { env, tables, calls } = createEnv({
    signer: signer.publicKey,
    accounts: {
      [multisig]: account(goodAccount),
      [other]: account(wrongMembers),
      [walletB.publicKey]: account(lowThreshold),
      [mintA]: mintAccount(6),
    },
    txs: {
      [goodSig]: transferTx(walletA.publicKey, 1_000_000_000),
      [shortSig]: transferTx(walletA.publicKey, 1000),
      [wrongPayerSig]: transferTx(walletB.publicKey, 1_000_000_000),
      [deadSig]: { meta: { err: 'failed' }, transaction: { message: { instructions: [] } } },
      [campaignSig]: transferTx(walletA.publicKey, 250_000_000),
    },
    tokenAccounts: {
      [vaultAddress + '|' + mintA]: ownedTokens(mintA, 10_000_000, 6),
    },
  });
  const tokenA = (await signJwt(SECRET, walletA.publicKey)).token;
  const tokenB = (await signJwt(SECRET, walletB.publicKey)).token;
  try {
    const locked = [
      ['/api/projects', { name: 'Nope', ticker: 'NO', mint: mintA }],
      ['/api/campaigns', { projectId: 'x', title: 'T', rule: 'R', type: 'raid' }],
      ['/api/projects/x/vault', { address: vaultAddress, multisig }],
      ['/api/joins/status', { campaignId: 'c', wallet: holder.publicKey, status: 'approved' }],
      ['/api/joins/progress', { campaignId: 'c', wallet: holder.publicKey, progress: 1 }],
      ['/api/joins/qualify', { campaignId: 'c', wallet: holder.publicKey }],
      ['/api/settlements/s/team-sign', {}],
      ['/api/settlements/s/team-signed', {}],
      ['/api/settlements/s/bard-signed', {}],
      ['/api/settlements/s/executed', { signature: goodSig }],
      ['/api/settlements/propose', { projectId: 'x', campaignId: 'c' }],
      ['/api/vault/reserve', { projectId: 'x', campaignId: 'c', amount: '1' }],
      ['/api/settlements/s/execute', { signature: goodSig }],
      ['/api/campaigns/c/draw/commit', { topN: 1 }],
      ['/api/campaigns/c/draw/finalize', {}],
    ];
    for (const [path, body] of locked) {
      const res = await call(env, 'POST', path, body);
      assert.equal(res.status, 401, path);
      assert.equal(res.data.error, 'missing session');
    }
    for (const path of ['/api/projects/x/plan', '/api/fees/confirm', '/api/claims']) {
      const res = await call(env, 'POST', path, {});
      assert.equal(res.status, 404, path);
    }
    assert.equal(tables.projects.length, 0);

    const config = await handleRequest(new Request('http://127.0.0.1/api/config'), env);
    const configBody = await config.json();
    assert.equal(configBody.bardSignerPubkey, signer.publicKey);
    assert.equal(configBody.cutBps, 500);
    assert.equal(configBody.cutWallet, FEE_TREASURY);
    assert.equal(Object.prototype.hasOwnProperty.call(configBody, 'feesEnabled'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(configBody, 'feeTreasury'), false);

    const created = await call(env, 'POST', '/api/projects', {
      name: 'Alpha', ticker: 'ALP', mint: mintA, plan: 'starter',
    }, tokenA);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const project = created.data.project;
    assert.equal(project.admin_wallet, walletA.publicKey);
    assert.equal(project.plan, 'starter');
    assert.equal(project.fee_paid, true);

    const bPlan = await call(env, 'POST', '/api/projects/' + project.id + '/plan', { plan: 'pro' }, tokenB);
    assert.equal(bPlan.status, 404);
    assert.equal(tables.projects[0].plan, 'starter');

    const raidEarly = await call(env, 'POST', '/api/campaigns', {
      projectId: project.id, title: 'Raid', rule: 'reply', type: 'raid', rewardMode: 'fixed', reward: '1',
    }, tokenA);
    assert.equal(raidEarly.status, 409);
    assert.match(raidEarly.data.error, /Link a vault/);
    assert.equal(tables.campaigns.length, 0);

    const own = await call(env, 'POST', '/api/projects', {
      name: 'Beta', ticker: 'BET', mint: mintB,
    }, tokenB);
    assert.equal(own.status, 200);
    const cross = await call(env, 'POST', '/api/projects/' + own.data.project.id + '/plan', { plan: 'pro' }, tokenA);
    assert.equal(cross.status, 404);
    assert.equal(tables.projects.find((row) => row.id === own.data.project.id).plan, 'starter');

    const fee = await call(env, 'POST', '/api/fees/confirm', {
      kind: 'starter', signature: goodSig, projectId: project.id,
    }, tokenA);
    assert.equal(fee.status, 404);
    assert.equal(tables.fee_payments.length, 0);

    const linked = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: vaultAddress, multisig, mint: mintA,
    }, tokenA);
    assert.equal(linked.status, 200, JSON.stringify(linked.data));
    assert.equal(linked.data.project.vault_status, 'linked');
    assert.equal(linked.data.project.vault_multisig, multisig);
    assert.equal(linked.data.project.vault_address, vaultAddress);
    const otherMint = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: vaultAddress, multisig, mint: mintB,
    }, tokenA);
    assert.equal(otherMint.status, 400);
    assert.match(otherMint.data.error, /project mint/);
    assert.equal(tables.projects[0].vault_mint, mintA);
    const notVault = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: wrongVault, multisig,
    }, tokenA);
    assert.equal(notVault.status, 400);
    assert.match(notVault.data.error, /Squads vault/);
    assert.equal(tables.projects[0].vault_address, vaultAddress);
    const wrong = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: vaultAddress, multisig: other,
    }, tokenA);
    assert.equal(wrong.status, 400);
    assert.match(wrong.data.error, /2-of-2/);
    const low = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: vaultAddress, multisig: walletB.publicKey,
    }, tokenA);
    assert.equal(low.status, 400);
    const bVault = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: vaultAddress, multisig,
    }, tokenB);
    assert.equal(bVault.status, 403);
    assert.equal(tables.projects[0].vault_multisig, multisig);

    const treasuryEnv = createEnv({ signer: FEE_TREASURY, accounts: {}, txs: {} });
    treasuryEnv.tables.projects.push({ id: project.id, admin_wallet: walletA.publicKey });
    const treasury = await call(treasuryEnv.env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: vaultAddress, multisig,
    }, tokenA);
    assert.equal(treasury.status, 500);
    assert.match(treasury.data.error, /fee treasury/);

    const raid = await call(env, 'POST', '/api/campaigns', {
      projectId: project.id, title: 'Raid', rule: 'reply', type: 'raid', rewardMode: 'fixed', reward: '1',
    }, tokenA);
    assert.equal(raid.status, 200, JSON.stringify(raid.data));
    assert.equal(raid.data.campaign.status, 'active');
    assert.equal(raid.data.campaign.fee_paid, true);
    assert.equal(raid.data.campaign.cut_bps, 500);
    assert.equal(raid.data.campaign.prize_raw, '1000000');
    assert.equal(raid.data.campaign.locked_raw, '1050000');
    assert.equal(tables.projects[0].vault_reserved, '1.05');
    const hold = await call(env, 'POST', '/api/campaigns', {
      projectId: project.id, title: 'Hold', rule: 'hold', type: 'hold', rewardMode: 'fixed', reward: '1',
    }, tokenA);
    assert.equal(hold.status, 200, JSON.stringify(hold.data));
    const stolen = await call(env, 'POST', '/api/campaigns', {
      projectId: project.id, title: 'Stolen', rule: 'no', type: 'raid', rewardMode: 'fixed', reward: '1',
    }, tokenB);
    assert.equal(stolen.status, 403);
    assert.equal(tables.campaigns.length, 2);

    tables.campaign_joins.push({
      id: crypto.randomUUID(),
      campaign_id: raid.data.campaign.id,
      project_id: project.id,
      wallet: holder.publicKey,
      status: 'pending',
      progress: 0,
      qualified: false,
    });
    const bStatus = await call(env, 'POST', '/api/joins/status', {
      campaignId: raid.data.campaign.id, wallet: holder.publicKey, status: 'rejected',
    }, tokenB);
    assert.equal(bStatus.status, 403);
    assert.equal(tables.campaign_joins[0].status, 'pending');
    const status = await call(env, 'POST', '/api/joins/status', {
      campaignId: raid.data.campaign.id, wallet: holder.publicKey, status: 'approved',
    }, tokenA);
    assert.equal(status.status, 200);
    assert.equal(status.data.join.status, 'approved');
    const progress = await call(env, 'POST', '/api/joins/progress', {
      campaignId: raid.data.campaign.id, wallet: holder.publicKey, progress: 4,
    }, tokenA);
    assert.equal(progress.status, 200);
    assert.equal(progress.data.join.progress, 4);
    const qualify = await call(env, 'POST', '/api/joins/qualify', {
      campaignId: raid.data.campaign.id, wallet: holder.publicKey,
    }, tokenA);
    assert.equal(qualify.status, 200);
    assert.equal(qualify.data.join.qualified, true);
    const bQualify = await call(env, 'POST', '/api/joins/qualify', {
      campaignId: raid.data.campaign.id, wallet: holder.publicKey,
    }, tokenB);
    assert.equal(bQualify.status, 403);

    const claim = await call(env, 'POST', '/api/claims', {
      campaignId: raid.data.campaign.id, wallet: holder.publicKey, amount: '1', unit: 'SOL',
    }, tokenA);
    assert.equal(claim.status, 404);
    assert.equal(tables.platform_claims.length, 0);

    const settlementId = crypto.randomUUID();
    tables.vault_settlements.push({
      id: settlementId,
      project_id: project.id,
      status: 'proposed',
      bard_signed: false,
      team_signed: false,
      tx_index: null,
      vault_multisig: other,
    });
    const bSign = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-sign', { sig: 'sig', multisig: other }, tokenB);
    assert.equal(bSign.status, 403);
    assert.equal(tables.vault_settlements[0].team_signed, false);
    const savedMultisig = tables.projects[0].vault_multisig;
    tables.projects[0].vault_multisig = null;
    const unlinked = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-sign', { sig: 'sig', multisig: other }, tokenA);
    assert.equal(unlinked.status, 400);
    assert.match(unlinked.data.error, /not linked/);
    assert.equal(tables.vault_settlements[0].team_signed, false);
    assert.equal(tables.vault_settlements[0].vault_multisig, other);
    tables.projects[0].vault_multisig = savedMultisig;
    const team = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-sign', { sig: 'sig', multisig: other }, tokenA);
    assert.equal(team.status, 400, JSON.stringify(team.data));
    assert.match(team.data.error, /no vault transaction/);
    assert.equal(tables.vault_settlements[0].team_signed, false);
    tables.vault_settlements[0].bard_signed = true;
    tables.vault_settlements[0].status = 'executed';
    const closed = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-sign', { sig: 'sig3' }, tokenA);
    assert.equal(closed.status, 400);
    assert.match(closed.data.error, /closed/);
    const bard = await call(env, 'POST', '/api/vault/bard-sign', { settlementId });
    assert.equal(bard.status, 400, JSON.stringify(bard.data));
    assert.equal(bard.data.reason, 'settlement has no vault transaction');
    assert.equal(tables.vault_settlements[0].bard_signed, true);
    assert.equal(calls.some((line) => /supabase\.co|mainnet|publicnode/.test(line)), false);
  } finally {
    restore();
  }
});

function mintAccount(decimals) {
  const data = new Uint8Array(82);
  data[44] = decimals;
  return { value: { owner: TOKEN_PROGRAM, data: [toBase64(data), 'base64'] } };
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

const SYSTEM_PROGRAM = '11111111111111111111111111111111';

function compileMessage(payer, instructions) {
  const metas = new Map();
  const add = (pubkey, isSigner, isWritable) => {
    const prev = metas.get(pubkey);
    if (!prev) metas.set(pubkey, { isSigner, isWritable });
    else metas.set(pubkey, { isSigner: prev.isSigner || isSigner, isWritable: prev.isWritable || isWritable });
  };
  add(payer, true, true);
  for (const ix of instructions) {
    for (const key of ix.keys) add(key.pubkey, key.isSigner, key.isWritable);
    add(ix.programId, false, false);
  }
  const writableSigners = [];
  const readonlySigners = [];
  const writable = [];
  const readonly = [];
  for (const [pubkey, meta] of metas) {
    if (meta.isSigner && meta.isWritable) writableSigners.push(pubkey);
    else if (meta.isSigner) readonlySigners.push(pubkey);
    else if (meta.isWritable) writable.push(pubkey);
    else readonly.push(pubkey);
  }
  const accountKeys = [...writableSigners, ...readonlySigners, ...writable, ...readonly];
  const indexOf = (key) => accountKeys.indexOf(key);
  return {
    vaultIndex: 0,
    numSigners: writableSigners.length + readonlySigners.length,
    numWritableSigners: writableSigners.length,
    numWritableNonSigners: writable.length,
    accountKeys,
    instructions: instructions.map((ix) => ({
      programIdIndex: indexOf(ix.programId),
      accountIndexes: Uint8Array.from(ix.keys.map((key) => indexOf(key.pubkey))),
      data: ix.data,
    })),
    addressTableLookups: [],
  };
}

function createAtaIx(payer, ata, owner, mint, tokenProgram) {
  return {
    programId: ASSOCIATED_TOKEN_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Uint8Array.of(1),
  };
}

function transferIx(source, mint, destination, owner, amount, decimals, tokenProgram) {
  const data = new Uint8Array(10);
  data[0] = 12;
  new DataView(data.buffer).setBigUint64(1, BigInt(amount), true);
  data[9] = decimals;
  return {
    programId: tokenProgram,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  };
}

async function vaultAccountFor(spec) {
  const ordered = spec.lines.slice().sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  const vaultAta = await associatedTokenAddress(spec.vault, spec.mint, TOKEN_PROGRAM);
  const instructions = [createAtaIx(spec.vault, vaultAta, spec.vault, spec.mint, TOKEN_PROGRAM)];
  for (const line of ordered) {
    const ata = await associatedTokenAddress(line.wallet, spec.mint, TOKEN_PROGRAM);
    instructions.push(createAtaIx(spec.vault, ata, line.wallet, spec.mint, TOKEN_PROGRAM));
    instructions.push(transferIx(vaultAta, spec.mint, ata, spec.vault, line.amountRaw, spec.decimals, TOKEN_PROGRAM));
  }
  if (spec.tamperFirst) {
    const transfer = instructions.find((ix) => ix.data && ix.data[0] === 12);
    new DataView(transfer.data.buffer).setBigUint64(1, 1n, true);
  }
  if (spec.drain) {
    const drainAta = await associatedTokenAddress(spec.drain, spec.mint, TOKEN_PROGRAM);
    const transfer = new Uint8Array(9);
    transfer[0] = 3;
    new DataView(transfer.buffer).setBigUint64(1, 1n, true);
    instructions.push({
      programId: TOKEN_PROGRAM,
      keys: [
        { pubkey: vaultAta, isSigner: false, isWritable: true },
        { pubkey: drainAta, isSigner: false, isWritable: true },
        { pubkey: spec.vault, isSigner: true, isWritable: false },
      ],
      data: transfer,
    });
    const authority = new Uint8Array(38);
    authority[0] = 6;
    authority[1] = 2;
    new DataView(authority.buffer).setUint32(2, 1, true);
    authority.set(bs58.decode(spec.drain), 6);
    instructions.push({
      programId: TOKEN_PROGRAM,
      keys: [
        { pubkey: vaultAta, isSigner: false, isWritable: true },
        { pubkey: spec.vault, isSigner: true, isWritable: false },
      ],
      data: authority,
    });
  }
  const message = compileMessage(spec.vault, instructions);
  return encodeVaultTransactionAccount({
    multisig: spec.multisig,
    creator: spec.creator,
    index: spec.index,
    bump: 3,
    vaultIndex: 0,
    vaultBump: 4,
    ephemeralSignerBumps: new Uint8Array(),
    ...message,
  });
}

function proposalAccount(multisig, index, approved) {
  const parts = [Uint8Array.of(26, 94, 189, 187, 116, 136, 53, 33), bs58.decode(multisig)];
  const idx = new Uint8Array(8);
  new DataView(idx.buffer).setBigUint64(0, BigInt(index), true);
  parts.push(idx, Uint8Array.of(1), new Uint8Array(8), Uint8Array.of(0));
  const count = new Uint8Array(4);
  new DataView(count.buffer).setUint32(0, approved.length, true);
  parts.push(count);
  for (const wallet of approved) parts.push(bs58.decode(wallet));
  return concat(parts);
}

test('settlement routes keep the canonical hash and reject the other wallet', { timeout: 30000 }, async () => {
  const restore = installFetchGuard();
  const walletA = keypair();
  const walletB = keypair();
  const holder = keypair();
  const stranger = keypair();
  const signer = keypair();
  const multisig = keypair().publicKey;
  const mint = keypair().publicKey;
  const vaultAddress = await squadsVaultAddress(multisig);
  const goodAccount = await craftMultisig(2, [walletA.publicKey, signer.publicKey]);
  const chain = {
    slot: 1000,
    blocks: {
      1150: { error: { code: -32007, message: 'Slot 1150 was skipped' } },
      1151: { blockhash: 'SeedHashFromNextSlot' },
    },
  };
  const accounts = {
    [multisig]: account(goodAccount),
    [mint]: mintAccount(6),
  };
  const tokenAccounts = {
    [vaultAddress + '|' + mint]: ownedTokens(mint, 10_000_000, 6),
  };
  const { env, tables } = createEnv({
    signer: signer.publicKey,
    accounts,
    txs: {},
    tokenAccounts,
    chain,
  });
  const tokenA = (await signJwt(SECRET, walletA.publicKey)).token;
  const tokenB = (await signJwt(SECRET, walletB.publicKey)).token;
  const paySig = '5'.repeat(88);
  const otherSig = '6'.repeat(88);
  try {
    const created = await call(env, 'POST', '/api/projects', {
      name: 'Alpha', ticker: 'ALP', mint, plan: 'starter',
    }, tokenA);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const project = created.data.project;
    const missingVault = await call(env, 'POST', '/api/campaigns', {
      projectId: project.id, title: 'Raid', rule: 'reply', type: 'raid', rewardMode: 'fixed', reward: '2', unit: 'TOKEN',
    }, tokenA);
    assert.equal(missingVault.status, 409);
    assert.match(missingVault.data.error, /Link a vault/);
    assert.equal(tables.campaigns.length, 0);

    const linked = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: vaultAddress, multisig, mint,
    }, tokenA);
    assert.equal(linked.status, 200, JSON.stringify(linked.data));

    tokenAccounts[vaultAddress + '|' + mint] = ownedTokens(mint, 1000, 6);
    const short = await call(env, 'POST', '/api/campaigns', {
      projectId: project.id, title: 'Raid', rule: 'reply', type: 'raid', rewardMode: 'fixed', reward: '2', unit: 'TOKEN',
    }, tokenA);
    assert.equal(short.status, 409, JSON.stringify(short.data));
    assert.match(short.data.error, /does not cover/);
    assert.equal(tables.campaigns.length, 0);
    tokenAccounts[vaultAddress + '|' + mint] = ownedTokens(mint, 10_000_000, 6);

    const raid = await call(env, 'POST', '/api/campaigns', {
      projectId: project.id, title: 'Raid', rule: 'reply', type: 'raid', rewardMode: 'fixed', reward: '2', unit: 'TOKEN',
    }, tokenA);
    assert.equal(raid.status, 200, JSON.stringify(raid.data));
    const campaign = raid.data.campaign;
    assert.equal(campaign.prize_raw, '2000000');
    assert.equal(campaign.cut_raw, '100000');
    assert.equal(campaign.locked_raw, '2100000');
    assert.equal(campaign.cut_bps, 500);
    assert.equal(campaign.status, 'active');
    assert.equal(tables.projects[0].vault_reserved, '2.1');

    env.BARD_CUT_BPS = '1000';
    const later = await call(env, 'POST', '/api/campaigns', {
      projectId: project.id, title: 'Later', rule: 'hold', type: 'hold', rewardMode: 'fixed', reward: '1',
    }, tokenA);
    assert.equal(later.status, 200, JSON.stringify(later.data));
    assert.equal(later.data.campaign.cut_bps, 1000);
    assert.equal(tables.campaigns[0].cut_bps, 500);
    env.BARD_CUT_BPS = '500';

    const bPropose = await call(env, 'POST', '/api/settlements/propose', {
      projectId: project.id, campaignId: campaign.id, payouts: [{ wallet: stranger.publicKey, amountRaw: '1' }],
    }, tokenB);
    assert.equal(bPropose.status, 403);
    const bReserve = await call(env, 'POST', '/api/vault/reserve', {
      projectId: project.id, campaignId: campaign.id, amount: '1',
    }, tokenB);
    assert.equal(bReserve.status, 403);
    const bDraw = await call(env, 'POST', '/api/campaigns/' + campaign.id + '/draw/commit', { topN: 1 }, tokenB);
    assert.equal(bDraw.status, 403);
    assert.equal(tables.vault_settlements.length, 0);
    assert.equal(tables.vault_reservations.length, 2);

    const noCampaign = await call(env, 'POST', '/api/vault/reserve', {
      projectId: project.id, amount: '1',
    }, tokenA);
    assert.equal(noCampaign.status, 409);
    assert.match(noCampaign.data.error, /needs a campaign/);
    const tooMuch = await call(env, 'POST', '/api/vault/reserve', {
      projectId: project.id, campaignId: campaign.id, amount: '100',
    }, tokenA);
    assert.equal(tooMuch.status, 409);
    assert.match(tooMuch.data.error, /cannot take a reservation/);
    const reserved = await call(env, 'POST', '/api/vault/reserve', {
      projectId: project.id, campaignId: campaign.id, amount: '3',
    }, tokenA);
    assert.equal(reserved.status, 409);
    assert.equal(tables.projects[0].vault_reserved, '3.2');
    assert.equal(tables.campaigns[0].vault_reserved, '2.1');
    assert.equal(tables.vault_reservations.length, 2);
    assert.equal(tables.vault_reservations[0].status, 'reserved');

    tables.campaign_joins.push({
      id: crypto.randomUUID(),
      campaign_id: campaign.id,
      project_id: project.id,
      wallet: holder.publicKey,
      status: 'approved',
      progress: 1,
      qualified: true,
    });
    tables.campaign_joins.push({
      id: crypto.randomUUID(),
      campaign_id: campaign.id,
      project_id: project.id,
      wallet: stranger.publicKey,
      status: 'rejected',
      progress: 9,
      qualified: false,
    });
    const expected = computePayouts({
      reward_mode: 'fixed', reward: '2', reward_unit: 'TOKEN', prize_raw: campaign.prize_raw,
    }, tables.campaign_joins, 6);
    const cut = settlementCut(expected.payouts, campaign.prize_raw, campaign.cut_bps, campaign.cut_wallet);
    const hash = payoutHash(settlementLines(expected.payouts, cut.cutWallet, cut.cutRaw));
    assert.notEqual(hash, expected.hash);
    const proposed = await call(env, 'POST', '/api/settlements/propose', {
      projectId: project.id,
      campaignId: campaign.id,
      payouts: [{ wallet: stranger.publicKey, amount: '99', amountRaw: '99' }],
      payout_hash: 'client-hash',
    }, tokenA);
    assert.equal(proposed.status, 200, JSON.stringify(proposed.data));
    assert.equal(proposed.data.settlement.payout_hash, hash);
    assert.equal(proposed.data.settlement.cut_raw, '100000');
    assert.equal(proposed.data.settlement.cut_waived, false);
    assert.notEqual(proposed.data.settlement.payout_hash, 'client-hash');
    assert.deepEqual(proposed.data.settlement.payouts.map((row) => row.wallet), [holder.publicKey]);
    assert.equal(tables.vault_settlements[0].payout_hash, hash);

    const settlementId = proposed.data.settlement.id;
    const bExecute = await call(env, 'POST', '/api/settlements/' + settlementId + '/execute', { signature: paySig }, tokenB);
    assert.equal(bExecute.status, 403);
    const missingTx = await call(env, 'POST', '/api/settlements/' + settlementId + '/execute', { signature: paySig }, tokenA);
    assert.equal(missingTx.status, 400);
    assert.match(missingTx.data.error, /no vault transaction/);

    const txIndex = 4n;
    tables.vault_settlements[0].tx_index = '4';
    const transactionPda = await squadsTransactionAddress(multisig, txIndex);
    const proposalPda = await squadsProposalAddress(multisig, txIndex);
    const vaultAta = await associatedTokenAddress(vaultAddress, mint, TOKEN_PROGRAM);
    const holderAta = await associatedTokenAddress(holder.publicKey, mint, TOKEN_PROGRAM);
    const cutAta = await associatedTokenAddress(FEE_TREASURY, mint, TOKEN_PROGRAM);
    const payoutLines = [
      { wallet: holder.publicKey, amountRaw: expected.payouts[0].amountRaw },
      { wallet: FEE_TREASURY, amountRaw: '100000' },
    ];
    const payoutTx = {
      meta: {
        err: null,
        logMessages: ['Program log: Instruction: VaultTransactionExecute'],
        innerInstructions: [],
      },
      transaction: {
        message: {
          accountKeys: [SQUADS_PROGRAM, multisig, transactionPda, proposalPda],
          instructions: [{
            program: 'spl-token',
            programId: TOKEN_PROGRAM,
            parsed: {
              type: 'transferChecked',
              info: {
                source: vaultAta,
                destination: holderAta,
                mint,
                authority: vaultAddress,
                tokenAmount: { amount: expected.payouts[0].amountRaw, decimals: 6 },
              },
            },
          }, {
            program: 'spl-token',
            programId: TOKEN_PROGRAM,
            parsed: {
              type: 'transferChecked',
              info: {
                source: vaultAta,
                destination: cutAta,
                mint,
                authority: vaultAddress,
                tokenAmount: { amount: '100000', decimals: 6 },
              },
            },
          }],
        },
      },
    };
    const tokenSigner = (await signJwt(SECRET, signer.publicKey)).token;
    const tampered = await vaultAccountFor({
      multisig, vault: vaultAddress, mint, lines: payoutLines, creator: walletA.publicKey, index: txIndex, decimals: 6, tamperFirst: true,
    });
    accounts[transactionPda] = account(toBase64(tampered));
    const teamTamper = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-signed', {}, tokenA);
    assert.equal(teamTamper.status, 400, JSON.stringify(teamTamper.data));
    assert.match(teamTamper.data.error, /does not match/);
    const bardTamper = await call(env, 'POST', '/api/settlements/' + settlementId + '/bard-signed', {}, tokenSigner);
    assert.equal(bardTamper.status, 400, JSON.stringify(bardTamper.data));
    assert.match(bardTamper.data.error, /does not match/);
    assert.equal(tables.vault_settlements[0].team_signed, false);
    assert.equal(tables.vault_settlements[0].bard_signed, false);
    let shownTx = payoutTx;
    const originalFetch = env.fetch;
    env.fetch = async (url, opts = {}) => {
      const u = new URL(url);
      if (u.hostname === 'rpc.test') {
        const payload = JSON.parse(opts.body);
        if (payload.method === 'getTransaction') {
          const sig = payload.params[0];
          return Response.json({ jsonrpc: '2.0', id: 1, result: sig === paySig ? shownTx : null });
        }
      }
      return originalFetch(url, opts);
    };

    const executedTamper = await call(env, 'POST', '/api/settlements/' + settlementId + '/executed', { signature: paySig }, tokenA);
    assert.equal(executedTamper.status, 400, JSON.stringify(executedTamper.data));
    assert.match(executedTamper.data.error, /does not match/);
    assert.equal(tables.vault_settlements[0].status, 'proposed');
    assert.equal(tables.vault_settlements[0].team_signed, false);
    assert.equal(tables.vault_settlements[0].bard_signed, false);
    assert.equal(tables.campaigns[0].status, 'active');
    assert.equal(tables.platform_claims.length, 0);
    const verifyTamper = await call(env, 'GET', '/api/settlements/' + settlementId + '/verify');
    assert.equal(verifyTamper.status, 200, JSON.stringify(verifyTamper.data));
    assert.equal(verifyTamper.data.matches, false);

    const refuseExecute = async (tx) => {
      shownTx = tx;
      const res = await call(env, 'POST', '/api/settlements/' + settlementId + '/execute', { signature: paySig }, tokenA);
      assert.equal(res.status, 400, JSON.stringify(res.data));
      assert.equal(tables.vault_settlements[0].status, 'proposed');
      assert.equal(tables.platform_claims.length, 0);
      assert.equal(tables.vault_reservations[0].status, 'reserved');
      assert.equal(String(tables.projects[0].vault_reserved), '3.2');
      assert.equal(tables.campaigns[0].status, 'active');
      assert.equal(tables.campaign_joins[0].qualified, true);
      return res;
    };
    const clonePayout = () => structuredClone(payoutTx);
    const wrongAuthority = clonePayout();
    wrongAuthority.transaction.message.instructions[0].parsed.info.authority = stranger.publicKey;
    const wrongAuth = await refuseExecute(wrongAuthority);
    assert.match(wrongAuth.data.error, /authority/);
    const missingAuthority = clonePayout();
    delete missingAuthority.transaction.message.instructions[0].parsed.info.authority;
    const missingAuth = await refuseExecute(missingAuthority);
    assert.match(missingAuth.data.error, /authority/);
    const emptyAuthority = clonePayout();
    emptyAuthority.transaction.message.instructions[0].parsed.info.authority = '';
    const emptyAuth = await refuseExecute(emptyAuthority);
    assert.match(emptyAuth.data.error, /authority/);
    for (const field of ['mint', 'source', 'destination']) {
      const tx = clonePayout();
      delete tx.transaction.message.instructions[0].parsed.info[field];
      await refuseExecute(tx);
    }
    const missingProgram = clonePayout();
    delete missingProgram.transaction.message.instructions[0].program;
    const missingProgramRes = await refuseExecute(missingProgram);
    assert.match(missingProgramRes.data.error, /program/);
    const missingProgramId = clonePayout();
    delete missingProgramId.transaction.message.instructions[0].programId;
    const missingProgramIdRes = await refuseExecute(missingProgramId);
    assert.match(missingProgramIdRes.data.error, /program/);
    const wrongProgramId = clonePayout();
    wrongProgramId.transaction.message.instructions[0].programId = stranger.publicKey;
    const wrongProgramIdRes = await refuseExecute(wrongProgramId);
    assert.match(wrongProgramIdRes.data.error, /program/);
    shownTx = payoutTx;
    const honest = await vaultAccountFor({
      multisig, vault: vaultAddress, mint, lines: payoutLines, creator: walletA.publicKey, index: txIndex, decimals: 6,
    });
    accounts[transactionPda] = account(toBase64(honest));
    accounts[proposalPda] = account(toBase64(proposalAccount(multisig, txIndex, [walletA.publicKey, signer.publicKey])));
    const verifyOk = await call(env, 'GET', '/api/settlements/' + settlementId + '/verify');
    assert.equal(verifyOk.status, 200, JSON.stringify(verifyOk.data));
    assert.equal(verifyOk.data.matches, true);
    const drained = await vaultAccountFor({
      multisig, vault: vaultAddress, mint, lines: payoutLines, creator: walletA.publicKey, index: txIndex, decimals: 6, drain: stranger.publicKey,
    });
    accounts[transactionPda] = account(toBase64(drained));
    const verifyDrain = await call(env, 'GET', '/api/settlements/' + settlementId + '/verify');
    assert.equal(verifyDrain.status, 200, JSON.stringify(verifyDrain.data));
    assert.equal(verifyDrain.data.matches, false);
    assert.equal(verifyDrain.data.diff.reason, 'extra_instruction');
    assert.equal(verifyDrain.data.diff.matches, true);
    const approveSrc = readFileSync(new URL('../../admin_app.js', import.meta.url), 'utf8');
    const approveAt = approveSrc.indexOf('id="btn-bard-approve"');
    assert.ok(approveAt > 0);
    assert.match(approveSrc.slice(approveAt, approveAt + 90), /report\.matches\?'':' disabled'/);
    accounts[transactionPda] = account(toBase64(honest));
    const teamOk = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-signed', {}, tokenA);
    assert.equal(teamOk.status, 200, JSON.stringify(teamOk.data));
    assert.equal(teamOk.data.settlement.team_signed, true);
    const bardOk = await call(env, 'POST', '/api/settlements/' + settlementId + '/bard-signed', {}, tokenSigner);
    assert.equal(bardOk.status, 200, JSON.stringify(bardOk.data));
    assert.equal(bardOk.data.settlement.bard_signed, true);
    assert.equal(bardOk.data.settlement.status, 'both_signed');

    const paid = await call(env, 'POST', '/api/settlements/' + settlementId + '/execute', { signature: paySig }, tokenA);
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    assert.equal(paid.data.settlement.status, 'executed');
    assert.equal(paid.data.settlement.tx_signature, paySig);
    assert.equal(tables.campaign_joins[0].qualified, true);
    assert.equal(tables.platform_claims.length, 1);
    assert.equal(tables.platform_claims[0].wallet, holder.publicKey);
    assert.equal(tables.platform_claims[0].settled, true);
    assert.equal(tables.platform_claims[0].fee_paid, true);
    assert.equal(Number(tables.platform_claims[0].fee_amount_sol), 0);
    assert.equal(tables.vault_reservations[0].status, 'settled');
    assert.equal(tables.projects[0].vault_reserved, '1.1');
    assert.equal(tables.campaigns[0].status, 'paid');
    assert.equal(tables.campaigns[0].vault_reserved, '0');
    assert.equal(tables.campaigns[1].status, 'active');
    const again = await call(env, 'POST', '/api/settlements/' + settlementId + '/execute', { signature: paySig }, tokenA);
    assert.equal(again.status, 200);
    assert.equal(again.data.settlement.status, 'executed');
    const reused = await call(env, 'POST', '/api/settlements/' + settlementId + '/execute', { signature: otherSig }, tokenA);
    assert.equal(reused.status, 400);
    assert.match(reused.data.error, /closed/);

    const committed = await call(env, 'POST', '/api/campaigns/' + campaign.id + '/draw/commit', { topN: 1 }, tokenA);
    assert.equal(committed.status, 200, JSON.stringify(committed.data));
    assert.equal(Number(tables.campaigns[0].draw_slot), 1150);
    assert.equal(Number(tables.campaigns[0].draw_count), 1);
    const secondCommit = await call(env, 'POST', '/api/campaigns/' + campaign.id + '/draw/commit', { topN: 2 }, tokenA);
    assert.equal(secondCommit.status, 400);
    assert.match(secondCommit.data.error, /already committed/);
    const early = await call(env, 'POST', '/api/campaigns/' + campaign.id + '/draw/finalize', {}, tokenA);
    assert.equal(early.status, 400);
    assert.match(early.data.error, /not final yet/);
    chain.slot = 1152;
    const finalized = await call(env, 'POST', '/api/campaigns/' + campaign.id + '/draw/finalize', {}, tokenA);
    assert.equal(finalized.status, 200, JSON.stringify(finalized.data));
    assert.equal(tables.campaigns[0].draw_seed, 'SeedHashFromNextSlot');
    assert.equal(Number(tables.campaigns[0].draw_seed_slot), 1151);
    assert.equal(tables.campaigns[0].draw_winners.length, 1);
    assert.equal(tables.campaigns[0].draw_winners[0].wallet, holder.publicKey);
    const secondFinal = await call(env, 'POST', '/api/campaigns/' + campaign.id + '/draw/finalize', {}, tokenA);
    assert.equal(secondFinal.status, 400);
    assert.match(secondFinal.data.error, /already finalized/);
    const bFinal = await call(env, 'POST', '/api/campaigns/' + campaign.id + '/draw/finalize', {}, tokenB);
    assert.equal(bFinal.status, 403);
  } finally {
    restore();
  }
});

test('two creates at once reserve only what the vault can cover', async () => {
  const restore = installFetchGuard();
  const wallet = keypair();
  const signer = keypair();
  const multisig = keypair().publicKey;
  const mint = keypair().publicKey;
  const vaultAddress = await squadsVaultAddress(multisig);
  const goodAccount = await craftMultisig(2, [wallet.publicKey, signer.publicKey]);
  const { env, tables } = createEnv({
    signer: signer.publicKey,
    accounts: { [multisig]: account(goodAccount), [mint]: mintAccount(6) },
    txs: {},
    tokenAccounts: { [vaultAddress + '|' + mint]: ownedTokens(mint, 1_050_000, 6) },
  });
  const token = (await signJwt(SECRET, wallet.publicKey)).token;
  try {
    const created = await call(env, 'POST', '/api/projects', {
      name: 'Alpha', ticker: 'ALP', mint, plan: 'starter',
    }, token);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const linked = await call(env, 'POST', '/api/projects/' + created.data.project.id + '/vault', {
      address: vaultAddress, multisig, mint,
    }, token);
    assert.equal(linked.status, 200, JSON.stringify(linked.data));
    const body = {
      projectId: created.data.project.id, rule: 'hold', type: 'hold', rewardMode: 'fixed', reward: '1',
    };
    const [first, second] = await Promise.all([
      call(env, 'POST', '/api/campaigns', { ...body, title: 'One' }, token),
      call(env, 'POST', '/api/campaigns', { ...body, title: 'Two' }, token),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409]);
    const refused = first.status === 409 ? first : second;
    assert.match(refused.data.error, /does not cover/);
    assert.equal(tables.campaigns.length, 1);
    assert.equal(tables.projects[0].vault_reserved_raw, '1050000');
    assert.equal(tables.campaigns[0].vault_reserved_raw, '1050000');
  } finally {
    restore();
  }
});

test('a second campaign succeeds after a fractional reservation', async () => {
  const restore = installFetchGuard();
  const wallet = keypair();
  const signer = keypair();
  const multisig = keypair().publicKey;
  const mint = keypair().publicKey;
  const fine = keypair().publicKey;
  const vaultAddress = await squadsVaultAddress(multisig);
  const goodAccount = await craftMultisig(2, [wallet.publicKey, signer.publicKey]);
  const { env, tables } = createEnv({
    signer: signer.publicKey,
    accounts: {
      [multisig]: account(goodAccount),
      [mint]: mintAccount(6),
      [fine]: mintAccount(9),
    },
    txs: {},
    tokenAccounts: {
      [vaultAddress + '|' + mint]: ownedTokens(mint, 100_000_000, 6),
      [vaultAddress + '|' + fine]: ownedTokens(fine, 2, 9),
    },
  });
  const token = (await signJwt(SECRET, wallet.publicKey)).token;
  try {
    const created = await call(env, 'POST', '/api/projects', {
      name: 'Alpha', ticker: 'ALP', mint, plan: 'starter',
    }, token);
    const projectId = created.data.project.id;
    const linked = await call(env, 'POST', '/api/projects/' + projectId + '/vault', {
      address: vaultAddress, multisig, mint,
    }, token);
    assert.equal(linked.status, 200, JSON.stringify(linked.data));
    const first = await call(env, 'POST', '/api/campaigns', {
      projectId, title: 'Ten', rule: 'hold', type: 'hold', rewardMode: 'fixed', reward: '10',
    }, token);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(tables.projects[0].vault_reserved_raw, '10500000');
    tables.projects[0].vault_reserved = 10.5;
    const second = await call(env, 'POST', '/api/campaigns', {
      projectId, title: 'One', rule: 'hold', type: 'hold', rewardMode: 'fixed', reward: '1',
    }, token);
    assert.equal(second.status, 200, JSON.stringify(second.data));
    assert.equal(tables.projects[0].vault_reserved_raw, '11550000');
    assert.equal(tables.campaigns.length, 2);

    const nine = await call(env, 'POST', '/api/projects', {
      name: 'Nine', ticker: 'NIN', mint: fine, plan: 'starter',
    }, token);
    assert.equal(nine.status, 200, JSON.stringify(nine.data));
    const linkedFine = await call(env, 'POST', '/api/projects/' + nine.data.project.id + '/vault', {
      address: vaultAddress, multisig, mint: fine,
    }, token);
    assert.equal(linkedFine.status, 200, JSON.stringify(linkedFine.data));
    const dust = await call(env, 'POST', '/api/campaigns', {
      projectId: nine.data.project.id, title: 'Dust', rule: 'hold', type: 'hold', rewardMode: 'fixed', reward: '0.000000001',
    }, token);
    assert.equal(dust.status, 200, JSON.stringify(dust.data));
    assert.equal(dust.data.campaign.prize_raw, '1');
    assert.equal(dust.data.campaign.locked_raw, '2');
    assert.equal(dust.data.campaign.vault_reserved_raw, '2');
    const nineRow = tables.projects.find((row) => row.id === nine.data.project.id);
    assert.equal(nineRow.vault_reserved_raw, '2');
  } finally {
    restore();
  }
});

test('a fixed reward pays only the holders the lock covers', async () => {
  const restore = installFetchGuard();
  const wallet = keypair();
  const signer = keypair();
  const multisig = keypair().publicKey;
  const mint = keypair().publicKey;
  const vaultAddress = await squadsVaultAddress(multisig);
  const goodAccount = await craftMultisig(2, [wallet.publicKey, signer.publicKey]);
  const holders = Array.from({ length: 11 }, () => keypair());
  const { env, tables } = createEnv({
    signer: signer.publicKey,
    accounts: { [multisig]: account(goodAccount), [mint]: mintAccount(0) },
    txs: {},
    tokenAccounts: { [vaultAddress + '|' + mint]: ownedTokens(mint, 1050, 0) },
  });
  const token = (await signJwt(SECRET, wallet.publicKey)).token;
  try {
    const created = await call(env, 'POST', '/api/projects', {
      name: 'Alpha', ticker: 'ALP', mint, plan: 'starter',
    }, token);
    const projectId = created.data.project.id;
    const linked = await call(env, 'POST', '/api/projects/' + projectId + '/vault', {
      address: vaultAddress, multisig, mint,
    }, token);
    assert.equal(linked.status, 200, JSON.stringify(linked.data));
    const campaign = await call(env, 'POST', '/api/campaigns', {
      projectId, title: 'Ten', rule: 'hold', type: 'hold', rewardMode: 'fixed', reward: '100',
      config: { holderCount: 10 },
    }, token);
    assert.equal(campaign.status, 200, JSON.stringify(campaign.data));
    assert.equal(campaign.data.campaign.prize_raw, '1000');
    assert.equal(campaign.data.campaign.locked_raw, '1050');
    holders.forEach((holder, index) => {
      tables.campaign_joins.push({
        id: crypto.randomUUID(),
        campaign_id: campaign.data.campaign.id,
        project_id: projectId,
        wallet: holder.publicKey,
        status: 'approved',
        progress: 100 - index,
        qualified: true,
      });
    });
    const proposed = await call(env, 'POST', '/api/settlements/propose', {
      projectId, campaignId: campaign.data.campaign.id,
      payouts: [{ wallet: holders[10].publicKey, amountRaw: '999' }],
    }, token);
    assert.equal(proposed.status, 200, JSON.stringify(proposed.data));
    assert.equal(proposed.data.settlement.payouts.length, 10);
    assert.equal(proposed.data.settlement.holder_total_raw, '1000');
    assert.equal(proposed.data.settlement.payouts.some((row) => row.wallet === holders[10].publicKey), false);
    assert.equal(proposed.data.settlement.payouts.every((row) => row.amountRaw === '100'), true);
  } finally {
    restore();
  }
});

function parsedPayoutTx(spec) {
  return {
    meta: {
      err: null,
      logMessages: ['Program log: Instruction: VaultTransactionExecute'],
      innerInstructions: [],
    },
    transaction: {
      message: {
        accountKeys: [SQUADS_PROGRAM, spec.multisig, spec.transactionPda, spec.proposalPda],
        instructions: spec.transfers.map((transfer) => ({
          program: 'spl-token',
          programId: TOKEN_PROGRAM,
          parsed: {
            type: 'transferChecked',
            info: {
              source: spec.vaultAta,
              destination: transfer.destination,
              mint: spec.mint,
              authority: spec.vaultAddress,
              tokenAmount: { amount: transfer.amount, decimals: 6 },
            },
          },
        })),
      },
    },
  };
}

async function prepareLockedSettlement() {
  const wallet = keypair();
  const holder = keypair();
  const signer = keypair();
  const multisig = keypair().publicKey;
  const mint = keypair().publicKey;
  const vaultAddress = await squadsVaultAddress(multisig);
  const goodAccount = await craftMultisig(2, [wallet.publicKey, signer.publicKey]);
  const paySig = '7'.repeat(88);
  const accounts = {
    [multisig]: account(goodAccount),
    [mint]: mintAccount(6),
  };
  const { env, tables } = createEnv({
    signer: signer.publicKey,
    accounts,
    txs: {},
    tokenAccounts: { [vaultAddress + '|' + mint]: ownedTokens(mint, 10_000_000, 6) },
  });
  const token = (await signJwt(SECRET, wallet.publicKey)).token;
  const created = await call(env, 'POST', '/api/projects', {
    name: 'Alpha', ticker: 'ALP', mint, plan: 'starter',
  }, token);
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const project = created.data.project;
  const linked = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
    address: vaultAddress, multisig, mint,
  }, token);
  assert.equal(linked.status, 200, JSON.stringify(linked.data));
  const raid = await call(env, 'POST', '/api/campaigns', {
    projectId: project.id, title: 'Raid', rule: 'reply', type: 'raid', rewardMode: 'fixed', reward: '2', unit: 'TOKEN',
  }, token);
  assert.equal(raid.status, 200, JSON.stringify(raid.data));
  const campaign = raid.data.campaign;
  tables.campaign_joins.push({
    id: crypto.randomUUID(),
    campaign_id: campaign.id,
    project_id: project.id,
    wallet: holder.publicKey,
    status: 'approved',
    progress: 1,
    qualified: true,
  });
  const proposed = await call(env, 'POST', '/api/settlements/propose', {
    projectId: project.id, campaignId: campaign.id,
  }, token);
  assert.equal(proposed.status, 200, JSON.stringify(proposed.data));
  const settlement = proposed.data.settlement;
  const txIndex = 4n;
  tables.vault_settlements[0].tx_index = '4';
  const transactionPda = await squadsTransactionAddress(multisig, txIndex);
  const proposalPda = await squadsProposalAddress(multisig, txIndex);
  const vaultAta = await associatedTokenAddress(vaultAddress, mint, TOKEN_PROGRAM);
  const holderAta = await associatedTokenAddress(holder.publicKey, mint, TOKEN_PROGRAM);
  const cutAta = await associatedTokenAddress(FEE_TREASURY, mint, TOKEN_PROGRAM);
  const honest = await vaultAccountFor({
    multisig,
    vault: vaultAddress,
    mint,
    lines: [
      { wallet: holder.publicKey, amountRaw: settlement.payouts[0].amountRaw },
      { wallet: FEE_TREASURY, amountRaw: String(settlement.cut_raw) },
    ],
    creator: wallet.publicKey,
    index: txIndex,
    decimals: 6,
  });
  accounts[transactionPda] = account(toBase64(honest));
  const payoutTx = parsedPayoutTx({
    multisig,
    transactionPda,
    proposalPda,
    vaultAta,
    mint,
    vaultAddress,
    transfers: [
      { destination: holderAta, amount: settlement.payouts[0].amountRaw },
      { destination: cutAta, amount: String(settlement.cut_raw) },
    ],
  });
  const originalFetch = env.fetch;
  env.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.hostname === 'rpc.test') {
      const payload = JSON.parse(opts.body);
      if (payload.method === 'getTransaction') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: payload.params[0] === paySig ? payoutTx : null });
      }
    }
    return originalFetch(url, opts);
  };
  return { env, tables, accounts, token, project, campaign, settlement, paySig, multisig, signer };
}

test('a draft campaign with pool_size gets 409 from propose', async () => {
  const restore = installFetchGuard();
  const wallet = keypair();
  const holder = keypair();
  const signer = keypair();
  const multisig = keypair().publicKey;
  const mint = keypair().publicKey;
  const vaultAddress = await squadsVaultAddress(multisig);
  const goodAccount = await craftMultisig(2, [wallet.publicKey, signer.publicKey]);
  const { env, tables } = createEnv({
    signer: signer.publicKey,
    accounts: { [multisig]: account(goodAccount), [mint]: mintAccount(6) },
    txs: {},
    tokenAccounts: { [vaultAddress + '|' + mint]: ownedTokens(mint, 10_000_000, 6) },
  });
  const token = (await signJwt(SECRET, wallet.publicKey)).token;
  try {
    const created = await call(env, 'POST', '/api/projects', {
      name: 'Alpha', ticker: 'ALP', mint, plan: 'starter',
    }, token);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const project = created.data.project;
    const linked = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: vaultAddress, multisig, mint,
    }, token);
    assert.equal(linked.status, 200, JSON.stringify(linked.data));
    const draftId = crypto.randomUUID();
    tables.campaigns.push({
      id: draftId,
      project_id: project.id,
      title: 'Draft',
      type: 'raid',
      status: 'draft',
      reward_mode: 'pool',
      reward_unit: 'TOKEN',
      pool_size: '10000000',
      reward: '10000000',
      prize_raw: null,
      locked_raw: null,
      cut_bps: null,
      prize_mint: null,
    });
    tables.campaign_joins.push({
      id: crypto.randomUUID(),
      campaign_id: draftId,
      project_id: project.id,
      wallet: holder.publicKey,
      status: 'approved',
      qualified: true,
    });
    const proposed = await call(env, 'POST', '/api/settlements/propose', {
      projectId: project.id, campaignId: draftId,
    }, token);
    assert.equal(proposed.status, 409);
    assert.equal(proposed.data.error, 'campaign has no locked prize');
    assert.equal(tables.vault_settlements.length, 0);

    const settlementId = crypto.randomUUID();
    tables.vault_settlements.push({
      id: settlementId,
      project_id: project.id,
      campaign_id: draftId,
      status: 'proposed',
      payouts: [{ wallet: holder.publicKey, amount: '10000000', amountRaw: '10000000' }],
      payout_hash: 'draft-hash',
      tx_index: '1',
      vault_multisig: multisig,
      cut_waived: true,
    });
    const shown = await call(env, 'GET', '/api/settlements/' + settlementId + '/verify');
    assert.equal(shown.status, 200, JSON.stringify(shown.data));
    assert.equal(shown.data.matches, false);
    assert.equal(shown.data.reason, 'campaign_not_locked');
    const bard = await call(env, 'POST', '/api/vault/bard-sign', { settlementId });
    assert.equal(bard.status, 200, JSON.stringify(bard.data));
    assert.equal(bard.data.matches, false);
    assert.equal(bard.data.reason, 'campaign_not_locked');
  } finally {
    restore();
  }
});

test('a second propose fails and a second executed fails', async () => {
  const restore = installFetchGuard();
  try {
    const ready = await prepareLockedSettlement();
    const { env, tables, token, project, campaign, paySig, multisig } = ready;
    const again = await call(env, 'POST', '/api/settlements/propose', {
      projectId: project.id, campaignId: campaign.id,
    }, token);
    assert.equal(again.status, 409);
    assert.equal(again.data.error, 'campaign already has a settlement');
    assert.equal(tables.vault_settlements.length, 1);

    const paid = await call(env, 'POST', '/api/settlements/' + ready.settlement.id + '/executed', { signature: paySig }, token);
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    assert.equal(paid.data.settlement.status, 'executed');
    assert.equal(tables.campaigns[0].status, 'paid');

    const secondId = crypto.randomUUID();
    const otherSig = '8'.repeat(88);
    tables.vault_settlements.push({
      id: secondId,
      project_id: project.id,
      campaign_id: campaign.id,
      status: 'both_signed',
      payouts: tables.vault_settlements[0].payouts,
      payout_hash: tables.vault_settlements[0].payout_hash,
      total: tables.vault_settlements[0].total,
      unit: tables.vault_settlements[0].unit,
      tx_index: '9',
      vault_multisig: multisig,
      cut_raw: tables.vault_settlements[0].cut_raw,
      cut_wallet: tables.vault_settlements[0].cut_wallet,
      cut_waived: false,
      team_signed: true,
      bard_signed: true,
    });
    const second = await call(env, 'POST', '/api/settlements/' + secondId + '/executed', { signature: otherSig }, token);
    assert.equal(second.status, 409);
    assert.equal(second.data.error, 'campaign is already paid');
    assert.equal(tables.vault_settlements[1].status, 'both_signed');
    assert.equal(tables.vault_settlements[1].tx_signature || null, null);
    const shown = await call(env, 'GET', '/api/settlements/' + secondId + '/verify');
    assert.equal(shown.data.matches, false);
    assert.equal(shown.data.reason, 'campaign_already_paid');
    const bard = await call(env, 'POST', '/api/vault/bard-sign', { settlementId: secondId });
    assert.equal(bard.data.matches, false);
    assert.equal(bard.data.reason, 'campaign_already_paid');
  } finally {
    restore();
  }
});

test('a repeat executed re-runs the payout writes', async () => {
  const restore = installFetchGuard();
  try {
    const ready = await prepareLockedSettlement();
    const { env, tables, token, paySig, signer } = ready;
    const settlementId = ready.settlement.id;
    const snap = {
      projectRaw: tables.projects[0].vault_reserved_raw,
      projectReserved: tables.projects[0].vault_reserved,
      campaignRaw: tables.campaigns[0].vault_reserved_raw,
      campaignReserved: tables.campaigns[0].vault_reserved,
      reservation: tables.vault_reservations[0].status,
    };
    const paid = await call(env, 'POST', '/api/settlements/' + settlementId + '/executed', { signature: paySig }, token);
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    assert.equal(tables.vault_settlements[0].status, 'executed');
    assert.equal(tables.vault_settlements[0].tx_signature, paySig);
    assert.equal(tables.platform_claims.length, 1);
    assert.equal(tables.campaigns[0].status, 'paid');

    const signerToken = (await signJwt(SECRET, signer.publicKey)).token;
    tables.vault_settlements[0].status = 'both_signed';
    const resigned = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-signed', {}, token);
    assert.equal(resigned.status, 400);
    assert.match(resigned.data.error, /closed/);
    const bardSigned = await call(env, 'POST', '/api/settlements/' + settlementId + '/bard-signed', {}, signerToken);
    assert.equal(bardSigned.status, 400);
    assert.match(bardSigned.data.error, /closed/);
    assert.equal(tables.vault_settlements[0].status, 'both_signed');
    tables.vault_settlements[0].status = 'executed';

    tables.platform_claims.splice(0, tables.platform_claims.length);
    tables.campaign_joins[0].qualified = false;
    tables.projects[0].vault_reserved_raw = snap.projectRaw;
    tables.projects[0].vault_reserved = snap.projectReserved;
    tables.campaigns[0].status = 'active';
    tables.campaigns[0].vault_reserved_raw = snap.campaignRaw;
    tables.campaigns[0].vault_reserved = snap.campaignReserved;
    tables.vault_reservations[0].status = snap.reservation;

    const replay = await call(env, 'POST', '/api/settlements/' + settlementId + '/executed', { signature: paySig }, token);
    assert.equal(replay.status, 200, JSON.stringify(replay.data));
    assert.equal(replay.data.settlement.status, 'executed');
    assert.equal(replay.data.settlement.tx_signature, paySig);
    assert.equal(tables.vault_settlements.length, 1);
    assert.equal(tables.platform_claims.length, 1);
    assert.equal(tables.platform_claims[0].settled, true);
    assert.equal(tables.campaign_joins[0].qualified, true);
    assert.equal(tables.campaigns[0].status, 'paid');
    assert.equal(tables.campaigns[0].vault_reserved_raw, '0');
    assert.equal(tables.vault_reservations[0].status, 'settled');
    assert.equal(tables.projects[0].vault_reserved_raw, '0');
  } finally {
    restore();
  }
});

test('a bound vault transaction index cannot be pointed at a second payout', async () => {
  const restore = installFetchGuard();
  try {
    const ready = await prepareLockedSettlement();
    const { env, tables, accounts, token, project, settlement, multisig, signer } = ready;
    const settlementId = settlement.id;
    const before = structuredClone(tables.vault_settlements[0]);
    assert.equal(before.tx_index, '4');

    const teamMoved = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-signed', { txIndex: 6 }, token);
    assert.equal(teamMoved.status, 409, JSON.stringify(teamMoved.data));
    assert.equal(teamMoved.data.error, 'settlement is bound to vault transaction 4');
    assert.deepEqual(tables.vault_settlements[0], before);

    const signerToken = (await signJwt(SECRET, signer.publicKey)).token;
    const bardMoved = await call(env, 'POST', '/api/settlements/' + settlementId + '/bard-signed', { txIndex: '6' }, signerToken);
    assert.equal(bardMoved.status, 409, JSON.stringify(bardMoved.data));
    assert.equal(bardMoved.data.error, 'settlement is bound to vault transaction 4');
    assert.deepEqual(tables.vault_settlements[0], before);

    const txIndex = 4n;
    const proposalPda = await squadsProposalAddress(multisig, txIndex);
    accounts[proposalPda] = account(toBase64(proposalAccount(multisig, txIndex, [project.admin_wallet])));
    const teamSame = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-signed', { txIndex: '4' }, token);
    assert.equal(teamSame.status, 200, JSON.stringify(teamSame.data));
    assert.equal(teamSame.data.settlement.tx_index, '4');
    assert.equal(teamSame.data.settlement.team_signed, true);
    assert.equal(tables.vault_settlements[0].tx_index, '4');
    assert.equal(tables.vault_settlements[0].bard_signed, false);
  } finally {
    restore();
  }
});

test('a concurrent first write keeps the tx_index it stored', async () => {
  const restore = installFetchGuard();
  try {
    const ready = await prepareLockedSettlement();
    const { env, tables, accounts, token, project, settlement, multisig } = ready;
    const settlementId = settlement.id;
    const linked = tables.projects[0];
    tables.vault_settlements[0].tx_index = null;
    const txIndex = 6n;
    const transactionPda = await squadsTransactionAddress(multisig, txIndex);
    const proposalPda = await squadsProposalAddress(multisig, txIndex);
    const honest = await vaultAccountFor({
      multisig,
      vault: linked.vault_address,
      mint: linked.vault_mint || linked.mint,
      lines: [
        { wallet: settlement.payouts[0].wallet, amountRaw: settlement.payouts[0].amountRaw },
        { wallet: FEE_TREASURY, amountRaw: String(settlement.cut_raw) },
      ],
      creator: project.admin_wallet,
      index: txIndex,
      decimals: 6,
    });
    accounts[transactionPda] = account(toBase64(honest));
    accounts[proposalPda] = account(toBase64(proposalAccount(multisig, txIndex, [project.admin_wallet])));
    tables.afterSettlementRead = () => {
      tables.vault_settlements[0].tx_index = '4';
    };
    const raced = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-signed', { txIndex: 6 }, token);
    assert.equal(raced.status, 409, JSON.stringify(raced.data));
    assert.equal(raced.data.error, 'settlement changed while signing; reload and retry');
    assert.equal(tables.vault_settlements[0].tx_index, '4');
    assert.equal(tables.vault_settlements[0].team_signed, false);
  } finally {
    restore();
  }
});

test('a signature stored during signing refuses the sign write', async () => {
  const restore = installFetchGuard();
  try {
    const ready = await prepareLockedSettlement();
    const { env, tables, accounts, token, project, settlement, multisig } = ready;
    const settlementId = settlement.id;
    const txIndex = 4n;
    const proposalPda = await squadsProposalAddress(multisig, txIndex);
    accounts[proposalPda] = account(toBase64(proposalAccount(multisig, txIndex, [project.admin_wallet])));
    tables.afterSettlementRead = () => {
      tables.vault_settlements[0].tx_signature = 'race-signature';
      tables.vault_settlements[0].status = 'executed';
    };
    const raced = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-signed', { txIndex: '4' }, token);
    assert.equal(raced.status, 409, JSON.stringify(raced.data));
    assert.equal(raced.data.error, 'settlement changed while signing; reload and retry');
    assert.equal(tables.vault_settlements[0].status, 'executed');
    assert.equal(tables.vault_settlements[0].tx_signature, 'race-signature');
    assert.equal(tables.vault_settlements[0].tx_index, '4');
    assert.equal(tables.vault_settlements[0].team_signed, false);
  } finally {
    restore();
  }
});
