import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519';

export function canonicalMessage({ kind, season, chapter, charId, nonce, signedAt, extra }) {
  return [
    'bard',
    season || 's0',
    kind,
    chapter == null ? '-' : String(chapter),
    charId || '-',
    nonce,
    String(signedAt),
    extra || '-'
  ].join('|');
}

export function verifyWalletSignature({ publicKey, message, signature }) {
  try {
    const pub = bs58.decode(publicKey);
    const sig = bs58.decode(signature);
    const msg = new TextEncoder().encode(message);
    return ed25519.verify(sig, msg, pub);
  } catch {
    return false;
  }
}
