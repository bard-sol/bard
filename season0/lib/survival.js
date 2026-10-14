import { CAST } from './cast.js';
import { chooseMarked, scoreCast } from './score.js';

/**
 * One elimination per chapter across the eight. No revival.
 * Markets, turnout and Trial accuracy are fixed so the run can be repeated.
 */
export function survivalField() {
  return CAST.map((character, index) => ({
    id: character.id,
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

export async function simulateSeason(randomness) {
  let living = survivalField();
  const chapters = [];
  for (let chapter = 1; chapter <= 7 && living.length > 1; chapter++) {
    const scored = scoreCast(living.map((row) => ({ ...row, chapter })));
    const marked = await chooseMarked(scored, randomness || ('season-' + chapter), 1);
    const dead = marked[0];
    const best = scored.filter((row) => row.id !== dead.id).sort((a, b) => b.S - a.S)[0];
    chapters.push({
      chapter,
      marked: dead.id,
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
