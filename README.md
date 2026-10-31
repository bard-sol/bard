# Bard

UX fix pass in progress — admin.html, admin_app.js, dashboard.html.

## Solana network and the Bard signer

The worker decides the Solana network once, and the browser follows it. `GET /api/config` returns a `solana` block (`network`, `rpc`, `explorerCluster`, `error`) built from the worker's `SOLANA_RPC`; no page or script picks a network or an RPC of its own.

- `SOLANA_RPC` (secret, server only): the RPC the worker reads. Its genesis hash names the network (`mainnet-beta`, `devnet`, `testnet`). The value is never sent to the browser or put in an error.
- `SOLANA_RPC_PUBLIC` (optional): the RPC the browser uses. It must be on the same network as `SOLANA_RPC`; a different network makes `/api/config` report an error and the vault pages stop. Without it the browser uses the public endpoint of the detected network. Set it in production when `SOLANA_RPC` is a keyed or rate-limited provider.
- Local and test runs: point `SOLANA_RPC` at devnet and the browser follows to devnet. A loopback URL on an unknown network (a local simulation) is passed to the browser as it is.
- `BARD_SIGNER_PUBKEY`: the public key of the wallet that signs as Bard. It must not be `FEE_TREASURY` (`server/chain.js`) or `BARD_CUT_WALLET`. While it is, the worker answers every vault-link, campaign-create, reserve and settlement write with a 500 that says why, and `/api/config` returns `signerError`. Unset is fine: the Bard sign step waits.

Check before a deploy, and again after it:

```
npm test                                                      # includes the real wrangler.toml
npm run check:signer                                          # wrangler.toml [vars]
BARD_SIGNER_PUBKEY=<pubkey> npm run check:signer -- --require-signer   # a key you are about to set
npm run check:signer -- --url https://bard.is --require-signer --expect-network mainnet-beta   # the live worker
```

`check:signer` prints public keys only and never reads `SOLANA_RPC`.
