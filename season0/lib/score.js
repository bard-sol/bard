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

function median(values) {
  const list = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = Math.floor(list.length / 2);
  if (list.length % 2) return list[mid];
  return (list[mid - 1] + list[mid]) / 2;
}

/** mom = clamp(ln(TWAP_n / TWAP_n-1), -0.2, 0.2), or 0 when a guard trips. */
export function momentumTerm({ chapter, twap, prevTwap, swaps, traders, graduated }) {
  if ((Number(chapter) || 1) <= 1) return 0;
  if ((Number(swaps) || 0) < 50 || (Number(traders) || 0) < 20) return 0;
  if (graduated) return 0;
  if (!(Number(prevTwap) > 0) || !(Number(twap) > 0)) return 0;
  const raw = Math.log(Number(twap) / Number(prevTwap));
  return Math.max(-0.2, Math.min(0.2, raw));
}

/** M = min(1, sqrt(MC / (2 * median))) then min(1, M * (1 + 0.5 * mom)). */
export function marketTerm({ mc, medianMc, mom }) {
  if (!(Number(medianMc) > 0) || !(Number(mc) >= 0)) return 0;
  const base = Math.min(1, Math.sqrt(Number(mc) / (2 * Number(medianMc))));
  const tilt = Number(mom) || 0;
  return Math.min(1, base * (1 + 0.5 * tilt));
}

/**
 * characters: {
 *   id, twap, supply, prevTwap, chapter, swaps, traders, graduated,
 *   trainCredited, encMod,
 *   wallets: [{ balance, active, eligible }],
 *   dailyAccuracies or strikeAccuracies
 * }
 * M is the market-cap term with momentum guards. U and K stay in 0..1.
 * B and P are divided by the living maximum. Ties record raw TWAP.
 */
export function scoreCast(characters, weights) {
  const w = weights || defaultConfig().weights;
  const drafted = (characters || []).map((c) => {
    const supply = c.supply || defaultConfig().supply;
    const mc = Number.isFinite(c.mc) ? Number(c.mc) : Math.max(0, Number(c.twap) || 0) * supply;
    return { c, mc };
  });
  const medianMc = median(drafted.map((row) => row.mc));
  const rows = drafted.map(({ c, mc }) => {
    const eligible = (c.wallets || []).filter((x) => x.eligible && Number(x.balance) > 0);
    const U = turnout(eligible.map((x) => ({ balance: x.balance, active: !!x.active })));
    const B = Math.log10(1 + eligible.length);
    const enc = Number(c.encMod) || 0;
    const P = Math.sqrt(Math.max(0, Number(c.trainCredited) || 0)) * (1 + enc);
    const days = (c.dailyAccuracies || c.strikeAccuracies || []).filter((n) => Number.isFinite(n));
    const K = days.length ? days.reduce((a, b) => a + b, 0) / days.length : 0;
    const mom = momentumTerm({
      chapter: c.chapter,
      twap: c.twap,
      prevTwap: c.prevTwap,
      swaps: c.swaps,
      traders: c.traders,
      graduated: c.graduated
    });
    const M = marketTerm({ mc, medianMc, mom });
    return {
      id: c.id,
      M,
      U,
      B,
      P,
      K,
      mom,
      swaps: Number(c.swaps) || 0,
      traders: Number(c.traders) || 0,
      rawTwap: Number(c.twap) || 0,
      mc
    };
  });
  const max = {
    B: Math.max(0, ...rows.map((r) => r.B), 0),
    P: Math.max(0, ...rows.map((r) => r.P), 0)
  };
  return rows.map((r) => {
    const B = scale(r.B, max.B);
    const P = scale(r.P, max.P);
    const S = w.M * r.M + w.U * r.U + w.B * B + w.P * P + w.K * r.K;
    return {
      id: r.id,
      S,
      M: r.M,
      U: r.U,
      B,
      P,
      K: r.K,
      mom: r.mom,
      swaps: r.swaps,
      traders: r.traders,
      rawTwap: r.rawTwap,
      mc: r.mc,
      raw: r
    };
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
    const aTwap = Number(a.rawTwap);
    const bTwap = Number(b.rawTwap);
    if (Number.isFinite(a.rawTwap) && Number.isFinite(b.rawTwap) && aTwap !== bTwap) return aTwap - bTwap;
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
