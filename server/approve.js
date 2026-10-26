import bs58 from 'bs58';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  associatedTokenAddress,
} from './chain.js';
import { payoutHash, payoutRawAmount } from './settlement.js';

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const VAULT_TX_DISC = Uint8Array.of(168, 250, 162, 100, 81, 14, 162, 207);
const CREATE_IDEMPOTENT = 1;
const TRANSFER_CHECKED = 12;

function fail(reason) {
  return { ok: false, reason };
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value);
  return new Uint8Array(0);
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function pubkey(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.toBase58 === 'function') return value.toBase58();
  if (value && value.pubkey) return pubkey(value.pubkey);
  return '';
}

function readU32(bytes, offset) {
  if (offset + 4 > bytes.length) return null;
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function readVec(bytes, offset) {
  const len = readU32(bytes, offset);
  if (len == null) return null;
  const start = offset + 4;
  if (len > bytes.length - start) return null;
  return { data: bytes.subarray(start, start + len), next: start + len };
}

function keyAt(message, index) {
  const keys = message.accountKeys || [];
  if (!Number.isInteger(index) || index < 0 || index >= keys.length) return '';
  return pubkey(keys[index]);
}

function instructionAccounts(message, ix) {
  const indexes = ix.accountIndexes || ix.accountKeyIndexes || ix.accounts || [];
  const out = [];
  for (const index of indexes) out.push(keyAt(message, Number(index)));
  return out;
}

function instructionProgram(message, ix) {
  if (ix.programId) return pubkey(ix.programId);
  return keyAt(message, Number(ix.programIdIndex));
}

function canonicalPayouts(settlement, decimals) {
  const rows = settlement && settlement.payouts;
  const list = typeof rows === 'string' ? JSON.parse(rows) : rows;
  if (!Array.isArray(list)) return null;
  const positive = [];
  for (const row of list) {
    const raw = payoutRawAmount(row, decimals);
    if (raw < 0n) return null;
    if (raw === 0n) continue;
    positive.push({ wallet: String(row.wallet), amountRaw: raw });
  }
  const cutText = settlement && settlement.cut_waived === true
    ? ''
    : String(settlement && (settlement.cut_raw != null ? settlement.cut_raw : settlement.cutRaw) || '').trim();
  if (cutText) {
    if (!/^\d+$/.test(cutText)) return null;
    const cut = BigInt(cutText);
    if (cut > 0n) {
      const cutWallet = settlement.cut_wallet || settlement.cutWallet;
      if (!cutWallet) return null;
      positive.push({ wallet: String(cutWallet), amountRaw: cut });
    }
  }
  positive.sort((a, b) => {
    if (a.wallet < b.wallet) return -1;
    if (a.wallet > b.wallet) return 1;
    return 0;
  });
  return positive;
}

function transferData(amount, decimals) {
  const data = new Uint8Array(10);
  data[0] = TRANSFER_CHECKED;
  new DataView(data.buffer).setBigUint64(1, amount, true);
  data[9] = decimals;
  return data;
}

function sameAccounts(got, expected) {
  if (got.length !== expected.length) return false;
  for (let i = 0; i < got.length; i++) if (got[i] !== expected[i]) return false;
  return true;
}

function checkInstruction(actual, expected) {
  if (actual.programId !== expected.programId) {
    return expected.kind === 'transfer' ? 'token_program' : 'instruction';
  }
  if (!sameAccounts(actual.accounts, expected.accounts)) {
    if (expected.kind === 'transfer' && actual.accounts[2] !== expected.accounts[2]) return 'destination';
    return 'instruction';
  }
  if (expected.kind === 'transfer' && actual.data.length === 10 && expected.data.length === 10) {
    if (actual.data[9] !== expected.data[9]) return 'decimals';
    if (!sameBytes(actual.data.subarray(1, 9), expected.data.subarray(1, 9))) return 'amount';
  }
  if (!sameBytes(actual.data, expected.data)) {
    return expected.kind === 'transfer' ? 'amount' : 'instruction';
  }
  return '';
}

/**
 * Squads stores the vault message as a beet struct: three u8 counts, then
 * length-prefixed account keys, compiled instructions, and address lookups.
 * vaultIndex lives on the account, beside that message.
 */
export function decodeVaultTransactionAccount(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
  if (bytes.length < 8 + 32 + 32 + 8 + 3) return null;
  for (let i = 0; i < VAULT_TX_DISC.length; i++) {
    if (bytes[i] !== VAULT_TX_DISC[i]) return null;
  }
  let offset = 8;
  const multisig = bs58.encode(bytes.subarray(offset, offset + 32));
  offset += 32;
  const creator = bs58.encode(bytes.subarray(offset, offset + 32));
  offset += 32;
  const index = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true);
  offset += 8;
  const bump = bytes[offset];
  const vaultIndex = bytes[offset + 1];
  const vaultBump = bytes[offset + 2];
  offset += 3;
  const bumps = readVec(bytes, offset);
  if (!bumps) return null;
  offset = bumps.next;
  if (offset + 3 > bytes.length) return null;
  const numSigners = bytes[offset];
  const numWritableSigners = bytes[offset + 1];
  const numWritableNonSigners = bytes[offset + 2];
  offset += 3;
  const keyCount = readU32(bytes, offset);
  if (keyCount == null) return null;
  offset += 4;
  if (keyCount > 64 || offset + keyCount * 32 > bytes.length) return null;
  const accountKeys = [];
  for (let i = 0; i < keyCount; i++) {
    accountKeys.push(bs58.encode(bytes.subarray(offset, offset + 32)));
    offset += 32;
  }
  const ixCount = readU32(bytes, offset);
  if (ixCount == null) return null;
  offset += 4;
  if (ixCount > 64) return null;
  const instructions = [];
  for (let i = 0; i < ixCount; i++) {
    if (offset >= bytes.length) return null;
    const programIdIndex = bytes[offset];
    offset += 1;
    const accounts = readVec(bytes, offset);
    if (!accounts) return null;
    offset = accounts.next;
    const ixData = readVec(bytes, offset);
    if (!ixData) return null;
    offset = ixData.next;
    instructions.push({
      programIdIndex,
      accountIndexes: accounts.data,
      data: ixData.data,
    });
  }
  const lookupCount = readU32(bytes, offset);
  if (lookupCount == null) return null;
  offset += 4;
  if (lookupCount > 16) return null;
  const addressTableLookups = [];
  for (let i = 0; i < lookupCount; i++) {
    if (offset + 32 > bytes.length) return null;
    const accountKey = bs58.encode(bytes.subarray(offset, offset + 32));
    offset += 32;
    const writable = readVec(bytes, offset);
    if (!writable) return null;
    offset = writable.next;
    const readonly = readVec(bytes, offset);
    if (!readonly) return null;
    offset = readonly.next;
    addressTableLookups.push({
      accountKey,
      writableIndexes: writable.data,
      readonlyIndexes: readonly.data,
    });
  }
  if (offset !== bytes.length) return null;
  return {
    multisig,
    creator,
    index,
    bump,
    vaultIndex,
    vaultBump,
    ephemeralSignerBumps: bumps.data,
    numSigners,
    numWritableSigners,
    numWritableNonSigners,
    accountKeys,
    instructions,
    addressTableLookups,
  };
}

