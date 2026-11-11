/**
 * Squads 2-of-2 vault used by admin_app.js.
 *
 * Recipient ATAs are created inside the vault transaction, with the vault PDA
 * as the payer. Squads execution can sign for the vault and cannot sign for
 * the team wallet, so a team-paid ATA create inside the vault message fails
 * for any recipient who does not already have an account. A separate
 * team-paid transaction could pre-create those ATAs, but keeping the create
 * in the proposal means a missing account cannot be forgotten between two
 * transactions. The vault PDA must hold SOL for the new accounts' rent.
 * One idempotent create per recipient covers existing and missing ATAs and
 * stays in the same proposal as the transfers.
 *
 * The token program is the mint account's owner: classic SPL Token or
 * Token-2022. Amounts are BigInt raw units. If a payout has amountRaw, that
 * integer is used as-is. Otherwise amount is a human decimal and mint
 * decimals are applied once.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';
import * as multisig from '@sqds/multisig';
import { PAYOUT_BATCH_LINES, payoutBatches } from '../../server/settlement.js';

export { PAYOUT_BATCH_LINES };

export const PROGRAM_ID = multisig.PROGRAM_ID;

function connectionFrom(rpc) {
  if (rpc && typeof rpc.getLatestBlockhash === 'function') return rpc;
  return new Connection(String(rpc), 'confirmed');
}

function isKeypair(signer) {
  return !!(
    signer &&
    signer.secretKey &&
    signer.publicKey &&
    typeof signer.signTransaction !== 'function'
  );
}

function pubkeyOf(wallet, signer) {
  if (wallet && wallet.publicKey) return wallet.publicKey;
  if (wallet) return new PublicKey(String(wallet));
  if (isKeypair(signer)) return signer.publicKey;
  throw new Error('Wallet public key is required');
}

function decimalToRaw(value, decimals) {
  var d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 18) throw new Error('Bad mint decimals');
  var s;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.floor(value) !== value) {
      throw new Error('Fractional payout amounts must be decimal strings');
    }
    s = String(value);
  } else {
    s = String(value == null ? '' : value).trim();
  }
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Bad payout amount');
  var parts = s.split('.');
  var frac = parts[1] || '';
  if (frac.length > d) throw new Error('Payout has more decimals than the mint');
  while (frac.length < d) frac += '0';
  return BigInt(d === 0 ? parts[0] : parts[0] + frac);
}

function payoutRaw(payout, decimals) {
  if (payout && payout.amountRaw != null && String(payout.amountRaw).trim() !== '') {
    var raw = String(payout.amountRaw).trim();
    if (!/^\d+$/.test(raw)) throw new Error('amountRaw must be an integer string');
    return BigInt(raw);
  }
  return decimalToRaw(payout && payout.amount, decimals);
}

async function signAndSend(connection, tx, signer, recent) {
  if (isKeypair(signer)) tx.sign([signer]);
  else if (signer && typeof signer.signTransaction === 'function') tx = await signer.signTransaction(tx);
  else throw new Error('Wallet cannot sign the vault transaction');
  var signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  var strategy = recent || await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction({
    signature: signature,
    blockhash: strategy.blockhash,
    lastValidBlockHeight: strategy.lastValidBlockHeight,
  }, 'confirmed');
  return signature;
}

export async function tokenProgramForMint(connection, mint) {
  var info = await connection.getAccountInfo(mint, 'confirmed');
  if (!info) throw new Error('Mint account not found');
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error('Mint owner is not SPL Token or Token-2022');
}

export function vaultPdaFor(multisigAddress) {
  var multisigPda = new PublicKey(String(multisigAddress));
  return multisig.getVaultPda({ multisigPda: multisigPda, index: 0 })[0].toBase58();
}

export async function createTwoOfTwo(rpc, signer, wallet, bard) {
  var connection = connectionFrom(rpc);
  var team = pubkeyOf(wallet, signer);
  var bardKey = new PublicKey(String(bard));
  if (team.equals(bardKey)) throw new Error('Team and Bard keys must be different');
  var createKey = Keypair.generate();
  var multisigPda = multisig.getMultisigPda({ createKey: createKey.publicKey })[0];
  var vaultPda = multisig.getVaultPda({ multisigPda: multisigPda, index: 0 })[0];
  var configPda = multisig.getProgramConfigPda({})[0];
  var programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(connection, configPda);
  var block = await connection.getLatestBlockhash('confirmed');
  var tx = multisig.transactions.multisigCreateV2({
    blockhash: block.blockhash,
    treasury: programConfig.treasury,
    createKey: createKey.publicKey,
    creator: team,
    multisigPda: multisigPda,
    configAuthority: null,
    threshold: 2,
    members: [
      { key: team, permissions: multisig.types.Permissions.all() },
      { key: bardKey, permissions: multisig.types.Permissions.all() },
    ],
    timeLock: 0,
    rentCollector: null,
    memo: 'bard 2-of-2',
  });
  tx.sign([createKey]);
  var signature = await signAndSend(connection, tx, signer, block);
  return { vault: vaultPda.toBase58(), multisig: multisigPda.toBase58(), signature: signature };
}

// Payout lines (holders and the cut) split into vault transactions, the way the worker and the
// Bard check split them: wallet order, PAYOUT_BATCH_LINES per transaction.
function batchLines(payouts, cut, decimals) {
  var lines = [];
  (payouts || []).concat(cut && cut.wallet ? [cut] : []).forEach(function (payout) {
    var raw = payoutRaw(payout, decimals);
    if (raw > 0n) lines.push({ wallet: String(payout.wallet), amountRaw: raw.toString() });
  });
  return payoutBatches(lines);
}

/** How many vault transactions a payout needs. Amounts must be amountRaw integers. */
export function payoutBatchCount(payouts, cut) {
  return batchLines(payouts, cut, 0).length;
}

