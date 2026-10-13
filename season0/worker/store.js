import { assertNotLiveSupabase } from '../lib/cluster.js';

const memory = {
  nonces: new Map(),
  used: new Map(),
  holds: new Map(),
  trials: new Map(),
  streaks: new Map(),
  letters: new Map(),
  crowd: new Map(),
  chests: new Map(),
  pushSent: new Map(),
  pushSubs: new Map(),
  turnstile: new Set(),
  onchain: new Set()
};

export function resetMemory() {
  memory.nonces.clear();
  memory.used.clear();
  memory.holds.clear();
  memory.trials.clear();
  memory.streaks.clear();
  memory.letters.clear();
  memory.crowd.clear();
  memory.chests.clear();
  memory.pushSent.clear();
  memory.pushSubs.clear();
  memory.turnstile.clear();
  memory.onchain.clear();
}

export function loopMemory() {
  return memory;
}

export function rememberOnChain(wallet) {
  if (wallet) memory.onchain.add(wallet);
}

export function rememberNonce(nonce, record) {
  memory.nonces.set(nonce, record);
}

export function takeNonce(nonce) {
  return memory.nonces.get(nonce) || null;
}

export function consumeNonce(nonce, signature) {
  const row = memory.nonces.get(nonce);
  if (!row) return { ok: false, reason: 'unknown_nonce' };
  if (row.usedBy && row.usedBy !== signature) return { ok: false, reason: 'nonce_used' };
  row.usedBy = signature || 'seen';
  memory.used.set(nonce, row.usedBy);
  return { ok: true, row };
}

export function supabaseEnv(env) {
  const url = env && (env.SEASON_SUPABASE_URL || '');
  const key = env && (env.SEASON_SUPABASE_SERVICE_KEY || '');
  if (!url) return null;
  assertNotLiveSupabase(url);
  if (!key) throw new Error('Season Supabase URL is set without a service key');
  return { url, key };
}

export async function rememberNonceDurable(env, nonce, record) {
  rememberNonce(nonce, record);
  const sb = supabaseEnv(env);
  if (!sb) return;
  const res = await fetch(sb.url.replace(/\/$/, '') + '/rest/v1/season_spend_nonces', {
    method: 'POST',
    headers: {
      apikey: sb.key,
      authorization: 'Bearer ' + sb.key,
      'content-type': 'application/json',
      prefer: 'resolution=ignore-duplicates'
    },
    body: JSON.stringify({ nonce, payload: record, used: false })
  });
  if (!res.ok) throw new Error('nonce persist failed: ' + res.status);
}
