/**
 * Duck-typed @solana/web3.js Connection backed by LiteSVM 1.6.1.
 * Vault builders keep sending the same Squads messages as bard-vault.js.
 */
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import { FailedTransactionMetadata, ComputeBudget } from 'litesvm';
import { getTransactionDecoder } from '@solana/kit';
import bs58 from 'bs58';

function toBytes(raw) {
  if (raw instanceof Uint8Array) return raw;
  if (Buffer.isBuffer(raw)) return new Uint8Array(raw);
  return Uint8Array.from(raw);
}

function pubkeyOf(value) {
  return value instanceof PublicKey ? value : new PublicKey(value);
}

function encodeSig(bytes) {
  if (typeof bytes === 'string') return bytes;
  return bs58.encode(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
}

function failMessage(result) {
  var err;
  try { err = result.err(); } catch (e) { err = e; }
  var logs = [];
  try { logs = result.meta().logs(); } catch (e) { logs = []; }
  return 'LiteSVM transaction failed: ' + JSON.stringify(err) + (logs.length ? '\n' + logs.join('\n') : '');
}

export function sendWire(svm, raw) {
  var bytes = toBytes(raw);
  var result;
  try {
    var kitTx = getTransactionDecoder().decode(bytes);
    result = svm.sendTransaction(kitTx);
  } catch (e) {
    try {
      result = svm.inner.sendVersionedTransaction(bytes);
    } catch (e2) {
      result = svm.inner.sendLegacyTransaction(bytes);
    }
  }
  if (result instanceof FailedTransactionMetadata) {
    throw new Error(failMessage(result));
  }
  svm.expireBlockhash();
  return result;
}

export function createLiteSvmConnection(svm) {
  return {
    rpcEndpoint: 'litesvm://local',
    commitment: 'confirmed',
    async getLatestBlockhash() {
      return {
        blockhash: svm.latestBlockhash(),
        lastValidBlockHeight: Number(svm.getClock().slot) + 150,
      };
    },
    async getLatestBlockhashAndContext() {
      var value = await this.getLatestBlockhash();
      return { context: { slot: Number(svm.getClock().slot) }, value: value };
    },
    async getRecentBlockhash() {
      var latest = await this.getLatestBlockhash();
      return { blockhash: latest.blockhash, feeCalculator: { lamportsPerSignature: 5000 } };
    },
    async getSlot() {
      return Number(svm.getClock().slot);
    },
    async getBalance(pubkey) {
      var balance = svm.getBalance(pubkeyOf(pubkey).toBase58());
      return balance == null ? 0 : Number(balance);
    },
    async getMinimumBalanceForRentExemption(size) {
      return Number(svm.minimumBalanceForRentExemption(BigInt(size)));
    },
    async getAccountInfo(pubkey) {
      var acc = svm.getAccount(pubkeyOf(pubkey).toBase58());
      if (!acc || acc.exists === false) return null;
      return {
        executable: acc.executable,
        owner: new PublicKey(acc.programAddress),
        lamports: Number(acc.lamports),
        data: Buffer.from(acc.data),
        rentEpoch: 0,
      };
    },
    async getMultipleAccountsInfo(pubkeys) {
      var self = this;
      return Promise.all((pubkeys || []).map(function (pk) { return self.getAccountInfo(pk); }));
    },
    async getAddressLookupTable() {
      return { value: null };
    },
    async sendRawTransaction(raw) {
      var bytes = toBytes(raw);
      var result = sendWire(svm, bytes);
      this.lastSent = { bytes: bytes, meta: result };
      var sig = result.signature();
      try {
        sig = VersionedTransaction.deserialize(bytes).signatures[0];
      } catch (e) {
        try {
          sig = Transaction.from(Buffer.from(bytes)).signature;
        } catch (e2) { /* keep metadata signature */ }
      }
      return encodeSig(sig);
    },
    async sendTransaction(transaction, signers, options) {
      void options;
      signers = signers || [];
      if (transaction instanceof VersionedTransaction || (transaction && transaction.version != null && typeof transaction.serialize === 'function' && !transaction.recentBlockhash)) {
        if (signers.length) transaction.sign(signers);
        return this.sendRawTransaction(transaction.serialize());
      }
      if (transaction && typeof transaction.serialize === 'function') {
        if (!transaction.recentBlockhash) {
          var latest = await this.getLatestBlockhash();
          transaction.recentBlockhash = latest.blockhash;
        }
        if (!transaction.feePayer && signers[0]) transaction.feePayer = signers[0].publicKey;
        if (signers.length && typeof transaction.partialSign === 'function') transaction.partialSign.apply(transaction, signers);
        else if (signers.length && typeof transaction.sign === 'function') transaction.sign.apply(transaction, signers);
        return this.sendRawTransaction(transaction.serialize());
      }
      return this.sendRawTransaction(transaction);
    },
    async confirmTransaction() {
      return { context: { slot: Number(svm.getClock().slot) }, value: { err: null } };
    },
    async getSignatureStatus() {
      return { context: { slot: Number(svm.getClock().slot) }, value: { err: null, confirmationStatus: 'confirmed' } };
    },
    async simulateTransaction() {
      return { context: { slot: Number(svm.getClock().slot) }, value: { err: null, logs: [], unitsConsumed: 0 } };
    },
  };
}

export function applyComputeBudget(svm) {
  var budget = new ComputeBudget();
  budget.computeUnitLimit = 1_400_000n;
  svm.withComputeBudget(budget);
  return svm;
}
