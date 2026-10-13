/** Free cosmetic chests. No purchase path. Contents never leave the account. */

export const CHEST_ODDS = [
  { rarity: 'common', weight: 70, items: ['Ink blot', 'Margin tick', 'Soft glow'] },
  { rarity: 'uncommon', weight: 25, items: ['Ribbon', 'Wax seal', 'Page dog'] },
  { rarity: 'rare', weight: 5, items: ['Gold seam', 'Reaper bell', 'Last-page thread'] }
];

export const CHEST_PITY = 10;

export function publishedOdds() {
  const total = CHEST_ODDS.reduce((sum, row) => sum + row.weight, 0);
  return CHEST_ODDS.map((row) => ({
    rarity: row.rarity,
    chance: row.weight / total,
    items: row.items.slice(),
    transferable: false,
    nft: false
  }));
}

function pick(rng, rows) {
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  let roll = rng() * total;
  for (const row of rows) {
    roll -= row.weight;
    if (roll < 0) return row;
  }
  return rows[rows.length - 1];
}

/**
 * A rare is guaranteed on the 10th open without one.
 * pay must be absent. There is no buy-extra path.
 */
export function openChest({ rng, sinceRare, pay }) {
  if (pay != null && pay !== 0 && pay !== false) return { ok: false, reason: 'chests_are_free' };
  const dry = Number(sinceRare) || 0;
  const forced = dry >= CHEST_PITY - 1;
  const row = forced
    ? CHEST_ODDS.find((item) => item.rarity === 'rare')
    : pick(rng, CHEST_ODDS);
  const item = row.items[Math.floor(rng() * row.items.length)];
  const nextDry = row.rarity === 'rare' ? 0 : dry + 1;
  return {
    ok: true,
    item,
    rarity: row.rarity,
    pity: forced,
    sinceRare: nextDry,
    transferable: false,
    nft: false,
    tradeable: false
  };
}
