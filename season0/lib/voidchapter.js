export const VOID_REASONS = ['vrf', 'indexer', 'exploit'];

export const VOID_COPY = {
  vrf: "The Reaper's randomness failed twice (VRF and fallback).",
  indexer: 'Our data feed was down for more than 6 hours during the final window.',
  exploit: 'We found a critical exploit and stopped the chapter.'
};

/** First matching trigger wins, in the order the rules list them after exploit (team declaration). */
export function voidReason({ vrfFailed, fallbackFailed, indexerOutageHours, exploit }) {
  if (exploit) return 'exploit';
  if (vrfFailed && fallbackFailed) return 'vrf';
  if (Number(indexerOutageHours) > 6) return 'indexer';
  return null;
}

export function voidMemo(season, chapter, reason, stateHash) {
  if (!VOID_REASONS.includes(reason)) throw new Error('void reason must be vrf, indexer, or exploit');
  if (!/^[0-9a-f]{64}$/.test(String(stateHash))) throw new Error('void memo needs a sha256 hex');
  return 'bard:v1:void:' + season + ':' + chapter + ':' + reason + ':' + stateHash;
}

/** Stake signature prefix is the first 8 base58 characters. */
export function unstakeMemo(season, chapter, stakeSig) {
  const sig = String(stakeSig || '');
  if (sig.length < 8) throw new Error('stake signature too short');
  return 'bard:v1:unstake:' + season + ':' + chapter + ':void:' + sig.slice(0, 8);
}

/** About 8 stake returns per transaction (transfer + memo each). */
export function batchStakeReturns(stakes, size) {
  const n = size == null ? 8 : size;
  if (n < 1) throw new Error('bad batch size');
  const batches = [];
  const list = stakes || [];
  for (let i = 0; i < list.length; i += n) batches.push(list.slice(i, i + n));
  return batches;
}

/**
 * Void effects, including the Q-G1 assumptions the screen spec locks in:
 * no per-chapter legacy points, the snapshot does not count toward squad removal,
 * and the rerun uses a normal prediction window.
 */
export function voidEffects() {
  return {
    mark: false,
    elimination: false,
    returnStakes: true,
    voidPicks: true,
    keepTrainCredit: true,
    legacyPoints: false,
    countsForSquadRemoval: false,
    rerunPredictionWindow: 'normal',
    keepBurns: true
  };
}