/**
 * Build and propose one batch of a payout as a vault transaction. A payout of up to
 * PAYOUT_BATCH_LINES lines is batch 0 and needs no batch argument; a larger one needs each batch
 * proposed on its own (proposePayoutBatches does all of them).
 */
export async function createPayoutProposal(rpc, signer, wallet, multisigAddress, mintAddress, payouts, cut, batch) {
  var connection = connectionFrom(rpc);
  var team = pubkeyOf(wallet, signer);
  var multisigPda = new PublicKey(String(multisigAddress));
  var mint = new PublicKey(String(mintAddress));
  var tokenProgram = await tokenProgramForMint(connection, mint);
  var mintState = await getMint(connection, mint, 'confirmed', tokenProgram);
  var decimals = mintState.decimals;
  var vaultPda = multisig.getVaultPda({ multisigPda: multisigPda, index: 0 })[0];
  var account = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  var transactionIndex = BigInt(account.transactionIndex.toString()) + 1n;
  var vaultAta = getAssociatedTokenAddressSync(mint, vaultPda, true, tokenProgram);
  var instructions = [
    createAssociatedTokenAccountIdempotentInstruction(vaultPda, vaultAta, vaultPda, mint, tokenProgram),
  ];
  // The signer accepts payouts only in wallet order, the same order as payoutHash.
  // The cut is one more transfer in that order, not an instruction after the holders.
  var batches = batchLines(payouts, cut, decimals);
  var number = batch == null ? 0 : Number(batch);
  if (batch == null && batches.length > 1) {
    throw new Error('This payout is ' + batches.length + ' vault transactions; propose each batch');
  }
  if (!Number.isInteger(number) || number < 0 || number >= Math.max(batches.length, 1)) throw new Error('No batch ' + batch);
  (batches[number] || []).forEach(function (payout) {
    var raw = BigInt(payout.amountRaw);
    var owner = new PublicKey(String(payout.wallet));
    var ata = getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(vaultPda, ata, owner, mint, tokenProgram));
    instructions.push(createTransferCheckedInstruction(vaultAta, mint, ata, vaultPda, raw, decimals, [], tokenProgram));
  });
  if (instructions.length < 2) throw new Error('No payout amounts');
  var block = await connection.getLatestBlockhash('confirmed');
  var message = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: block.blockhash,
    instructions: instructions,
  });
  var tx = multisig.transactions.vaultTransactionCreate({
    blockhash: block.blockhash,
    feePayer: team,
    multisigPda: multisigPda,
    transactionIndex: transactionIndex,
    creator: team,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage: message,
    memo: 'bard payout',
  });
  var signature = await signAndSend(connection, tx, signer, block);
  var proposalBlock = await connection.getLatestBlockhash('confirmed');
  var proposalTx = multisig.transactions.proposalCreate({
    blockhash: proposalBlock.blockhash,
    feePayer: team,
    multisigPda: multisigPda,
    transactionIndex: transactionIndex,
    creator: team,
    rentPayer: team,
    isDraft: false,
  });
  var proposalSignature = await signAndSend(connection, proposalTx, signer, proposalBlock);
  return {
    signature: signature,
    proposalSignature: proposalSignature,
    transactionIndex: transactionIndex.toString(),
    tokenProgram: tokenProgram.toBase58(),
    decimals: decimals,
    batch: number,
    batches: batches.length,
  };
}

export async function teamApprove(rpc, signer, wallet, multisigAddress, transactionIndex) {
  var connection = connectionFrom(rpc);
  var member = pubkeyOf(wallet, signer);
  var multisigPda = new PublicKey(String(multisigAddress));
  var index = BigInt(transactionIndex);
  var block = await connection.getLatestBlockhash('confirmed');
  var tx = multisig.transactions.proposalApprove({
    blockhash: block.blockhash,
    feePayer: member,
    multisigPda: multisigPda,
    transactionIndex: index,
    member: member,
    memo: 'bard approve',
  });
  return signAndSend(connection, tx, signer, block);
}

