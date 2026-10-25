import assert from 'node:assert/strict';
import { test } from 'node:test';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { handleRequest } from '../../server/api.js';
import {
  decodeVaultTransactionAccount,
  encodeVaultTransactionAccount,
  verifyVaultTransactionMessage,
} from '../../server/approve.js';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  SQUADS_PROGRAM,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  associatedTokenAddress,
  squadsTransactionAddress,
  squadsVaultAddress,
} from '../../server/chain.js';
import { payoutHash } from '../../server/settlement.js';

const SYSTEM_PROGRAM = '11111111111111111111111111111111';

function keypair() {
  const pair = nacl.sign.keyPair();
  return { publicKey: bs58.encode(pair.publicKey) };
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

async function matchingCase() {
  const multisig = keypair().publicKey;
  const vault = await squadsVaultAddress(multisig);
  const mint = keypair().publicKey;
  const first = keypair().publicKey;
  const second = keypair().publicKey;
  const wallets = [first, second].sort();
  const amounts = ['2500000', '7500000'];
  const payouts = [
    { wallet: wallets[1], amountRaw: amounts[1] },
    { wallet: wallets[0], amountRaw: amounts[0] },
  ];
  const canonical = [
    { wallet: wallets[0], amountRaw: amounts[0] },
    { wallet: wallets[1], amountRaw: amounts[1] },
  ];
  const vaultAta = await associatedTokenAddress(vault, mint, TOKEN_PROGRAM);
  const atas = [];
  for (const wallet of wallets) atas.push(await associatedTokenAddress(wallet, mint, TOKEN_PROGRAM));
  const instructions = [createAta(vault, vaultAta, vault, mint, TOKEN_PROGRAM)];
  for (let i = 0; i < wallets.length; i++) {
    instructions.push(createAta(vault, atas[i], wallets[i], mint, TOKEN_PROGRAM));
    instructions.push(transferChecked(vaultAta, mint, atas[i], vault, amounts[i], 6, TOKEN_PROGRAM));
  }
  const message = compile(vault, instructions);
  const settlement = { payouts: canonical, payout_hash: payoutHash(canonical) };
  const options = { multisig, vaultAddress: vault, mint, decimals: 6, tokenProgram: TOKEN_PROGRAM };
  return { message, settlement, options, payouts, wallets, atas, vault, mint, multisig, vaultAta };
}

function cloneMessage(message) {
  return {
    ...message,
    accountKeys: message.accountKeys.slice(),
    instructions: message.instructions.map((ix) => ({
      programIdIndex: ix.programIdIndex,
      accountIndexes: Uint8Array.from(ix.accountIndexes),
      data: Uint8Array.from(ix.data),
    })),
    addressTableLookups: message.addressTableLookups.map((lookup) => ({ ...lookup })),
  };
}

test('matching vault message passes', async () => {
  const built = await matchingCase();
  const verdict = await verifyVaultTransactionMessage(built.message, built.settlement, built.options);
  assert.equal(verdict.ok, true, verdict.reason);
});

test('one extra instruction fails', async () => {
  const built = await matchingCase();
  const message = cloneMessage(built.message);
  message.instructions.push(message.instructions[message.instructions.length - 1]);
  const verdict = await verifyVaultTransactionMessage(message, built.settlement, built.options);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'extra_instruction');
});

test('one altered amount fails', async () => {
  const built = await matchingCase();
  const message = cloneMessage(built.message);
  const transfer = message.instructions[2];
  new DataView(transfer.data.buffer, transfer.data.byteOffset, transfer.data.byteLength).setBigUint64(1, 1n, true);
  const verdict = await verifyVaultTransactionMessage(message, built.settlement, built.options);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'amount');
});

test('one altered destination fails', async () => {
  const built = await matchingCase();
  const message = cloneMessage(built.message);
  const stranger = keypair().publicKey;
  message.accountKeys.push(stranger);
  const transfer = message.instructions[2];
  transfer.accountIndexes[2] = message.accountKeys.length - 1;
  const verdict = await verifyVaultTransactionMessage(message, built.settlement, built.options);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'destination');
});

test('a lookup table fails', async () => {
  const built = await matchingCase();
  const message = cloneMessage(built.message);
  message.addressTableLookups.push({
    accountKey: keypair().publicKey,
    writableIndexes: Uint8Array.of(1),
    readonlyIndexes: new Uint8Array(),
  });
  const verdict = await verifyVaultTransactionMessage(message, built.settlement, built.options);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'address_lookup_table');
});

test('a different token program fails', async () => {
  const built = await matchingCase();
  const verdict = await verifyVaultTransactionMessage(built.message, built.settlement, {
    ...built.options,
    tokenProgram: TOKEN_2022_PROGRAM,
  });
  assert.equal(verdict.ok, false);
  assert.notEqual(verdict.reason, '');
});

