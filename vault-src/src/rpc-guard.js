/** Reject anything except the public Solana devnet RPC. */
export const DEVNET_RPC = 'https://api.devnet.solana.com';

export function assertDevnetUrl(url) {
  var parsed;
  try {
    parsed = new URL(String(url));
  } catch (e) {
    throw new Error('Refusing malformed RPC URL');
  }
  var host = parsed.hostname.toLowerCase();
  if (host === 'supabase.co' || host.endsWith('.supabase.co')) {
    throw new Error('Refusing request to Supabase');
  }
  if (host !== 'api.devnet.solana.com') {
    throw new Error('Refusing non-devnet RPC: ' + host);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Refusing non-https RPC');
  }
}
