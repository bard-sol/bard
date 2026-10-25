/**
 * Local LiteSVM settlement path:
 * create 2-of-2 vault → deposit → reserve check → propose → team approve
 * → Bard approve → execute.
 *
 * Reuses the same vault transaction builders as bard-vault.js / devnet-e2e.mjs.
 * Runs once for a classic SPL mint and once for a Token-2022 mint.
 * Asserts balances, ATA creation, payout hash, and an over-balance failure.
 * Does not send transactions to any cluster.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
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
import {
  createTwoOfTwo,
  createPayoutProposal,
  teamApprove,
  executePayout,
} from '../src/index.js';
import { loadSquadsCache, SQUADS_PROGRAM_ID } from './litesvm-cache.mjs';
import { applyComputeBudget, createLiteSvmConnection } from './litesvm-connection.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DECIMALS = 6;
const UNIT = 1_000_000n;
const DEPOSIT = 1_000n * UNIT;
const POOL_HUMAN = '600';

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

function tokenBalance(account) {
  return BigInt(account.amount.toString());
}

async function bootSvm() {
  var cache = await loadSquadsCache();
  var svm = applyComputeBudget(new LiteSVM());
  svm.addProgram(cache.programId, cache.elf);
  svm.setAccount(cache.programConfig);
  var treasury = Object.assign({}, cache.treasury);
  if (treasury.lamports < 1_000_000n) treasury.lamports = 1_000_000_000n;
  svm.setAccount(treasury);
  var loaded = svm.getAccount(SQUADS_PROGRAM_ID);
  if (!loaded || loaded.exists === false) {
    throw new Error('Squads program did not load into LiteSVM');
  }
  return svm;
}

async function fund(svm, pubkey, sol) {
  var result = svm.airdrop(pubkey.toBase58(), BigInt(sol) * 1_000_000_000n);
  if (result instanceof FailedTransactionMetadata) {
    throw new Error('airdrop failed for ' + pubkey.toBase58());
  }
  svm.expireBlockhash();
}

async function runMint(connection, svm, label, tokenProgram, team, bard) {
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
  var fundSig = await connection.sendRawTransaction(fundTx.serialize());
  await connection.confirmTransaction(fundSig, 'confirmed');
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
  assert.equal(BigInt(balanceRaw), DEPOSIT);

  assert.throws(
    function () { platform.planReservation('0', '0', '1000.000001', balanceRaw, DECIMALS); },
    /exceeds vault token balance/
  );
  console.log('reserve refused over-balance');
  var reserved = platform.planReservation('0', '0', POOL_HUMAN, balanceRaw, DECIMALS);
  var again = platform.planReservation(reserved.projectReserved, reserved.campaignReserved, '50', balanceRaw, DECIMALS);
  assert.equal(again.campaignReserved, '650');
  console.log('reserve', reserved.projectReserved, 'then accumulated campaign', again.campaignReserved);

  var recipients = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  await getOrCreateAssociatedTokenAccount(
    connection, team, mint, recipients[0].publicKey, false, 'confirmed', undefined, tokenProgram
  );
  var missingBefore = [
    getAssociatedTokenAddressSync(mint, recipients[1].publicKey, true, tokenProgram),
    getAssociatedTokenAddressSync(mint, recipients[2].publicKey, true, tokenProgram),
  ];
  assert.equal(await connection.getAccountInfo(missingBefore[0]), null);
  assert.equal(await connection.getAccountInfo(missingBefore[1]), null);
  console.log('recipient0 ATA pre-created', recipients[0].publicKey.toBase58());
  console.log('recipient1 no ATA', recipients[1].publicKey.toBase58());
  console.log('recipient2 no ATA', recipients[2].publicKey.toBase58());

  var joins = [
    { wallet: recipients[0].publicKey.toBase58(), qualified: true, status: 'approved', progress: 30 },
    { wallet: recipients[1].publicKey.toBase58(), qualified: true, status: 'approved', progress: 20 },
    { wallet: recipients[2].publicKey.toBase58(), qualified: true, status: 'approved', progress: 10 },
  ];
  var built = platform.computePayouts({
    rewardMode: 'top3',
    pool: POOL_HUMAN,
    unit: 'TOKEN',
    config: { top3First: 50, top3Second: 30, top3Third: 20 },
  }, joins, DECIMALS);
  assert.equal(built.payouts.length, 3);
  var expectedHash = createHash('sha256').update(platform.canonicalPayoutText(built.payouts), 'utf8').digest('hex');
  assert.equal(built.hash, expectedHash);
  assert.equal(built.hash, platform.payoutHash(built.payouts));
  console.log('payoutHash', built.hash);
  console.log('payouts', built.payouts.map(function (p) { return p.wallet + ':' + p.amountRaw; }).join(' '));

  var proposed = await createPayoutProposal(
    connection,
    team,
    team.publicKey.toBase58(),
    created.multisig,
    mint.toBase58(),
    built.payouts
  );
  console.log('propose', proposed.signature);
  console.log('proposal', proposed.proposalSignature);
  console.log('txIndex', proposed.transactionIndex);
  assert.equal(proposed.tokenProgram, tokenProgram.toBase58());

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

  var paid = 0n;
  for (var i = 0; i < built.payouts.length; i++) {
    var row = built.payouts[i];
    var ata = getAssociatedTokenAddressSync(mint, new PublicKey(row.wallet), true, tokenProgram);
    var account = await getAccount(connection, ata, 'confirmed', tokenProgram);
    var expected = BigInt(row.amountRaw);
    assert.equal(tokenBalance(account), expected, label + ' recipient ' + row.wallet);
    paid += expected;
    console.log('balance', row.wallet, account.amount.toString());
  }
  assert.equal(paid, BigInt(built.totalRaw));
  var vaultAfter = await getAccount(connection, vaultAta.address, 'confirmed', tokenProgram);
  assert.equal(tokenBalance(vaultAfter), DEPOSIT - paid);
  assert.ok(await connection.getAccountInfo(missingBefore[0]));
  assert.ok(await connection.getAccountInfo(missingBefore[1]));
  console.log('vaultRemaining', vaultAfter.amount.toString());

  var over = [{
    wallet: recipients[0].publicKey.toBase58(),
    amount: '401',
    amountRaw: (401n * UNIT).toString(),
  }];
  var overProposed = await createPayoutProposal(
    connection, team, team.publicKey.toBase58(), created.multisig, mint.toBase58(), over
  );
  await teamApprove(connection, team, team.publicKey.toBase58(), created.multisig, overProposed.transactionIndex);
  await teamApprove(connection, bard, bard.publicKey.toBase58(), created.multisig, overProposed.transactionIndex);
  var overFailed = false;
  try {
    await executePayout(connection, team, team.publicKey.toBase58(), created.multisig, overProposed.transactionIndex);
  } catch (e) {
    overFailed = true;
    console.log('over-payout refused', e && e.message ? String(e.message).split('\n')[0] : e);
  }
  assert.equal(overFailed, true, label + ' over-payout must fail');
  var vaultStill = await getAccount(connection, vaultAta.address, 'confirmed', tokenProgram);
  assert.equal(tokenBalance(vaultStill), DEPOSIT - paid);

  console.log('ok', label);
  return {
    label: label,
    signatures: {
      createVault: created.signature,
      fundVault: fundSig,
      deposit: depositSig,
      propose: proposed.signature,
      proposal: proposed.proposalSignature,
      teamApprove: teamSig,
      bardApprove: bardSig,
      execute: execSig,
    },
    hash: built.hash,
    totalRaw: built.totalRaw,
  };
}

async function main() {
  var svm = await bootSvm();
  var connection = createLiteSvmConnection(svm);
  var team = Keypair.generate();
  var bard = Keypair.generate();
  console.log('sim', 'litesvm@1.6.1');
  console.log('squads', SQUADS_PROGRAM_ID);
  console.log('team', team.publicKey.toBase58());
  console.log('bard', bard.publicKey.toBase58());
  await fund(svm, team.publicKey, 2);
  await fund(svm, bard.publicKey, 1);
  var classic = await runMint(connection, svm, 'classic SPL', TOKEN_PROGRAM_ID, team, bard);
  await fund(svm, team.publicKey, 2);
  await fund(svm, bard.publicKey, 1);
  var token2022 = await runMint(connection, svm, 'Token-2022', TOKEN_2022_PROGRAM_ID, team, bard);
  console.log('\nsim e2e passed');
  console.log(JSON.stringify({ classic: classic, token2022: token2022 }, null, 2));
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
