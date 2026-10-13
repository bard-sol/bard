import { sha256Hex } from './bytes.js';
import { defaultConfig } from './config.js';

/**
 * Time-weighted price from on-chain swaps.
 * Each swap's post-trade price holds until the next swap.
 * The price at window start is the last swap at or before startTs.
 * Swaps are { blockTime, price }. Slot order should match blockTime order.
 */
export function twapPrice(swaps, startTs, endTs) {
  if (!(endTs > startTs)) return 0;
  const list = (swaps || []).filter((s) => Number.isFinite(s.blockTime) && Number.isFinite(s.price));
  const before = list.filter((s) => s.blockTime <= startTs).sort((a, b) => a.blockTime - b.blockTime);
  const inside = list.filter((s) => s.blockTime > startTs && s.blockTime <= endTs).sort((a, b) => a.blockTime - b.blockTime);
  let price = before.length ? before[before.length - 1].price : 0;
  let acc = 0;
  let cursor = startTs;
  for (const sw of inside) {
    const dt = sw.blockTime - cursor;
    if (dt > 0) acc += price * dt;
    price = sw.price;
    cursor = sw.blockTime;
  }
  if (endTs > cursor) acc += price * (endTs - cursor);
  return acc / (endTs - startTs);
}

export function marketRaw(twap, supply) {
  const px = Math.max(0, Number(twap) || 0);
  const sup = Number(supply) || 0;
  return Math.sqrt(px * sup);
}

/** Square-root turnout. Idle whales count in the denominator only. */
export function turnout(wallets) {
  let num = 0;
  let den = 0;
  for (const w of wallets || []) {
    const bal = Number(w.balance) || 0;
    if (bal <= 0) continue;
    const s = Math.sqrt(bal);
    den += s;
    if (w.active) num += s;
  }
  if (den === 0) return 0;
  return num / den;
}

export function trainedBonus(credited) {
  const c = Math.max(0, Number(credited) || 0);
  return Math.floor(10 * Math.sqrt(c / 100));
}

function scale(value, max) {
  if (!(max > 0)) return 0;
  return value / max;
}

/**
 * characters: {
 *   id, twap, supply, trainCredited, encMod,
 *   wallets: [{ balance, active, eligible }],
 *   strikeAccuracies: number[]   // eligible strikers only
 * }
 * U and K stay in 0..1. M, B, P are divided by the living maximum.
 */
export function scoreCast(characters, weights) {
  const w = weights || defaultConfig().weights;
  const rows = (characters || []).map((c) => {
    const eligible = (c.wallets || []).filter((x) => x.eligible && Number(x.balance) > 0);
    const U = turnout(eligible.map((x) => ({ balance: x.balance, active: !!x.active })));
    const B = Math.log10(1 + eligible.length);
    const enc = Number(c.encMod) || 0;
    const P = Math.sqrt(Math.max(0, Number(c.trainCredited) || 0)) * (1 + enc);
    const strikes = (c.strikeAccuracies || []).filter((n) => Number.isFinite(n));
    const K = strikes.length ? strikes.reduce((a, b) => a + b, 0) / strikes.length : 0;
    const M = marketRaw(c.twap, c.supply || defaultConfig().supply);
    return { id: c.id, M, U, B, P, K };
  });
  const max = {
    M: Math.max(0, ...rows.map((r) => r.M), 0),
    B: Math.max(0, ...rows.map((r) => r.B), 0),
    P: Math.max(0, ...rows.map((r) => r.P), 0)
  };
  return rows.map((r) => {
    const M = scale(r.M, max.M);
    const B = scale(r.B, max.B);
    const P = scale(r.P, max.P);
    const S = w.M * M + w.U * r.U + w.B * B + w.P * P + w.K * r.K;
    return { id: r.id, S, M, U: r.U, B, P, K: r.K, raw: r };
  });
}

/** (S - S_dead) / S_dead. Null when the dead score is 0. */
export function margin(score, deadScore) {
  if (!(deadScore > 0)) return null;
  return (score - deadScore) / deadScore;
}

export function marginLabel(score, deadScore) {
  const m = margin(score, deadScore);
  if (m == null) return null;
  return 'survived by ' + (m * 100).toFixed(1) + '%';
}

/**
 * Lowest S dies. Tie → lower M, then lower U, then lower sha256(r|id).
 * `take` is 2 after a successful revival.
 */
export async function chooseMarked(scored, randomnessHex, take) {
  const n = Math.max(1, take || 1);
  const decorated = [];
  for (const row of scored || []) {
    const tie = await sha256Hex(String(randomnessHex) + '|' + row.id);
    decorated.push({ ...row, tie });
  }
  decorated.sort((a, b) => {
    if (a.S !== b.S) return a.S - b.S;
    if (a.M !== b.M) return a.M - b.M;
    if (a.U !== b.U) return a.U - b.U;
    if (a.tie < b.tie) return -1;
    if (a.tie > b.tie) return 1;
    return 0;
  });
  return decorated.slice(0, Math.min(n, decorated.length));
}

/**
 * Snapshot is drawn after the window closes and applied backwards.
 * snapshot = windowStart + (u64le(r[0..8]) mod 43200).
 * It is never known before `r` exists.
 */
export function snapshotFromRandomness(windowStartSec, randomnessBytes, windowLenSec) {
  const len = BigInt(windowLenSec || 43200);
  let n = 0n;
  for (let i = 7; i >= 0; i--) n = (n << 8n) + BigInt(randomnessBytes[i]);
  const offset = n % len;
  return Number(BigInt(windowStartSec) + offset);
}

export function reaperSeedMaterial(season, chapter) {
  return 'bard|' + season + '|' + chapter + '|reaper';
}

export function encounterSeedMaterial(season, chapter, charId) {
  return 'bard|' + season + '|' + chapter + '|' + charId + '|encounter';
}
