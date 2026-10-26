/**
 * Prize lock and payout-cut math. Amounts are raw token units (BigInt).
 * The cut locked at creation is ceil(prize × bps / 10000).
 * The cut paid at settlement is floor(holder total × bps / 10000).
 * A cut that rounds to zero is waived. Holders are never shorted to make one.
 */

export const JSON_SAFE_RAW_LIMIT = 9007199254740992n;
export const U64_MAX = 18446744073709551615n;

export function toRaw(value) {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error('amount is invalid');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('amount is too large to settle safely');
  }
  let text = String(value == null ? '' : value).trim();
  if (/^\d+\.0+$/.test(text)) text = text.slice(0, text.indexOf('.'));
  if (!/^\d+$/.test(text)) throw new Error('amount is invalid');
  return BigInt(text);
}

export function assertJsonSafeRaw(value, label) {
  const raw = toRaw(value);
  if (raw >= JSON_SAFE_RAW_LIMIT) throw new Error(label + ' is too large to settle safely');
  return raw;
}

export function assertU64Raw(value, label) {
  const raw = toRaw(value);
  if (raw > U64_MAX) throw new Error(label + ' is larger than u64');
  return raw;
}

export function decimalToRaw(value, decimals) {
  const places = Number(decimals);
  if (!Number.isInteger(places) || places < 0 || places > 18) throw new Error('Bad mint decimals');
  let text;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.floor(value) !== value) {
      throw new Error('Fractional amounts must be decimal strings');
    }
    text = String(value);
  } else {
    text = String(value == null ? '' : value).trim();
  }
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('Bad amount');
  const parts = text.split('.');
  let frac = parts[1] || '';
  if (frac.length > places) throw new Error('Amount has more decimals than the mint');
  while (frac.length < places) frac += '0';
  return BigInt(places === 0 ? parts[0] : parts[0] + frac);
}

export function rawToDecimal(raw, decimals) {
  const places = Number(decimals);
  const value = toRaw(raw);
  if (places === 0) return value.toString();
  let text = value.toString();
  while (text.length <= places) text = '0' + text;
  const whole = text.slice(0, text.length - places);
  const frac = text.slice(text.length - places).replace(/0+$/, '');
  return whole + (frac ? '.' + frac : '');
}

export function wholeNumber(value) {
  const text = String(value == null ? '' : value).trim();
  if (!/^\d+$/.test(text)) throw new Error('Expected a whole number');
  return BigInt(text);
}

export function normalizeConfig(config) {
  if (!config) return {};
  if (typeof config === 'string') {
    try { return JSON.parse(config) || {}; } catch { return {}; }
  }
  return config;
}

export function ceilCut(prizeRaw, bps) {
  const prize = toRaw(prizeRaw);
  const cutBps = toRaw(bps);
  if (cutBps > 10000n) throw new Error('cut basis points are invalid');
  if (prize === 0n || cutBps === 0n) return 0n;
  return (prize * cutBps + 9999n) / 10000n;
}

export function floorCut(totalRaw, bps) {
  const total = toRaw(totalRaw);
  const cutBps = toRaw(bps);
  if (cutBps > 10000n) throw new Error('cut basis points are invalid');
  return (total * cutBps) / 10000n;
}

export function lockNeed(prizeRaw, bps) {
  const prize = toRaw(prizeRaw);
  const cutRaw = ceilCut(prize, bps);
  return { prizeRaw: prize, cutRaw, lockedRaw: prize + cutRaw };
}

export function covered(balanceRaw, reservedRaw, lockedRaw) {
  return toRaw(balanceRaw) >= toRaw(reservedRaw || 0) + toRaw(lockedRaw);
}

export function top3Shares(config) {
  const cfg = normalizeConfig(config);
  return [
    wholeNumber(cfg.top3First != null && cfg.top3First !== '' ? cfg.top3First : 50),
    wholeNumber(cfg.top3Second != null && cfg.top3Second !== '' ? cfg.top3Second : 30),
    wholeNumber(cfg.top3Third != null && cfg.top3Third !== '' ? cfg.top3Third : 20),
  ];
}

export function sharesSum100(shares) {
  return shares.reduce((sum, part) => sum + part, 0n) === 100n;
}

export function resolvePrizeRaw({ rewardMode, reward, prize, pool, config, decimals }) {
  const cfg = normalizeConfig(config);
  const mode = rewardMode || 'fixed';
  if (mode === 'growing') {
    if (cfg.growCap == null || String(cfg.growCap).trim() === '') {
      throw new Error('A growing pool needs a cap before it can lock');
    }
    const cap = decimalToRaw(cfg.growCap, decimals);
    if (cap <= 0n) throw new Error('A growing pool needs a cap before it can lock');
    return cap;
  }
  if (mode === 'top3' || mode === 'topn') {
    const shares = top3Shares(cfg);
    if (!sharesSum100(shares)) throw new Error('Top 3 shares must sum to 100');
  }
  if (mode === 'fixed') {
    const hasCount = cfg.holderCount != null && String(cfg.holderCount).trim() !== '';
    const hasReward = reward != null && String(reward).trim() !== '';
    if (hasReward && hasCount) {
      const each = decimalToRaw(reward, decimals);
      const count = wholeNumber(cfg.holderCount);
      if (each <= 0n || count <= 0n) {
        throw new Error('Fixed rewards need a per-holder amount and an expected holder count');
      }
      return each * count;
    }
  }
  const human = prize != null && String(prize).trim() !== ''
    ? prize
    : (pool != null && String(pool).trim() !== '' ? pool : reward);
  if (human == null || String(human).trim() === '') throw new Error('Enter the prize holders will share');
  const raw = decimalToRaw(human, decimals);
  if (raw <= 0n) throw new Error('Enter the prize holders will share');
  return raw;
}

export function canonicalPayoutText(lines) {
  return (lines || []).slice().sort((a, b) => {
    if (a.wallet < b.wallet) return -1;
    if (a.wallet > b.wallet) return 1;
    return 0;
  }).map((line) => String(line.wallet) + ':' + String(line.amountRaw)).join('\n');
}

export async function payoutHash(lines) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPayoutText(lines)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hashLines(payouts, cutWallet, cutRaw) {
  const lines = (payouts || []).map((row) => ({ wallet: row.wallet, amountRaw: String(row.amountRaw) }));
  if (toRaw(cutRaw || 0) > 0n) lines.push({ wallet: cutWallet, amountRaw: toRaw(cutRaw).toString() });
  return lines;
}

export function settlementCut(payouts, prizeRaw, cutBps, cutWallet) {
  const holderTotalRaw = (payouts || []).reduce((sum, row) => sum + toRaw(row.amountRaw), 0n);
  if (prizeRaw != null && String(prizeRaw).trim() !== '' && holderTotalRaw > toRaw(prizeRaw)) {
    throw new Error('Payout is larger than the locked prize');
  }
  const cutRaw = floorCut(holderTotalRaw, cutBps);
  const cutWaived = cutRaw === 0n;
  return {
    holderTotalRaw,
    cutRaw,
    cutWaived,
    cutWallet: cutWaived ? null : cutWallet,
    lines: hashLines(payouts, cutWallet, cutRaw),
  };
}
