import { PROGRAMS } from './config.js';
import { sha256Bytes } from './bytes.js';

/** Anchor discriminators the bard-sign worker may approve. */
export async function anchorDiscriminator(name) {
  const full = await sha256Bytes('global:' + name);
  return full.slice(0, 8);
}

export const CLAIM_IX = [
  'claim_partner_trading_fee',
  'claim_creator_trading_fee',
  'claim_position_fee',
  'claim_position_fee2'
];

/**
 * A vault transaction is approvable on devnet only when every instruction is
 * an SPL transfer/burn, a memo, or a DBC/DAMM claim. System transfers must
 * name an allow-listed destination.
 */
export async function instructionAllowed(ix, { destinations }) {
  const program = ix.programId;
  const data = ix.data || new Uint8Array();
  if (program === PROGRAMS.memo) return true;
  if (program === PROGRAMS.token) {
    const tag = data[0];
    return tag === 3 || tag === 8 || tag === 12;
  }
  if (program === PROGRAMS.system) {
    const dest = ix.destination;
    return !!dest && (destinations || []).includes(dest);
  }
  if (program === PROGRAMS.dbc || program === PROGRAMS.dammV2) {
    if (data.length < 8) return false;
    for (const name of CLAIM_IX) {
      const disc = await anchorDiscriminator(name);
      let match = true;
      for (let i = 0; i < 8; i++) if (data[i] !== disc[i]) match = false;
      if (match) return true;
    }
    return false;
  }
  return false;
}

export async function transactionAllowed(instructions, opts) {
  if (!instructions || !instructions.length) return false;
  for (const ix of instructions) {
    if (!(await instructionAllowed(ix, opts || {}))) return false;
  }
  return true;
}