function writeU32(parts, value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  parts.push(bytes);
}

function writeVec(parts, bytes) {
  const data = asBytes(bytes);
  writeU32(parts, data.length);
  parts.push(data);
}

function concat(parts) {
  let len = 0;
  for (const part of parts) len += part.length;
  const out = new Uint8Array(len);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Inverse of decodeVaultTransactionAccount, used to feed the signer route in tests. */
export function encodeVaultTransactionAccount(account) {
  const parts = [VAULT_TX_DISC];
  parts.push(bs58.decode(account.multisig));
  parts.push(bs58.decode(account.creator));
  const index = new Uint8Array(8);
  new DataView(index.buffer).setBigUint64(0, BigInt(account.index), true);
  parts.push(index);
  parts.push(Uint8Array.of(account.bump & 255, account.vaultIndex & 255, account.vaultBump & 255));
  writeVec(parts, account.ephemeralSignerBumps || new Uint8Array());
  parts.push(Uint8Array.of(account.numSigners, account.numWritableSigners, account.numWritableNonSigners));
  const keys = account.accountKeys || [];
  writeU32(parts, keys.length);
  for (const key of keys) parts.push(bs58.decode(pubkey(key)));
  const instructions = account.instructions || [];
  writeU32(parts, instructions.length);
  for (const ix of instructions) {
    parts.push(Uint8Array.of(Number(ix.programIdIndex) & 255));
    writeVec(parts, ix.accountIndexes || ix.accountKeyIndexes || []);
    writeVec(parts, ix.data || []);
  }
  const lookups = account.addressTableLookups || [];
  writeU32(parts, lookups.length);
  for (const lookup of lookups) {
    parts.push(bs58.decode(pubkey(lookup.accountKey)));
    writeVec(parts, lookup.writableIndexes || []);
    writeVec(parts, lookup.readonlyIndexes || []);
  }
  return concat(parts);
}

async function verifyInner(decodedMessage, settlement, options) {
  const message = decodedMessage || {};
  if (Number(message.vaultIndex) !== 0) return fail('vault_index');
  if (!Array.isArray(message.addressTableLookups) || message.addressTableLookups.length !== 0) {
    return fail('address_lookup_table');
  }
  const opts = options || {};
  const vaultAddress = pubkey(opts.vaultAddress);
  const mint = pubkey(opts.mint);
  const tokenProgram = pubkey(opts.tokenProgram);
  const decimals = Number(opts.decimals);
  if (!vaultAddress || !mint) return fail('bad_message');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return fail('decimals');
  if (tokenProgram !== TOKEN_PROGRAM && tokenProgram !== TOKEN_2022_PROGRAM) return fail('token_program');
  const keys = message.accountKeys || [];
  if (Number(message.numSigners) !== 1 || Number(message.numWritableSigners) !== 1) return fail('vault_not_signer');
  if (pubkey(keys[0]) !== vaultAddress) return fail('vault_not_signer');
  let payouts;
  try {
    payouts = canonicalPayouts(settlement, decimals);
  } catch {
    return fail('amount');
  }
  if (!payouts || !payouts.length) return fail('no_payouts');
  let storedHash = '';
  try {
    storedHash = payoutHash(payouts.map((row) => ({ wallet: row.wallet, amountRaw: row.amountRaw.toString() })));
  } catch {
    return fail('payout_hash');
  }
  if (!settlement || storedHash !== settlement.payout_hash) return fail('payout_hash');
  const vaultAta = await associatedTokenAddress(vaultAddress, mint, tokenProgram);
  const expected = [{
    kind: 'create',
    programId: ASSOCIATED_TOKEN_PROGRAM,
    accounts: [vaultAddress, vaultAta, vaultAddress, mint, SYSTEM_PROGRAM, tokenProgram],
    data: Uint8Array.of(CREATE_IDEMPOTENT),
  }];
  for (const payout of payouts) {
    const destAta = await associatedTokenAddress(payout.wallet, mint, tokenProgram);
    expected.push({
      kind: 'create',
      programId: ASSOCIATED_TOKEN_PROGRAM,
      accounts: [vaultAddress, destAta, payout.wallet, mint, SYSTEM_PROGRAM, tokenProgram],
      data: Uint8Array.of(CREATE_IDEMPOTENT),
    });
    expected.push({
      kind: 'transfer',
      programId: tokenProgram,
      accounts: [vaultAta, mint, destAta, vaultAddress],
      data: transferData(payout.amountRaw, decimals),
    });
  }
  const actual = message.instructions || [];
  if (!Array.isArray(actual)) return fail('bad_message');
  if (actual.length > expected.length) return fail('extra_instruction');
  if (actual.length < expected.length) return fail('missing_instruction');
  for (let i = 0; i < expected.length; i++) {
    const ix = actual[i] || {};
    const got = {
      programId: instructionProgram(message, ix),
      accounts: instructionAccounts(message, ix),
      data: asBytes(ix.data),
    };
    if (got.accounts.some((key) => !key)) return fail('instruction');
    const reason = checkInstruction(got, expected[i]);
    if (reason) return fail(reason);
  }
  return { ok: true };
}

export async function verifyVaultTransactionMessage(decodedMessage, settlement, options) {
  try {
    return await verifyInner(decodedMessage, settlement, options);
  } catch {
    return fail('bad_message');
  }
}