export const bardApprove = teamApprove;

export async function proposePayouts(rpc, signer, wallet, multisigAddress, mintAddress, payouts, cut) {
  var created = await createPayoutProposal(rpc, signer, wallet, multisigAddress, mintAddress, payouts, cut);
  var signature = await teamApprove(rpc, signer, wallet, multisigAddress, created.transactionIndex);
  return {
    signature: signature,
    transactionIndex: created.transactionIndex,
    createSignature: created.signature,
    proposalSignature: created.proposalSignature,
    tokenProgram: created.tokenProgram,
    decimals: created.decimals,
  };
}

/**
 * Propose and approve the batches of a payout, one vault transaction each. onBatch(result) runs
 * after each batch so the caller can record it before the next. `only` limits the batches made.
 */
export async function proposePayoutBatches(rpc, signer, wallet, multisigAddress, mintAddress, payouts, cut, opts) {
  var options = opts || {};
  var count = payoutBatchCount(payouts, cut);
  var out = [];
  for (var n = 0; n < count; n++) {
    if (options.only && options.only.indexOf(n) < 0) continue;
    var created = await createPayoutProposal(rpc, signer, wallet, multisigAddress, mintAddress, payouts, cut, n);
    var signature = await teamApprove(rpc, signer, wallet, multisigAddress, created.transactionIndex);
    var result = {
      batch: n,
      batches: count,
      signature: signature,
      transactionIndex: created.transactionIndex,
      createSignature: created.signature,
      proposalSignature: created.proposalSignature,
    };
    if (options.onBatch) await options.onBatch(result);
    out.push(result);
  }
  return out;
}

/**
 * Close a payout proposal so its vault transaction can never execute: the worker's campaign
 * cancel refuses while one is still open. In a 2-of-2 one reject closes a proposal that is not
 * fully approved, so the member rejects it (a draft is activated first). An approved proposal
 * needs a cancel vote from both keys: each member calls this once. Returns what this member did:
 * 'rejected', 'cancel_voted' or 'closed' (already rejected or cancelled; nothing sent).
 */
export async function cancelPayoutProposal(rpc, signer, wallet, multisigAddress, transactionIndex) {
  var connection = connectionFrom(rpc);
  var member = pubkeyOf(wallet, signer);
  var multisigPda = new PublicKey(String(multisigAddress));
  var index = BigInt(transactionIndex);
  var proposalPda = multisig.getProposalPda({ multisigPda: multisigPda, transactionIndex: index })[0];
  var info = await connection.getAccountInfo(proposalPda, 'confirmed');
  // No proposal: the vault transaction cannot execute, and the worker accepts it as closed.
  if (!info) return 'closed';
  var proposal = multisig.accounts.Proposal.fromAccountInfo(info)[0];
  var kind = proposal.status.__kind;
  if (kind === 'Rejected' || kind === 'Cancelled') return 'closed';
  if (kind === 'Executed' || kind === 'Executing') throw new Error('vault transaction ' + index + ' already paid out');
  var block;
  if (kind === 'Draft') {
    block = await connection.getLatestBlockhash('confirmed');
    await signAndSend(connection, multisig.transactions.proposalActivate({
      blockhash: block.blockhash,
      feePayer: member,
      multisigPda: multisigPda,
      transactionIndex: index,
      member: member,
    }), signer, block);
    kind = 'Active';
  }
  if (kind === 'Approved') {
    if (proposal.cancelled.some(function (key) { return key.equals(member); })) return 'cancel_voted';
    block = await connection.getLatestBlockhash('confirmed');
    await signAndSend(connection, multisig.transactions.proposalCancel({
      blockhash: block.blockhash,
      feePayer: member,
      multisigPda: multisigPda,
      transactionIndex: index,
      member: member,
      memo: 'bard cancel',
    }), signer, block);
    return 'cancel_voted';
  }
  if (kind !== 'Active') throw new Error('vault proposal ' + index + ' is ' + kind);
  block = await connection.getLatestBlockhash('confirmed');
  await signAndSend(connection, multisig.transactions.proposalReject({
    blockhash: block.blockhash,
    feePayer: member,
    multisigPda: multisigPda,
    transactionIndex: index,
    member: member,
    memo: 'bard cancel',
  }), signer, block);
  return 'rejected';
}

export async function executePayout(rpc, signer, wallet, multisigAddress, transactionIndex) {
  var connection = connectionFrom(rpc);
  var member = pubkeyOf(wallet, signer);
  var multisigPda = new PublicKey(String(multisigAddress));
  var index = BigInt(transactionIndex);
  var block = await connection.getLatestBlockhash('confirmed');
  var tx = await multisig.transactions.vaultTransactionExecute({
    connection: connection,
    blockhash: block.blockhash,
    feePayer: member,
    multisigPda: multisigPda,
    transactionIndex: index,
    member: member,
  });
  return signAndSend(connection, tx, signer, block);
}
