/** Holdings do not multiply contribution. Season 0 pays tBard only. */

export const REWARD_UNLOCK_DAYS = 14;
export const POOL_PER_CHAPTER = 2142857;
export const CONTRIB_REWARD_MODE = 'tbard';

export function rewardMode(requested) {
  if (requested && requested !== 'tbard') {
    return { ok: false, reason: 'mainnet_rewards_disabled', mode: 'tbard' };
  }
  return { ok: true, mode: 'tbard' };
}

/**
 * Champion triples Trial weight. Clutch doubles it for a character who was
 * in danger from the shortlist through the chapter close. The Captain's
 * Decide call is worth 2. A plain Decide is 1. Train is 1, not the amount.
 */
export function contributionPoints(row) {
  const wallet = row || {};
  let trial = Math.round((Number(wallet.trialAccuracy) || 0) * 100);
  if (wallet.champion) trial *= 3;
  if (wallet.clutch || wallet.inDanger) trial *= 2;
  let decide = 0;
  if (wallet.decided && wallet.captain) decide = 2;
  else if (wallet.decided) decide = 1;
  const train = wallet.trained ? 1 : 0;
  return {
    cp: trial + decide + train,
    parts: { trial, decide, train },
    holdingsIgnored: true
  };
}

export function impactReadout(wallet, peers) {
  const mine = contributionPoints(wallet);
  const list = peers || [];
  const total = list.reduce((sum, row) => sum + contributionPoints(row).cp, 0);
  return {
    cp: mine.cp,
    parts: mine.parts,
    share: total > 0 ? mine.cp / total : 0,
    of: total,
    holdingsIgnored: true
  };
}

function recipients(wallets) {
  const ranked = (wallets || [])
    .map((row) => ({ ...row, ...contributionPoints(row) }))
    .filter((row) => row.cp > 0)
    .sort((a, b) => b.cp - a.cp);
  if (!ranked.length) return [];
  const take = Math.max(3, Math.ceil(ranked.length * 0.1));
  return ranked.slice(0, Math.min(take, ranked.length));
}

function cappedShares(rows, emit) {
  const cap = Math.floor(emit * 0.01);
  let weights = rows.map((row) => Math.pow(row.cp, 0.8));
  let amounts = rows.map(() => 0);
  let left = emit;
  let open = rows.map(() => true);
  for (let pass = 0; pass < rows.length && left > 0; pass++) {
    const sum = weights.reduce((total, weight, index) => total + (open[index] ? weight : 0), 0);
    if (!(sum > 0)) break;
    let spent = 0;
    rows.forEach((row, index) => {
      if (!open[index]) return;
      const share = Math.floor(left * weights[index] / sum);
      const room = Math.max(0, cap - amounts[index]);
      const give = Math.min(share, room);
      amounts[index] += give;
      spent += give;
      if (amounts[index] >= cap) open[index] = false;
    });
    left -= spent;
    if (spent === 0) break;
  }
  return amounts;
}

/**
 * Top 10% of each surviving character (at least 3), share by CP^0.8,
 * 1% cap per wallet. Dead characters pay nothing. Unlock is linear over 14 days.
 */
export function contributorPool({ characters, bardTwap, rolled, mode, daysSinceFinale }) {
  const gate = rewardMode(mode || CONTRIB_REWARD_MODE);
  if (!gate.ok) return gate;
  const pool = POOL_PER_CHAPTER + Math.max(0, Number(rolled) || 0);
  let emit = pool;
  let solCap = null;
  if (Number(bardTwap) > 0) {
    solCap = Math.floor(20 / Number(bardTwap));
    emit = Math.min(pool, solCap);
  }
  const leftover = pool - emit;
  const payouts = [];
  for (const character of characters || []) {
    if (character.alive === false) continue;
    const chosen = recipients(character.wallets || []);
    const amounts = cappedShares(chosen, emit);
    chosen.forEach((row, index) => {
      if (!amounts[index]) return;
      payouts.push({
        charId: character.id,
        wallet: row.wallet,
        cp: row.cp,
        amount: amounts[index],
        unlocked: unlockedAmount(amounts[index], daysSinceFinale)
      });
    });
  }
  return {
    ok: true,
    mode: 'tbard',
    mainnet: false,
    pool,
    emit,
    solCap,
    leftover,
    unlockDays: REWARD_UNLOCK_DAYS,
    payouts
  };
}

export function unlockedAmount(total, daysSinceFinale) {
  const days = Math.max(0, Math.min(REWARD_UNLOCK_DAYS, Math.floor(Number(daysSinceFinale) || 0)));
  return Math.floor((Number(total) || 0) * days / REWARD_UNLOCK_DAYS);
}
