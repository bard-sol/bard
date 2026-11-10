/**
 * Public Solana devnet for the simulations. Same interface as chain-local.mjs.
 *
 * Only https://api.devnet.solana.com is used, and the genesis hash is checked before anything
 * is sent. The team and Bard keys are the throwaway devnet keys in ~/.bard-devnet-rehearsal
 * (or BARD_REHEARSAL_KEY_DIR), shared with `npm run campaign:devnet`. No faucet is called: a
 * run that would need more devnet SOL than the team key holds stops before it starts. Holder
 * wallets are derived from the seed and never need SOL; the team pays their fees and rent, and
 * gets the token-account rent back when the run closes them.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  createTransferCheckedInstruction,
  createBurnCheckedInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
} from '@solana/spl-token';
import { DEVNET_GENESIS } from '../../../server/network.js';
import { DEVNET_RPC, assertDevnetUrl } from '../../src/rpc-guard.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function keyDirectory(root) {
  const home = (() => { try { return os.userInfo().homedir; } catch { return os.homedir(); } })();
  const chosen = process.env.BARD_REHEARSAL_KEY_DIR ? path.resolve(process.env.BARD_REHEARSAL_KEY_DIR) : path.join(home, '.bard-devnet-rehearsal');
  const relative = path.relative(root, chosen);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('the key directory must be outside the repository');
  }
  return chosen;
}

function loadKey(dir, role) {
  const file = path.join(dir, role + '.json');
  if (!existsSync(file)) throw new Error('devnet ' + role + ' key is missing at ' + file + '; run npm run campaign:devnet once to create it');
  chmodSync(file, 0o600);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(raw) || raw.length !== 64) throw new Error(role + ' key file is not a 64-byte keypair');
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

// Public devnet throttles bursts, per RPC method ("Too many requests for a specific RPC call").
// The worker reads every holder's balance at once, so calls go through a small gate, a 429 on a
// method pauses every caller of that method (not just the one that was refused), and the
// methods with the tightest limit are spaced out. Retrying each call on its own kept the
// window full, and a holder's balance came back unknown.
const MAX_IN_FLIGHT = 3;
const SPACED_MS = { getTokenAccountsByOwner: 700, getProgramAccounts: 1500 };
let inFlight = 0;
const waiting = [];
const methodReadyAt = new Map();

function rpcMethod(init) {
  try {
    const body = JSON.parse(String(init && init.body));
    return Array.isArray(body) ? 'batch' : String(body.method || '');
  } catch {
    return '';
  }
}

async function methodTurn(method) {
  for (;;) {
    const wait = (methodReadyAt.get(method) || 0) - Date.now();
    if (wait <= 0) break;
    await sleep(wait);
  }
  const spacing = SPACED_MS[method];
  if (spacing) methodReadyAt.set(method, Date.now() + spacing);
}

async function gate(fn) {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise((resolve) => waiting.push(resolve));
  inFlight += 1;
  try {
    return await fn();
  } finally {
    inFlight -= 1;
    const next = waiting.shift();
    if (next) next();
  }
}

async function devnetFetch(url, init) {
  assertDevnetUrl(url);
  const method = rpcMethod(init);
  for (let attempt = 0; ; attempt++) {
    await methodTurn(method);
    const res = await gate(() => fetch(url, init));
    if (attempt >= 20) return res;
    let limited = res.status === 429;
    if (!limited) limited = /rate limit|Too many requests/i.test(await res.clone().text());
    if (!limited) return res;
    const pause = Math.min(6000, 500 * 2 ** Math.min(attempt, 4)) + Math.floor(Math.random() * 400);
    methodReadyAt.set(method, Math.max(methodReadyAt.get(method) || 0, Date.now() + pause));
  }
}

export async function createDevnetChain(opts) {
  assertDevnetUrl(DEVNET_RPC);
  const connection = new Connection(DEVNET_RPC, { commitment: 'confirmed', fetch: (url, init) => devnetFetch(String(url), init) });
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS) throw new Error('genesis ' + genesis + ' is not devnet');
  const dir = keyDirectory(opts.root);
  const team = loadKey(dir, 'team');
  const bard = loadKey(dir, 'bard');
  const opened = [];

  async function send(feePayer, instructions, signers) {
    const block = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: feePayer.publicKey, recentBlockhash: block.blockhash });
    tx.add(...instructions);
    tx.sign(feePayer, ...(signers || []).filter((s) => !s.publicKey.equals(feePayer.publicKey)));
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction({ signature: sig, blockhash: block.blockhash, lastValidBlockHeight: block.lastValidBlockHeight }, 'confirmed');
    return sig;
  }

  const chain = {
    name: 'devnet',
    network: 'devnet',
    rpcUrl: DEVNET_RPC,
    // Devnet keeps every mint a past run created, so a replayed seed salts its mint keys.
    keySalt: randomBytes(4).toString('hex'),
    connection,
    unknownMethods: new Set(),
    get txCount() { return 0; },
    async rpcFetch(input, init) {
      const url = typeof input === 'string' ? input : input.url;
      return devnetFetch(url, init);
    },
    async slot() {
      return connection.getSlot('finalized');
    },
    advanceSlots() {},
    async waitForSlot(slot, timeoutMs = 240000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if ((await connection.getSlot('finalized')) >= Number(slot)) return;
        await sleep(2000);
      }
      throw new Error('devnet did not reach slot ' + slot);
    },
    /** Pays from the team key; there is no faucet. */
    async fundSol(pubkey, lamports) {
      if (new PublicKey(pubkey).equals(team.publicKey)) return;
      await send(team, [SystemProgram.transfer({ fromPubkey: team.publicKey, toPubkey: new PublicKey(pubkey), lamports: Number(lamports) })]);
    },
    async solBalance(pubkey) {
      return BigInt(await connection.getBalance(new PublicKey(pubkey), 'confirmed'));
    },
    async createMint(payer, mintKeypair, decimals, tokenProgram = TOKEN_PROGRAM_ID) {
      const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
      await send(payer, [
        SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mintKeypair.publicKey, space: MINT_SIZE, lamports: rent, programId: tokenProgram }),
        createInitializeMint2Instruction(mintKeypair.publicKey, decimals, payer.publicKey, null, tokenProgram),
      ], [mintKeypair]);
      return mintKeypair.publicKey.toBase58();
    },
    async mintTo(payer, mint, owner, amountRaw, tokenProgram = TOKEN_PROGRAM_ID) {
      const mintKey = new PublicKey(mint);
      const ownerKey = new PublicKey(owner);
      const ata = getAssociatedTokenAddressSync(mintKey, ownerKey, true, tokenProgram);
      await send(payer, [
        createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, ownerKey, mintKey, tokenProgram),
        createMintToInstruction(mintKey, ata, payer.publicKey, BigInt(amountRaw), [], tokenProgram),
      ]);
      opened.push({ owner: ownerKey.toBase58(), mint: mintKey.toBase58(), tokenProgram });
      return ata.toBase58();
    },
    async transferTokens(feePayer, ownerKeypair, mint, to, amountRaw, decimals, tokenProgram = TOKEN_PROGRAM_ID) {
      const mintKey = new PublicKey(mint);
      const toKey = new PublicKey(to);
      const fromAta = getAssociatedTokenAddressSync(mintKey, ownerKeypair.publicKey, true, tokenProgram);
      const toAta = getAssociatedTokenAddressSync(mintKey, toKey, true, tokenProgram);
      return send(feePayer, [
        createAssociatedTokenAccountIdempotentInstruction(feePayer.publicKey, toAta, toKey, mintKey, tokenProgram),
        createTransferCheckedInstruction(fromAta, mintKey, toAta, ownerKeypair.publicKey, BigInt(amountRaw), decimals, [], tokenProgram),
      ], [ownerKeypair]);
    },
    async tokenBalance(owner, mint, tokenProgram = TOKEN_PROGRAM_ID) {
      const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, tokenProgram);
      try {
        const acc = await getAccount(connection, ata, 'confirmed', tokenProgram);
        return BigInt(acc.amount.toString());
      } catch {
        return 0n;
      }
    },
    async teamKeys() {
      return { team, bard };
    },
    /**
     * Give back the rent of holder token accounts this run opened: each holder (a seeded key the
     * run controls) burns what it holds and closes the account to the team. The team pays fees.
     */
    async reclaim(keysByWallet) {
      let closed = 0;
      for (const item of opened) {
        const owner = keysByWallet.get(item.owner);
        if (!owner) continue;
        const mintKey = new PublicKey(item.mint);
        const ata = getAssociatedTokenAddressSync(mintKey, owner.publicKey, true, item.tokenProgram);
        let acc;
        try { acc = await getAccount(connection, ata, 'confirmed', item.tokenProgram); } catch { continue; }
        const ixs = [];
        if (acc.amount > 0n) {
          const decimals = (await connection.getParsedAccountInfo(mintKey)).value.data.parsed.info.decimals;
          ixs.push(createBurnCheckedInstruction(ata, mintKey, owner.publicKey, acc.amount, decimals, [], item.tokenProgram));
        }
        ixs.push(createCloseAccountInstruction(ata, team.publicKey, owner.publicKey, [], item.tokenProgram));
        try { await send(team, ixs, [owner]); closed += 1; } catch { /* left open; costs rent only */ }
      }
      return closed;
    },
    async close() {},
  };
  return chain;
}
