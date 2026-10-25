import bs58 from 'bs58';

export const FEE_TREASURY = 'JB9uSThPHadHPpyed7E2rvpYubGHBA8evZqQgNQZZFAd';
export const SQUADS_PROGRAM = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';

export const PLAN_SOL = {
  starter: 1,
  pro: 4,
  onboard: 0.25,
  campaign: 0.25,
  claim: 0.1,
  stake: 0.05,
};

export function solToLamports(sol) {
  return BigInt(Math.round(Number(sol) * 1e9));
}

function readU16(view, offset) {
  return view.getUint16(offset, true);
}

function readU32(view, offset) {
  return view.getUint32(offset, true);
}

export async function squadsMultisigDiscriminator() {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('account:Multisig'));
  return new Uint8Array(digest).slice(0, 8);
}

export const SQUADS_PERMISSION_VOTE = 2;
export const SQUADS_PERMISSION_EXECUTE = 4;

export async function parseSquadsMultisig(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const expected = await squadsMultisigDiscriminator();
  if (bytes.length < expected.length + 96) return null;
  for (let i = 0; i < expected.length; i++) {
    if (bytes[i] !== expected[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const configAuthority = bs58.encode(bytes.subarray(40, 72));
  let offset = 8 + 32 + 32;
  const threshold = readU16(view, offset);
  offset += 2 + 4 + 8 + 8;
  if (offset >= bytes.length) return null;
  const rentTag = bytes[offset];
  offset += 1;
  if (rentTag === 1) offset += 32;
  else if (rentTag !== 0) return null;
  offset += 1;
  if (offset + 4 > bytes.length) return null;
  const count = readU32(view, offset);
  offset += 4;
  if (count > 16) return null;
  const members = [];
  for (let i = 0; i < count; i++) {
    if (offset + 33 > bytes.length) return null;
    members.push({
      key: bs58.encode(bytes.subarray(offset, offset + 32)),
      permissions: bytes[offset + 32],
    });
    offset += 33;
  }
  return { threshold, configAuthority, members };
}

function memberKey(member) {
  if (typeof member === 'string') return member;
  if (member && typeof member.key === 'string') return member.key;
  return '';
}

export function sameMemberSet(members, expected) {
  if (!members || !expected || members.length !== expected.length) return false;
  const got = new Set(members.map(memberKey));
  return expected.every((key) => got.has(memberKey(key)));
}

export function decodeBase64(value) {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function collectTreasuryLamports(tx, { treasury, payer }) {
  if (!tx || !tx.meta || tx.meta.err) return null;
  const groups = [];
  const message = tx.transaction && tx.transaction.message;
  if (message && Array.isArray(message.instructions)) groups.push(...message.instructions);
  const inner = tx.meta.innerInstructions || [];
  for (const group of inner) {
    if (group && Array.isArray(group.instructions)) groups.push(...group.instructions);
  }
  let total = 0n;
  for (const ix of groups) {
    const parsed = ix && ix.parsed;
    if (!parsed || parsed.type !== 'transfer' || !parsed.info) continue;
    if (!ix.program || ix.program !== 'system') continue;
    if (!parsed.info.destination || parsed.info.destination !== treasury) continue;
    if (!parsed.info.source || parsed.info.source !== payer) continue;
    total += BigInt(parsed.info.lamports || 0);
  }
  return total;
}

const ED25519_P = (1n << 255n) - 19n;
const ED25519_D = 0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3n;
const ED25519_SQRT_M1 = 19681161376707505956807079304988542015446066515923890162744021073123829784752n;

function modP(n) {
  const r = n % ED25519_P;
  return r >= 0n ? r : r + ED25519_P;
}

function modPow(base, exp) {
  let result = 1n;
  let b = modP(base);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = modP(result * b);
    b = modP(b * b);
    e >>= 1n;
  }
  return result;
}

function uvRatio(u, v) {
  const v3 = modP(v * v * v);
  const v7 = modP(v3 * v3 * v);
  const pow = modPow(modP(u * v7), (ED25519_P - 5n) / 8n);
  let x = modP(u * v3 * pow);
  const vx2 = modP(v * x * x);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === modP(-u);
  if (useRoot2) x = modP(x * ED25519_SQRT_M1);
  if ((x & 1n) === 1n) x = modP(-x);
  return { isValid: useRoot1 || useRoot2, value: x };
}

export function isOnCurve(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) return false;
  const normed = new Uint8Array(bytes);
  const sign = (normed[31] & 0x80) !== 0;
  normed[31] &= 0x7f;
  let y = 0n;
  for (let i = 0; i < 32; i++) y |= BigInt(normed[i]) << (8n * BigInt(i));
  if (y >= ED25519_P) return false;
  const y2 = modP(y * y);
  const u = modP(y2 - 1n);
  const v = modP(ED25519_D * y2 + 1n);
  const ratio = uvRatio(u, v);
  if (!ratio.isValid) return false;
  if (ratio.value === 0n && sign) return false;
  return true;
}

function concatBytes(parts) {
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

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

export async function findProgramAddress(seeds, programId) {
  const program = typeof programId === 'string' ? bs58.decode(programId) : programId;
  if (program.length !== 32) throw new Error('invalid program id');
  for (let bump = 255; bump > 0; bump--) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', concatBytes([
      ...seeds,
      Uint8Array.of(bump),
      program,
      PDA_MARKER,
    ])));
    if (!isOnCurve(hash)) return { address: bs58.encode(hash), bump };
  }
  throw new Error('no program address');
}

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

function decodeKey(value, label) {
  const key = bs58.decode(value);
  if (key.length !== 32) throw new Error('invalid ' + label);
  return key;
}

export function u64le(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

export async function squadsVaultAddress(multisig, index = 0) {
  if (!Number.isInteger(index) || index < 0 || index > 255) throw new Error('invalid vault index');
  const key = decodeKey(multisig, 'multisig');
  const text = new TextEncoder();
  const found = await findProgramAddress([
    text.encode('multisig'),
    key,
    text.encode('vault'),
    Uint8Array.of(index),
  ], SQUADS_PROGRAM);
  return found.address;
}

export async function squadsTransactionAddress(multisig, index) {
  const key = decodeKey(multisig, 'multisig');
  const text = new TextEncoder();
  const found = await findProgramAddress([
    text.encode('multisig'),
    key,
    text.encode('transaction'),
    u64le(index),
  ], SQUADS_PROGRAM);
  return found.address;
}

export async function squadsProposalAddress(multisig, index) {
  const key = decodeKey(multisig, 'multisig');
  const text = new TextEncoder();
  const found = await findProgramAddress([
    text.encode('multisig'),
    key,
    text.encode('transaction'),
    u64le(index),
    text.encode('proposal'),
  ], SQUADS_PROGRAM);
  return found.address;
}

export async function associatedTokenAddress(owner, mint, tokenProgram) {
  const found = await findProgramAddress([
    decodeKey(owner, 'owner'),
    decodeKey(tokenProgram, 'token program'),
    decodeKey(mint, 'mint'),
  ], ASSOCIATED_TOKEN_PROGRAM);
  return found.address;
}
