import { DEVNET_RPC } from '../lib/config.js';
import { assertDevnetEndpoint, assertDevnetGenesis } from '../lib/cluster.js';
import { transactionAllowed } from '../lib/allowlist.js';

function keypairFromSecret(secret, Keypair, bs58) {
  const raw = String(secret).trim();
  if (raw.startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }
  return Keypair.fromSecretKey(bs58.decode(raw));
}

/**
 * Approve a Squads proposal with the devnet key in BARD_VAULT_SECRET.
 * Missing secret keeps the historical "waiting" response the team UI already shows.
 * The transaction is fetched from devnet and refused unless every instruction is allow-listed.
 */
export async function bardSign(env, body) {
  if (!env || !env.BARD_VAULT_SECRET) {
    return { ok: false, waiting: true, reason: 'bard_signer_offline' };
  }
  if (!body || !body.multisig || body.txIndex == null || body.txIndex === '') {
    return { ok: false, waiting: true, reason: 'missing_proposal' };
  }
  const endpoint = assertDevnetEndpoint(DEVNET_RPC);
  const web3 = await import('@solana/web3.js');
  const bs58 = (await import('bs58')).default;
  const squads = await import('@sqds/multisig');
  const connection = new web3.Connection(endpoint, 'confirmed');
  const genesis = await connection.getGenesisHash();
  assertDevnetGenesis(genesis);
  const payer = keypairFromSecret(env.BARD_VAULT_SECRET, web3.Keypair, bs58);
  const multisigPda = new web3.PublicKey(body.multisig);
  const transactionIndex = BigInt(body.txIndex);
  const [txPda] = squads.getTransactionPda({ multisigPda, index: transactionIndex });
  let vaultTx;
  try {
    vaultTx = await squads.accounts.VaultTransaction.fromAccountAddress(connection, txPda);
  } catch (err) {
    return { ok: false, waiting: true, reason: 'proposal_not_found', detail: String(err && err.message || err).slice(0, 180) };
  }
  const message = vaultTx.message;
  const destinations = String(env.BARD_PAYOUT_DESTINATIONS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const instructions = message.instructions.map((ix) => {
    const programId = message.accountKeys[ix.programIdIndex].toBase58();
    let destination = null;
    if (ix.accountIndexes && ix.accountIndexes.length > 1) {
      destination = message.accountKeys[ix.accountIndexes[1]].toBase58();
    }
    return { programId, data: ix.data, destination };
  });
  const allowed = await transactionAllowed(instructions, { destinations });
  if (!allowed) return { ok: false, waiting: true, reason: 'instruction_not_allowlisted' };
  const signature = await squads.rpc.proposalApprove({
    connection,
    feePayer: payer,
    member: payer,
    multisigPda,
    transactionIndex
  });
  return { ok: true, signature, cluster: 'devnet', member: payer.publicKey.toBase58() };
}
