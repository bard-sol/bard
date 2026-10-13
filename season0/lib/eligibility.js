/**
 * Season 0 devnet: eligibility_min_sol is 0, so any nonzero balance qualifies
 * once it has been held for 24h. Mainnet uses 0.05 SOL of value at the
 * chapter average price. Faucet tBard never confers eligibility.
 */
export function isEligible({ balance, heldSinceMs, snapshotMs, valueSol, minSol, holdMs }) {
  const bal = Number(balance) || 0;
  if (!(bal > 0)) return false;
  const min = Number(minSol) || 0;
  if (min > 0 && !((Number(valueSol) || 0) >= min)) return false;
  if (heldSinceMs == null || snapshotMs == null) return false;
  const held = Number(snapshotMs) - Number(heldSinceMs);
  if (!(held >= Number(holdMs))) return false;
  return true;
}

/** Selling to zero restarts the 24h clock. The next buy sets a new heldSince. */
export function nextHeldSince({ prevBalance, nextBalance, prevHeldSince, nowMs }) {
  if (!(Number(nextBalance) > 0)) return null;
  if (!(Number(prevBalance) > 0)) return nowMs;
  return prevHeldSince == null ? nowMs : prevHeldSince;
}

export function valueSol(balance, twapPricePerToken) {
  return (Number(balance) || 0) * (Number(twapPricePerToken) || 0);
}
