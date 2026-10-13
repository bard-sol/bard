const RISK_RANK = { SAFE: 0, NORMAL: 1, BOLD: 2 };

/**
 * Iterative 2% cap. Under 50 voters the cap relaxes to max(2%, 1/n)
 * so a small ballot does not zero itself out.
 */
export function applyVoteCap(weights, opts) {
  const cap = (opts && opts.cap) || 0.02;
  const relaxUnder = (opts && opts.relaxUnder) || 50;
  const maxIter = (opts && opts.maxIter) || 50;
  let w = (weights || []).map((n) => Math.max(0, Number(n) || 0));
  const voters = w.filter((n) => n > 0).length;
  const limit = voters > 0 && voters < relaxUnder ? Math.max(cap, 1 / voters) : cap;
  for (let i = 0; i < maxIter; i++) {
    const total = w.reduce((a, b) => a + b, 0);
    if (total <= 0) break;
    let changed = false;
    w = w.map((n) => {
      const ceiling = limit * total;
      if (n > ceiling + 1e-9) {
        changed = true;
        return ceiling;
      }
      return n;
    });
    if (!changed) break;
  }
  return w;
}

export function winningChoice(choices, weightById) {
  const list = choices || [];
  const weighted = list.map((c) => ({
    choice: c,
    weight: Math.max(0, Number(weightById && weightById[c.id]) || 0)
  }));
  const total = weighted.reduce((a, b) => a + b.weight, 0);
  if (total <= 0) {
    const safe = list.find((c) => c.risk === 'SAFE') || list[0] || null;
    return { choice: safe, share: 0, apathy: true, total: 0 };
  }
  const top = Math.max(...weighted.map((x) => x.weight));
  const tied = weighted.filter((x) => Math.abs(x.weight - top) < 1e-9).map((x) => x.choice);
  tied.sort((a, b) => {
    const as = a.risk === 'SAFE' ? -1 : 0;
    const bs = b.risk === 'SAFE' ? -1 : 0;
    if (as !== bs) return as - bs;
    return (RISK_RANK[a.risk] ?? 9) - (RISK_RANK[b.risk] ?? 9);
  });
  const choice = tied[0];
  return { choice, share: top / total, apathy: false, total };
}

export function encounterOutcome({ randomness, stat, maxStat, luck, maxLuck, winningShare, risk, apathy }) {
  const r = BigInt(randomness);
  const u = Number(r % (2n ** 32n)) / 2 ** 32;
  const sRel = maxStat > 0 ? Number(stat) / Number(maxStat) : 0;
  const lRel = maxLuck > 0 ? Number(luck) / Number(maxLuck) : 0;
  const unity = winningShare >= 0.66 ? 0.05 : 0;
  let p = 0.3 + 0.4 * sRel + 0.15 * lRel + unity;
  p = Math.min(0.9, Math.max(0.15, p));
  let tier;
  let tierValue;
  if (u < 0.4 * p) {
    tier = 'TRIUMPH';
    tierValue = 1;
  } else if (u < p) {
    tier = 'SUCCESS';
    tierValue = 0.5;
  } else if (u < p + 0.6 * (1 - p)) {
    tier = 'SETBACK';
    tierValue = -0.5;
  } else {
    tier = 'DISASTER';
    tierValue = -1;
  }
  const scale = { SAFE: 0.1, NORMAL: 0.15, BOLD: 0.2 }[risk];
  if (scale == null) throw new Error('bad risk ' + risk);
  let enc = tierValue * scale;
  if (apathy) enc -= 0.05;
  enc = Math.min(0.2, Math.max(-0.2, enc));
  return { u, p, tier, tierValue, encMod: enc, unity };
}
