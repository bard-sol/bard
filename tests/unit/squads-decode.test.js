import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../vault-src/package.json', import.meta.url));
const { Keypair, PublicKey } = require('@solana/web3.js');
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
import {
  TOKEN_PROGRAM,
  associatedTokenAddress,
  squadsProposalAddress,
  squadsTransactionAddress,
  squadsVaultAddress,
} from '../../server/chain.js';
import { decodeProposal, decodeVaultTransaction } from '../../server/accounts.js';
import {
  sdkProposalAddress,
  sdkTransactionAddress,
  sdkVaultAddress,
  serializeProposal,
  serializeVaultTransaction,
  transferCheckedIx,
} from './squads-fixture.js';

test('Squads vault transaction and proposal bytes match the SDK', async () => {
  const multisig = Keypair.generate().publicKey.toBase58();
  const creator = Keypair.generate().publicKey.toBase58();
  const holder = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const vault = await squadsVaultAddress(multisig);
  const source = await associatedTokenAddress(vault, mint, TOKEN_PROGRAM);
  const destination = await associatedTokenAddress(holder, mint, TOKEN_PROGRAM);
  const bytes = serializeVaultTransaction({
    multisig,
    creator,
    index: 7,
    vault,
    instructions: [
      transferCheckedIx({
        source,
        mint,
        destination,
        authority: vault,
        amountRaw: 123456n,
        decimals: 6,
      }),
    ],
  });
  const decoded = decodeVaultTransaction(bytes);
  assert.equal(decoded.multisig, multisig);
  assert.equal(decoded.index, 7n);
  assert.equal(decoded.transfers.length, 1);
  assert.equal(decoded.transfers[0].amountRaw, '123456');
  assert.equal(decoded.transfers[0].decimals, 6);
  assert.equal(decoded.transfers[0].destination, destination);
  assert.equal(decoded.transfers[0].mint, mint);
  assert.equal(decoded.transfers[0].authority, vault);

  const active = decodeProposal(serializeProposal({
    multisig,
    index: 7,
    approved: [creator, holder],
    kind: 'active',
  }));
  assert.equal(active.multisig, multisig);
  assert.equal(active.transactionIndex, 7n);
  assert.deepEqual(active.approved, [creator, holder]);

  const executing = decodeProposal(serializeProposal({
    multisig,
    index: 4,
    approved: [creator],
    kind: 'executing',
  }));
  assert.equal(executing.transactionIndex, 4n);
  assert.deepEqual(executing.approved, [creator]);

  assert.equal(await squadsTransactionAddress(multisig, 7), sdkTransactionAddress(multisig, 7));
  assert.equal(await squadsProposalAddress(multisig, 7), sdkProposalAddress(multisig, 7));
  assert.equal(vault, sdkVaultAddress(multisig));
  const sdkAta = getAssociatedTokenAddressSync(
    new PublicKey(mint),
    new PublicKey(holder),
    true,
    TOKEN_PROGRAM_ID,
  ).toBase58();
  assert.equal(destination, sdkAta);
});
