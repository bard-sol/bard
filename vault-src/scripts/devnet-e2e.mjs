/**
 * Devnet settlement path:
 * create 2-of-2 vault → deposit → reserve check → propose → team approve
 * → Bard approve → execute.
 *
 * Runs once for a classic SPL mint and once for a Token-2022 mint.
 * Prints transaction signatures. Refuses any RPC that is not public devnet
 * and any request to Supabase.
 */
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transferChecked,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { DEVNET_RPC, assertDevnetUrl } from '../src/rpc-guard.js';
import {
  createTwoOfTwo,
  createPayoutProposal,
  teamApprove,
  executePayout,
} from '../src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DECIMALS = 6;
const UNIT = 1_000_000n;
const DEPOSIT = 1_000n * UNIT;
const PAYOUTS_HUMAN = [100n, 200n, 300n];

assertDevnetUrl(DEVNET_RPC);
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  var url = typeof input === 'string' ? input : (input && input.url);
  assertDevnetUrl(url);
  return originalFetch(input, init);
};

function loadPlatform() {
  const code = readFileSync(path.join(root, 'platform.js'), 'utf8');
  const sandbox = {
    console,
    URL,
    Date,
    Math,
    Number,
    String,
    BigInt,
    parseInt,
    JSON,
    Object,
    Array,
    Error,
    Promise,
    Uint8Array,
    Uint32Array,
    DataView,
    TextEncoder,
    encodeURIComponent,
    isNaN,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'platform.js' });
  return sandbox.BardPlatform;
}

const platform = loadPlatform();

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function airdrop(connection, pubkey, sol) {
  var lamports = sol * 1_000_000_000;
  var last = null;
  for (var attempt = 1; attempt <= 8; attempt++) {
    try {
      var sig = await connection.requestAirdrop(pubkey, lamports);
      var block = await connection.getLatestBlockhash('confirmed');
      await connection.confirmTransaction({
        signature: sig,
        blockhash: block.blockhash,
        lastValidBlockHeight: block.lastValidBlockHeight,
      }, 'confirmed');
      console.log('airdrop', pubkey.toBase58(), sol, 'SOL', sig);
      return sig;
    } catch (e) {
      last = e;
      console.log('airdrop retry', attempt, pubkey.toBase58(), e && e.message ? e.message : e);
      await sleep(2000 * attempt);
    }
  }
  throw last || new Error('airdrop failed');
}

async function ensureSol(connection, pubkey, minSol) {
  var balance = await connection.getBalance(pubkey, 'confirmed');
  if (balance >= minSol * 1_000_000_000) return;
  await airdrop(connection, pubkey, 1);
  balance = await connection.getBalance(pubkey, 'confirmed');
  if (balance < minSol * 1_000_000_000) await airdrop(connection, pubkey, 1);
}

