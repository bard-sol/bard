import { defaultConfig } from './config.js';

export function earlyBuyCopy(config) {
  const on = config ? config.legacy_early_buy_enabled !== false : defaultConfig().legacy_early_buy_enabled;
  if (on) {
    return 'Season 0 play earns legacy points and the first buying window on the Season 1 cast. Timing only. No discount. No tokens, and no promise of tokens.';
  }
  return 'Legacy points are recorded. The Season 1 early buying window is switched off.';
}

/**
 * Per-chapter legacy. A voided chapter pays nothing (screen-spec assumption).
 * Prediction points are capped per season and only after the wallet qualifies.
 */
export function chapterLegacy(input) {
  const cap = input.cap == null ? 50 : input.cap;
  if (input.voided) {
    return { points: 0, prediction: 0, sources: [], capUsed: input.predictionPointsSoFar || 0 };
  }
  const sources = [];
  if (input.eligibleStrike) sources.push(['strike', 2]);
  if (input.trained) sources.push(['train', 2]);
  if (input.voted) sources.push(['decide', 2]);
  if (input.topSquad) sources.push(['top_squad', 5]);
  if (input.revivalSuccess) sources.push(['revival', 5]);
  if (input.champion) sources.push(['champion', 20]);
  let prediction = 0;
  if (input.predictionCounts && input.predictionCorrect && input.predictionQualified) {
    const room = Math.max(0, cap - (Number(input.predictionPointsSoFar) || 0));
    prediction = Math.min(10, room);
    if (prediction > 0) sources.push(['prediction', prediction]);
  }
  const points = sources.reduce((a, s) => a + s[1], 0);
  return {
    points,
    prediction,
    sources,
    capUsed: (Number(input.predictionPointsSoFar) || 0) + prediction
  };
}

/** Every source shares one season cap. Unqualified points stay cosmetic. */
export function seasonLegacy({ events, turnstile, onChain, cap }) {
  const limit = cap == null ? 50 : cap;
  const list = events || [];
  const total = list.reduce((sum, event) => sum + (Number(event.points) || 0), 0);
  const qualified = !!(turnstile && onChain);
  if (!qualified) {
    return { qualified: false, counted: 0, cosmetic: total, cap: limit, total };
  }
  const counted = Math.min(limit, Math.max(0, total));
  return { qualified: true, counted, cosmetic: total - counted, cap: limit, total };
}
