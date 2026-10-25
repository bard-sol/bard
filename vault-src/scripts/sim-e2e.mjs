/**
 * Local LiteSVM settlement path:
 * create 2-of-2 vault → deposit → reserve check → propose → team approve
 * → Bard approve → execute.
 *
 * Reuses the same vault transaction builders as bard-vault.js / devnet-e2e.mjs.
 * Runs once for a classic SPL mint and once for a Token-2022 mint.
 * Asserts balances, ATA creation, payout hash, the treasury cut, and an over-balance failure.
 * A third run waives the cut. Does not send transactions to any cluster.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transferChecked,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import * as multisig from '@sqds/multisig';
import {
  createTwoOfTwo,
  createPayoutProposal,
  teamApprove,
  executePayout,
} from '../src/index.js';
import { verifyExecutedPayout } from '../../server/api.js';
import { decodeVaultTransactionAccount, verifyVaultTransactionMessage } from '../../server/approve.js';
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

function accountKeysFromWire(bytes) {
  var wire = Buffer.from(bytes);
  try {
    var versioned = VersionedTransaction.deserialize(wire);
    return versioned.message.staticAccountKeys.map(function (key) { return key.toBase58(); });
  } catch (e) {
    var legacy = Transaction.from(wire);
    return legacy.compileMessage().accountKeys.map(function (key) { return key.toBase58(); });
  }
}

function parsedCompiled(ix, keys) {
  var programIndex = typeof ix.programIdIndex === 'function' ? ix.programIdIndex() : ix.programIdIndex;
  var rawAccounts = typeof ix.accounts === 'function' ? ix.accounts() : (ix.accountKeyIndexes || ix.accounts);
  var rawData = typeof ix.data === 'function' ? ix.data() : ix.data;
  var programId = keys[programIndex] || '';
  var accounts = Array.from(rawAccounts || []).map(function (index) { return keys[index] || ''; });
  var data = Uint8Array.from(rawData || []);
  var tokenName = programId === TOKEN_2022_PROGRAM_ID.toBase58() ? 'spl-token-2022'
    : (programId === TOKEN_PROGRAM_ID.toBase58() ? 'spl-token' : '');
  if (tokenName && data.length >= 10 && data[0] === 12 && accounts.length >= 4) {
    var amount = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(1, true);
    return {
      program: tokenName,
      programId: programId,
      parsed: {
        type: 'transferChecked',
        info: {
          source: accounts[0],
          mint: accounts[1],
          destination: accounts[2],
          authority: accounts[3],
          tokenAmount: { amount: amount.toString(), decimals: data[9] },
        },
      },
    };
  }
  return { programId: programId, accounts: accounts, data: Buffer.from(data).toString('base64') };
}

function outerCompiled(bytes) {
  try {
    var versioned = VersionedTransaction.deserialize(Buffer.from(bytes));
    return versioned.message.compiledInstructions.map(function (ix) {
      return { programIdIndex: ix.programIdIndex, accountKeyIndexes: ix.accountKeyIndexes, data: ix.data };
    });
  } catch (e) {
    var legacy = Transaction.from(Buffer.from(bytes));
    return legacy.compileMessage().instructions.map(function (ix) {
      return { programIdIndex: ix.programIdIndex, accounts: ix.accounts, data: ix.data };
    });
  }
}

function innerGroups(meta) {
  var raw = meta.innerInstructions();
  if (!raw || !raw.length) return [];
  if (Array.isArray(raw[0])) return raw;
  return [raw];
}

function jsonParsedFromSent(sent) {
  var logs = sent.meta.logs();
  var keys = accountKeysFromWire(sent.bytes);
  var innerInstructions = [];
  var groups = innerGroups(sent.meta);
  for (var i = 0; i < groups.length; i++) {
    var group = groups[i] || [];
    if (!group.length) continue;
    innerInstructions.push({
      index: i,
      instructions: group.map(function (inner) {
        var ix = inner && typeof inner.instruction === 'function' ? inner.instruction() : inner;
        return parsedCompiled(ix, keys);
      }),
    });
  }
  return {
    logs: logs,
    parsed: {
      meta: { err: null, logMessages: logs, innerInstructions: innerInstructions },
      transaction: {
        message: {
          accountKeys: keys,
          instructions: outerCompiled(sent.bytes).map(function (ix) { return parsedCompiled(ix, keys); }),
        },
      },
    },
  };
}

function countTransfers(parsed) {
  var n = 0;
  var groups = [parsed.transaction.message.instructions].concat(
    (parsed.meta.innerInstructions || []).map(function (group) { return group.instructions || []; })
  );
  for (var g = 0; g < groups.length; g++) {
    for (var i = 0; i < groups[g].length; i++) {
      if (groups[g][i].parsed && groups[g][i].parsed.type === 'transferChecked') n += 1;
    }
  }
  return n;
}

function proofEnv(parsedTx, tokenProgram) {
  var mintData = Buffer.alloc(82);
  mintData[44] = DECIMALS;
  return {
    SOLANA_RPC: 'http://127.0.0.1/proof',
    fetch: async function (url, opts) {
      void url;
      var payload = JSON.parse(opts.body);
      if (payload.method === 'getTransaction') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: parsedTx });
      }
      if (payload.method === 'getAccountInfo') {
        return Response.json({ jsonrpc: '2.0', id: 1, result: {
          value: { owner: tokenProgram, data: [mintData.toString('base64'), 'base64'] },
        }});
      }
      throw new Error('unexpected proof rpc ' + payload.method);
    },
  };
}

async function assertRealExecute(sent, signature, settlement, project, tokenProgram, minTransfers) {
  var built = jsonParsedFromSent(sent);
  assert.ok(
    built.logs.some(function (line) { return String(line).includes('VaultTransactionExecute'); }),
    'real execute logs did not include VaultTransactionExecute\n' + built.logs.join('\n')
  );
  assert.ok(countTransfers(built.parsed) >= minTransfers, 'simulated execute did not expose transferChecked instructions');
  var env = proofEnv(built.parsed, tokenProgram);
  await verifyExecutedPayout(env, settlement, project, signature);
  return built;
}

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

async function sendSigned(connection, tx, signer) {
  tx.sign([signer]);
  var signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}

async function proposeExtraTransfer(connection, team, multisigAddress, mint, tokenProgram, payouts, stranger) {
  var multisigPda = new PublicKey(String(multisigAddress));
  var vaultPda = multisig.getVaultPda({ multisigPda: multisigPda, index: 0 })[0];
  var account = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  var transactionIndex = BigInt(account.transactionIndex.toString()) + 1n;
  var vaultAta = getAssociatedTokenAddressSync(mint, vaultPda, true, tokenProgram);
  var ordered = payouts.slice().sort(function (a, b) {
    if (a.wallet < b.wallet) return -1;
    if (a.wallet > b.wallet) return 1;
    return 0;
  });
  var instructions = [
    createAssociatedTokenAccountIdempotentInstruction(vaultPda, vaultAta, vaultPda, mint, tokenProgram),
  ];
  for (var i = 0; i < ordered.length; i++) {
    var owner = new PublicKey(ordered[i].wallet);
    var ata = getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(vaultPda, ata, owner, mint, tokenProgram));
    instructions.push(createTransferCheckedInstruction(
      vaultAta, mint, ata, vaultPda, BigInt(ordered[i].amountRaw), DECIMALS, [], tokenProgram
    ));
  }
  var strangerAta = getAssociatedTokenAddressSync(mint, stranger, true, tokenProgram);
  instructions.push(createTransferCheckedInstruction(
    vaultAta, mint, strangerAta, vaultPda, 1n, DECIMALS, [], tokenProgram
  ));
  var block = await connection.getLatestBlockhash('confirmed');
  var message = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: block.blockhash,
    instructions: instructions,
  });
  var createSig = await sendSigned(connection, multisig.transactions.vaultTransactionCreate({
    blockhash: block.blockhash,
    feePayer: team.publicKey,
    multisigPda: multisigPda,
    transactionIndex: transactionIndex,
    creator: team.publicKey,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage: message,
    memo: 'bard extra',
  }), team);
  var proposalBlock = await connection.getLatestBlockhash('confirmed');
  await sendSigned(connection, multisig.transactions.proposalCreate({
    blockhash: proposalBlock.blockhash,
    feePayer: team.publicKey,
    multisigPda: multisigPda,
    transactionIndex: transactionIndex,
    creator: team.publicKey,
    rentPayer: team.publicKey,
    isDraft: false,
  }), team);
  return { transactionIndex: transactionIndex.toString(), signature: createSig };
}

async function runMint(connection, svm, label, tokenProgram, team, bard, cutBps) {
  if (cutBps == null) cutBps = 500;
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
  var treasury = Keypair.generate();
  var holderTotal = 0n;
  for (var h = 0; h < built.payouts.length; h++) holderTotal += BigInt(built.payouts[h].amountRaw);
  var cutRaw = BigInt(cutBps) <= 0n ? 0n : (holderTotal * BigInt(cutBps)) / 10000n;
  var lines = built.payouts.map(function (p) { return { wallet: p.wallet, amountRaw: String(p.amountRaw) }; });
  var cutArg = null;
  if (cutRaw > 0n) {
    lines.push({ wallet: treasury.publicKey.toBase58(), amountRaw: cutRaw.toString() });
    cutArg = { wallet: treasury.publicKey.toBase58(), amountRaw: cutRaw.toString() };
  }
  var payoutHash = platform.payoutHash(lines);
  if (cutRaw > 0n) assert.notEqual(payoutHash, built.hash);
  else assert.equal(payoutHash, built.hash);
  console.log('payoutHash', payoutHash, 'cutRaw', cutRaw.toString());
  console.log('payouts', lines.map(function (p) { return p.wallet + ':' + p.amountRaw; }).join(' '));

  var proposed = await createPayoutProposal(
    connection,
    team,
    team.publicKey.toBase58(),
    created.multisig,
    mint.toBase58(),
    built.payouts,
    cutArg
  );
  console.log('propose', proposed.signature);
  console.log('proposal', proposed.proposalSignature);
  console.log('txIndex', proposed.transactionIndex);
  assert.equal(proposed.tokenProgram, tokenProgram.toBase58());
  var txPda = multisig.getTransactionPda({
    multisigPda: new PublicKey(created.multisig),
    index: BigInt(proposed.transactionIndex),
  })[0];
  var stored = await connection.getAccountInfo(txPda);
  var decoded = decodeVaultTransactionAccount(stored.data);
  assert.ok(decoded, label + ' vault transaction did not decode');
  var verdict = await verifyVaultTransactionMessage(decoded, {
    payouts: built.payouts,
    payout_hash: payoutHash,
    cut_raw: cutRaw.toString(),
    cut_wallet: treasury.publicKey.toBase58(),
    cut_waived: cutRaw === 0n,
  }, {
    multisig: created.multisig,
    vaultAddress: created.vault,
    mint: mint.toBase58(),
    decimals: DECIMALS,
    tokenProgram: tokenProgram.toBase58(),
  });
  assert.equal(verdict.ok, true, label + ' signer rejected the proposal: ' + verdict.reason);

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
  var cleanSent = connection.lastSent;

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
  var treasuryAta = getAssociatedTokenAddressSync(mint, treasury.publicKey, true, tokenProgram);
  if (cutRaw > 0n) {
    var treasuryAccount = await getAccount(connection, treasuryAta, 'confirmed', tokenProgram);
    assert.equal(tokenBalance(treasuryAccount), cutRaw, label + ' treasury');
    console.log('treasury', treasury.publicKey.toBase58(), treasuryAccount.amount.toString());
  } else {
    assert.equal(await connection.getAccountInfo(treasuryAta), null, label + ' waived cut created a treasury account');
  }
  var vaultAfter = await getAccount(connection, vaultAta.address, 'confirmed', tokenProgram);
  assert.equal(tokenBalance(vaultAfter), DEPOSIT - paid - cutRaw);
  assert.ok(await connection.getAccountInfo(missingBefore[0]));
  assert.ok(await connection.getAccountInfo(missingBefore[1]));
  console.log('vaultRemaining', vaultAfter.amount.toString());
  var settlement = {
    vault_multisig: created.multisig,
    tx_index: proposed.transactionIndex,
    payouts: built.payouts,
    cut_raw: cutRaw.toString(),
    cut_wallet: treasury.publicKey.toBase58(),
    cut_waived: cutRaw === 0n,
  };
  var project = {
    vault_multisig: created.multisig,
    vault_address: created.vault,
    vault_mint: mint.toBase58(),
    mint: mint.toBase58(),
  };
  await assertRealExecute(cleanSent, execSig, settlement, project, tokenProgram.toBase58(), built.payouts.length + (cutRaw > 0n ? 1 : 0));
  console.log('verifyExecutedPayout accepted the real execute');

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
  assert.equal(tokenBalance(vaultStill), DEPOSIT - paid - cutRaw);

  // The clean execute already spent the reserved pool. Top the vault up so the
  // same payouts plus one stranger transfer can actually land on chain.
  await mintTo(
    connection, team, mint, teamAta.address, team, paid + UNIT, [], { commitment: 'confirmed' }, tokenProgram
  );
  await transferChecked(
    connection, team, teamAta.address, mint, vaultAta.address, team, paid + 1n, DECIMALS, [],
    { commitment: 'confirmed' }, tokenProgram
  );
  var stranger = Keypair.generate();
  await getOrCreateAssociatedTokenAccount(
    connection, team, mint, stranger.publicKey, false, 'confirmed', undefined, tokenProgram
  );
  var extra = await proposeExtraTransfer(
    connection, team, created.multisig, mint, tokenProgram, built.payouts, stranger.publicKey
  );
  var extraPda = multisig.getTransactionPda({
    multisigPda: new PublicKey(created.multisig),
    index: BigInt(extra.transactionIndex),
  })[0];
  var extraStored = await connection.getAccountInfo(extraPda);
  var extraDecoded = decodeVaultTransactionAccount(extraStored.data);
  var extraVerdict = await verifyVaultTransactionMessage(extraDecoded, {
    payouts: built.payouts,
    payout_hash: built.hash,
  }, {
    multisig: created.multisig,
    vaultAddress: created.vault,
    mint: mint.toBase58(),
    decimals: DECIMALS,
    tokenProgram: tokenProgram.toBase58(),
  });
  assert.equal(extraVerdict.ok, false, label + ' extra transfer must fail the signer');
  assert.equal(extraVerdict.reason, 'extra_instruction');
  await teamApprove(connection, team, team.publicKey.toBase58(), created.multisig, extra.transactionIndex);
  await teamApprove(connection, bard, bard.publicKey.toBase58(), created.multisig, extra.transactionIndex);
  var extraSig = await executePayout(
    connection, team, team.publicKey.toBase58(), created.multisig, extra.transactionIndex
  );
  var extraSent = connection.lastSent;
  var extraParsed = jsonParsedFromSent(extraSent);
  assert.ok(extraParsed.logs.some(function (line) { return String(line).includes('VaultTransactionExecute'); }));
  var extraFailed = false;
  try {
    await verifyExecutedPayout(
      proofEnv(extraParsed.parsed, tokenProgram.toBase58()),
      Object.assign({}, settlement, { tx_index: extra.transactionIndex }),
      project,
      extraSig
    );
  } catch (e) {
    extraFailed = true;
    assert.match(String(e && e.message), /unexpected account/);
    console.log('extra transfer refused', e.message);
  }
  assert.equal(extraFailed, true, label + ' extra transfer must fail verifyExecutedPayout');
  var strangerAta = getAssociatedTokenAddressSync(mint, stranger.publicKey, true, tokenProgram);
  var strangerAccount = await getAccount(connection, strangerAta, 'confirmed', tokenProgram);
  assert.equal(tokenBalance(strangerAccount), 1n, label + ' stranger did not receive the extra transfer');

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
    hash: payoutHash,
    holderHash: built.hash,
    cutRaw: cutRaw.toString(),
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
  var classic = await runMint(connection, svm, 'classic SPL', TOKEN_PROGRAM_ID, team, bard, 500);
  await fund(svm, team.publicKey, 2);
  await fund(svm, bard.publicKey, 1);
  var token2022 = await runMint(connection, svm, 'Token-2022', TOKEN_2022_PROGRAM_ID, team, bard, 500);
  await fund(svm, team.publicKey, 2);
  await fund(svm, bard.publicKey, 1);
  var waived = await runMint(connection, svm, 'waived cut', TOKEN_PROGRAM_ID, team, bard, 0);
  console.log('\nsim e2e passed');
  console.log(JSON.stringify({ classic: classic, token2022: token2022, waived: waived }, null, 2));
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
