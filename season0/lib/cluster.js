import { DEVNET_GENESIS, DEVNET_RPC, LIVE_SUPABASE_REF, MAINNET_GENESIS } from './config.js';

export function isMainnetEndpoint(url) {
  const s = String(url || '');
  return /mainnet|mainnet-beta/i.test(s);
}

/**
 * Refuse anything that is not the public devnet RPC or a localhost proxy
 * that the caller has already proven via genesis hash.
 */
export function assertDevnetEndpoint(url) {
  const s = String(url || '');
  if (!s) throw new Error('Refusing: empty RPC endpoint');
  if (isMainnetEndpoint(s)) throw new Error('Refusing mainnet RPC endpoint');
  if (s !== DEVNET_RPC && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?/.test(s)) {
    throw new Error('Refusing non-devnet RPC endpoint: ' + s);
  }
  return s;
}

export function assertDevnetGenesis(genesis) {
  if (genesis === MAINNET_GENESIS) throw new Error('Refusing mainnet genesis hash');
  if (genesis !== DEVNET_GENESIS) throw new Error('Refusing: genesis is not devnet (' + genesis + ')');
  return true;
}

export function assertNotLiveSupabase(url) {
  if (!url) return;
  if (String(url).includes(LIVE_SUPABASE_REF)) {
    throw new Error('Refusing live Supabase project ' + LIVE_SUPABASE_REF);
  }
}
