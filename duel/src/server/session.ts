/** Shared session cookies for the passcode gate and a per-browser friend seat. */

export const PASS_COOKIE = 'bard_duel_session';
export const WHO_COOKIE = 'bard_duel_who';
const SESSION_LABEL = 'bard-duel-v1';
const COOKIE_MAX_AGE = 2_592_000;

/** 128 bits, Crockford base32, 26 characters. Unguessable match codes. */
export const FRIEND_CODE = /^[0-9a-hjkmnp-tv-z]{26}$/;

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export function friendCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let value = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >> bits) & 31] ?? '0';
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31] ?? '0';
  return out;
}

export function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^\/m\/([0-9a-hjkmnp-tv-z]{26})$/i.exec(value);
  const code = match?.[1];
  if (!code) return null;
  return `/m/${code.toLowerCase()}`;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return null;
}

export function whoToken(header: string | null | undefined): string | null {
  const value = readCookie(header, WHO_COOKIE);
  if (!value || !/^[0-9a-f]{32}$/.test(value)) return null;
  return value;
}

export function mintWho(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function whoCookie(token: string, secure: boolean): string {
  const parts = [`${WHO_COOKIE}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${COOKIE_MAX_AGE}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function passCookie(token: string, secure: boolean): string {
  const parts = [`${PASS_COOKIE}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${COOKIE_MAX_AGE}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export async function sessionToken(passcode: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(passcode), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(SESSION_LABEL));
  return hex(sig);
}

export async function authorized(header: string | null | undefined, passcode: string): Promise<boolean> {
  const got = readCookie(header, PASS_COOKIE);
  if (!got) return false;
  return safeEqual(got, await sessionToken(passcode));
}

export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let diff = x.length === y.length ? 0 : 1;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function gateHtml(rejected: boolean, next: string | null): string {
  const note = rejected ? '<p class="bad">That passcode was not accepted.</p>' : '';
  const hidden = next ? `<input type="hidden" name="next" value="${escapeHtml(next)}" />` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow, noarchive" />
  <title>Bard</title>
  <style>
    html, body { margin: 0; height: 100%; background: #140e0a; color: #f3e6d0; font-family: Georgia, serif; }
    main { min-height: 100%; display: grid; place-items: center; }
    form { display: grid; gap: 12px; width: min(320px, 88vw); }
    input, button { font: inherit; padding: 12px; border-radius: 8px; }
    input { background: #24180f; color: #f3e6d0; border: 1px solid #8a6a3b; }
    button { background: #c6a15a; color: #140e0a; border: 0; }
    .bad { color: #e0a090; margin: 0; }
  </style>
</head>
<body>
  <main>
    <form method="post" action="/api/unlock">
      <h1>Bard</h1>
      ${note}
      ${hidden}
      <input type="password" name="passcode" autocomplete="current-password" required />
      <button type="submit">Enter</button>
    </form>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'));
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
