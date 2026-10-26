/**
 * Squads v4 account bytes the worker can read without the browser bundle.
 * Layout matches @sqds/multisig 2.1.4 VaultTransaction and Proposal accounts.
 */
import bs58 from 'bs58';

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SQUADS_PROGRAM = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';

const VAULT_TX_DISC = Uint8Array.of(168, 250, 162, 100, 81, 14, 162, 207);
const PROPOSAL_DISC = Uint8Array.of(26, 94, 189, 187, 116, 136, 53, 33);
function readU32(bytes, offset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(offset, true);
}

function readU64(bytes, offset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getBigUint64(offset, true);
}

function pubkey(bytes, offset) {
  return bs58.encode(bytes.subarray(offset, offset + 32));
}

function sameBytes(bytes, offset, expected) {
  for (let i = 0; i < expected.length; i++) {
    if (bytes[offset + i] !== expected[i]) return false;
  }
  return true;
}

export function decodeVaultTransaction(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 8 + 32 + 32 + 8 + 3 + 4 || !sameBytes(bytes, 0, VAULT_TX_DISC)) return null;
  let offset = 8;
  const multisig = pubkey(bytes, offset);
  offset += 32;
  offset += 32;
  const index = readU64(bytes, offset);
  offset += 8;
  offset += 3;
  if (offset + 4 > bytes.length) return null;
  const bumpCount = readU32(bytes, offset);
  offset += 4;
  if (bumpCount > 16 || offset + bumpCount > bytes.length) return null;
  offset += bumpCount;
  if (offset + 3 > bytes.length) return null;
  offset += 3;
  if (offset + 4 > bytes.length) return null;
  const keyCount = readU32(bytes, offset);
  offset += 4;
  if (keyCount > 64 || offset + keyCount * 32 > bytes.length) return null;
  const accountKeys = [];
  for (let i = 0; i < keyCount; i++) {
    accountKeys.push(pubkey(bytes, offset));
    offset += 32;
  }
  if (offset + 4 > bytes.length) return null;
  const ixCount = readU32(bytes, offset);
  offset += 4;
  if (ixCount > 64) return null;
  const transfers = [];
  for (let i = 0; i < ixCount; i++) {
    if (offset + 1 + 8 > bytes.length) return null;
    const programIdIndex = bytes[offset];
    offset += 1;
    const accountLen = readU32(bytes, offset);
    offset += 4;
    if (accountLen > 32 || offset + accountLen > bytes.length) return null;
    const accountIndexes = bytes.subarray(offset, offset + accountLen);
    offset += accountLen;
    const dataLen = readU32(bytes, offset);
    offset += 4;
    if (dataLen > 1024 || offset + dataLen > bytes.length) return null;
    const ixData = bytes.subarray(offset, offset + dataLen);
    offset += dataLen;
    const programId = accountKeys[programIdIndex];
    if ((programId === TOKEN_PROGRAM || programId === TOKEN_2022_PROGRAM) && ixData.length >= 10 && ixData[0] === 12 && accountIndexes.length >= 4) {
      const view = new DataView(ixData.buffer, ixData.byteOffset, ixData.byteLength);
      transfers.push({
        programId,
        source: accountKeys[accountIndexes[0]],
        mint: accountKeys[accountIndexes[1]],
        destination: accountKeys[accountIndexes[2]],
        authority: accountKeys[accountIndexes[3]],
        amountRaw: view.getBigUint64(1, true).toString(),
        decimals: ixData[9],
      });
    }
  }
  return { multisig, index, transfers };
}

export function decodeProposal(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 8 + 32 + 8 + 1 || !sameBytes(bytes, 0, PROPOSAL_DISC)) return null;
  let offset = 8;
  const multisig = pubkey(bytes, offset);
  offset += 32;
  const transactionIndex = readU64(bytes, offset);
  offset += 8;
  const variant = bytes[offset];
  offset += 1;
  if (variant > 6) return null;
  if (variant !== 4) {
    if (offset + 8 > bytes.length) return null;
    offset += 8;
  }
  if (offset + 1 > bytes.length) return null;
  offset += 1;
  const approved = [];
  if (offset + 4 > bytes.length) return null;
  const count = readU32(bytes, offset);
  offset += 4;
  if (count > 16 || offset + count * 32 > bytes.length) return null;
  for (let i = 0; i < count; i++) {
    approved.push(pubkey(bytes, offset));
    offset += 32;
  }
  return { multisig, transactionIndex, approved };
}

export function accountKeysOf(tx) {
  const message = tx && tx.transaction && tx.transaction.message;
  const keys = (message && message.accountKeys) || [];
  return keys.map((key) => {
    if (typeof key === 'string') return key;
    return key && (key.pubkey || key.pubKey) ? key.pubkey || key.pubKey : '';
  }).filter(Boolean);
}

export function executionMatches(tx, expected) {
  if (!tx || !tx.meta || tx.meta.err) return false;
  const keys = new Set(accountKeysOf(tx));
  if (!keys.has(SQUADS_PROGRAM)) return false;
  if (expected.multisig && !keys.has(expected.multisig)) return false;
  if (expected.transaction && !keys.has(expected.transaction)) return false;
  if (expected.vault && !keys.has(expected.vault)) return false;
  return true;
}

export function diffTransfers(expected, actual) {
  const extra = (actual || []).map((row) => ({ ...row }));
  const missing = [];
  for (const row of expected || []) {
    const index = extra.findIndex((item) => item.destination === row.destination && String(item.amountRaw) === String(row.amountRaw));
    if (index < 0) missing.push(row);
    else extra.splice(index, 1);
  }
  return {
    matches: missing.length === 0 && extra.length === 0,
    missing,
    extra,
  };
}
