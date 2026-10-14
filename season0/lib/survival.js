import { CAST } from './cast.js';
import { chooseMarked, scoreCast } from './score.js';

/**
 * One elimination per chapter across the eight. No revival.
 * Markets, turnout and Trial accuracy are fixed so the run can be repeated.
 */
export function survivalField() {
  return CAST.map((character, index) => ({
    id: character.id,
    entity_id: character.id,
    entity_type: 'character',
    twap: 0.8 + index * 0.35,
    prevTwap: 0.75 + index * 0.3,
    supply: 1000000000,
    trainCredited: 40 + index * 25,
    encMod: 0,
    swaps: 80,
    traders: 25,
    graduated: false,
    dailyAccuracies: [0.45 + (index % 4) * 0.12],
    wallets: [
      { balance: 80 + index * 10, eligible: true, active: index % 2 === 0 },
      { balance: 30, eligible: true, active: true },
      { balance: 12, eligible: true, active: false }
    ]
  }));
}

function mulberry(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Same distribution for every character: market cap, Train, turnout, and Trial. */
export function randomField(rng) {
  return CAST.map((character) => {
    const twap = Math.exp(Math.log(0.25) + rng() * Math.log(12));
    const prevTwap = Math.max(0.05, twap * Math.exp((rng() - 0.5) * 0.6));
    const holders = 3 + Math.floor(rng() * 14);
    const activeRate = rng();
    const wallets = [];
    for (let i = 0; i < holders; i++) {
      wallets.push({
        balance: 1 + Math.floor(rng() * 800),
        eligible: rng() > 0.08,
        active: rng() < activeRate
      });
    }
    return {
      id: character.id,
      entity_id: character.id,
      entity_type: 'character',
      twap,
      prevTwap,
      supply: 1000000000,
      trainCredited: Math.floor(rng() * 900),
      encMod: 0,
      swaps: Math.floor(rng() * 200),
      traders: Math.floor(rng() * 80),
      graduated: rng() < 0.04,
      dailyAccuracies: [rng(), rng(), rng()],
      wallets
    };
  });
}

export async function simulateSeason(randomness, field) {
  let living = (field || survivalField()).map((row) => ({
    ...row,
    wallets: (row.wallets || []).map((wallet) => ({ ...wallet })),
    dailyAccuracies: (row.dailyAccuracies || []).slice()
  }));
  const chapters = [];
  for (let chapter = 1; chapter <= 7 && living.length > 1; chapter++) {
    const scored = scoreCast(living.map((row) => ({ ...row, chapter })));
    const marked = await chooseMarked(scored, randomness || ('season-' + chapter), 1);
    const dead = marked[0];
    const best = scored.filter((row) => row.id !== dead.id).sort((a, b) => b.S - a.S)[0];
    chapters.push({
      chapter,
      marked: dead.id,
      entity_id: dead.entity_id,
      entity_type: dead.entity_type,
      deadScore: dead.S,
      leader: best.id,
      leaderScore: best.S,
      margin: dead.S > 0 ? (best.S - dead.S) / dead.S : null,
      mom: dead.mom
    });
    living = living.filter((row) => row.id !== dead.id);
  }
  return {
    champion: living[0] ? living[0].id : null,
    remaining: living.map((row) => row.id),
    chapters
  };
}

function shareOf(counts, total) {
  const out = {};
  for (const id of CAST.map((character) => character.id)) {
    out[id] = (counts[id] || 0) / total;
  }
  return out;
}

/**
 * Many seasons. Each seed draws a fresh field. Reports who is marked in each
 * chapter and who is champion. A share above 40% is flagged.
 */
export async function simulateSurvivalSeeds(count) {
  const total = Math.max(1, Number(count) || 500);
  const marked = {};
  const champions = {};
  const margins = {};
  for (let chapter = 1; chapter <= 7; chapter++) {
    marked[chapter] = {};
    margins[chapter] = [];
  }
  for (let i = 0; i < total; i++) {
    const season = await simulateSeason('surv-' + i, randomField(mulberry((i + 1) * 0x9e3779b9)));
    champions[season.champion] = (champions[season.champion] || 0) + 1;
    for (const row of season.chapters) {
      marked[row.chapter][row.marked] = (marked[row.chapter][row.marked] || 0) + 1;
      if (row.margin != null) margins[row.chapter].push(row.margin);
    }
  }
  const flagged = [];
  const chapters = [];
  for (let chapter = 1; chapter <= 7; chapter++) {
    const share = shareOf(marked[chapter], total);
    for (const id of Object.keys(share)) {
      if (share[id] > 0.4) flagged.push({ chapter, id, share: share[id] });
    }
    const list = margins[chapter].slice().sort((a, b) => a - b);
    const mid = list.length ? list[Math.floor((list.length - 1) / 2)] : null;
    chapters.push({ chapter, marked: share, medianMargin: mid });
  }
  return {
    seeds: total,
    chapters,
    champions: shareOf(champions, total),
    flagged
  };
}
