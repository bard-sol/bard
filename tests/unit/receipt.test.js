import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { encodeVaultTransactionAccount } from '../../server/approve.js';
import { handleRequest } from '../../server/api.js';
import { shortWallet } from '../../server/campaign_state.js';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  SQUADS_PROGRAM,
  TOKEN_PROGRAM,
  associatedTokenAddress,
  squadsTransactionAddress,
  squadsVaultAddress,
} from '../../server/chain.js';
import { canonicalPayoutText, settlementLines, sha256Hex } from '../../server/settlement.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CID = '11111111-1111-4111-8111-111111111111';
const PID = '22222222-2222-4222-8222-222222222222';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const CHAIN_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;

function keypair() {
  const pair = nacl.sign.keyPair();
  return { publicKey: bs58.encode(pair.publicKey) };
}

function chainSig() {
  for (let i = 0; i < 30; i++) {
    const sig = bs58.encode(nacl.randomBytes(64));
    if (CHAIN_SIGNATURE.test(sig)) return sig;
  }
  throw new Error('could not mint a chain signature');
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function compile(payer, instructions) {
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

function createAta(payer, ata, owner, mint, tokenProgram) {
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

function transferChecked(source, mint, destination, owner, amount, decimals, tokenProgram) {
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

function filterRows(rows, params) {
  let out = rows.slice();
  for (const [key, value] of params) {
    if (key === 'select' || key === 'order') continue;
    if (value.startsWith('eq.')) {
      const expected = value.slice(3);
      out = out.filter((row) => String(row[key]) === expected);
    } else if (value.startsWith('in.(') && value.endsWith(')')) {
      const parts = value.slice(4, -1).split(',').map((part) => part.trim().replace(/^"|"$/g, ''));
      out = out.filter((row) => parts.includes(String(row[key])));
    }
  }
  return out;
}

function createWorld() {
  const paths = [];
  const rpcCalls = [];
  const tables = {
    vault_settlements: [],
    campaigns: [],
    projects: [],
    holders: [],
    platform_claims: [],
  };
  const accounts = {};
  const tx = { current: null };
  const store = new Map();
  const env = {
    SUPABASE_URL: 'https://db.example',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    SOLANA_RPC: 'https://rpc.example/devnet',
    caches: {
      default: {
        async match(req) {
          const hit = store.get(req.url);
          if (!hit) return undefined;
          return new Response(hit.body, { status: hit.status, headers: hit.headers });
        },
        async put(req, res) {
          const headers = {};
          res.headers.forEach((value, key) => { headers[key] = value; });
          store.set(req.url, { body: await res.text(), status: res.status, headers });
        },
      },
    },
    async fetch(url, opts = {}) {
      const u = new URL(String(url));
      if (u.origin === 'https://db.example') {
        const rel = u.pathname + u.search;
        paths.push(rel);
        if (rel.includes('platform_claims')) throw new Error('receipt fetched platform_claims');
        const name = u.pathname.split('/').filter(Boolean).pop();
        if (!Object.prototype.hasOwnProperty.call(tables, name)) {
          return new Response(JSON.stringify({ message: 'missing table' }), { status: 404 });
        }
        return new Response(JSON.stringify(filterRows(tables[name], u.searchParams)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url) === env.SOLANA_RPC) {
        const body = JSON.parse(opts.body);
        rpcCalls.push(body);
        if (body.method === 'getAccountInfo') {
          const acc = accounts[body.params[0]];
          const value = acc ? { owner: acc.owner, data: [toBase64(acc.data), 'base64'] } : null;
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (body.method === 'getTransaction') {
          return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: tx.current }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error('unexpected rpc ' + body.method);
      }
      throw new Error('unexpected fetch ' + url);
    },
  };
  return { env, tables, accounts, paths, rpcCalls, tx, store };
}

async function installVault(world, spec) {
  const ordered = spec.lines.slice().sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  const vaultAta = await associatedTokenAddress(spec.vault, spec.mint, TOKEN_PROGRAM);
  const instructions = [createAta(spec.vault, vaultAta, spec.vault, spec.mint, TOKEN_PROGRAM)];
  for (const line of ordered) {
    const ata = await associatedTokenAddress(line.wallet, spec.mint, TOKEN_PROGRAM);
    instructions.push(createAta(spec.vault, ata, line.wallet, spec.mint, TOKEN_PROGRAM));
    instructions.push(transferChecked(vaultAta, spec.mint, ata, spec.vault, line.amountRaw, spec.decimals, TOKEN_PROGRAM));
  }
  const message = compile(spec.vault, instructions);
  const bytes = encodeVaultTransactionAccount({
    multisig: spec.multisig,
    creator: spec.creator,
    index: spec.index,
    bump: 3,
    vaultIndex: 0,
    vaultBump: 4,
    ephemeralSignerBumps: new Uint8Array(),
    ...message,
  });
  const txAddress = await squadsTransactionAddress(spec.multisig, spec.index);
  world.accounts[txAddress] = { owner: SQUADS_PROGRAM, data: bytes };
  const mintData = new Uint8Array(82);
  mintData[44] = spec.decimals;
  world.accounts[spec.mint] = { owner: TOKEN_PROGRAM, data: mintData };
  return txAddress;
}

async function seedPaid(world, opts = {}) {
  const multisig = keypair().publicKey;
  const vault = await squadsVaultAddress(multisig);
  const mint = keypair().publicKey;
  const creator = keypair().publicKey;
  const sorted = [keypair().publicKey, keypair().publicKey, keypair().publicKey].sort();
  const holderLow = sorted[0];
  const holderHigh = sorted[1];
  const cutWallet = sorted[2];
  const payouts = [
    { wallet: holderHigh, amountRaw: '300000000' },
    { wallet: holderLow, amountRaw: '180000000' },
  ];
  const waived = opts.waived === true;
  const lines = settlementLines(payouts, waived ? null : cutWallet, waived ? '0' : '120000000');
  const hash = sha256Hex(canonicalPayoutText(lines));
  const signature = chainSig();
  world.tables.campaigns.push({
    id: CID,
    title: 'Hold the line',
    project_id: PID,
    draw_seed: opts.draw === false ? null : 'SeedHashFromTheDraw',
    draw_slot: 1150,
    draw_seed_slot: 1000,
    draw_winners: [{ wallet: holderHigh, x_handle: 'ada' }, holderLow],
  });
  world.tables.projects.push({
    id: PID,
    name: 'Demo',
    ticker: 'BARD',
    vault_address: vault,
    vault_multisig: multisig,
    vault_mint: mint,
    mint,
  });
  world.tables.holders.push(
    { wallet: holderHigh, x_handle: 'ada', show_handle: true, x_via: 'oauth' },
    { wallet: holderLow, x_handle: 'hidden', show_handle: true, x_via: 'typed' },
  );
  world.tables.vault_settlements.push({
    id: '33333333-3333-4333-8333-333333333333',
    status: 'executed',
    tx_signature: signature,
    executed_at: '2026-10-25T12:00:00.000Z',
    payouts,
    payout_hash: hash,
    cut_raw: '120000000',
    cut_wallet: cutWallet,
    cut_bps: 500,
    cut_waived: waived,
    holder_total_raw: '480000000',
    tx_index: 7,
    vault_multisig: multisig,
    project_id: PID,
    campaign_id: CID,
    unit: 'TOKEN',
  });
  const vaultLines = waived
    ? payouts.map((row) => ({ wallet: row.wallet, amountRaw: row.amountRaw }))
    : payouts.concat([{ wallet: cutWallet, amountRaw: '120000000' }]);
  const txAddress = await installVault(world, {
    multisig, vault, mint, creator, index: 7, lines: vaultLines, decimals: 6,
  });
  world.tx.current = { slot: 123, blockTime: 1700000000, meta: { err: null } };
  return { signature, hash, holderHigh, holderLow, cutWallet, multisig, vault, mint, txAddress };
}

async function call(env, suffix = '') {
  const res = await handleRequest(new Request('http://127.0.0.1/api/campaigns/' + CID + '/receipt' + suffix), env);
  const body = await res.json();
  return { res, body };
}

function assertRefusal(res, body, reason) {
  assert.equal(res.status, 409, JSON.stringify(body));
  assert.deepEqual(Object.keys(body).sort(), ['error', 'reason']);
  assert.equal(body.error, 'unverified');
  assert.equal(body.reason, reason);
  assert.equal(res.headers.get('cache-control'), 'no-store');
}

async function withGuard(fn) {
  const prev = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('live network'); };
  try {
    return await fn();
  } finally {
    globalThis.fetch = prev;
  }
}

function txCalls(world) {
  return world.rpcCalls.filter((call) => call.method === 'getTransaction');
}

test('a missing executed settlement is a 404 and is not cached', async () => {
  await withGuard(async () => {
    const world = createWorld();
    world.tables.vault_settlements.push({
      campaign_id: CID,
      status: 'proposed',
      tx_signature: chainSig(),
      payout_hash: 'abc',
      payouts: [],
    });
    const missing = await call(world.env);
    assert.equal(missing.res.status, 404);
    assert.equal(missing.res.headers.get('cache-control'), 'no-store');
    assert.equal(world.store.size, 0);
    assert.equal(world.paths.some((item) => item.includes('platform_claims')), false);
    const bad = await handleRequest(new Request('http://127.0.0.1/api/campaigns/not-a-uuid/receipt'), world.env);
    assert.equal(bad.status, 404);
    assert.equal(bad.headers.get('cache-control'), 'no-store');
  });
});

test('a null signature is unverified', async () => {
  await withGuard(async () => {
    const world = createWorld();
    world.tables.vault_settlements.push({
      campaign_id: CID, status: 'executed', tx_signature: null, payouts: [], payout_hash: 'abc',
    });
    const { res, body } = await call(world.env);
    assertRefusal(res, body, 'no_chain_signature');
    assert.equal(world.store.size, 0);
    assert.equal(world.rpcCalls.length, 0);
  });
});

test('the literal released signature is unverified', async () => {
  await withGuard(async () => {
    const world = createWorld();
    world.tables.vault_settlements.push({
      campaign_id: CID, status: 'executed', tx_signature: 'released', payouts: [], payout_hash: 'abc',
    });
    const { res, body } = await call(world.env);
    assertRefusal(res, body, 'no_chain_signature');
    assert.equal(world.rpcCalls.length, 0);
  });
});

test('a non-base58 signature is unverified', async () => {
  await withGuard(async () => {
    const world = createWorld();
    world.tables.vault_settlements.push({
      campaign_id: CID, status: 'executed', tx_signature: '0'.repeat(88), payouts: [], payout_hash: 'abc',
    });
    const { res, body } = await call(world.env);
    assertRefusal(res, body, 'no_chain_signature');
    assert.equal(world.rpcCalls.length, 0);
  });
});

test('a payout hash that does not match the stored lines is unverified', async () => {
  await withGuard(async () => {
    const world = createWorld();
    const wallet = keypair().publicKey;
    world.tables.vault_settlements.push({
      campaign_id: CID,
      status: 'executed',
      tx_signature: chainSig(),
      payouts: [{ wallet, amountRaw: '300000000' }],
      payout_hash: 'deadbeef',
      cut_raw: '0',
      cut_waived: false,
    });
    const { res, body } = await call(world.env);
    assertRefusal(res, body, 'hash_mismatch');
    assert.equal(world.rpcCalls.length, 0);
    assert.equal(world.paths.some((item) => item.startsWith('/campaigns')), false);
    assert.equal(world.store.size, 0);
  });
});

test('a vault transaction that does not match is unverified', async () => {
  await withGuard(async () => {
    const world = createWorld();
    const built = await seedPaid(world);
    delete world.accounts[built.txAddress];
    const { res, body } = await call(world.env);
    assertRefusal(res, body, 'chain_mismatch');
    assert.equal(txCalls(world).length, 0);
    assert.equal(world.store.size, 0);
  });
});

test('a signature missing from the chain is unverified', async () => {
  await withGuard(async () => {
    const world = createWorld();
    await seedPaid(world);
    world.tx.current = null;
    const { res, body } = await call(world.env);
    assertRefusal(res, body, 'not_on_chain');
    assert.equal(txCalls(world).length, 1);
    assert.deepEqual(txCalls(world)[0].params[1], { maxSupportedTransactionVersion: 0 });
    assert.equal(world.store.size, 0);
  });
});

test('a failed chain transaction is unverified', async () => {
  await withGuard(async () => {
    const world = createWorld();
    await seedPaid(world);
    world.tx.current = { slot: 9, blockTime: 1700000000, meta: { err: { InstructionError: [0, 'Custom'] } } };
    const { res, body } = await call(world.env);
    assertRefusal(res, body, 'failed_on_chain');
    assert.equal(world.store.size, 0);
  });
});

test('the latest executed row is the one that is read', async () => {
  await withGuard(async () => {
    const world = createWorld();
    world.tables.vault_settlements.push({
      campaign_id: CID,
      status: 'executed',
      executed_at: '2026-01-01T00:00:00.000Z',
      tx_signature: chainSig(),
      payouts: [{ wallet: keypair().publicKey, amountRaw: '1' }],
      payout_hash: 'abc',
    });
    world.tables.vault_settlements.push({
      campaign_id: CID,
      status: 'executed',
      executed_at: '2026-10-01T00:00:00.000Z',
      tx_signature: null,
      payouts: [],
      payout_hash: 'def',
    });
    const { res, body } = await call(world.env);
    assertRefusal(res, body, 'no_chain_signature');
  });
});

test('a verified payout returns the frozen receipt and ignores platform claims', async () => {
  await withGuard(async () => {
    const world = createWorld();
    const built = await seedPaid(world);
    const { res, body } = await call(world.env);
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(world.tables.platform_claims.length, 0);
    assert.equal(world.paths.some((item) => item.includes('platform_claims')), false);
    assert.equal(body.campaign.id, CID);
    assert.equal(body.campaign.title, 'Hold the line');
    assert.equal(body.campaign.project.name, 'Demo');
    assert.equal(body.campaign.project.ticker, 'BARD');
    assert.equal(body.unit, 'BARD');
    assert.equal(body.decimals, 6);
    assert.equal(body.total_raw, '600000000');
    assert.equal(body.settlement.tx_signature, built.signature);
    assert.equal(body.settlement.explorer_url, 'https://solscan.io/tx/' + built.signature + '?cluster=devnet');
    assert.equal(body.settlement.payout_hash, built.hash);
    assert.equal(body.settlement.hash_recomputed_ok, true);
    assert.equal(body.settlement.slot, 123);
    assert.equal(body.settlement.block_time, new Date(1700000000 * 1000).toISOString());
    assert.equal(body.settlement.executed_at, '2026-10-25T12:00:00.000Z');
    assert.equal(body.rows.length, 3);
    assert.equal(body.rows[0].rank, 1);
    assert.equal(body.rows[0].amount, '300');
    assert.equal(body.rows[0].amount_raw, '300000000');
    assert.equal(body.rows[0].handle, 'ada');
    assert.equal(body.rows[0].wallet_short, shortWallet(built.holderHigh));
    assert.equal(body.rows[0].wallet_hash, sha256Hex(built.holderHigh));
    assert.equal(body.rows[0].is_platform_cut, false);
    assert.equal(body.rows[1].rank, 2);
    assert.equal(body.rows[1].amount, '180');
    assert.equal(body.rows[1].amount_raw, '180000000');
    assert.equal(body.rows[1].handle, null);
    assert.equal(body.rows[2].rank, 3);
    assert.equal(body.rows[2].is_platform_cut, true);
    assert.equal(body.rows[2].amount, '120');
    assert.equal(body.rows[2].amount_raw, '120000000');
    assert.equal(body.rows[2].handle, null);
    assert.equal(body.rows[2].wallet_short, shortWallet(built.cutWallet));
    assert.deepEqual(body.platform_cut, { bps: 500, amount_raw: '120000000', waived: false });
    assert.deepEqual(Object.keys(body.draw).sort(), ['seed', 'seed_slot', 'slot', 'winners']);
    assert.equal(body.draw.slot, 1150);
    assert.equal(body.draw.seed, 'SeedHashFromTheDraw');
    assert.equal(body.draw.seed_slot, 1000);
    assert.deepEqual(body.draw.winners, [shortWallet(built.holderHigh), shortWallet(built.holderLow)]);
    const packed = JSON.stringify(body);
    for (const secret of [built.holderHigh, built.holderLow, built.cutWallet, built.vault, built.multisig, built.mint]) {
      assert.equal(packed.includes(secret), false, secret);
    }
    assert.equal(packed.includes('hidden'), false);
    assert.equal(packed.includes('essay'), false);
    assert.equal(packed.includes('explanation'), false);
    assert.equal(txCalls(world).length, 1);

    const again = await call(world.env, '?x=2');
    assert.equal(again.res.status, 200);
    assert.equal(again.body.settlement.payout_hash, built.hash);
    assert.equal(txCalls(world).length, 1);
    assert.deepEqual([...world.store.keys()], ['http://127.0.0.1/api/campaigns/' + CID + '/receipt']);
  });
});

test('a waived cut is labelled and left out of the total', async () => {
  await withGuard(async () => {
    const world = createWorld();
    await seedPaid(world, { waived: true, draw: false });
    const { res, body } = await call(world.env);
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.rows.length, 2);
    assert.equal(body.rows.some((row) => row.is_platform_cut), false);
    assert.deepEqual(body.platform_cut, { bps: 500, amount_raw: '0', waived: true });
    assert.equal(body.total_raw, '480000000');
    assert.equal(body.draw, null);
  });
});

test('a refusal is not served from the cache after the payout verifies', async () => {
  await withGuard(async () => {
    const world = createWorld();
    await seedPaid(world);
    world.tx.current = null;
    const refused = await call(world.env);
    assertRefusal(refused.res, refused.body, 'not_on_chain');
    assert.equal(world.store.size, 0);
    world.tx.current = { slot: 123, blockTime: 1700000000, meta: { err: null } };
    const paid = await call(world.env);
    assert.equal(paid.res.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(world.store.size, 1);
  });
});

test('the receipt page, dashboard, and admin stay on the public proof', () => {
  const receiptJs = readFileSync(path.join(root, 'server/receipt.js'), 'utf8');
  const api = readFileSync(path.join(root, 'server/api.js'), 'utf8');
  const page = readFileSync(path.join(root, 'receipt.html'), 'utf8');
  const dashboard = readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  const admin = readFileSync(path.join(root, 'admin_app.js'), 'utf8');
  const campaign = readFileSync(path.join(root, 'campaign.html'), 'utf8');
  assert.match(receiptJs, /canonicalPayoutText/);
  assert.equal(receiptJs.includes('platform_claims'), false);
  assert.match(api, /handleCampaignReceipt/);
  assert.match(api, /receiptRoute/);
  assert.match(page, /This payout could not be verified on chain/);
  assert.equal(/<(button|input|textarea)\b/i.test(page), false);
  assert.match(dashboard, /Paid · receipt/);
  assert.equal(/<button[^>]*>\s*Claim/.test(dashboard), false);
  assert.match(campaign, /receipt\.textContent = 'receipt'/);
  assert.match(admin, /Vault toolkit failed to load — refresh/);
  assert.match(admin, /id="btn-execute-payout" disabled/);
  assert.match(admin, /\/receipt/);
  assert.equal(admin.includes("tx='released'"), false);
});
