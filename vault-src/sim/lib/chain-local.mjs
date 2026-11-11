/**
 * Local Solana for the simulations: LiteSVM with the real Squads v4 program (dumped once from
 * devnet into vault-src/.litesvm-cache) and the real SPL Token program. Nothing is sent to any
 * cluster.
 *
 * The worker reads the chain through JSON-RPC, so this module also answers the RPC methods the
 * worker calls (getAccountInfo, getTokenAccountsByOwner, getProgramAccounts, getSlot, getBlock,
 * getTransaction, getGenesisHash) from LiteSVM state. Its genesis hash is its own, so the worker
 * reports the network as "custom", never as devnet or mainnet.
 */
import { createHash } from 'node:crypto';
import { LiteSVM } from 'litesvm';
import bs58 from 'bs58';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
} from '@solana/spl-token';
import { loadSquadsCache } from '../../scripts/litesvm-cache.mjs';
import { applyComputeBudget, createLiteSvmConnection } from '../../scripts/litesvm-connection.mjs';

export const LOCAL_GENESIS = bs58.encode(createHash('sha256').update('bard-sim-litesvm-local-chain').digest());
const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);
const SYSTEM = SystemProgram.programId.toBase58();

// The reply echoes the request id: web3.js in the browser refuses a reply whose id is not its own.
function rpcOk(result, id = 1) {
  return Response.json({ jsonrpc: '2.0', id, result });
}

function rpcErr(code, message, id = 1) {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } });
}

function u64(data, offset) {
  return Buffer.from(data).readBigUInt64LE(offset);
}

function tokenAccountView(data) {
  if (!data || data.length < 165) return null;
  const buf = Buffer.from(data);
  return {
    mint: new PublicKey(buf.subarray(0, 32)).toBase58(),
    owner: new PublicKey(buf.subarray(32, 64)).toBase58(),
    amount: u64(buf, 64),
    state: buf[108],
  };
}

function wireKeys(bytes) {
  try {
    const versioned = VersionedTransaction.deserialize(Buffer.from(bytes));
    return {
      keys: versioned.message.staticAccountKeys.map((k) => k.toBase58()),
      compiled: versioned.message.compiledInstructions.map((ix) => ({
        programIdIndex: ix.programIdIndex,
        accounts: Array.from(ix.accountKeyIndexes),
        data: Uint8Array.from(ix.data),
      })),
      signature: bs58.encode(versioned.signatures[0]),
    };
  } catch {
    const legacy = Transaction.from(Buffer.from(bytes));
    const message = legacy.compileMessage();
    return {
      keys: message.accountKeys.map((k) => k.toBase58()),
      compiled: message.instructions.map((ix) => ({
        programIdIndex: ix.programIdIndex,
        accounts: ix.accounts.slice(),
        data: Uint8Array.from(bs58.decode(ix.data)),
      })),
      signature: bs58.encode(legacy.signature),
    };
  }
}

/**
 * opts.rng   seeded random source; picks which slots are skipped so the draw's skip handling runs
 * opts.clock () => ms, the simulation clock used for block times
 */
