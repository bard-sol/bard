import assert from 'node:assert/strict';
import { test } from 'node:test';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { signJwt } from '../../server/auth.js';
import { handleRequest, verifyExecutedPayout } from '../../server/api.js';
import {
  FEE_TREASURY,
  SQUADS_PROGRAM,
  TOKEN_PROGRAM,
  associatedTokenAddress,
  decodeBase64,
  SQUADS_PERMISSION_EXECUTE,
  SQUADS_PERMISSION_VOTE,
  parseSquadsMultisig,
  sameMemberSet,
  squadsMultisigDiscriminator,
  squadsProposalAddress,
  squadsTransactionAddress,
  squadsVaultAddress,
} from '../../server/chain.js';
import { computePayouts } from '../../server/settlement.js';

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

async function craftMultisig(threshold, members, options = {}) {
  const disc = await squadsMultisigDiscriminator();
  const authority = options.configAuthority ? bs58.decode(options.configAuthority) : new Uint8Array(32);
  const defaultMask = options.permissions == null
    ? (SQUADS_PERMISSION_VOTE | SQUADS_PERMISSION_EXECUTE)
    : options.permissions;
  const parts = [
    disc,
    new Uint8Array(32),
    authority,
    leBytes(2, 'setUint16', threshold),
    leBytes(4, 'setUint32', 0),
    leBytes(8, 'setBigUint64', 0n),
    leBytes(8, 'setBigUint64', 0n),
    new Uint8Array([0]),
    new Uint8Array([1]),
    leBytes(4, 'setUint32', members.length),
  ];
  for (const member of members) {
    const key = typeof member === 'string' ? member : member.key;
    const mask = member && typeof member === 'object' && member.permissions != null
      ? member.permissions
      : defaultMask;
    parts.push(bs58.decode(key));
    parts.push(new Uint8Array([mask]));
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
        if (value.startsWith('not.in.')) {
          filters.push({ key, op: 'not.in', val: value.slice('not.in.'.length) });
          continue;
        }
        const dot = value.indexOf('.');
        filters.push({ key, op: value.slice(0, dot), val: value.slice(dot + 1) });
      }
      const matches = (row) => filters.every((filter) => {
        const got = row[filter.key] == null ? '' : String(row[filter.key]);
        if (filter.op === 'eq') return got === filter.val;
        if (filter.op === 'lt') return got < filter.val;
        if (filter.op === 'is' && filter.val === 'null') return row[filter.key] == null;
        if (filter.op === 'not.in') {
          const list = filter.val.replace(/^\(/, '').replace(/\)$/, '').split(',');
          return !list.includes(got);
        }
        return false;
      });
      if (opts.method === 'GET') return Response.json(rows.filter(matches));
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
        const updated = rows.filter(matches);
        if (table === 'vault_settlements' && body.tx_signature) {
          const ids = new Set(updated.map((row) => row.id));
          const clash = rows.some((row) => row.tx_signature === body.tx_signature && !ids.has(row.id));
          if (clash) return Response.json({ code: '23505', message: 'duplicate' }, { status: 409 });
        }
        updated.forEach((row) => Object.assign(row, body));
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
  const configMultisig = keypair().publicKey;
  const voteOnlyMultisig = keypair().publicKey;
  const executeOnlyMultisig = keypair().publicKey;
  const goodAccount = await craftMultisig(2, [walletA.publicKey, signer.publicKey]);
  const wrongMembers = await craftMultisig(2, [walletA.publicKey, other]);
  const lowThreshold = await craftMultisig(1, [walletA.publicKey, signer.publicKey]);
  const configAuthority = await craftMultisig(2, [walletA.publicKey, signer.publicKey], {
    configAuthority: walletA.publicKey,
  });
  const voteOnly = await craftMultisig(2, [walletA.publicKey, signer.publicKey], {
    permissions: SQUADS_PERMISSION_VOTE,
  });
  const executeOnly = await craftMultisig(2, [
    { key: walletA.publicKey, permissions: SQUADS_PERMISSION_VOTE | SQUADS_PERMISSION_EXECUTE },
    { key: signer.publicKey, permissions: SQUADS_PERMISSION_EXECUTE },
  ]);
  const parsedGood = await parseSquadsMultisig(decodeBase64(goodAccount));
  assert.equal(parsedGood.configAuthority, bs58.encode(new Uint8Array(32)));
  assert.deepEqual(parsedGood.members.map((member) => member.key), [walletA.publicKey, signer.publicKey]);
  assert.deepEqual(parsedGood.members.map((member) => member.permissions), [
    SQUADS_PERMISSION_VOTE | SQUADS_PERMISSION_EXECUTE,
    SQUADS_PERMISSION_VOTE | SQUADS_PERMISSION_EXECUTE,
  ]);
  assert.ok(sameMemberSet(parsedGood.members, [walletA.publicKey, signer.publicKey]));
  const parsedConfig = await parseSquadsMultisig(decodeBase64(configAuthority));
  assert.equal(parsedConfig.configAuthority, walletA.publicKey);
  const parsedVote = await parseSquadsMultisig(decodeBase64(voteOnly));
  assert.deepEqual(parsedVote.members.map((member) => member.permissions), [SQUADS_PERMISSION_VOTE, SQUADS_PERMISSION_VOTE]);
  const { env, tables, calls } = createEnv({
    signer: signer.publicKey,
    accounts: {
      [multisig]: account(goodAccount),
      [other]: account(wrongMembers),
      [walletB.publicKey]: account(lowThreshold),
      [configMultisig]: account(configAuthority),
      [voteOnlyMultisig]: account(voteOnly),
      [executeOnlyMultisig]: account(executeOnly),
    },
    txs: {
      [goodSig]: transferTx(walletA.publicKey, 1_000_000_000),
      [shortSig]: transferTx(walletA.publicKey, 1000),
      [wrongPayerSig]: transferTx(walletB.publicKey, 1_000_000_000),
      [deadSig]: { meta: { err: 'failed' }, transaction: { message: { instructions: [] } } },
      [campaignSig]: transferTx(walletA.publicKey, 250_000_000),
    },
  });
  const tokenA = (await signJwt(SECRET, walletA.publicKey)).token;
  const tokenB = (await signJwt(SECRET, walletB.publicKey)).token;
  try {
    const locked = [
      ['/api/projects', { name: 'Nope', ticker: 'NO', mint: mintA }],
      ['/api/campaigns', { projectId: 'x', title: 'T', rule: 'R', type: 'raid' }],
      ['/api/projects/x/plan', { plan: 'pro' }],
      ['/api/projects/x/vault', { address: vaultAddress, multisig }],
      ['/api/fees/confirm', { kind: 'starter', signature: goodSig }],
      ['/api/joins/status', { campaignId: 'c', wallet: holder.publicKey, status: 'approved' }],
      ['/api/joins/progress', { campaignId: 'c', wallet: holder.publicKey, progress: 1 }],
      ['/api/joins/qualify', { campaignId: 'c', wallet: holder.publicKey }],
      ['/api/claims', { campaignId: 'c', wallet: holder.publicKey }],
      ['/api/settlements/s/team-sign', {}],
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
    assert.equal(tables.projects.length, 0);

    const config = await handleRequest(new Request('http://127.0.0.1/api/config'), env);
    const configBody = await config.json();
    assert.equal(configBody.feesEnabled, false);
    assert.equal(configBody.bardSignerPubkey, signer.publicKey);
    assert.equal(configBody.feeTreasury, FEE_TREASURY);

    const created = await call(env, 'POST', '/api/projects', {
      name: 'Alpha', ticker: 'ALP', mint: mintA, plan: 'starter',
    }, tokenA);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const project = created.data.project;
    assert.equal(project.admin_wallet, walletA.publicKey);
    assert.equal(project.plan, 'starter');
    assert.equal(project.fee_paid, true);

    const bPlan = await call(env, 'POST', '/api/projects/' + project.id + '/plan', { plan: 'pro' }, tokenB);
    assert.equal(bPlan.status, 403);
    assert.equal(tables.projects[0].plan, 'starter');

    const raid = await call(env, 'POST', '/api/campaigns', {
      projectId: project.id, title: 'Raid', rule: 'reply', type: 'raid', rewardMode: 'fixed',
    }, tokenA);
    assert.equal(raid.status, 200, JSON.stringify(raid.data));
    assert.equal(raid.data.campaign.fee_paid, true);
    const premium = await call(env, 'POST', '/api/campaigns', {
      projectId: project.id, title: 'Hold', rule: 'hold', type: 'hold', rewardMode: 'fixed',
    }, tokenA);
    assert.equal(premium.status, 402);
    assert.equal(tables.campaigns.length, 1);

    const planned = await call(env, 'POST', '/api/projects/' + project.id + '/plan', { plan: 'pro' }, tokenA);
    assert.equal(planned.status, 200);
    assert.equal(planned.data.project.plan, 'pro');
    assert.equal(planned.data.project.fee_paid, true);

    const hold = await call(env, 'POST', '/api/campaigns', {
      projectId: project.id, title: 'Hold', rule: 'hold', type: 'hold', rewardMode: 'fixed',
    }, tokenA);
    assert.equal(hold.status, 200);
    const stolen = await call(env, 'POST', '/api/campaigns', {
      projectId: project.id, title: 'Stolen', rule: 'no', type: 'raid',
    }, tokenB);
    assert.equal(stolen.status, 403);
    assert.equal(tables.campaigns.length, 2);

    const own = await call(env, 'POST', '/api/projects', {
      name: 'Beta', ticker: 'BET', mint: mintB,
    }, tokenB);
    assert.equal(own.status, 200);
    const cross = await call(env, 'POST', '/api/projects/' + own.data.project.id + '/plan', { plan: 'pro' }, tokenA);
    assert.equal(cross.status, 403);
    assert.equal(tables.projects.find((row) => row.id === own.data.project.id).plan, 'starter');

    const fee = await call(env, 'POST', '/api/fees/confirm', {
      kind: 'starter', signature: goodSig, projectId: project.id,
    }, tokenA);
    assert.equal(fee.status, 200, JSON.stringify(fee.data));
    assert.equal(fee.data.fee.tx_signature, goodSig);
    assert.equal(tables.projects[0].plan, 'starter');
    assert.equal(tables.projects[0].fee_tx, goodSig);
    const shortPay = await call(env, 'POST', '/api/fees/confirm', {
      kind: 'starter', signature: shortSig, projectId: project.id,
    }, tokenA);
    assert.equal(shortPay.status, 400);
    assert.match(shortPay.data.error, /below the plan price/);
    const wrongPayer = await call(env, 'POST', '/api/fees/confirm', {
      kind: 'starter', signature: wrongPayerSig, projectId: project.id,
    }, tokenA);
    assert.equal(wrongPayer.status, 400);
    const unconfirmed = await call(env, 'POST', '/api/fees/confirm', {
      kind: 'starter', signature: deadSig, projectId: project.id,
    }, tokenA);
    assert.equal(unconfirmed.status, 400);
    assert.match(unconfirmed.data.error, /not confirmed/);
    const reuse = await call(env, 'POST', '/api/fees/confirm', {
      kind: 'starter', signature: goodSig, projectId: project.id,
    }, tokenA);
    assert.equal(reuse.status, 400);
    assert.match(reuse.data.error, /already used/);
    assert.equal(tables.fee_payments.length, 1);
    const bFee = await call(env, 'POST', '/api/fees/confirm', {
      kind: 'starter', signature: '5'.repeat(87), projectId: project.id,
    }, tokenB);
    assert.equal(bFee.status, 403);

    tables.campaigns[0].fee_paid = false;
    tables.campaigns[0].fee_tx = null;
    const omitted = await call(env, 'POST', '/api/fees/confirm', {
      kind: 'campaign', signature: campaignSig, campaignId: raid.data.campaign.id,
    }, tokenB);
    assert.equal(omitted.status, 403);
    assert.equal(tables.campaigns[0].fee_paid, false);
    assert.equal(tables.fee_payments.length, 1);
    const otherProject = await call(env, 'POST', '/api/fees/confirm', {
      kind: 'campaign',
      signature: campaignSig,
      campaignId: raid.data.campaign.id,
      projectId: own.data.project.id,
    }, tokenB);
    assert.equal(otherProject.status, 403);
    assert.equal(tables.campaigns[0].fee_paid, false);
    const campaignFee = await call(env, 'POST', '/api/fees/confirm', {
      kind: 'campaign', signature: campaignSig, campaignId: raid.data.campaign.id,
    }, tokenA);
    assert.equal(campaignFee.status, 200, JSON.stringify(campaignFee.data));
    assert.equal(tables.campaigns[0].fee_paid, true);
    assert.equal(tables.campaigns[0].fee_tx, campaignSig);
    assert.equal(campaignFee.data.fee.project_id, project.id);

    const configVault = await squadsVaultAddress(configMultisig);
    const configLink = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: configVault, multisig: configMultisig, mint: mintA,
    }, tokenA);
    assert.equal(configLink.status, 400, JSON.stringify(configLink.data));
    assert.equal(configLink.data.error, 'vault config authority must be unset');
    const voteVault = await squadsVaultAddress(voteOnlyMultisig);
    const voteLink = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: voteVault, multisig: voteOnlyMultisig, mint: mintA,
    }, tokenA);
    assert.equal(voteLink.status, 400, JSON.stringify(voteLink.data));
    assert.equal(voteLink.data.error, 'vault members must be able to vote and execute');
    const executeVault = await squadsVaultAddress(executeOnlyMultisig);
    const executeLink = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: executeVault, multisig: executeOnlyMultisig, mint: mintA,
    }, tokenA);
    assert.equal(executeLink.status, 400, JSON.stringify(executeLink.data));
    assert.equal(executeLink.data.error, 'vault members must be able to vote and execute');
    assert.equal(tables.projects.find((row) => row.id === project.id).vault_multisig || null, null);

    const linked = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: vaultAddress, multisig, mint: mintA,
    }, tokenA);
    assert.equal(linked.status, 200, JSON.stringify(linked.data));
    assert.equal(linked.data.project.vault_status, 'linked');
    assert.equal(linked.data.project.vault_multisig, multisig);
    assert.equal(linked.data.project.vault_address, vaultAddress);
    const projectRow = () => tables.projects.find((row) => row.id === project.id);
    const savedReserved = projectRow().vault_reserved;
    projectRow().vault_reserved = '0.5';
    const reservedLink = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: vaultAddress, multisig, mint: mintA,
    }, tokenA);
    assert.equal(reservedLink.status, 400, JSON.stringify(reservedLink.data));
    assert.equal(reservedLink.data.error, 'vault cannot be re-linked while funds are reserved');
    assert.equal(projectRow().vault_address, vaultAddress);
    projectRow().vault_reserved = savedReserved;
    const openSettlement = {
      id: crypto.randomUUID(),
      project_id: project.id,
      status: 'proposed',
    };
    tables.vault_settlements.push(openSettlement);
    const openLink = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: vaultAddress, multisig, mint: mintA,
    }, tokenA);
    assert.equal(openLink.status, 400, JSON.stringify(openLink.data));
    assert.equal(openLink.data.error, 'vault cannot be re-linked while a settlement is open');
    openSettlement.status = 'both_signed';
    const bothOpen = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: vaultAddress, multisig, mint: mintA,
    }, tokenA);
    assert.equal(bothOpen.status, 400);
    assert.equal(bothOpen.data.error, 'vault cannot be re-linked while a settlement is open');
    openSettlement.status = 'executed';
    const executedLink = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: vaultAddress, multisig, mint: mintA,
    }, tokenA);
    assert.equal(executedLink.status, 200, JSON.stringify(executedLink.data));
    openSettlement.status = 'cancelled';
    const cancelledLink = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: vaultAddress, multisig, mint: mintA,
    }, tokenA);
    assert.equal(cancelledLink.status, 200, JSON.stringify(cancelledLink.data));
    tables.vault_settlements.splice(tables.vault_settlements.indexOf(openSettlement), 1);
    assert.equal(projectRow().vault_multisig, multisig);
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

    const bClaim = await call(env, 'POST', '/api/claims', {
      campaignId: raid.data.campaign.id, wallet: holder.publicKey, amount: '1',
    }, tokenB);
    assert.equal(bClaim.status, 403);
    assert.equal(tables.platform_claims.length, 0);
    const claim = await call(env, 'POST', '/api/claims', {
      campaignId: raid.data.campaign.id, wallet: holder.publicKey, amount: '1', unit: 'SOL',
    }, tokenA);
    assert.equal(claim.status, 200, JSON.stringify(claim.data));
    assert.equal(claim.data.claim.wallet, holder.publicKey);
    assert.equal(claim.data.claim.project_id, project.id);
    assert.equal(claim.data.claim.settled, true);

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
    const badIndex = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-sign', { sig: 'sig', txIndex: '4a' }, tokenA);
    assert.equal(badIndex.status, 400, JSON.stringify(badIndex.data));
    assert.equal(badIndex.data.error, 'invalid tx index');
    const blankIndex = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-sign', { sig: 'sig', txIndex: '' }, tokenA);
    assert.equal(blankIndex.status, 400);
    assert.equal(blankIndex.data.error, 'invalid tx index');
    const spacedIndex = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-sign', { sig: 'sig', txIndex: '4 ' }, tokenA);
    assert.equal(spacedIndex.status, 400);
    assert.equal(tables.vault_settlements[0].team_signed, false);
    const team = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-sign', { sig: 'sig', multisig: other, txIndex: 4 }, tokenA);
    assert.equal(team.status, 200, JSON.stringify(team.data));
    assert.equal(team.data.settlement.team_signed, true);
    assert.equal(team.data.settlement.status, 'awaiting_bard');
    assert.equal(team.data.settlement.tx_index, '4');
    assert.equal(team.data.settlement.cosigned_wallet, walletA.publicKey);
    assert.equal(team.data.settlement.vault_multisig, multisig);
    tables.vault_settlements[0].bard_signed = true;
    const both = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-sign', { sig: 'sig2' }, tokenA);
    assert.equal(both.status, 200);
    assert.equal(both.data.settlement.status, 'both_signed');
    tables.vault_settlements[0].status = 'executed';
    const closed = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-sign', { sig: 'sig3' }, tokenA);
    assert.equal(closed.status, 400);
    assert.match(closed.data.error, /closed/);
    const bard = await call(env, 'POST', '/api/vault/bard-sign', { settlementId });
    assert.equal(bard.status, 400, JSON.stringify(bard.data));
    assert.equal(bard.data.reason, 'vault transaction is missing');
    assert.equal(tables.vault_settlements[0].bard_signed, true);
    tables.vault_settlements[0].tx_index = null;
    const bardWithoutTx = await call(env, 'POST', '/api/vault/bard-sign', { settlementId });
    assert.equal(bardWithoutTx.status, 400, JSON.stringify(bardWithoutTx.data));
    assert.equal(bardWithoutTx.data.reason, 'settlement has no vault transaction');
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
  const secondSource = keypair().publicKey;
  const goodAccount = await craftMultisig(2, [walletA.publicKey, signer.publicKey]);
  const chain = {
    slot: 1000,
    blocks: {
      1150: { error: { code: -32007, message: 'Slot 1150 was skipped' } },
      1151: { blockhash: 'SeedHashFromNextSlot' },
    },
  };
  const { env, tables } = createEnv({
    signer: signer.publicKey,
    accounts: {
      [multisig]: account(goodAccount),
      [mint]: mintAccount(6),
    },
    txs: {},
    tokenAccounts: {
      [vaultAddress + '|' + mint]: ownedTokens(mint, 10_000_000, 6),
    },
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
    const raid = await call(env, 'POST', '/api/campaigns', {
      projectId: project.id, title: 'Raid', rule: 'reply', type: 'raid', rewardMode: 'fixed', reward: '2', unit: 'TOKEN',
    }, tokenA);
    assert.equal(raid.status, 200, JSON.stringify(raid.data));
    const campaign = raid.data.campaign;

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
    assert.equal(tables.vault_reservations.length, 0);

    const linked = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: vaultAddress, multisig, mint,
    }, tokenA);
    assert.equal(linked.status, 200, JSON.stringify(linked.data));

    const tooMuch = await call(env, 'POST', '/api/vault/reserve', {
      projectId: project.id, campaignId: campaign.id, amount: '100',
    }, tokenA);
    assert.equal(tooMuch.status, 400);
    assert.match(tooMuch.data.error, /exceeds vault token balance/);
    const reserved = await call(env, 'POST', '/api/vault/reserve', {
      projectId: project.id, campaignId: campaign.id, amount: '3',
    }, tokenA);
    assert.equal(reserved.status, 200, JSON.stringify(reserved.data));
    assert.equal(tables.projects[0].vault_reserved, '3');
    assert.equal(tables.campaigns[0].vault_reserved, '3');
    assert.equal(tables.vault_reservations.length, 1);
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
      reward_mode: 'fixed', reward: '2', reward_unit: 'TOKEN', vault_reserved: '3',
    }, tables.campaign_joins, 6);
    const proposed = await call(env, 'POST', '/api/settlements/propose', {
      projectId: project.id,
      campaignId: campaign.id,
      payouts: [{ wallet: stranger.publicKey, amount: '99', amountRaw: '99' }],
      payout_hash: 'client-hash',
    }, tokenA);
    assert.equal(proposed.status, 200, JSON.stringify(proposed.data));
    assert.equal(proposed.data.settlement.payout_hash, expected.hash);
    assert.notEqual(proposed.data.settlement.payout_hash, 'client-hash');
    assert.deepEqual(proposed.data.settlement.payouts.map((row) => row.wallet), [holder.publicKey]);
    assert.equal(tables.vault_settlements[0].payout_hash, expected.hash);

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
    const tokenBalance = (accountIndex, owner, amount) => ({
      accountIndex,
      mint,
      owner,
      uiTokenAmount: { amount: String(amount), decimals: 6 },
    });
    const payoutTx = {
      meta: {
        err: null,
        logMessages: ['Program log: Instruction: VaultTransactionExecute'],
        innerInstructions: [],
        preTokenBalances: [
          tokenBalance(4, vaultAddress, '10000000'),
          tokenBalance(6, vaultAddress, '10000000'),
        ],
        postTokenBalances: [
          tokenBalance(4, vaultAddress, '8000000'),
          tokenBalance(5, holder.publicKey, expected.payouts[0].amountRaw),
          tokenBalance(6, vaultAddress, '10000000'),
        ],
      },
      transaction: {
        message: {
          accountKeys: [SQUADS_PROGRAM, multisig, transactionPda, proposalPda, vaultAta, holderAta, secondSource]
            .map((pubkey) => ({ pubkey })),
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
          }],
        },
      },
    };
    let shownTx = payoutTx;
    const servedSigs = new Set([paySig]);
    let injectDup = false;
    let closeRace = false;
    let wroteAfterEmpty = false;
    let sawEmptyPatch = false;
    let bookkeepingWrites = 0;
    let armCrashAfterClaim = false;
    let throwNextWrite = false;
    const originalFetch = env.fetch;
    env.fetch = async (url, opts = {}) => {
      const u = new URL(url);
      if (u.hostname === 'rpc.test') {
        const payload = JSON.parse(opts.body);
        if (payload.method === 'getTransaction') {
          const sig = payload.params[0];
          return Response.json({ jsonrpc: '2.0', id: 1, result: servedSigs.has(sig) ? shownTx : null });
        }
      }
      if (injectDup && opts.method === 'GET' && u.pathname.endsWith('/vault_settlements') && u.search.includes('tx_signature=eq.')) {
        const res = await originalFetch(url, opts);
        tables.vault_settlements.push({
          id: crypto.randomUUID(),
          project_id: project.id,
          campaign_id: campaign.id,
          tx_signature: new URL(url).searchParams.get('tx_signature').slice('eq.'.length),
          status: 'executed',
        });
        injectDup = false;
        return res;
      }
      if (closeRace && opts.method === 'PATCH' && u.pathname.endsWith('/vault_settlements') && u.search.includes('not.in')) {
        const row = tables.vault_settlements.find((item) => item.id === closeRace);
        if (row) row.status = 'cancelled';
        closeRace = false;
        sawEmptyPatch = true;
      }
      if (throwNextWrite && opts.method && opts.method !== 'GET') {
        throwNextWrite = false;
        throw new Error('crash between claim and close');
      }
      const res = await originalFetch(url, opts);
      if (armCrashAfterClaim && opts.method === 'PATCH' && u.pathname.endsWith('/vault_settlements') && u.search.includes('is.null')) {
        armCrashAfterClaim = false;
        throwNextWrite = true;
      }
      if (opts.method === 'POST' && u.pathname.endsWith('/platform_claims')) bookkeepingWrites += 1;
      if (opts.method === 'PATCH' && (
        u.pathname.endsWith('/vault_reservations')
        || u.pathname.endsWith('/projects')
        || u.pathname.endsWith('/campaign_joins')
      )) bookkeepingWrites += 1;
      if (sawEmptyPatch && opts.method && opts.method !== 'GET' && !(u.pathname.endsWith('/vault_settlements') && u.search.includes('not.in'))) {
        wroteAfterEmpty = true;
      }
      return res;
    };

    const refuseExecute = async (tx) => {
      shownTx = tx;
      const res = await call(env, 'POST', '/api/settlements/' + settlementId + '/execute', { signature: paySig }, tokenA);
      assert.equal(res.status, 400, JSON.stringify(res.data));
      assert.equal(tables.vault_settlements[0].status, 'proposed');
      assert.equal(tables.platform_claims.length, 0);
      assert.equal(tables.vault_reservations[0].status, 'reserved');
      assert.equal(String(tables.projects[0].vault_reserved), '3');
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
    for (const field of ['source', 'destination']) {
      const tx = clonePayout();
      delete tx.transaction.message.instructions[0].parsed.info[field];
      await refuseExecute(tx);
    }
    const strangerAta = await associatedTokenAddress(stranger.publicKey, mint, TOKEN_PROGRAM);
    const plainExtra = clonePayout();
    plainExtra.transaction.message.instructions.push({
      program: 'spl-token',
      programId: TOKEN_PROGRAM,
      parsed: {
        type: 'transfer',
        info: {
          source: vaultAta,
          destination: strangerAta,
          authority: vaultAddress,
          amount: '1',
        },
      },
    });
    const refusedPlain = await refuseExecute(plainExtra);
    assert.match(refusedPlain.data.error, /unexpected/);
    const secondExtra = clonePayout();
    secondExtra.transaction.message.instructions.push({
      program: 'spl-token',
      programId: TOKEN_PROGRAM,
      parsed: {
        type: 'transferChecked',
        info: {
          source: secondSource,
          destination: strangerAta,
          mint,
          authority: vaultAddress,
          tokenAmount: { amount: '1', decimals: 6 },
        },
      },
    });
    const refusedSecond = await refuseExecute(secondExtra);
    assert.match(refusedSecond.data.error, /unexpected/);
    const plainSecond = clonePayout();
    plainSecond.transaction.message.instructions.push({
      program: 'spl-token',
      programId: TOKEN_PROGRAM,
      parsed: {
        type: 'transfer',
        info: {
          source: secondSource,
          destination: strangerAta,
          authority: vaultAddress,
          amount: '1',
        },
      },
    });
    const refusedPlainSecond = await refuseExecute(plainSecond);
    assert.match(refusedPlainSecond.data.error, /unexpected/);
    const extraFromSecond = () => ({
      program: 'spl-token',
      programId: TOKEN_PROGRAM,
      parsed: {
        type: 'transferChecked',
        info: {
          source: secondSource,
          destination: strangerAta,
          mint,
          authority: vaultAddress,
          tokenAmount: { amount: '1', decimals: 6 },
        },
      },
    });
    const closedSource = clonePayout();
    closedSource.transaction.message.instructions.push(extraFromSecond());
    closedSource.meta.postTokenBalances = closedSource.meta.postTokenBalances.filter((entry) => entry.accountIndex !== 6);
    const refusedClosed = await refuseExecute(closedSource);
    assert.match(refusedClosed.data.error, /owner changed/);
    const reownedSource = clonePayout();
    reownedSource.transaction.message.instructions.push(extraFromSecond());
    reownedSource.meta.postTokenBalances.find((entry) => entry.accountIndex === 6).owner = stranger.publicKey;
    const refusedReowned = await refuseExecute(reownedSource);
    assert.match(refusedReowned.data.error, /owner changed/);
    const reownedAta = clonePayout();
    reownedAta.meta.postTokenBalances.find((entry) => entry.accountIndex === 4).owner = stranger.publicKey;
    const refusedAta = await refuseExecute(reownedAta);
    assert.match(refusedAta.data.error, /owner changed/);
    const missingPre = clonePayout();
    delete missingPre.meta.preTokenBalances;
    const refusedMissingPre = await refuseExecute(missingPre);
    assert.match(refusedMissingPre.data.error, /pre-token balances/);
    const strangerSource = keypair().publicKey;
    const unrelated = clonePayout();
    unrelated.transaction.message.instructions.push({
      program: 'spl-token',
      programId: TOKEN_PROGRAM,
      parsed: {
        type: 'transferChecked',
        info: {
          source: strangerSource,
          destination: strangerAta,
          mint,
          authority: stranger.publicKey,
          tokenAmount: { amount: '1', decimals: 6 },
        },
      },
    });
    shownTx = unrelated;
    const payoutFetch = env.fetch;
    let strangerLookups = 0;
    env.fetch = async (url, opts = {}) => {
      const u = new URL(url);
      if (u.hostname === 'rpc.test') {
        const payload = JSON.parse(opts.body);
        if (payload.method === 'getAccountInfo' && payload.params[0] === strangerSource) strangerLookups += 1;
      }
      return payoutFetch(url, opts);
    };
    await verifyExecutedPayout(env, tables.vault_settlements[0], tables.projects[0], paySig);
    assert.equal(strangerLookups, 0);
    env.fetch = payoutFetch;
    shownTx = payoutTx;
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

    const paid = await call(env, 'POST', '/api/settlements/' + settlementId + '/execute', { signature: paySig }, tokenA);
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    assert.equal(paid.data.settlement.status, 'executed');
    assert.equal(paid.data.settlement.tx_signature, paySig);
    assert.equal(tables.campaign_joins[0].qualified, true);
    assert.equal(tables.platform_claims.length, 1);
    assert.equal(tables.platform_claims[0].wallet, holder.publicKey);
    assert.equal(tables.platform_claims[0].settled, true);
    assert.equal(tables.vault_reservations[0].status, 'settled');
    assert.equal(tables.projects[0].vault_reserved, '1');
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

    const stageSettlement = () => {
      const source = tables.vault_settlements[0];
      const id = crypto.randomUUID();
      tables.vault_settlements.push({
        id,
        project_id: source.project_id,
        campaign_id: source.campaign_id,
        payouts: source.payouts,
        total: source.total,
        unit: source.unit,
        payout_hash: source.payout_hash,
        status: 'proposed',
        tx_index: source.tx_index,
        vault_multisig: source.vault_multisig,
      });
      return id;
    };
    const raceSig = '7'.repeat(88);
    const closedSig = '8'.repeat(88);
    const crashSig = '9'.repeat(88);
    servedSigs.add(raceSig);
    servedSigs.add(closedSig);
    servedSigs.add(crashSig);
    shownTx = payoutTx;
    const dupId = stageSettlement();
    injectDup = true;
    const writesBeforeDup = bookkeepingWrites;
    const reservedBeforeDup = String(tables.projects[0].vault_reserved);
    const claimsBeforeDup = JSON.stringify(tables.platform_claims);
    const reservationBeforeDup = tables.vault_reservations[0].status;
    const dup = await call(env, 'POST', '/api/settlements/' + dupId + '/execute', { signature: raceSig }, tokenA);
    assert.equal(dup.status, 400, JSON.stringify(dup.data));
    assert.equal(dup.data.error, 'signature already used');
    const dupRow = tables.vault_settlements.find((row) => row.id === dupId);
    assert.equal(dupRow.status, 'proposed');
    assert.equal(dupRow.tx_signature || null, null);
    assert.equal(bookkeepingWrites, writesBeforeDup);
    assert.equal(String(tables.projects[0].vault_reserved), reservedBeforeDup);
    assert.equal(JSON.stringify(tables.platform_claims), claimsBeforeDup);
    assert.equal(tables.vault_reservations[0].status, reservationBeforeDup);
    const closedId = stageSettlement();
    closeRace = closedId;
    wroteAfterEmpty = false;
    sawEmptyPatch = false;
    const writesBeforeClose = bookkeepingWrites;
    const reservedBeforeClose = String(tables.projects[0].vault_reserved);
    const claimsBeforeClose = JSON.stringify(tables.platform_claims);
    const reservationBeforeClose = tables.vault_reservations[0].status;
    const lost = await call(env, 'POST', '/api/settlements/' + closedId + '/execute', { signature: closedSig }, tokenA);
    assert.equal(lost.status, 400, JSON.stringify(lost.data));
    assert.equal(lost.data.error, 'settlement is closed');
    assert.equal(wroteAfterEmpty, false);
    const closedRow = tables.vault_settlements.find((row) => row.id === closedId);
    assert.equal(closedRow.status, 'cancelled');
    assert.equal(closedRow.tx_signature || null, null);
    assert.equal(bookkeepingWrites, writesBeforeClose);
    assert.equal(String(tables.projects[0].vault_reserved), reservedBeforeClose);
    assert.equal(JSON.stringify(tables.platform_claims), claimsBeforeClose);
    assert.equal(tables.vault_reservations[0].status, reservationBeforeClose);
    const crashId = stageSettlement();
    const writesBeforeCrash = bookkeepingWrites;
    const reservedBeforeCrash = String(tables.projects[0].vault_reserved);
    const claimsBeforeCrash = JSON.stringify(tables.platform_claims);
    const reservationBeforeCrash = tables.vault_reservations[0].status;
    armCrashAfterClaim = true;
    const crashed = await call(env, 'POST', '/api/settlements/' + crashId + '/execute', { signature: crashSig }, tokenA);
    assert.equal(crashed.status, 500, JSON.stringify(crashed.data));
    assert.match(crashed.data.error, /crash between claim and close/);
    const crashRow = tables.vault_settlements.find((row) => row.id === crashId);
    assert.equal(crashRow.status, 'proposed');
    assert.equal(crashRow.tx_signature, crashSig);
    assert.equal(bookkeepingWrites, writesBeforeCrash);
    assert.equal(String(tables.projects[0].vault_reserved), reservedBeforeCrash);
    assert.equal(JSON.stringify(tables.platform_claims), claimsBeforeCrash);
    assert.equal(tables.vault_reservations[0].status, reservationBeforeCrash);
    const recovered = await call(env, 'POST', '/api/settlements/' + crashId + '/execute', { signature: crashSig }, tokenA);
    assert.equal(recovered.status, 200, JSON.stringify(recovered.data));
    assert.equal(recovered.data.settlement.status, 'executed');
    assert.equal(recovered.data.settlement.tx_signature, crashSig);
    assert.equal(bookkeepingWrites, writesBeforeCrash + 4);
    const reservedAfterRecovery = String(tables.projects[0].vault_reserved);
    assert.notEqual(reservedAfterRecovery, reservedBeforeCrash);
    const replay = await call(env, 'POST', '/api/settlements/' + crashId + '/execute', { signature: crashSig }, tokenA);
    assert.equal(replay.status, 200, JSON.stringify(replay.data));
    assert.equal(replay.data.settlement.status, 'executed');
    assert.equal(bookkeepingWrites, writesBeforeCrash + 4);
    assert.equal(String(tables.projects[0].vault_reserved), reservedAfterRecovery);
  } finally {
    restore();
  }
});
