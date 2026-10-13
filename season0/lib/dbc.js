import { PROGRAMS } from './config.js';

/**
 * Devnet DBC config, checked against the kickoff report.
 * migration_quote_threshold is 85 devnet SOL so a test graduation is reachable.
 * Field names are passed through to @meteora-ag/dynamic-bonding-curve-sdk.
 */
export function dbcConfigParams({ feeClaimer, leftoverReceiver }) {
  return {
    quoteMint: PROGRAMS.wsol,
    feeClaimer,
    leftoverReceiver,
    collectFeeMode: 0,
    baseFeeBps: 200,
    dynamicFee: false,
    creatorTradingFeePercentage: 0,
    partnerLpPercentage: 0,
    partnerLockedLpPercentage: 100,
    creatorLpPercentage: 0,
    creatorLockedLpPercentage: 0,
    migrationOption: 1,
    migrationFeeOption: 6,
    migratedPoolFee: { collectFeeMode: 0, dynamicFee: 0, poolFeeBps: 200 },
    tokenType: 0,
    tokenDecimal: 6,
    tokenUpdateAuthority: 1,
    supply: 1_000_000_000,
    migrationQuoteThresholdSol: 85,
    cluster: 'devnet'
  };
}

export const CHARACTER_POOLS = [
  { id: 'grenna', name: 'Grenna Ironvow', symbol: 'GRE' },
  { id: 'silas', name: 'Silas Quill', symbol: 'SIL' },
  { id: 'marrow', name: 'Lady Marrow', symbol: 'MAR' },
  { id: 'pip', name: 'Pip Fennick', symbol: 'PIP' },
  { id: 'wick', name: 'Old Wick', symbol: 'WIK' },
  { id: 'vey', name: 'Captain Vey', symbol: 'VEY' },
  { id: 'thorn', name: 'Thorn', symbol: 'THO' },
  { id: 'twins', name: 'Ash and Ember', symbol: 'TWN' }
];
