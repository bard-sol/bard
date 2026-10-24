import nacl from 'tweetnacl';
import bs58 from 'bs58';

export const SIGNIN_DOMAIN = 'bard.is';
export const NONCE_TTL_MS = 5 * 60 * 1000;
export const JWT_TTL_SEC = 60 * 60;

const textEncoder = new TextEncoder();

export function signInMessage({ domain, wallet, nonce, issuedAt }) {
  return [
    'Bard sign-in',
    'Domain: ' + domain,
    'Wallet: ' + wallet,
    'Nonce: ' + nonce,
    'Issued At: ' + issuedAt,
  ].join('\n');
}

export function isBase58Address(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) return false;
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}

function bytesToBinary(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return bin;
}

export function b64urlEncode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(bytesToBinary(u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function b64urlDecode(value) {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const bin = atob(String(value).replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function hmacSign(secret, data) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, textEncoder.encode(data));
  return new Uint8Array(sig);
}

export async function createNonce(secret, wallet, now = Date.now()) {
  if (!secret) throw new Error('SUPABASE_JWT_SECRET is not set');
  if (!isBase58Address(wallet)) throw new Error('invalid wallet');
  const iat = now;
  const exp = iat + NONCE_TTL_MS;
  const issuedAt = new Date(iat).toISOString();
  const jtiBytes = new Uint8Array(16);
  crypto.getRandomValues(jtiBytes);
  const payload = { v: 1, jti: b64urlEncode(jtiBytes), iat, exp, wallet, issuedAt };
  const body = b64urlEncode(textEncoder.encode(JSON.stringify(payload)));
  const sig = b64urlEncode(await hmacSign(secret, body));
  const nonce = body + '.' + sig;
  return {
    nonce,
    issuedAt,
    domain: SIGNIN_DOMAIN,
    expiresAt: new Date(exp).toISOString(),
    message: signInMessage({ domain: SIGNIN_DOMAIN, wallet, nonce, issuedAt }),
    payload,
  };
}

export async function readNonce(secret, nonce, now = Date.now()) {
  if (!secret) return { ok: false, error: 'nonce invalid' };
  const parts = String(nonce || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: 'nonce invalid' };
  const expected = await hmacSign(secret, parts[0]);
  let got;
  try { got = b64urlDecode(parts[1]); } catch { return { ok: false, error: 'nonce invalid' }; }
  if (!timingSafeEqual(expected, got)) return { ok: false, error: 'nonce invalid' };
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0]))); } catch { return { ok: false, error: 'nonce invalid' }; }
  if (!payload || payload.v !== 1 || !payload.jti || !payload.wallet) return { ok: false, error: 'nonce invalid' };
  if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number') return { ok: false, error: 'nonce invalid' };
  if (payload.exp - payload.iat !== NONCE_TTL_MS) return { ok: false, error: 'nonce invalid' };
  if (now >= payload.exp) return { ok: false, error: 'nonce expired' };
  if (payload.iat > now + 60 * 1000) return { ok: false, error: 'nonce invalid' };
  return { ok: true, payload };
}

export function verifyWalletSignature(wallet, message, signature) {
  let pub;
  let sig;
  try {
    pub = bs58.decode(wallet);
    sig = bs58.decode(signature);
  } catch {
    return false;
  }
  if (pub.length !== 32 || sig.length !== 64) return false;
  return nacl.sign.detached.verify(textEncoder.encode(message), sig, pub);
}

export async function signJwt(secret, wallet, now = Date.now()) {
  if (!secret) throw new Error('SUPABASE_JWT_SECRET is not set');
  const iat = Math.floor(now / 1000);
  const exp = iat + JWT_TTL_SEC;
  const header = b64urlEncode(textEncoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = {
    aud: 'authenticated',
    role: 'authenticated',
    sub: wallet,
    wallet,
    iss: 'bard.is',
    iat,
    exp,
  };
  const body = b64urlEncode(textEncoder.encode(JSON.stringify(payload)));
  const signingInput = header + '.' + body;
  const sig = b64urlEncode(await hmacSign(secret, signingInput));
  return { token: signingInput + '.' + sig, exp, payload };
}

export async function verifyJwt(secret, token, now = Date.now()) {
  if (!secret || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = await hmacSign(secret, parts[0] + '.' + parts[1]);
  let got;
  try { got = b64urlDecode(parts[2]); } catch { return null; }
  if (!timingSafeEqual(expected, got)) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))); } catch { return null; }
  if (!payload || payload.role !== 'authenticated') return null;
  if (!isBase58Address(payload.sub) || payload.sub !== payload.wallet) return null;
  if (typeof payload.exp !== 'number' || payload.exp - payload.iat > JWT_TTL_SEC) return null;
  if (Math.floor(now / 1000) >= payload.exp) return null;
  return payload;
}
