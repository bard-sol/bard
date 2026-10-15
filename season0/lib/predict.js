/**
 * A pick counts only when both the wallet's signed time and the server
 * receipt time are at or before the lock (T0 + 36h).
 */
export function pickCounts({ signedAt, receivedAt, lockAt }) {
  if (signedAt == null || receivedAt == null || lockAt == null) return false;
  const signed = Number(signedAt);
  const received = Number(receivedAt);
  const lock = Number(lockAt);
  if (!Number.isFinite(signed) || !Number.isFinite(received) || !Number.isFinite(lock)) return false;
  return signed <= lock && received <= lock;
}

export function predictionLockMs(t0Ms, config) {
  const offset = ((config && config.predict_lock_s) || 36 * 3600) * 1000;
  return t0Ms + offset;
}

/**
 * Points land only for picks that count, on a qualifying wallet, under the cap.
 * A voided chapter scores 0 and does not consume cap.
 */
export function predictionPoints({ counts, correct, qualified, pointsSoFar, cap, voided }) {
  if (voided || !counts || !correct || !qualified) return 0;
  const room = Math.max(0, (cap == null ? 50 : cap) - (Number(pointsSoFar) || 0));
  return Math.min(10, room);
}
