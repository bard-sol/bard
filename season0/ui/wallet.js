/** Wallet links and devnet help. The app never sends a mainnet transaction. */

export const BARD_REF = 'https://bard.is';

export function phantomBrowseUrl(pageUrl, ref) {
  const origin = ref || BARD_REF;
  return 'https://phantom.com/ul/browse/' + encodeURIComponent(pageUrl) + '?ref=' + encodeURIComponent(origin);
}

/** Verified Solflare browse link. The path is /ul/v1/browse/. */
export function solflareBrowseUrl(pageUrl, ref) {
  const origin = ref || BARD_REF;
  return 'https://solflare.com/ul/v1/browse/' + encodeURIComponent(pageUrl) + '?ref=' + encodeURIComponent(origin);
}

export function wrongNetworkHelp(wallet) {
  const key = String(wallet || 'other').toLowerCase();
  const steps = {
    phantom: 'Phantom: Settings > Developer Settings > Testnet Mode > Solana Devnet.',
    solflare: 'Solflare: Settings > General > Network > Devnet.',
    backpack: 'Backpack: Settings > Preferences > Developer Mode, then the network switcher > Add Network > Solana Devnet.'
  };
  return {
    title: 'Your wallet may be on mainnet. Switch it to Devnet:',
    steps: steps[key] || "Open your wallet's settings and switch the network to Solana Devnet."
  };
}

/** True when a preflight or RPC error looks like a mainnet wallet. */
export function looksLikeMainnet(message) {
  return /mainnet|5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d/i.test(String(message || ''));
}
