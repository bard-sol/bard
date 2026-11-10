/**
 * What each reward mode should pay, written from the rules the public page states, separately
 * from server/settlement.js. A scenario compares Bard's proposed payouts with these.
 *
 * Eligible: not rejected, and qualified or approved with points. Order: qualified first, then
 * points high to low, then wallet address.
 */

export function eligible(rows) {
  return rows.filter((r) => r.status !== 'rejected' && (r.qualified === true || (r.status === 'approved' && Number(r.progress) > 0)));
}

function byRank(a, b) {
  if (!!b.qualified !== !!a.qualified) return b.qualified ? 1 : -1;
  const d = (Number(b.progress) || 0) - (Number(a.progress) || 0);
  if (d) return d;
  return a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0;
}

/** The public leaderboard: everyone who is not rejected, ranked. */
export function boardOrder(rows) {
  return rows.filter((r) => r.status !== 'rejected').slice().sort(byRank).slice(0, 200);
}

export function ranked(rows) {
  return eligible(rows).slice().sort(byRank);
}

function line(wallet, raw) {
  return { wallet, amountRaw: raw.toString() };
}

/** Every qualified holder gets `each`, as far as the locked prize goes, in rank order. */
export function expectedFixed(rows, each, prizeRaw) {
  const list = ranked(rows);
  const slots = Number(BigInt(prizeRaw) / BigInt(each));
  return list.slice(0, Math.min(slots, list.length)).map((r) => line(r.wallet, BigInt(each)));
}

/** Top 3 by rank get 50 / 30 / 20 percent of the prize, each rounded down. */
export function expectedTop3(rows, prizeRaw, shares = [50n, 30n, 20n]) {
  return ranked(rows).slice(0, 3).map((r, i) => line(r.wallet, BigInt(prizeRaw) * shares[i] / 100n)).filter((p) => p.amountRaw !== '0');
}

/** The pool split evenly; the remainder goes one unit each to the first in rank order. */
export function expectedPool(rows, poolRaw) {
  const list = ranked(rows);
  const n = BigInt(list.length);
  const each = BigInt(poolRaw) / n;
  const rem = BigInt(poolRaw) % n;
  return list.map((r, i) => line(r.wallet, each + (BigInt(i) < rem ? 1n : 0n))).filter((p) => p.amountRaw !== '0');
}

/**
 * Growing: start + add for every full period since the campaign started, capped at the cap
 * (the locked prize), all to the top-ranked holder.
 */
export function expectedGrowing(rows, { startRaw, addRaw, capRaw, periods }) {
  let now = BigInt(startRaw) + BigInt(addRaw) * BigInt(periods);
  if (now > BigInt(capRaw)) now = BigInt(capRaw);
  const top = ranked(rows)[0];
  return top ? [line(top.wallet, now)] : [];
}

/** Bard's cut on what holders receive: basis points of the holder total, rounded down. */
export function expectedCut(payouts, bps) {
  const total = payouts.reduce((n, p) => n + BigInt(p.amountRaw), 0n);
  return total * BigInt(bps) / 10000n;
}