async function runMint(connection, label, tokenProgram, team, bard) {
  console.log('\n=== ' + label + ' ===');
  var mint = await createMint(
    connection,
    team,
    team.publicKey,
    null,
    DECIMALS,
    Keypair.generate(),
    { commitment: 'confirmed' },
    tokenProgram
  );
  console.log('mint', mint.toBase58(), 'program', tokenProgram.toBase58());

  var created = await createTwoOfTwo(
    connection,
    team,
    team.publicKey.toBase58(),
    bard.publicKey.toBase58()
  );
  console.log('createVault', created.signature);
  console.log('multisig', created.multisig);
  console.log('vault', created.vault);
  var vault = new PublicKey(created.vault);
  // Recipient ATAs are created inside the vault transaction, paid by the vault PDA.
  // The vault must hold SOL for that rent before execution.
  var fundBlock = await connection.getLatestBlockhash('confirmed');
  var fundTx = new Transaction({
    feePayer: team.publicKey,
    recentBlockhash: fundBlock.blockhash,
  }).add(SystemProgram.transfer({
    fromPubkey: team.publicKey,
    toPubkey: vault,
    lamports: 50_000_000,
  }));
  fundTx.sign(team);
  var fundSig = await connection.sendRawTransaction(fundTx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({
    signature: fundSig,
    blockhash: fundBlock.blockhash,
    lastValidBlockHeight: fundBlock.lastValidBlockHeight,
  }, 'confirmed');
  console.log('fundVault', fundSig);

  var teamAta = await getOrCreateAssociatedTokenAccount(
    connection, team, mint, team.publicKey, false, 'confirmed', undefined, tokenProgram
  );
  await mintTo(
    connection, team, mint, teamAta.address, team, DEPOSIT, [], { commitment: 'confirmed' }, tokenProgram
  );
  var vaultAta = await getOrCreateAssociatedTokenAccount(
    connection, team, mint, vault, true, 'confirmed', undefined, tokenProgram
  );
  var depositSig = await transferChecked(
    connection,
    team,
    teamAta.address,
    mint,
    vaultAta.address,
    team,
    DEPOSIT,
    DECIMALS,
    [],
    { commitment: 'confirmed' },
    tokenProgram
  );
  console.log('deposit', depositSig);

  var chain = await getAccount(connection, vaultAta.address, 'confirmed', tokenProgram);
  var balanceRaw = chain.amount.toString();
  try {
    platform.planReservation('0', '0', '1000.000001', balanceRaw, DECIMALS);
    throw new Error('over-reserve was accepted');
  } catch (e) {
    if (!/exceeds vault token balance/i.test(String(e && e.message))) throw e;
    console.log('reserve refused over-balance');
  }
  var reserved = platform.planReservation('0', '0', '600', balanceRaw, DECIMALS);
  var again = platform.planReservation(reserved.projectReserved, reserved.campaignReserved, '50', balanceRaw, DECIMALS);
  if (again.campaignReserved !== '650') throw new Error('campaign reserve did not accumulate: ' + again.campaignReserved);
  console.log('reserve', reserved.projectReserved, 'then accumulated campaign', again.campaignReserved);

  var recipients = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  await getOrCreateAssociatedTokenAccount(
    connection, team, mint, recipients[0].publicKey, false, 'confirmed', undefined, tokenProgram
  );
  console.log('recipient0 ATA pre-created', recipients[0].publicKey.toBase58());
  console.log('recipient1 no ATA', recipients[1].publicKey.toBase58());
  console.log('recipient2 no ATA', recipients[2].publicKey.toBase58());

  var payouts = recipients.map(function (kp, i) {
    var raw = PAYOUTS_HUMAN[i] * UNIT;
    return {
      wallet: kp.publicKey.toBase58(),
      amount: PAYOUTS_HUMAN[i].toString(),
      amountRaw: raw.toString(),
    };
  });
  var proposed = await createPayoutProposal(
    connection,
    team,
    team.publicKey.toBase58(),
    created.multisig,
    mint.toBase58(),
    payouts
  );
  console.log('propose', proposed.signature);
  console.log('proposal', proposed.proposalSignature);
  console.log('txIndex', proposed.transactionIndex);
  if (proposed.tokenProgram !== tokenProgram.toBase58()) {
    throw new Error('token program mismatch ' + proposed.tokenProgram);
  }

  var teamSig = await teamApprove(
    connection, team, team.publicKey.toBase58(), created.multisig, proposed.transactionIndex
  );
  console.log('teamApprove', teamSig);
  var bardSig = await teamApprove(
    connection, bard, bard.publicKey.toBase58(), created.multisig, proposed.transactionIndex
  );
  console.log('bardApprove', bardSig);
  var execSig = await executePayout(
    connection, team, team.publicKey.toBase58(), created.multisig, proposed.transactionIndex
  );
  console.log('execute', execSig);

  for (var i = 0; i < recipients.length; i++) {
    var ata = getAssociatedTokenAddressSync(mint, recipients[i].publicKey, true, tokenProgram);
    var account = await getAccount(connection, ata, 'confirmed', tokenProgram);
    var expected = PAYOUTS_HUMAN[i] * UNIT;
    if (account.amount !== expected) {
      throw new Error(label + ' recipient ' + i + ' balance ' + account.amount.toString() + ' != ' + expected.toString());
    }
    console.log('balance', recipients[i].publicKey.toBase58(), account.amount.toString());
  }
  console.log('ok', label);
}

async function main() {
  var connection = new Connection(DEVNET_RPC, 'confirmed');
  var team = Keypair.generate();
  var bard = Keypair.generate();
  console.log('devnet', DEVNET_RPC);
  console.log('team', team.publicKey.toBase58());
  console.log('bard', bard.publicKey.toBase58());
  await ensureSol(connection, team.publicKey, 2);
  await ensureSol(connection, bard.publicKey, 1);
  await runMint(connection, 'classic SPL', TOKEN_PROGRAM_ID, team, bard);
  await ensureSol(connection, team.publicKey, 1);
  await ensureSol(connection, bard.publicKey, 1);
  await runMint(connection, 'Token-2022', TOKEN_2022_PROGRAM_ID, team, bard);
  console.log('\ndevnet e2e passed');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
