import { isBase58Address } from './auth.js';
import { FEE_TREASURY } from './chain.js';

export function cutSettings(env) {
  const bpsText = String(env.BARD_CUT_BPS == null || env.BARD_CUT_BPS === '' ? '500' : env.BARD_CUT_BPS).trim();
  if (!/^\d+$/.test(bpsText) || BigInt(bpsText) > 10000n) throw new Error('BARD_CUT_BPS is invalid');
  const wallet = String(env.BARD_CUT_WALLET || FEE_TREASURY).trim();
  if (!isBase58Address(wallet)) throw new Error('BARD_CUT_WALLET is invalid');
  return { cutBps: bpsText, cutWallet: wallet };
}

export function bardSigner(env) {
  return String(env.BARD_SIGNER_PUBKEY == null ? '' : env.BARD_SIGNER_PUBKEY).trim();
}

// null means the signer is either unset (the sign step waits) or safe to use.
export function signerConfigProblem(env) {
  const signer = bardSigner(env);
  if (!signer) return null;
  if (!isBase58Address(signer)) return 'BARD_SIGNER_PUBKEY is not a valid Solana address';
  if (signer === FEE_TREASURY) {
    return 'bard signer must not be the fee treasury: BARD_SIGNER_PUBKEY equals FEE_TREASURY';
  }
  const cutWallet = String(env.BARD_CUT_WALLET || FEE_TREASURY).trim();
  if (signer === cutWallet) {
    return 'bard signer must not be the cut wallet: BARD_SIGNER_PUBKEY equals BARD_CUT_WALLET';
  }
  return null;
}
