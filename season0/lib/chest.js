import { sha256Hex } from './bytes.js';

/** Free cosmetic chests. Rolls come from sha256(wallet, day, "chest"). Never for sale. */

export const CHEST_ODDS = [
  { rarity: 'common', weight: 70 },
  { rarity: 'rare', weight: 25 },
  { rarity: 'epic', weight: 5 }
];

export const CHEST_PITY = 10;

const POOL = [];
function add(type, rarity, names) {
  names.forEach((name, index) => {
    POOL.push({
      id: type + '-' + rarity + '-' + (index + 1),
      type,
      rarity,
      name,
      transferable: false,
      nft: false,
      tradeable: false
    });
  });
}

add('frame', 'common', ['Brass corner', 'Ink rule', 'Soft vignette', 'Margin line']);
add('frame', 'rare', ['Sky ring', 'Vermillion edge']);
add('frame', 'epic', ['Gilded frame']);
add('title', 'common', ['Page dog', 'Ink blot', 'Margin tick', 'Soft glow']);
add('title', 'rare', ['Ribbon', 'Wax seal']);
add('title', 'epic', ['Last Page Witness']);
add('back', 'common', ['Plain board', 'Hatched board', 'Bone board']);
add('back', 'rare', ['Sky back', 'Ochre back']);
add('back', 'epic', ['Gilded back']);
add('letter', 'common', ['Plain sheet', 'Ruled sheet', 'Torn sheet']);
add('letter', 'rare', ['Wax stationery']);
add('letter', 'epic', ['Last-page stationery']);
add('emote', 'common', ['Nod', 'Wave']);
add('emote', 'rare', ['Cheer']);

export function chestPool() {
  return POOL.map((item) => ({ ...item }));
}

export function publishedOdds() {
  const total = CHEST_ODDS.reduce((sum, row) => sum + row.weight, 0);
  return CHEST_ODDS.map((row) => ({
    rarity: row.rarity,
    chance: row.weight / total,
    count: POOL.filter((item) => item.rarity === row.rarity).length,
    transferable: false,
    nft: false
  }));
}

export async function chestSeed(wallet, day) {
  return sha256Hex(String(wallet) + '|' + String(day) + '|chest');
}

async function unitAt(seedHex, index) {
  const hex = await sha256Hex(String(seedHex) + '|' + index);
  return parseInt(hex.slice(0, 8), 16) / 4294967296;
}

function tierFromUnit(unit, { pity, rareOrBetter, forceEpic }) {
  if (forceEpic) return 'epic';
  if (pity) return 'rare';
  const mark = unit * 100;
  let rarity = 'common';
  if (mark >= 95) rarity = 'epic';
  else if (mark >= 70) rarity = 'rare';
  if (rareOrBetter && rarity === 'common') rarity = 'rare';
  return rarity;
}

function unfinished(rarity, owned) {
  const same = POOL.filter((item) => item.rarity === rarity && !owned.has(item.id));
  if (same.length) return same;
  const bump = rarity === 'common' ? 'rare' : 'common';
  const moved = POOL.filter((item) => item.rarity === bump && !owned.has(item.id));
  if (moved.length) return moved;
  return POOL.filter((item) => !owned.has(item.id));
}

/**
 * pay must be absent. A rare is guaranteed on the 10th open without a rare or better.
 * Streak days 7 and 14 are rare-or-better. Day 21 forces an epic if one is missing.
 */
export async function openChest({ seedHex, rng, sinceRare, pay, owned, streak, dayOfSeason, rareOrBetter }) {
  if (pay != null && pay !== 0 && pay !== false) return { ok: false, reason: 'chests_are_free' };
  const dry = Number(sinceRare) || 0;
  const have = new Set(owned || []);
  const pity = dry >= CHEST_PITY - 1;
  const bonus = rareOrBetter || streak === 7 || streak === 14;
  const missingEpic = !POOL.some((item) => item.rarity === 'epic' && have.has(item.id));
  const forceEpic = Number(dayOfSeason) === 21 && missingEpic;
  let rarity;
  let item;
  if (rng && !seedHex) {
    const row = pity
      ? CHEST_ODDS.find((entry) => entry.rarity === 'rare')
      : pickWeighted(rng, bonus, forceEpic);
    rarity = row.rarity;
    const choices = unfinished(rarity, have);
    item = choices[Math.floor(rng() * choices.length)] || null;
  } else {
    const seed = seedHex || '0';
    const rarityUnit = await unitAt(seed, 0);
    rarity = tierFromUnit(rarityUnit, { pity, rareOrBetter: bonus, forceEpic });
    const choices = unfinished(rarity, have);
    if (!choices.length) return { ok: false, reason: 'collection_complete' };
    const pickUnit = await unitAt(seed, 1);
    item = choices[Math.floor(pickUnit * choices.length)];
    rarity = item.rarity;
  }
  if (!item) return { ok: false, reason: 'collection_complete' };
  const better = item.rarity === 'rare' || item.rarity === 'epic';
  return {
    ok: true,
    item: item.name,
    id: item.id,
    type: item.type,
    rarity: item.rarity,
    pity,
    sinceRare: better ? 0 : dry + 1,
    transferable: false,
    nft: false,
    tradeable: false
  };
}

function pickWeighted(rng, rareOrBetter, forceEpic) {
  if (forceEpic) return CHEST_ODDS.find((row) => row.rarity === 'epic');
  const rows = rareOrBetter ? CHEST_ODDS.filter((row) => row.rarity !== 'common') : CHEST_ODDS;
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  let roll = rng() * total;
  for (const row of rows) {
    roll -= row.weight;
    if (roll < 0) return row;
  }
  return rows[rows.length - 1];
}
