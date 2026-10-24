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

export async function parseSquadsMultisig(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const expected = await squadsMultisigDiscriminator();
  if (bytes.length < expected.length + 96) return null;
  for (let i = 0; i < expected.length; i++) {
    if (bytes[i] !== expected[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
    members.push(bs58.encode(bytes.subarray(offset, offset + 32)));
    offset += 33;
  }
  return { threshold, members };
}

export function sameMemberSet(members, expected) {
  if (members.length !== expected.length) return false;
  const got = new Set(members);
  return expected.every((key) => got.has(key));
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
    if (ix.program && ix.program !== 'system') continue;
    if (parsed.info.destination !== treasury || parsed.info.source !== payer) continue;
    total += BigInt(parsed.info.lamports || 0);
  }
  return total;
}
