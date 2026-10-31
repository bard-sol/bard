export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const TESTNET_GENESIS = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY';

const KNOWN_NETWORKS = {
  [MAINNET_GENESIS]: { network: 'mainnet-beta', publicRpc: 'https://api.mainnet-beta.solana.com', explorerCluster: '' },
  [DEVNET_GENESIS]: { network: 'devnet', publicRpc: 'https://api.devnet.solana.com', explorerCluster: 'devnet' },
  [TESTNET_GENESIS]: { network: 'testnet', publicRpc: 'https://api.testnet.solana.com', explorerCluster: 'testnet' },
};

const GENESIS_TIMEOUT_MS = 5000;
const genesisByFetch = new WeakMap();

function httpUrl(text) {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function isLoopback(text) {
  const url = httpUrl(text);
  if (!url) return false;
  const host = url.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
}

async function genesisHashOf(env, url) {
  const fetcher = env.fetch || fetch;
  let cached = genesisByFetch.get(fetcher);
  if (!cached) {
    cached = new Map();
    genesisByFetch.set(fetcher, cached);
  }
  if (cached.has(url)) return cached.get(url);
  const res = await fetcher(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash' }),
    signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(GENESIS_TIMEOUT_MS) : undefined,
  });
  const data = await res.json();
  const hash = data && typeof data.result === 'string' ? data.result : '';
  if (!hash) throw new Error('no genesis hash');
  cached.set(url, hash);
  return hash;
}

// The one place the Solana network is decided. SOLANA_RPC (secret, server only) says which
// chain the worker reads. The browser gets an RPC on that same chain: SOLANA_RPC_PUBLIC when
// set (its genesis hash must match), else the public endpoint of the recognised chain, else a
// local simulation URL. The SOLANA_RPC value itself is never returned, and no error text
// repeats it, because hosted RPC URLs carry API keys.
export async function resolveSolanaConfig(env) {
  const out = { network: null, rpc: null, genesisHash: null, explorerCluster: null, error: null };
  const serverUrl = String(env.SOLANA_RPC || '').trim();
  if (!serverUrl) {
    out.error = 'SOLANA_RPC is not set';
    return out;
  }
  if (!httpUrl(serverUrl)) {
    out.error = 'SOLANA_RPC is not an http(s) URL';
    return out;
  }
  let genesis;
  try {
    genesis = await genesisHashOf(env, serverUrl);
  } catch {
    out.error = 'SOLANA_RPC did not return a genesis hash';
    return out;
  }
  const known = KNOWN_NETWORKS[genesis] || null;
  out.genesisHash = genesis;
  out.network = known ? known.network : 'custom';
  out.explorerCluster = known ? known.explorerCluster : null;

  const publicUrl = String(env.SOLANA_RPC_PUBLIC || '').trim();
  if (publicUrl) {
    if (!httpUrl(publicUrl)) {
      out.error = 'SOLANA_RPC_PUBLIC is not an http(s) URL';
      return out;
    }
    let publicGenesis;
    try {
      publicGenesis = await genesisHashOf(env, publicUrl);
    } catch {
      out.error = 'SOLANA_RPC_PUBLIC did not return a genesis hash';
      return out;
    }
    if (publicGenesis !== genesis) {
      out.error = 'SOLANA_RPC_PUBLIC is on a different Solana network than SOLANA_RPC';
      return out;
    }
    out.rpc = publicUrl;
  } else if (known) {
    out.rpc = known.publicRpc;
  } else if (isLoopback(serverUrl)) {
    out.rpc = serverUrl;
  } else {
    out.error = 'SOLANA_RPC is on a Solana network Bard does not recognise; set SOLANA_RPC_PUBLIC to a public RPC on that network';
  }
  return out;
}
