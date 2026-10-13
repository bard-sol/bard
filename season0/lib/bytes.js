/** Shared hashing. Works in Node, the browser, and the worker. */

export function utf8(input) {
  return typeof input === 'string' ? new TextEncoder().encode(input) : input;
}

export function hex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export function fromHex(value) {
  const s = String(value).replace(/^0x/, '');
  if (s.length % 2) throw new Error('bad hex');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256Bytes(input) {
  const digest = await crypto.subtle.digest('SHA-256', utf8(input));
  return new Uint8Array(digest);
}

export async function sha256Hex(input) {
  return hex(await sha256Bytes(input));
}

/** First 8 bytes of randomness, little-endian, as a bigint. */
export function u64le(bytes) {
  if (!bytes || bytes.length < 8) throw new Error('need 8 randomness bytes');
  let n = 0n;
  for (let i = 7; i >= 0; i--) n = (n << 8n) + BigInt(bytes[i]);
  return n;
}

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, utf8(message));
  return hex(new Uint8Array(sig));
}

export function timingSafeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
