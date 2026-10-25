import { createRequire } from 'node:module';
import { TOKEN_PROGRAM } from '../../server/chain.js';

const require = createRequire(new URL('../../vault-src/package.json', import.meta.url));
const { PublicKey, TransactionInstruction, TransactionMessage } = require('@solana/web3.js');
const multisig = require('@sqds/multisig');

const BLOCKHASH = '11111111111111111111111111111111';

export function transferCheckedIx({ source, mint, destination, authority, amountRaw, decimals, program }) {
  const data = Buffer.alloc(10);
  data[0] = 12;
  data.writeBigUInt64LE(BigInt(amountRaw), 1);
  data[9] = Number(decimals);
  return new TransactionInstruction({
    programId: new PublicKey(program || TOKEN_PROGRAM),
    keys: [
      { pubkey: new PublicKey(source), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(mint), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(destination), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(authority), isSigner: true, isWritable: true },
    ],
    data,
  });
}

export function serializeVaultTransaction({ multisig: multisigKey, creator, index, vault, instructions }) {
  const compiled = new TransactionMessage({
    payerKey: new PublicKey(vault),
    recentBlockhash: BLOCKHASH,
    instructions,
  }).compileToV0Message();
  const account = multisig.accounts.VaultTransaction.fromArgs({
    multisig: new PublicKey(multisigKey),
    creator: new PublicKey(creator),
    index: BigInt(index),
    bump: 255,
    vaultIndex: 0,
    vaultBump: 254,
    ephemeralSignerBumps: Buffer.alloc(0),
    message: {
      numSigners: compiled.header.numRequiredSignatures,
      numWritableSigners: compiled.header.numRequiredSignatures - compiled.header.numReadonlySignedAccounts,
      numWritableNonSigners: compiled.staticAccountKeys.length - compiled.header.numRequiredSignatures - compiled.header.numReadonlyUnsignedAccounts,
      accountKeys: compiled.staticAccountKeys,
      instructions: compiled.compiledInstructions.map((ix) => ({
        programIdIndex: ix.programIdIndex,
        accountIndexes: Uint8Array.from(ix.accountKeyIndexes),
        data: Uint8Array.from(ix.data),
      })),
      addressTableLookups: [],
    },
  });
  const [buf] = account.serialize();
  return new Uint8Array(buf);
}

export function serializeProposal({ multisig: multisigKey, index, approved, kind }) {
  const status = kind === 'executing'
    ? { __kind: 'Executing' }
    : { __kind: kind === 'approved' ? 'Approved' : 'Active', timestamp: 1n };
  const account = multisig.accounts.Proposal.fromArgs({
    multisig: new PublicKey(multisigKey),
    transactionIndex: BigInt(index),
    status,
    bump: 255,
    approved: (approved || []).map((key) => new PublicKey(key)),
    rejected: [],
    cancelled: [],
  });
  const [buf] = account.serialize();
  return new Uint8Array(buf);
}

export function sdkTransactionAddress(multisigKey, index) {
  return multisig.getTransactionPda({
    multisigPda: new PublicKey(multisigKey),
    index: BigInt(index),
  })[0].toBase58();
}

export function sdkProposalAddress(multisigKey, index) {
  return multisig.getProposalPda({
    multisigPda: new PublicKey(multisigKey),
    transactionIndex: BigInt(index),
  })[0].toBase58();
}

export function sdkVaultAddress(multisigKey) {
  return multisig.getVaultPda({
    multisigPda: new PublicKey(multisigKey),
    index: 0,
  })[0].toBase58();
}