export async function createLocalChain(opts = {}) {
  const cache = await loadSquadsCache();
  const svm = applyComputeBudget(new LiteSVM());
  svm.addProgram(cache.programId, cache.elf);
  svm.setAccount(cache.programConfig);
  const treasury = Object.assign({}, cache.treasury);
  if (treasury.lamports < 1_000_000n) treasury.lamports = 1_000_000_000n;
  svm.setAccount(treasury);

  const clock = opts.clock || (() => Date.now());
  const rng = opts.rng || null;
  const blocks = new Map();
  const history = new Map();
  const unknownMethods = new Set();
  const decimalsCache = new Map();
  let txCount = 0;

  function slotNow() {
    return Number(svm.getClock().slot);
  }

  blocks.set(slotNow(), { blockhash: svm.latestBlockhash(), parent: slotNow() - 1, time: clock() });

  // Move one slot forward and give it a new blockhash. A seeded share of slots is skipped,
  // the way real leaders sometimes skip, so the draw has to look past them.
  function tick(allowSkip) {
    const next = slotNow() + 1;
    svm.warpToSlot(BigInt(next));
    const skipped = allowSkip && rng && rng.next() < 0.08;
    if (skipped) return;
    svm.expireBlockhash();
    const parent = [...blocks.keys()].reduce((a, b) => Math.max(a, b), 0);
    blocks.set(next, { blockhash: svm.latestBlockhash(), parent, time: clock() });
  }

  function accountRaw(address) {
    const acc = svm.getAccount(String(address));
    if (!acc || acc.exists === false) return null;
    return acc;
  }

  function mintDecimals(mint) {
    if (decimalsCache.has(mint)) return decimalsCache.get(mint);
    const acc = accountRaw(mint);
    if (!acc || acc.data.length < 45) return null;
    const d = acc.data[44];
    decimalsCache.set(mint, d);
    return d;
  }

  function tokenBalances(keys) {
    const out = [];
    keys.forEach((key, accountIndex) => {
      const acc = accountRaw(key);
      if (!acc || !TOKEN_PROGRAMS.has(acc.programAddress) || acc.data.length < 165) return;
      const view = tokenAccountView(acc.data);
      if (!view) return;
      const decimals = mintDecimals(view.mint);
      out.push({
        accountIndex,
        mint: view.mint,
        owner: view.owner,
        programId: acc.programAddress,
        uiTokenAmount: { amount: view.amount.toString(), decimals, uiAmountString: view.amount.toString() },
      });
    });
    return out;
  }

  function parseInstruction(raw, keys) {
    // Outer instructions come from web3.js as plain objects; LiteSVM inner ones have getter methods.
    const ix = typeof raw.programIdIndex === 'function'
      ? { programIdIndex: raw.programIdIndex(), accounts: Array.from(raw.accounts()), data: raw.data() }
      : raw;
    const programId = keys[ix.programIdIndex];
    const accounts = Array.from(ix.accounts || ix.accountKeyIndexes || []).map((i) => keys[i]);
    const data = ix.data instanceof Uint8Array ? ix.data : Uint8Array.from(ix.data || []);
    if (TOKEN_PROGRAMS.has(programId) && data.length >= 10 && data[0] === 12 && accounts.length >= 4) {
      return {
        program: programId === TOKEN_2022_PROGRAM_ID.toBase58() ? 'spl-token-2022' : 'spl-token',
        programId,
        parsed: {
          type: 'transferChecked',
          info: {
            source: accounts[0],
            mint: accounts[1],
            destination: accounts[2],
            authority: accounts[3],
            tokenAmount: { amount: u64(data, 1).toString(), decimals: data[9] },
          },
        },
      };
    }
    if (TOKEN_PROGRAMS.has(programId) && data.length >= 9 && data[0] === 3 && accounts.length >= 3) {
      return {
        program: programId === TOKEN_2022_PROGRAM_ID.toBase58() ? 'spl-token-2022' : 'spl-token',
        programId,
        parsed: {
          type: 'transfer',
          info: { source: accounts[0], destination: accounts[1], authority: accounts[2], amount: u64(data, 1).toString() },
        },
      };
    }
    return { programId, accounts, data: bs58.encode(data) };
  }

  function innerGroups(meta) {
    let raw = [];
    try { raw = meta.innerInstructions() || []; } catch { raw = []; }
    if (!raw.length) return [];
    return Array.isArray(raw[0]) ? raw : [raw];
  }

  const connection = createLiteSvmConnection(svm);
  const baseSend = connection.sendRawTransaction.bind(connection);
  connection.sendRawTransaction = async function (raw) {
    const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
    const wire = wireKeys(bytes);
    const pre = tokenBalances(wire.keys);
    const signature = await baseSend(bytes);
    const meta = this.lastSent.meta;
    const post = tokenBalances(wire.keys);
    const slot = slotNow();
    let logs = [];
    try { logs = meta.logs(); } catch { logs = []; }
    const inner = innerGroups(meta)
      .map((group, index) => ({
        index,
        instructions: (group || []).map((item) => parseInstruction(item && typeof item.instruction === 'function' ? item.instruction() : item, wire.keys)),
      }))
      .filter((group) => group.instructions.length);
    history.set(signature, {
      slot,
      blockTime: Math.floor(clock() / 1000),
      transaction: {
        signatures: [signature],
        message: {
          accountKeys: wire.keys.map((pubkey) => ({ pubkey, signer: false, writable: true, source: 'transaction' })),
          instructions: wire.compiled.map((ix) => parseInstruction(ix, wire.keys)),
        },
      },
      meta: {
        err: null,
        fee: 5000,
        logMessages: logs,
        innerInstructions: inner,
        preTokenBalances: pre,
        postTokenBalances: post,
        loadedAddresses: { writable: [], readonly: [] },
      },
      version: 'legacy',
    });
    txCount += 1;
    tick(false);
    return signature;
  };
  connection.getSignatureStatuses = async function (sigs) {
    return { context: { slot: slotNow() }, value: sigs.map((s) => (history.has(s) ? { slot: history.get(s).slot, confirmations: null, err: null, confirmationStatus: 'finalized' } : null)) };
  };

  function encodeAccount(acc, encoding) {
    const base = {
      lamports: Number(acc.lamports),
      owner: acc.programAddress,
      executable: !!acc.executable,
      rentEpoch: 0,
      space: acc.data.length,
    };
    if (encoding === 'jsonParsed' && TOKEN_PROGRAMS.has(acc.programAddress) && acc.data.length >= 165) {
      const view = tokenAccountView(acc.data);
      const decimals = mintDecimals(view.mint);
      return Object.assign(base, {
        data: {
          program: acc.programAddress === TOKEN_2022_PROGRAM_ID.toBase58() ? 'spl-token-2022' : 'spl-token',
          parsed: {
            type: 'account',
            info: {
              mint: view.mint,
              owner: view.owner,
              state: view.state === 2 ? 'frozen' : 'initialized',
              tokenAmount: { amount: view.amount.toString(), decimals, uiAmountString: view.amount.toString() },
            },
          },
          space: acc.data.length,
        },
      });
    }
    return Object.assign(base, { data: [Buffer.from(acc.data).toString('base64'), 'base64'] });
  }

  function memcmpOk(data, filter) {
    const want = Buffer.from(bs58.decode(filter.memcmp.bytes));
    const at = Number(filter.memcmp.offset || 0);
    return Buffer.from(data).subarray(at, at + want.length).equals(want);
  }

  function programAccounts(program, filters) {
    const list = svm.getProgramAccounts(String(program)) || [];
    return list
      .map((item) => ({ pubkey: item.address ? String(item.address) : String(item.pubkey), account: item.account || item }))
      .filter(({ account }) => (filters || []).every((f) => {
        if (f.dataSize != null) return account.data.length === Number(f.dataSize);
        if (f.memcmp) return memcmpOk(account.data, f);
        return true;
      }));
  }

  const methods = {
    getGenesisHash: () => LOCAL_GENESIS,
    getHealth: () => 'ok',
    getVersion: () => ({ 'solana-core': 'litesvm', 'feature-set': 0 }),
    getSlot: () => slotNow(),
    getBlockHeight: () => slotNow(),
    getLatestBlockhash: () => ({ context: { slot: slotNow() }, value: { blockhash: svm.latestBlockhash(), lastValidBlockHeight: slotNow() + 150 } }),
    getBalance: ([address]) => ({ context: { slot: slotNow() }, value: Number(svm.getBalance(String(address)) || 0n) }),
    // What a browser wallet sends: the signed transaction runs at once, so it is final on return.
    sendTransaction: async ([encoded, cfg]) => {
      const bytes = cfg && cfg.encoding === 'base64' ? Buffer.from(String(encoded), 'base64') : bs58.decode(String(encoded));
      try {
        return await connection.sendRawTransaction(Uint8Array.from(bytes));
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        throw Object.assign(new Error('Transaction simulation failed: ' + message), { code: -32002 });
      }
    },
    getAccountInfo: ([address, cfg]) => {
      const acc = accountRaw(address);
      return { context: { slot: slotNow() }, value: acc ? encodeAccount(acc, cfg && cfg.encoding) : null };
    },
    getMultipleAccounts: ([addresses, cfg]) => ({
      context: { slot: slotNow() },
      value: addresses.map((address) => {
        const acc = accountRaw(address);
        return acc ? encodeAccount(acc, cfg && cfg.encoding) : null;
      }),
    }),
    getTokenAccountsByOwner: ([owner, filter, cfg]) => {
      const programs = filter && filter.programId ? [filter.programId] : [...TOKEN_PROGRAMS];
      const out = [];
      for (const program of programs) {
        for (const item of programAccounts(program, [{ dataSize: 165 }])) {
          const view = tokenAccountView(item.account.data);
          if (!view || view.owner !== owner) continue;
          if (filter && filter.mint && view.mint !== filter.mint) continue;
          out.push({ pubkey: item.pubkey, account: encodeAccount(Object.assign({}, item.account, { programAddress: program }), cfg && cfg.encoding) });
        }
      }
      return { context: { slot: slotNow() }, value: out };
    },
    getProgramAccounts: ([program, cfg]) => programAccounts(program, cfg && cfg.filters)
      .map((item) => ({ pubkey: item.pubkey, account: encodeAccount(Object.assign({}, item.account, { programAddress: program }), cfg && cfg.encoding) })),
    getBlock: ([slot]) => {
      const n = Number(slot);
      if (n > slotNow()) throw { code: -32004, message: 'Block not available for slot ' + n };
      const block = blocks.get(n);
      if (!block) throw { code: -32007, message: 'Slot ' + n + ' was skipped, or missing due to ledger jump to recent snapshot' };
      const parent = blocks.get(block.parent);
      return {
        blockhash: block.blockhash,
        previousBlockhash: parent ? parent.blockhash : block.blockhash,
        parentSlot: block.parent,
        blockHeight: n,
        blockTime: Math.floor(block.time / 1000),
      };
    },
    getTransaction: ([signature]) => history.get(String(signature)) || null,
    getSignatureStatuses: ([sigs]) => ({ context: { slot: slotNow() }, value: sigs.map((s) => (history.has(s) ? { slot: history.get(s).slot, confirmations: null, err: null, confirmationStatus: 'finalized' } : null)) }),
    getMinimumBalanceForRentExemption: ([size]) => Number(svm.minimumBalanceForRentExemption(BigInt(size))),
  };

  /** JSON-RPC over fetch. Only the methods above; anything else is an RPC error and is recorded. */
  async function rpcFetch(input, init = {}) {
    const text = init.body != null ? String(init.body) : (input instanceof Request ? await input.text() : '');
    let payload;
    try { payload = JSON.parse(text); } catch { return rpcErr(-32700, 'parse error'); }
    const id = payload.id == null ? 1 : payload.id;
    const fn = methods[payload.method];
    if (!fn) {
      unknownMethods.add(payload.method);
      return rpcErr(-32601, 'Method not found: ' + payload.method, id);
    }
    try {
      return rpcOk(await fn(payload.params || []), id);
    } catch (err) {
      if (err && typeof err.code === 'number') return rpcErr(err.code, err.message, id);
      return rpcErr(-32603, err && err.message ? err.message : String(err), id);
    }
  }

  async function send(feePayer, instructions, signers) {
    const tx = new Transaction({ feePayer: feePayer.publicKey, recentBlockhash: svm.latestBlockhash() });
    tx.add(...instructions);
    tx.sign(feePayer, ...(signers || []).filter((s) => !s.publicKey.equals(feePayer.publicKey)));
    return connection.sendRawTransaction(tx.serialize());
  }

  return {
    name: 'local',
    network: 'custom',
    connection,
    rpcFetch,
    unknownMethods,
    svm,
    get txCount() { return txCount; },
    /** Every transaction the chain ran, as getTransaction returns it. */
    transactions() { return [...history.entries()].map(([signature, tx]) => ({ signature, ...tx })); },
    slot: slotNow,
    /** Move the chain forward n slots (some are skipped), as time passes on a real cluster. */
    advanceSlots(n) {
      for (let i = 0; i < n; i++) tick(true);
    },
    async waitForSlot(slot) {
      while (slotNow() < Number(slot)) tick(true);
    },
    async fundSol(pubkey, lamports) {
      const out = svm.airdrop(String(pubkey), BigInt(lamports));
      if (out && out.constructor && out.constructor.name === 'FailedTransactionMetadata') throw new Error('airdrop failed');
    },
    async solBalance(pubkey) {
      return BigInt(svm.getBalance(String(pubkey)) || 0n);
    },
    async createMint(payer, mintKeypair, decimals, tokenProgram = TOKEN_PROGRAM_ID) {
      const rent = Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE)));
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
      return ata.toBase58();
    },
    /** Owner moves tokens to another wallet; feePayer pays the fee and any new account rent. */
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
      const acc = accountRaw(ata.toBase58());
      if (!acc) return 0n;
      return tokenAccountView(acc.data).amount;
    },
    async teamKeys(rng) {
      return { team: Keypair.fromSeed(rng.seedBytes('team')), bard: Keypair.fromSeed(rng.seedBytes('bard')) };
    },
    async close() {},
  };
}

export { SYSTEM };
