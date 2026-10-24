import assert from 'node:assert/strict';
import { test } from 'node:test';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { signJwt } from '../../server/auth.js';
import { handleRequest } from '../../server/api.js';
import {
  FEE_TREASURY,
  SQUADS_PROGRAM,
  decodeBase64,
  parseSquadsMultisig,
  sameMemberSet,
  squadsMultisigDiscriminator,
} from '../../server/chain.js';

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

function createEnv({ signer, accounts, txs }) {
  const tables = {
    projects: [],
    campaigns: [],
    campaign_joins: [],
    platform_claims: [],
    fee_payments: [],
    vault_settlements: [],
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
        return Response.json({ jsonrpc: '2.0', id: 1, error: { message: 'unknown rpc' } });
      }
      const table = u.pathname.replace(/^\/rest\/v1\//, '');
      const rows = tables[table];
      if (!rows) return Response.json({ message: 'missing ' + table }, { status: 500 });
      const filters = [];
      for (const [key, value] of u.searchParams) {
        if (key === 'select') continue;
        const dot = value.indexOf('.');
        filters.push({ key, op: value.slice(0, dot), val: value.slice(dot + 1) });
      }
      const matches = (row) => filters.every((filter) => {
        const got = row[filter.key] == null ? '' : String(row[filter.key]);
        if (filter.op === 'eq') return got === filter.val;
        if (filter.op === 'lt') return got < filter.val;
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
  const vaultAddress = keypair().publicKey;
  const multisig = keypair().publicKey;
  const other = keypair().publicKey;
  const mintA = keypair().publicKey;
  const mintB = keypair().publicKey;
  const goodSig = '1'.repeat(87);
  const shortSig = '2'.repeat(87);
  const wrongPayerSig = '3'.repeat(87);
  const deadSig = '4'.repeat(87);
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
    },
    txs: {
      [goodSig]: transferTx(walletA.publicKey, 1_000_000_000),
      [shortSig]: transferTx(walletA.publicKey, 1000),
      [wrongPayerSig]: transferTx(walletB.publicKey, 1_000_000_000),
      [deadSig]: { meta: { err: 'failed' }, transaction: { message: { instructions: [] } } },
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

    const linked = await call(env, 'POST', '/api/projects/' + project.id + '/vault', {
      address: vaultAddress, multisig, mint: mintA,
    }, tokenA);
    assert.equal(linked.status, 200, JSON.stringify(linked.data));
    assert.equal(linked.data.project.vault_status, 'linked');
    assert.equal(linked.data.project.vault_multisig, multisig);
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
      vault_multisig: multisig,
    });
    const bSign = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-sign', { sig: 'sig' }, tokenB);
    assert.equal(bSign.status, 403);
    assert.equal(tables.vault_settlements[0].team_signed, false);
    const team = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-sign', { sig: 'sig' }, tokenA);
    assert.equal(team.status, 200, JSON.stringify(team.data));
    assert.equal(team.data.settlement.team_signed, true);
    assert.equal(team.data.settlement.status, 'awaiting_bard');
    assert.equal(team.data.settlement.cosigned_wallet, walletA.publicKey);
    tables.vault_settlements[0].bard_signed = true;
    const both = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-sign', { sig: 'sig2' }, tokenA);
    assert.equal(both.status, 200);
    assert.equal(both.data.settlement.status, 'both_signed');
    tables.vault_settlements[0].status = 'executed';
    const closed = await call(env, 'POST', '/api/settlements/' + settlementId + '/team-sign', { sig: 'sig3' }, tokenA);
    assert.equal(closed.status, 400);
    assert.match(closed.data.error, /closed/);
    const bard = await call(env, 'POST', '/api/vault/bard-sign', { settlementId });
    assert.equal(bard.status, 200);
    assert.equal(bard.data.ok, false);
    assert.equal(bard.data.waiting, true);
    assert.equal(tables.vault_settlements[0].bard_signed, true);
    assert.equal(calls.some((line) => /supabase\.co|mainnet|publicnode/.test(line)), false);
  } finally {
    restore();
  }
});