test('reordered payouts still pass', async () => {
  const built = await matchingCase();
  const settlement = { payouts: built.payouts, payout_hash: payoutHash(built.payouts) };
  assert.notDeepEqual(settlement.payouts.map((row) => row.wallet), built.settlement.payouts.map((row) => row.wallet));
  const verdict = await verifyVaultTransactionMessage(built.message, settlement, built.options);
  assert.equal(verdict.ok, true, verdict.reason);
});

test('vault transaction account bytes round-trip', async () => {
  const built = await matchingCase();
  const encoded = encodeVaultTransactionAccount({
    multisig: built.multisig,
    creator: built.wallets[0],
    index: 7n,
    bump: 3,
    vaultIndex: 0,
    vaultBump: 4,
    ephemeralSignerBumps: new Uint8Array(),
    ...built.message,
  });
  const decoded = decodeVaultTransactionAccount(encoded);
  assert.ok(decoded);
  assert.equal(decoded.multisig, built.multisig);
  assert.equal(decoded.index, 7n);
  assert.equal(decoded.vaultIndex, 0);
  assert.deepEqual(decoded.accountKeys, built.message.accountKeys);
  assert.equal(decoded.instructions.length, built.message.instructions.length);
  const verdict = await verifyVaultTransactionMessage(decoded, built.settlement, built.options);
  assert.equal(verdict.ok, true, verdict.reason);
});

function mintAccount(decimals, owner) {
  const data = new Uint8Array(82);
  data[44] = decimals;
  return { value: { owner, data: [toBase64(data), 'base64'] } };
}

test('bard sign checks the vault transaction and does not sign', async () => {
  const built = await matchingCase();
  const signer = keypair().publicKey;
  const projectId = crypto.randomUUID();
  const settlementId = crypto.randomUUID();
  const transactionPda = await squadsTransactionAddress(built.multisig, 7n);
  const account = (vaultIndex, amountByte) => {
    const message = cloneMessage(built.message);
    message.vaultIndex = vaultIndex;
    if (amountByte != null) message.instructions[2].data[1] = amountByte;
    return encodeVaultTransactionAccount({
      multisig: built.multisig,
      creator: signer,
      index: 7n,
      bump: 3,
      vaultIndex,
      vaultBump: 4,
      ephemeralSignerBumps: new Uint8Array(),
      ...message,
    });
  };
  const tables = {
    projects: [{
      id: projectId,
      vault_address: built.vault,
      vault_multisig: built.multisig,
      vault_mint: built.mint,
      mint: built.mint,
    }],
    vault_settlements: [{
      id: settlementId,
      project_id: projectId,
      payouts: built.settlement.payouts,
      payout_hash: built.settlement.payout_hash,
      vault_multisig: built.multisig,
      tx_index: '7',
      bard_signed: false,
      status: 'awaiting_bard',
    }],
  };
  const accounts = {
    [built.mint]: mintAccount(6, TOKEN_PROGRAM),
    [transactionPda]: { value: { owner: SQUADS_PROGRAM, data: [toBase64(account(0)), 'base64'] } },
  };
  const env = {
    SUPABASE_URL: 'http://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    BARD_SIGNER_PUBKEY: signer,
    SOLANA_RPC: 'http://rpc.test/solana',
    fetch: async (url, opts = {}) => {
      const u = new URL(url);
      if (u.hostname === 'rpc.test') {
        const payload = JSON.parse(opts.body);
        if (payload.method === 'getAccountInfo') {
          return Response.json({ jsonrpc: '2.0', id: 1, result: accounts[payload.params[0]] || { value: null } });
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
      const matches = (row) => filters.every((filter) => String(row[filter.key] == null ? '' : row[filter.key]) === filter.val);
      if (opts.method === 'GET') return Response.json(rows.filter(matches));
      return Response.json({ message: 'bad method' }, { status: 500 });
    },
  };
  const call = async (body) => {
    const res = await handleRequest(new Request('http://127.0.0.1/api/vault/bard-sign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), env);
    return { status: res.status, data: await res.json() };
  };
  const pass = await call({ settlementId });
  assert.equal(pass.status, 200, JSON.stringify(pass.data));
  assert.equal(pass.data.waiting, true);
  assert.equal(pass.data.reason, 'bard_signer_not_wired');
  assert.equal(tables.vault_settlements[0].bard_signed, false);

  accounts[transactionPda] = { value: { owner: SQUADS_PROGRAM, data: [toBase64(account(0, 9)), 'base64'] } };
  const fail = await call({ settlementId });
  assert.equal(fail.status, 400, JSON.stringify(fail.data));
  assert.equal(fail.data.reason, 'amount');
  assert.equal(tables.vault_settlements[0].bard_signed, false);

  const unwired = { ...env, BARD_SIGNER_PUBKEY: '' };
  const waiting = await handleRequest(new Request('http://127.0.0.1/api/vault/bard-sign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settlementId }),
  }), unwired);
  const waitingBody = await waiting.json();
  assert.equal(waiting.status, 200);
  assert.equal(waitingBody.waiting, true);
  assert.equal(waitingBody.reason, 'bard_signer_not_wired');
});
