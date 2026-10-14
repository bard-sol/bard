/**
 * score_v4 season sim. Does not modify game code.
 *
 * Run: node season0/sims/score-v4.mjs
 * Optional: SEASONS=1000 node season0/sims/score-v4.mjs
 *
 * Health follows delta §3, with §9 (Crypto, Oct 15) where they differ.
 * raise_loyalty_pays defaults to false. The same seasons are also scored
 * with the flag true. The flag does not change Health.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SEASONS = Math.max(1, Number(process.env.SEASONS || 1000));
const HOUSES = [
  ['grenna', 'The Pit'],
  ['silas', 'The Scriptorium'],
  ['marrow', 'The Gilt'],
  ['pip', 'The Tidewrack'],
  ['wick', 'The Candle'],
  ['vey', 'The Standard'],
  ['thorn', 'The Torn Margin'],
  ['twins', 'The Fold']
];
const IDS = HOUSES.map((row) => row[0]);
const NAME = Object.fromEntries(HOUSES);
const INDEX = Object.fromEntries(IDS.map((id, index) => [id, index]));

const DUEL = loadDuelRates();

const ASSUMPTIONS = [
  'House faces are the eight cast ids, mapped as in brief-v4-fit: Pit/Grenna, Scriptorium/Silas, Gilt/Marrow, Tidewrack/Pip, Candle/Wick, Standard/Vey, Torn Margin/Thorn, Fold/Ash & Ember.',
  'One successful revival per season. The delta does not say "once", but a second owed chapter breaks "ch6 starts with 3". A second pour can still fill a bar.',
  'Ch5 has no revival window. The death penalty is still charged there, because the window cannot succeed. Ch6 and ch7 eliminations are the podium and pay nothing.',
  'Oath ×1.5 multiplies the pot stake share only. It does not multiply TWL or Health.',
  'Unverified clusters are collapsed at generation: one weight from the combined stake, not one weight per sybil.',
  'Population is invented. House size is lognormal (σ 0.50). A typical house has about 42 verified stakers (median stake 100, σ 0.65), 28 unverified (median stake 35, σ 0.85, 18% of them a 3–8 wallet cluster), and 36 free Readers.',
  '35% of verified stakers take the Oath. 35% play the Duel at lookahead skill, 65% greedy, and 80% of stakers attempt it. Bonus moves arrive the next morning, including across the chapter boundary. Rates come from season0/sims/results/duel.json when that file exists.',
  'Shop extras: 22% of stakers buy one, 6% buy two. Weight equals a normal move. Readers do not shop.',
  'Fortune is one draw a morning, equal thirds: +1 move, Spyglass, or Doodle/fragment. The +1 weighs the same as that wallet\'s move. Spyglass retargets 10% of hit weight onto the current lowest rival (invented). Twist 9 sets that to 0. Doodles and fragments add 0.',
  'Heal split, invented: verified 62% of layer weight heals, unverified 48%, Readers 82%, ±8 points. The rest hits. Ghosts only hit.',
  'Default hit split, invented: 55% on the lowest-Health rival, 25% on the Crown if that is someone else, 20% across the other rivals. Day 1 of chapter 1 has no Crown.',
  'Armor fresh locks, invented: 10% of verified and 5% of unverified lock new Bard equal to 8–30% of their stake. A separate 15% "rollover" is generated and ignored. Re-pledges and switch-ins are not fresh locks.',
  'Ward, invented: 45% of houses buy a Ward each day, uniform from 0 to 0.10.',
  'Raise, invented: about 18% of verified wallets Raise each chapter. If the house is shortlisted, 45% of those raisers go to 4× and the rest stay at 2×. The multiplier applies only if the house survives that chapter. Raised Bard is 15% of stake.',
  'When raise_loyalty_pays is false, pot Loyalty is heal weight with no 1.5× and no Raise multiplier. When true, day-3 shortlist heals are ×1.5 and then a surviving raiser\'s chapter heals are ×2 or ×4. The two bonuses stack. Base heals still pay in both cases.',
  'Inside a finishing House the pot is 70% stake-time (Oath ×1.5) and 30% Loyalty, verified humans only, then capped at 2% per wallet with the surplus shared by the uncapped wallets.',
  'Re-pledge, invented: 18% of a dead House\'s verified and 10% of its unverified move to a random living House at the next chapter open, after the penalty, with time restarted. 25% of its Readers follow. This is not an entry fee and not Armor.',
  'Ghost retention, invented: 72% of verified wallets who did not re-pledge keep hitting. A6\'s denominator is every wallet that could move at death (verified + unverified + Readers).',
  'TWL uses chapter-open locks at weight 1. Fresh locks weigh the fraction of the chapter still ahead (day 1: 5/6, day 2: 1/2, day 3: 1/6). Move weight uses chapter-open stake, frozen with m.',
  'Even-count medians are the mean of the two central values.',
  'A Health tie breaks to the lower TWL, then the lower cast id.',
  'The Twist deck deals 7 distinct Twists per season. The forced-Twist study turns one Twist on for every chapter.',
  'Twist 8 draws the snapshot uniformly from +54h to +66h. The day-3 Tally is +59h, so day-3 moves drop with probability 5/12.',
  'Twist 11 gives stakers a 4th move. Readers stay at one move.',
  'Large House, for the pile-on: most verified wallets. The chosen rival is the highest-TWL other House. A second run aims at the lowest-TWL other House.',
  DUEL.source
];

const AMBIGUITIES = [
  '§3 still writes unverified weight as min(1, sqrt(stake/median)). §9 replaces that with min(1, stake_tw24h / m). This sim uses §9.',
  'm is "median verified stake", while the numerator is stake_tw24h. Those are different units. Full-day locks use the stake balance as the 24h weight.',
  'Σ|moves cast on k| is not defined. This sim uses gross cast weight after the layer caps and Twist multipliers, before Armor and before the Crown multiplier. |net| would force the people share to equal w by construction, so it is only reported as a check.',
  'The Crown on the first Tally of the season has no previous Tally. There is no Crown that morning. Later mornings inherit the previous Tally, including the previous chapter\'s snapshot.',
  '§3 caps the bought-lock term at 60% and then adds Ward, with a 70% total. §9 adds a 20% per-wallet cap and says Armor is new locks only. Twist 3 says the Armor cap is 30% instead of 60%. This sim changes only that 60% inner cap. Ward and the 70% total stay. One wallet is limited to 20% of the pre-cap formula Armor, and the excess is dropped.',
  'A kill is +2 and does not also grant the +1. The brief says "up to +2". Twist 12 raises the Duel cap to +3, but nothing in the Duel awards a third move, so the Twist has no Health effect.',
  'Twist 10 (midday reveal) has no numeric effect in the delta. This sim retargets the afternoon half of hit weight using Health after the morning half.',
  'Revival in ch5+ is forbidden, so a ch5 death has no window to fail. Charging the penalty there is a reading, not a sentence in §9.',
  '"Active wallets" for A6 is not defined. Ghosts can only be verified (§9), so a 50% bar against all wallets is a different predicate than 50% of verified wallets.',
  'A5 compares total weighted heals with total weighted hits. Hits here are post-Armor, post-Crown, post-Twist, including verified ghost hits.',
  'The 2% pot cap does not say where the surplus goes. It is shared by the other verified wallets in that House.',
  'Readers drawing Fortune\'s +1 move still have weight 0.5, and the Reader cap still applies.',
  'Whether unverified stakes pay the death penalty is not stated. This sim charges them 40%. Oath 25% is verified-only.'
];

function loadDuelRates() {
  try {
    const parsed = JSON.parse(readFileSync(new URL('./results/duel.json', import.meta.url), 'utf8'));
    const rates = parsed.ratesForScoreSim;
    if (rates && rates.lookahead && rates.greedy) {
      return {
        lookReach: rates.lookahead.reach60,
        lookKill: rates.lookahead.kill,
        greedyReach: rates.greedy.reach60,
        greedyKill: rates.greedy.kill,
        source: 'Duel bonus rates are the measured shared-seed rates in results/duel.json (reach-60 and kill, non-stacking).'
      };
    }
  } catch {
    // The duel sim may not have been run in this checkout yet.
  }
  return {
    lookReach: 0.55,
    lookKill: 0.25,
    greedyReach: 0.35,
    greedyKill: 0.05,
    source: 'Duel bonus rates are the delta\'s prior (~55% reach 60%, ~25% kill) because results/duel.json was not readable. Rerun after the Duel sim.'
  };
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function next() {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  const u = Math.max(1e-12, 1 - rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function rand(seed, a, b, c, d) {
  let x = (seed + 1) >>> 0;
  const parts = [a, b, c, d];
  for (let i = 0; i < parts.length; i++) {
    x ^= (parts[i] >>> 0) + (i + 1) * 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x ^= x >>> 15;
  }
  x = Math.imul(x ^ (x >>> 13), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function gaussAt(seed, a, b, c, d) {
  const u = Math.max(1e-12, 1 - rand(seed, a, b, c, d));
  const v = rand(seed, a, b, c, d + 17);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function sampleCount(n, p, seed, a, b, c) {
  if (n <= 0 || p <= 0) return 0;
  const mean = n * p;
  const sd = Math.sqrt(n * p * (1 - p));
  return clamp(Math.round(mean + gaussAt(seed, a, b, c, 3) * sd), 0, n);
}

function buildWorld(seed) {
  const rng = mulberry32(seed + 101);
  const houses = {};
  for (const id of IDS) {
    const pop = Math.exp(0.5 * gaussian(rng));
    const verified = [];
    const nV = Math.max(8, Math.round(42 * pop));
    for (let i = 0; i < nV; i++) {
      const skill = rng() < 0.35 ? 'look' : 'greedy';
      const duels = rng() < 0.8;
      verified.push({
        stake: Math.exp(Math.log(100) + 0.65 * gaussian(rng)),
        oath: rng() < 0.35,
        twl: 1,
        duel: duels ? skill : null
      });
    }
    const unverified = [];
    const nU = Math.max(4, Math.round(28 * pop));
    for (let i = 0; i < nU; i++) {
      const members = rng() < 0.18 ? 3 + Math.floor(rng() * 6) : 1;
      let stake = 0;
      for (let m = 0; m < members; m++) stake += Math.exp(Math.log(35) + 0.85 * gaussian(rng));
      unverified.push({ stake, members, each: stake / members, twl: 1 });
    }
    houses[id] = {
      verified,
      unverified,
      readers: Math.max(4, Math.round(36 * pop * (0.6 + rng()))),
    };
  }
  return houses;
}

function peopleShare(chapter, twist) {
  let w = chapter <= 5 ? 0.3 : chapter === 6 ? 0.4 : 0.5;
  if (twist === 6) w += 0.1;
  if (twist === 7) w -= 0.1;
  return w;
}

function duelBonusCount(n, reach, kill, seed, tag) {
  if (n <= 0) return 0;
  const plus2 = sampleCount(n, kill, seed, tag, 1, 1);
  const reached = sampleCount(n, reach, seed, tag, 2, 2);
  const plus1 = clamp(reached - plus2, 0, n - plus2);
  return plus1 + 2 * plus2;
}

function layerNoise(mean, n, seed, tag) {
  if (n <= 0) return 0;
  const sd = Math.sqrt(Math.max(n, 1)) * 0.35;
  return Math.max(0, mean + gaussAt(seed, tag, 4, 4, 4) * sd / Math.sqrt(n) * Math.sqrt(n));
}

function snapshotHourSkipsDay3(seed, chapter) {
  const hour = 54 + rand(seed, chapter, 8, 0, 0) * 12;
  return hour < 59;
}

function armorDay(house, seed, chapter, day, twist) {
  let locked = 0;
  for (const wallet of house.verified) locked += wallet.stake;
  for (const wallet of house.unverified) locked += wallet.stake;
  const fresh = [];
  let rolloverIgnored = 0;
  const take = (wallet, chance, tag) => {
    if (rand(seed, chapter, day, tag, 11) < 0.15) rolloverIgnored += wallet.stake * 0.1;
    if (rand(seed, chapter, day, tag, 12) < chance) {
      fresh.push(wallet.stake * (0.08 + 0.22 * rand(seed, chapter, day, tag, 13)));
    }
  };
  house.verified.forEach((wallet, index) => take(wallet, 0.1, index + 1));
  house.unverified.forEach((wallet, index) => take(wallet, 0.05, 1000 + index));
  let freshTotal = fresh.reduce((sum, value) => sum + value, 0);
  const inner = twist === 3 ? 0.3 : 0.6;
  const raw = locked > 0 ? Math.min(inner, 6 * freshTotal / locked) : 0;
  let kept = 0;
  let whaleCut = false;
  for (const amount of fresh) {
    const share = freshTotal > 0 ? raw * amount / freshTotal : 0;
    const capped = Math.min(share, raw * 0.2);
    if (capped < share - 1e-12) whaleCut = true;
    kept += capped;
  }
  const partial = (2.5 - day) / 3;
  const apply = (wallet, chance, tag) => {
    if (rand(seed, chapter, day, tag, 12) < chance) {
      const amount = wallet.stake * (0.08 + 0.22 * rand(seed, chapter, day, tag, 13));
      const old = wallet.stake;
      wallet.stake = old + amount;
      wallet.twl = old + amount > 0 ? (old * wallet.twl + amount * partial) / (old + amount) : 1;
    }
  };
  house.verified.forEach((wallet, index) => apply(wallet, 0.1, index + 1));
  house.unverified.forEach((wallet, index) => apply(wallet, 0.05, 1000 + index));
  const ward = rand(seed, chapter, day, 77, 14) < 0.45 ? rand(seed, chapter, day, 78, 15) * 0.1 : 0;
  return {
    armor: Math.min(0.7, kept + Math.min(0.1, ward)),
    whaleCut,
    rolloverIgnored,
    freshTotal
  };
}

function houseTWL(house) {
  let total = 0;
  for (const wallet of house.verified) total += wallet.stake * wallet.twl;
  for (const wallet of house.unverified) total += wallet.stake * wallet.twl;
  return total;
}

function bases(houses, living) {
  const twl = {};
  const roots = [];
  for (const id of living) {
    twl[id] = houseTWL(houses[id]);
    roots.push(Math.sqrt(Math.max(0, twl[id])));
  }
  const mid = median(roots);
  const base = {};
  living.forEach((id, index) => {
    base[id] = mid > 0 ? 100 * roots[index] / mid : 0;
  });
  return { twl, base };
}

function verifiedStakeMedian(houses, living) {
  const stakes = [];
  for (const id of living) {
    for (const wallet of houses[id].verified) stakes.push(wallet.stake);
  }
  return median(stakes);
}

function unverifiedWeight(house, m) {
  let weight = 0;
  let sybil = 0;
  for (const wallet of house.unverified) {
    const tw = wallet.stake;
    weight += Math.min(1, m > 0 ? tw / m : 0);
    sybil += wallet.members * Math.min(1, m > 0 ? wallet.each / m : 0);
  }
  return { weight, sybil };
}

function chooseTarget(living, twl, scores, attacker, kind) {
  const rivals = living.filter((id) => id !== attacker);
  if (!rivals.length) return null;
  if (kind === 'weak') {
    return rivals.slice().sort((a, b) => twl[a] - twl[b] || INDEX[a] - INDEX[b])[0];
  }
  return rivals.slice().sort((a, b) => twl[b] - twl[a] || INDEX[a] - INDEX[b])[0];
}

function lowestOf(ids, scores, twl) {
  return ids.slice().sort((a, b) => scores[a] - scores[b] || twl[a] - twl[b] || INDEX[a] - INDEX[b])[0];
}

function pour(incoming, weight, fromId, living, scores, twl, crown, peekFrac) {
  if (weight <= 0) return;
  const rivals = fromId ? living.filter((id) => id !== fromId) : living.slice();
  if (!rivals.length) return;
  const lowest = lowestOf(rivals, scores, twl);
  const peeked = weight * peekFrac;
  const normal = weight - peeked;
  incoming[lowest] += peeked;
  const crownRival = crown && rivals.includes(crown) ? crown : null;
  let lowShare = 0.55;
  let crownShare = crownRival && crownRival !== lowest ? 0.25 : 0;
  if (!crownRival || crownRival === lowest) lowShare = 0.8;
  let restShare = 1 - lowShare - crownShare;
  const rest = rivals.filter((id) => id !== lowest && id !== crownRival);
  if (!rest.length) {
    if (crownRival && crownRival !== lowest) {
      lowShare += restShare / 2;
      crownShare += restShare / 2;
    } else lowShare += restShare;
    restShare = 0;
  }
  incoming[lowest] += normal * lowShare;
  if (crownShare && crownRival) incoming[crownRival] += normal * crownShare;
  if (rest.length && restShare) {
    const each = normal * restShare / rest.length;
    for (const id of rest) incoming[id] += each;
  }
}

function emptyMap(living) {
  const out = {};
  for (const id of living) out[id] = 0;
  return out;
}

function healthOf(living, base, net, castAbs, w) {
  let sumBase = 0;
  let denom = 0;
  for (const id of living) {
    sumBase += base[id];
    denom += castAbs[id];
  }
  const moveValue = denom > 0 ? (w / (1 - w)) * sumBase / denom : 0;
  const health = {};
  let absPeople = 0;
  let absNet = 0;
  for (const id of living) {
    health[id] = base[id] + moveValue * net[id];
    absPeople += Math.abs(moveValue * net[id]);
    absNet += Math.abs(net[id]);
  }
  const altValue = absNet > 0 ? (w / (1 - w)) * sumBase / absNet : 0;
  let altAbs = 0;
  for (const id of living) altAbs += Math.abs(altValue * net[id]);
  return {
    health,
    moveValue,
    sumBase,
    denom,
    realized: sumBase + absPeople > 0 ? absPeople / (sumBase + absPeople) : 0,
    altRealized: sumBase + altAbs > 0 ? altAbs / (sumBase + altAbs) : 0,
    w
  };
}

function capShares(raw, cap) {
  const rows = raw.map((share) => ({ share, frozen: false }));
  for (let guard = 0; guard < 24; guard++) {
    const over = rows.filter((row) => !row.frozen && row.share > cap + 1e-9);
    if (!over.length) break;
    let surplus = 0;
    for (const row of over) {
      surplus += row.share - cap;
      row.share = cap;
      row.frozen = true;
    }
    const under = rows.filter((row) => !row.frozen);
    const mass = under.reduce((sum, row) => sum + row.share, 0);
    if (!under.length || mass <= 0) break;
    for (const row of under) row.share += surplus * (row.share / mass);
  }
  return rows.map((row) => row.share);
}

function potShares(verified) {
  const n = verified.length;
  if (!n) return { maxBefore: 0, maxAfter: 0, capped: 0 };
  let stakeWeight = 0;
  const weights = verified.map((wallet) => {
    const weight = wallet.stake * (wallet.oath ? 1.5 : 1);
    stakeWeight += weight;
    return weight;
  });
  const shares = weights.map((weight) => 0.7 * (stakeWeight > 0 ? weight / stakeWeight : 0) + 0.3 / n);
  const maxBefore = Math.max(...shares);
  const cappedRows = capShares(shares, 0.02);
  return {
    maxBefore,
    maxAfter: Math.max(...cappedRows),
    capped: maxBefore > 0.02 ? 1 : 0
  };
}

function pickLiving(living, seed, salt) {
  const slot = Math.floor(rand(seed, salt, 9, 9, 9) * living.length);
  return living[Math.min(living.length - 1, slot)];
}

function runSeason(seed, pristine, opts) {
  const houses = structuredClone(pristine);
  const twistDeck = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    .map((id) => ({ id, roll: rand(seed, 400, id, 0, 0) }))
    .sort((a, b) => a.roll - b.roll)
    .map((row) => row.id);
  let living = IDS.slice();
  let owed = false;
  let revivalUsed = false;
  let crown = null;
  let carryBonus = {};
  for (const id of IDS) carryBonus[id] = { verified: 0, unverified: 0 };
  const ghosts = [];
  const pending = [];
  const people = [];
  const chapterDeaths = [];
  const loyalty = {};
  for (const id of IDS) loyalty[id] = { heal: 0, short: 0, raiserTrue: 0, raiserBase: 0, trueTotal: 0, falseTotal: 0 };
  const roster = {};
  let a1 = false;
  let a3 = false;
  let a5 = false;
  let a4 = null;
  let ch1Top = null;
  let firstOpen = null;
  let doodles = 0;
  let fragments = 0;
  let penaltyBard = 0;
  let penaltyWaived = 0;
  let readerCap = 0;
  let unverifiedCap = 0;
  let whaleCut = 0;
  let armorSum = 0;
  let armorN = 0;
  let sybilExtra = 0;
  let sybilN = 0;
  let tallies = 0;
  let ch6Living = null;
  const pileLog = [];
  let stakeLeader = null;

  const markOpen = (chapter) => {
    if (firstOpen == null) firstOpen = chapter;
  };

  for (let chapter = 1; chapter <= 7 && living.length > 1; chapter++) {
    const twist = opts.twistMode === 'force' ? opts.forceTwist : opts.twistMode === 'deck' ? twistDeck[chapter - 1] : 0;
    const skipDay3 = twist === 8 && snapshotHourSkipsDay3(seed, chapter);
    for (const move of pending) {
      if (!living.length) break;
      const dest = pickLiving(living, seed, 500 + move.salt);
      if (move.wallet) {
        move.wallet.twl = 1;
        move.wallet.oath = false;
        houses[dest][move.bucket].push(move.wallet);
      } else houses[dest].readers += move.readers;
    }
    pending.length = 0;
    for (const id of living) {
      for (const wallet of houses[id].verified) wallet.twl = 1;
      for (const wallet of houses[id].unverified) wallet.twl = 1;
    }
    const opened = bases(houses, living);
    if (chapter === 1) {
      stakeLeader = living.slice().sort((a, b) => opened.twl[b] - opened.twl[a] || INDEX[a] - INDEX[b])[0];
    }
    if (chapter === 6) ch6Living = living.length;
    const m = verifiedStakeMedian(houses, living);
    const take = Math.min(owed ? 2 : 1, living.length - 1);
    owed = false;
    const days = skipDay3 ? 2 : 3;
    const grossHeal = emptyMap(living);
    const grossHit = emptyMap(living);
    const effectiveHit = emptyMap(living);
    let shortlist = [];
    let dayScores = { ...opened.base };
    let dayTwl = opened.twl;
    const raiseFrac = clamp(0.1 + 0.16 * rand(seed, chapter, 30, 0, 0), 0, 0.6);
    let chapterHeal = emptyMap(living);
    let chapterShort = emptyMap(living);
    let chapterPile = null;
    if (opts.pileMode) {
      const attacker = living.slice().sort((a, b) => houses[b].verified.length - houses[a].verified.length || opened.twl[b] - opened.twl[a] || INDEX[a] - INDEX[b])[0];
      chapterPile = {
        attacker,
        target: chooseTarget(living, opened.twl, opened.base, attacker, opts.pileMode === 'weak' ? 'weak' : 'rich')
      };
    }

    for (let day = 0; day < 3; day++) {
      const played = day < days;
      if (!played) {
        carryBonus = {};
        for (const id of living) carryBonus[id] = { verified: 0, unverified: 0 };
        continue;
      }
      const armor = {};
      const verifiedLayer = {};
      const readerLayer = {};
      const unverifiedLayer = {};
      for (const id of living) {
        const house = houses[id];
        const built = armorDay(house, seed, chapter, day, twist);
        armor[id] = built.armor;
        if (built.whaleCut) whaleCut += 1;
        armorSum += built.armor;
        armorN += 1;
        const moves = twist === 11 ? 4 : 3;
        const shop = sampleCount(house.verified.length, 0.22, seed, chapter * 10 + day, INDEX[id], 41)
          + 2 * sampleCount(house.verified.length, 0.06, seed, chapter * 10 + day, INDEX[id], 42);
        const fortune = sampleCount(house.verified.length, 1 / 3, seed, chapter * 10 + day, INDEX[id], 43);
        const bonus = carryBonus[id].verified;
        verifiedLayer[id] = house.verified.length * moves + shop + fortune + bonus;
        const u = unverifiedWeight(house, m);
        const per = house.unverified.length ? u.weight / house.unverified.length : 0;
        const uFortune = house.unverified.length ? sampleCount(house.unverified.length, 1 / 3, seed, chapter * 10 + day, INDEX[id], 44) : 0;
        const uShop = sampleCount(house.unverified.length, 0.22, seed, chapter * 10 + day, INDEX[id], 45)
          + 2 * sampleCount(house.unverified.length, 0.06, seed, chapter * 10 + day, INDEX[id], 46);
        unverifiedLayer[id] = u.weight * moves + per * uShop + per * uFortune + carryBonus[id].unverified;
        sybilExtra += Math.max(0, u.sybil - u.weight);
        sybilN += 1;
        const rFortune = sampleCount(house.readers, 1 / 3, seed, chapter * 10 + day, INDEX[id], 47);
        readerLayer[id] = house.readers * 0.5 + rFortune * 0.5;
        const capU = 0.5 * verifiedLayer[id];
        const capR = 0.25 * verifiedLayer[id];
        if (unverifiedLayer[id] > capU) {
          unverifiedLayer[id] = capU;
          unverifiedCap += 1;
        }
        if (readerLayer[id] > capR) {
          readerLayer[id] = capR;
          readerCap += 1;
        }
        tallies += 1;
        const drawN = house.verified.length + house.unverified.length + house.readers;
        if (firstOpen == null || chapter <= firstOpen) doodles += drawN;
        else fragments += drawN;
      }
      carryBonus = {};
      for (const id of living) carryBonus[id] = { verified: 0, unverified: 0 };
      for (const id of living) {
        const house = houses[id];
        let lookN = 0;
        let greedyN = 0;
        for (const wallet of house.verified) {
          if (wallet.duel === 'look') lookN += 1;
          else if (wallet.duel === 'greedy') greedyN += 1;
        }
        carryBonus[id].verified = duelBonusCount(lookN, DUEL.lookReach, DUEL.lookKill, seed, chapter * 20 + day * 3 + INDEX[id])
          + duelBonusCount(greedyN, DUEL.greedyReach, DUEL.greedyKill, seed, chapter * 20 + day * 3 + INDEX[id] + 80);
        const per = house.unverified.length ? unverifiedWeight(house, m).weight / house.unverified.length : 0;
        const attempts = Math.round(house.unverified.length * 0.8);
        const blendedReach = 0.35 * DUEL.lookReach + 0.65 * DUEL.greedyReach;
        const blendedKill = 0.35 * DUEL.lookKill + 0.65 * DUEL.greedyKill;
        carryBonus[id].unverified = per * duelBonusCount(attempts, blendedReach, blendedKill, seed, chapter * 20 + day * 3 + INDEX[id] + 90);
      }

      const wave = (frac, scores) => {
        const incoming = emptyMap(living);
        const heals = emptyMap(living);
        const peek = twist === 9 ? 0 : 0.1;
        for (const id of living) {
          const house = houses[id];
          const vFrac = clamp(0.62 + (rand(seed, chapter, day, INDEX[id], 51) - 0.5) * 0.16, 0.05, 0.95);
          const uFrac = clamp(0.48 + (rand(seed, chapter, day, INDEX[id], 52) - 0.5) * 0.16, 0.05, 0.95);
          const rFrac = clamp(0.82 + (rand(seed, chapter, day, INDEX[id], 53) - 0.5) * 0.16, 0.05, 0.95);
          const vHit = verifiedLayer[id] * (1 - vFrac) * frac;
          const uHit = unverifiedLayer[id] * (1 - uFrac) * frac;
          const rHit = readerLayer[id] * (1 - rFrac) * frac;
          heals[id] += (verifiedLayer[id] * vFrac + unverifiedLayer[id] * uFrac + readerLayer[id] * rFrac) * frac;
          if (day === 2 && shortlist.includes(id)) chapterShort[id] += verifiedLayer[id] * vFrac * frac;
          chapterHeal[id] += verifiedLayer[id] * vFrac * frac;
          const pileTarget = chapterPile && chapterPile.attacker === id ? chapterPile.target : null;
          if (pileTarget && living.includes(pileTarget) && pileTarget !== id) {
            incoming[pileTarget] += vHit + uHit + rHit;
          } else {
            pour(incoming, vHit + uHit + rHit, id, living, scores, dayTwl, crown, peek);
          }
        }
        for (const ghost of ghosts) {
          const hits = ghost.ghostActive * 0.5 * (1 + 1 / 3) * frac;
          pour(incoming, hits, null, living, scores, dayTwl, crown, peek);
        }
        return { incoming, heals };
      };

      if (played) {
        if (twist === 10) {
          const morning = wave(0.5, dayScores);
          applyWave(morning, armor, twist, living, crown, grossHeal, grossHit, effectiveHit);
          const mid = tally(living, houses, grossHeal, grossHit, effectiveHit, peopleShare(chapter, twist));
          dayScores = mid.health;
          dayTwl = mid.twl;
          const afternoon = wave(0.5, dayScores);
          applyWave(afternoon, armor, twist, living, crown, grossHeal, grossHit, effectiveHit);
        } else {
          const full = wave(1, dayScores);
          applyWave(full, armor, twist, living, crown, grossHeal, grossHit, effectiveHit);
        }
        const tallied = tally(living, houses, grossHeal, grossHit, effectiveHit, peopleShare(chapter, twist));
        dayScores = tallied.health;
        dayTwl = tallied.twl;
        if (day === 1) {
          shortlist = living.slice().sort((a, b) => dayScores[a] - dayScores[b] || dayTwl[a] - dayTwl[b] || INDEX[a] - INDEX[b]).slice(0, Math.min(2, living.length));
        }
        crown = living.slice().sort((a, b) => dayScores[b] - dayScores[a] || dayTwl[b] - dayTwl[a] || INDEX[a] - INDEX[b])[0];
      }
    }

    const snapshot = tally(living, houses, grossHeal, grossHit, effectiveHit, peopleShare(chapter, twist));
    let healSum = 0;
    let hitSum = 0;
    for (const id of living) {
      healSum += grossHeal[id];
      hitSum += effectiveHit[id];
    }
    people.push({
      chapter,
      twist,
      w: snapshot.w,
      realized: snapshot.realized,
      altRealized: snapshot.altRealized,
      sumBase: snapshot.sumBase,
      healsBeatHits: healSum > hitSum
    });
    if (healSum > hitSum) {
      a5 = true;
      markOpen(chapter);
    }
    const scored = living.slice();
    for (let i = 0; i < scored.length; i++) {
      for (let j = i + 1; j < scored.length; j++) {
        const left = snapshot.health[scored[i]];
        const right = snapshot.health[scored[j]];
        const top = Math.max(left, right);
        if (top > 0 && Math.abs(left - right) / top <= 0.005) a3 = true;
      }
    }
    if (a3) markOpen(chapter);
    if (chapter === 1) {
      ch1Top = living.slice().sort((a, b) => snapshot.health[b] - snapshot.health[a] || snapshot.twl[b] - snapshot.twl[a] || INDEX[a] - INDEX[b])[0];
    }
    for (const id of scored) {
      roster[id] = houses[id].verified.map((wallet) => ({ stake: wallet.stake, oath: wallet.oath }));
    }
    const ordered = living.slice().sort((a, b) => snapshot.health[a] - snapshot.health[b] || snapshot.twl[a] - snapshot.twl[b] || INDEX[a] - INDEX[b]);
    const marked = ordered.slice(0, take);
    const stayed = [];
    for (const id of marked) {
      let revived = false;
      let fill = 0;
      if (chapter <= 4) {
        if (rand(seed, chapter, INDEX[id], 21, 0) < 0.58) fill = 0.25 + rand(seed, chapter, INDEX[id], 21, 1) * 1.05;
        if (chapter <= 3 && fill >= 0.5) {
          a1 = true;
          markOpen(chapter);
        }
        if (!revivalUsed && fill >= 1) {
          revived = true;
          revivalUsed = true;
          owed = true;
          if (!a4) a4 = { id, due: chapter + 1, survived: false, pending: true };
        }
      }
      const stakeLoss = penaltyOf(houses[id]);
      if (revived) {
        penaltyWaived += stakeLoss;
      } else if (chapter <= 5) {
        penaltyBard += stakeLoss;
        applyPenalty(houses[id]);
        stayed.push(id);
      } else {
        stayed.push(id);
      }
      if (!revived) {
        const house = houses[id];
        const active = house.verified.length + house.unverified.length + house.readers;
        const verifiedN = house.verified.length;
        const keepV = [];
        const keepU = [];
        house.verified.forEach((wallet, index) => {
          if (rand(seed, chapter, INDEX[id], 60, index) < 0.18) pending.push({ wallet, bucket: 'verified', salt: chapter * 100 + index });
          else keepV.push(wallet);
        });
        house.unverified.forEach((wallet, index) => {
          if (rand(seed, chapter, INDEX[id], 61, index) < 0.1) pending.push({ wallet, bucket: 'unverified', salt: chapter * 100 + 40 + index });
          else keepU.push(wallet);
        });
        const movingReaders = Math.round(house.readers * 0.25);
        if (movingReaders > 0) pending.push({ readers: movingReaders, salt: chapter * 100 + 80 + INDEX[id] });
        house.verified = keepV;
        house.unverified = keepU;
        house.readers -= movingReaders;
        const ghostActive = Math.round(keepV.length * 0.72);
        ghosts.push({ id, active, verifiedN, ghostActive, died: chapter });
        living = living.filter((other) => other !== id);
        if (crown === id) crown = null;
      }
    }
    if (a4 && a4.pending && chapter === a4.due) {
      a4.survived = living.includes(a4.id);
      a4.pending = false;
      if (a4.survived) markOpen(chapter);
    }
    for (const id of scored) {
      const shorted = shortlist.includes(id);
      const survived = !stayed.includes(id);
      const reraise = shorted ? 0.45 : 0;
      const r4 = survived && shorted ? raiseFrac * reraise : 0;
      const r2 = survived ? raiseFrac * (1 - (shorted ? reraise : 0)) : 0;
      const heals = chapterHeal[id] || 0;
      const shortHeals = chapterShort[id] || 0;
      const adjusted = heals - shortHeals + 1.5 * shortHeals;
      const raiserMult = survived ? (r2 + r4 > 0 ? (2 * r2 + 4 * r4) / (r2 + r4) : 1) : 1;
      const raiserPoints = adjusted * raiseFrac * raiserMult;
      const otherPoints = adjusted * (1 - raiseFrac);
      loyalty[id].heal += heals;
      loyalty[id].short += shortHeals;
      loyalty[id].falseTotal += heals;
      loyalty[id].raiserBase += heals * raiseFrac;
      loyalty[id].trueTotal += raiserPoints + otherPoints;
      loyalty[id].raiserTrue += raiserPoints;
    }
    chapterDeaths.push({ chapter, marked, stayed, living: living.slice() });
    if (chapterPile) {
      pileLog.push({
        chapter,
        attacker: chapterPile.attacker,
        target: chapterPile.target,
        stayed: !!(chapterPile.target && stayed.includes(chapterPile.target))
      });
    }
    crown = living.length
      ? living.slice().sort((a, b) => snapshot.health[b] - snapshot.health[a] || snapshot.twl[b] - snapshot.twl[a] || INDEX[a] - INDEX[b])[0]
      : null;
  }

  const champion = living.length === 1 ? living[0] : living.slice().sort((a, b) => INDEX[a] - INDEX[b])[0];
  const a2 = !!(ch1Top && champion && ch1Top !== champion);
  if (a2) markOpen(7);
  const firstGhost = ghosts[0] || null;
  const a6ratio = firstGhost && firstGhost.died < 7 && firstGhost.active > 0 ? firstGhost.ghostActive / firstGhost.active : null;
  const a6verified = firstGhost && firstGhost.died < 7 && firstGhost.verifiedN > 0 ? firstGhost.ghostActive / firstGhost.verifiedN : null;
  const fallen = new Set(ghosts.map((ghost) => ghost.id));
  const pot = finishPot(roster, loyalty, chapterDeaths, champion);
  return {
    champion,
    stakeLeader,
    ch1Top,
    ch6Living,
    fallen: IDS.filter((id) => fallen.has(id)),
    people,
    a1,
    a2,
    a3,
    a4: !!(a4 && a4.survived),
    a4Attempted: !!(a4 && !a4.pending),
    a5,
    a6ratio,
    a6verified,
    firstOpen,
    doodles,
    fragments,
    penaltyBard,
    penaltyWaived,
    readerCap,
    unverifiedCap,
    whaleCut,
    armorMean: armorN ? armorSum / armorN : 0,
    sybil: sybilN ? sybilExtra / sybilN : 0,
    tallies,
    pot,
    chapterDeaths,
    pileLog,
    ghosts: ghosts.length
  };
}

function penaltyOf(house) {
  let loss = 0;
  for (const wallet of house.verified) loss += wallet.stake * (wallet.oath ? 0.25 : 0.4);
  for (const wallet of house.unverified) loss += wallet.stake * 0.4;
  return loss;
}

function applyPenalty(house) {
  for (const wallet of house.verified) wallet.stake *= wallet.oath ? 0.75 : 0.6;
  for (const wallet of house.unverified) wallet.stake *= 0.6;
}

function tally(living, houses, grossHeal, grossHit, effectiveHit, w) {
  const { twl, base } = bases(houses, living);
  const net = {};
  const castAbs = {};
  for (const id of living) {
    net[id] = grossHeal[id] - effectiveHit[id];
    castAbs[id] = process.env.DENOM === 'absnet' ? Math.abs(net[id]) : grossHeal[id] + grossHit[id];
  }
  const scored = healthOf(living, base, net, castAbs, w);
  return { ...scored, twl, base };
}

function applyWave(wave, armor, twist, living, crown, grossHeal, grossHit, effectiveHit) {
  const healMul = twist === 2 ? 1.25 : 1;
  const hitMul = twist === 1 ? 1.25 : 1;
  for (const id of living) {
    const crownMul = id === crown && twist !== 5 ? (twist === 4 ? 2 : 1.5) : 1;
    grossHeal[id] += wave.heals[id] * healMul;
    grossHit[id] += wave.incoming[id] * hitMul;
    effectiveHit[id] += wave.incoming[id] * hitMul * (1 - armor[id]) * crownMul;
  }
}

function finishPot(roster, loyalty, chapterDeaths, champion) {
  const byChapter = Object.fromEntries(chapterDeaths.map((row) => [row.chapter, row]));
  const second = byChapter[7] && byChapter[7].stayed ? byChapter[7].stayed[0] : null;
  const third = byChapter[6] && byChapter[6].stayed ? byChapter[6].stayed[0] : null;
  const podium = [champion, second, third].filter((id, index, list) => id && roster[id] && list.indexOf(id) === index);
  const out = { false: [], true: [] };
  for (const id of podium) {
    const book = loyalty[id];
    const shares = potShares(roster[id]);
    const bonus = book.trueTotal > 0 ? (book.trueTotal - book.falseTotal) / book.trueTotal : 0;
    const shortShare = book.heal > 0 ? book.short / book.heal : 0;
    out.false.push({
      id,
      ...shares,
      bonus: 0,
      raiserSlice: book.falseTotal > 0 ? book.raiserBase / book.falseTotal : 0,
      shortShare
    });
    out.true.push({
      id,
      ...shares,
      bonus,
      raiserSlice: book.trueTotal > 0 ? book.raiserTrue / book.trueTotal : 0,
      shortShare
    });
  }
  return out;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(flags) {
  return flags.length ? flags.filter(Boolean).length / flags.length : 0;
}

function summarizePeople(rows) {
  const by = {};
  for (let chapter = 1; chapter <= 7; chapter++) by[chapter] = [];
  for (const season of rows) {
    for (const point of season.people) by[point.chapter].push(point);
  }
  const out = {};
  for (let chapter = 1; chapter <= 7; chapter++) {
    const list = by[chapter];
    out[chapter] = {
      n: list.length,
      w: mean(list.map((point) => point.w)),
      realized: mean(list.map((point) => point.realized)),
      alt: mean(list.map((point) => point.altRealized)),
      within5pp: rate(list.map((point) => Math.abs(point.realized - point.w) <= 0.05))
    };
  }
  return out;
}

function deathTable(rows) {
  const die = Object.fromEntries(IDS.map((id) => [id, 0]));
  const fall = Object.fromEntries(IDS.map((id) => [id, 0]));
  const ch1 = Object.fromEntries(IDS.map((id) => [id, 0]));
  let leaderWins = 0;
  let ch6ok = 0;
  let ch6n = 0;
  for (const season of rows) {
    for (const id of IDS) if (id !== season.champion) die[id] += 1;
    for (const id of season.fallen) {
      const ghostChapter = season.chapterDeaths.find((row) => row.stayed.includes(id));
      if (ghostChapter && ghostChapter.chapter <= 5) fall[id] += 1;
      if (ghostChapter && ghostChapter.chapter === 1) ch1[id] += 1;
    }
    if (season.stakeLeader && season.stakeLeader === season.champion) leaderWins += 1;
    if (season.ch6Living != null) {
      ch6n += 1;
      if (season.ch6Living === 3) ch6ok += 1;
    }
  }
  const n = rows.length || 1;
  return {
    die: Object.fromEntries(IDS.map((id) => [id, die[id] / n])),
    fall: Object.fromEntries(IDS.map((id) => [id, fall[id] / n])),
    ch1: Object.fromEntries(IDS.map((id) => [id, ch1[id] / n])),
    leaderWins: leaderWins / n,
    ch6StartsAt3: ch6n ? ch6ok / ch6n : 0
  };
}

function annotationTable(rows) {
  const ratios = rows.map((season) => season.a6ratio).filter((value) => value != null);
  const verifiedRatios = rows.map((season) => season.a6verified).filter((value) => value != null);
  const sweep = {};
  for (const bar of [0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
    sweep[bar] = rate(ratios.map((value) => value >= bar));
  }
  const sweepVerified = {};
  for (const bar of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
    sweepVerified[bar] = rate(verifiedRatios.map((value) => value >= bar));
  }
  let recommend = 0.5;
  let best = Infinity;
  for (const [bar, fired] of Object.entries(sweep)) {
    const distance = fired < 0.2 || fired > 0.85 ? 1 + Math.abs(fired - 0.5) : Math.abs(fired - 0.5);
    if (distance < best) {
      best = distance;
      recommend = Number(bar);
    }
  }
  return {
    A1: rate(rows.map((season) => season.a1)),
    A2: rate(rows.map((season) => season.a2)),
    A3: rate(rows.map((season) => season.a3)),
    A4: rate(rows.map((season) => season.a4)),
    A4givenRevival: rate(rows.filter((season) => season.a4Attempted).map((season) => season.a4)),
    A5: rate(rows.map((season) => season.a5)),
    A5byChapter: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((chapter) => {
      const points = rows.flatMap((season) => season.people.filter((point) => point.chapter === chapter));
      return [chapter, rate(points.map((point) => point.healsBeatHits))];
    })),
    A6: rate(rows.map((season) => season.a6ratio != null && season.a6ratio >= 0.5)),
    a6MeanRatio: mean(ratios),
    a6SweepAllWallets: sweep,
    a6SweepVerifiedOnly: sweepVerified,
    a6RecommendedThreshold: recommend,
    firstOpen: mean(rows.map((season) => season.firstOpen || 7)),
    doodleDraws: mean(rows.map((season) => season.doodles)),
    fragmentDraws: mean(rows.map((season) => season.fragments))
  };
}

function loyaltyTable(rows) {
  const side = (flag) => {
    const books = rows.flatMap((season) => season.pot[flag]);
    return {
      houses: books.length,
      bonusShareOfLoyalty: mean(books.map((book) => book.bonus)),
      raiserSlice: mean(books.map((book) => book.raiserSlice)),
      shortlistHealShare: mean(books.map((book) => book.shortShare)),
      maxWalletBeforeCap: mean(books.map((book) => book.maxBefore)),
      maxWalletAfterCap: mean(books.map((book) => book.maxAfter)),
      capBinds: rate(books.map((book) => book.capped))
    };
  };
  return {
    raise_loyalty_pays_false: side('false'),
    raise_loyalty_pays_true: side('true'),
    penaltyBard: mean(rows.map((season) => season.penaltyBard)),
    penaltyWaivedByRevival: mean(rows.map((season) => season.penaltyWaived))
  };
}

function twistDelta(baseline, forced) {
  const out = {};
  for (const [twist, rows] of Object.entries(forced)) {
    const base = deathTable(baseline);
    const next = deathTable(rows);
    const houses = {};
    let flagged = false;
    for (const id of IDS) {
      const dDie = next.die[id] - base.die[id];
      const dFall = next.fall[id] - base.fall[id];
      houses[id] = { die: next.die[id], deltaDie: dDie, fall: next.fall[id], deltaFall: dFall };
      if (Math.abs(dDie) > 0.05 || Math.abs(dFall) > 0.05) flagged = true;
    }
    out[twist] = {
      flagged,
      leaderWins: next.leaderWins,
      deltaLeader: next.leaderWins - base.leaderWins,
      houses
    };
  }
  return out;
}

function pileSummary(pileRows, baseRows) {
  let attempts = 0;
  let kills = 0;
  let baseKills = 0;
  const byChapter = {};
  for (let chapter = 1; chapter <= 7; chapter++) byChapter[chapter] = { attempts: 0, kills: 0, base: 0 };
  for (let i = 0; i < pileRows.length; i++) {
    const pile = pileRows[i];
    const base = baseRows[i];
    for (const row of pile.pileLog) {
      if (!row.target) continue;
      const baseRow = base.chapterDeaths.find((item) => item.chapter === row.chapter);
      if (!baseRow) continue;
      const present = new Set(baseRow.living.concat(baseRow.marked));
      if (!present.has(row.target)) continue;
      attempts += 1;
      byChapter[row.chapter].attempts += 1;
      const baseDied = baseRow.stayed.includes(row.target);
      if (row.stayed) {
        kills += 1;
        byChapter[row.chapter].kills += 1;
      }
      if (baseDied) {
        baseKills += 1;
        byChapter[row.chapter].base += 1;
      }
    }
  }
  return {
    attempts,
    killRate: attempts ? kills / attempts : 0,
    baselineKillRate: attempts ? baseKills / attempts : 0,
    byChapter: Object.fromEntries(Object.entries(byChapter).map(([chapter, row]) => [chapter, {
      attempts: row.attempts,
      killRate: row.attempts ? row.kills / row.attempts : 0,
      baseline: row.attempts ? row.base / row.attempts : 0
    }]))
  };
}

function main() {
  if (process.env.ONLY === 'clean') {
    const worlds = [];
    for (let i = 0; i < SEASONS; i++) worlds.push(buildWorld(i + 1));
    const clean = worlds.map((world, index) => runSeason(index + 1, world, { twistMode: 'none' }));
    const deaths = deathTable(clean);
    const people = summarizePeople(clean);
    console.log(JSON.stringify({
      denom: process.env.DENOM || 'gross',
      leaderWins: deaths.leaderWins,
      ch6: deaths.ch6StartsAt3,
      people: Object.fromEntries(Object.entries(people).map(([chapter, row]) => [chapter, { w: row.w, realized: row.realized }]))
    }));
    return;
  }
  const started = Date.now();
  const worlds = [];
  for (let i = 0; i < SEASONS; i++) worlds.push(buildWorld(i + 1));
  const runAll = (opts) => worlds.map((world, index) => runSeason(index + 1, world, opts));
  console.log('seasons', SEASONS, 'duel', JSON.stringify(DUEL));
  const clean = runAll({ twistMode: 'none' });
  console.log('clean', Math.round((Date.now() - started) / 1000) + 's');
  const deck = runAll({ twistMode: 'deck' });
  console.log('deck', Math.round((Date.now() - started) / 1000) + 's');
  const forced = {};
  for (let twist = 1; twist <= 12; twist++) {
    forced[twist] = runAll({ twistMode: 'force', forceTwist: twist });
    console.log('twist', twist, Math.round((Date.now() - started) / 1000) + 's');
  }
  const pileRich = worlds.map((world, index) => runSeason(index + 1, world, { twistMode: 'none', pileMode: 'rich' }));
  const pileWeak = worlds.map((world, index) => runSeason(index + 1, world, { twistMode: 'none', pileMode: 'weak' }));
  console.log('pile', Math.round((Date.now() - started) / 1000) + 's');

  const report = {
    seasons: SEASONS,
    seconds: Math.round((Date.now() - started) / 1000),
    raise_loyalty_pays_default: false,
    duelRates: DUEL,
    peopleClean: summarizePeople(clean),
    peopleWithTwists: summarizePeople(deck),
    deathsClean: deathTable(clean),
    deathsWithTwists: deathTable(deck),
    annotations: annotationTable(deck),
    annotationsClean: annotationTable(clean),
    loyalty: loyaltyTable(deck),
    twists: twistDelta(clean, forced),
    pileOnRichRival: pileSummary(pileRich, clean),
    pileOnWeakRival: pileSummary(pileWeak, clean),
    caps: {
      readerCapShare: mean(deck.map((season) => season.tallies ? season.readerCap / season.tallies : 0)),
      unverifiedCapShare: mean(deck.map((season) => season.tallies ? season.unverifiedCap / season.tallies : 0)),
      armorWhaleCutShare: mean(deck.map((season) => season.tallies ? season.whaleCut / season.tallies : 0)),
      meanArmor: mean(deck.map((season) => season.armorMean)),
      sybilWeightAvoided: mean(deck.map((season) => season.sybil))
    },
    assumptions: ASSUMPTIONS,
    ambiguities: AMBIGUITIES
  };
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./results/score-v4.json', import.meta.url), JSON.stringify(report));
  printReport(report);
}

function pct(value) {
  return (100 * value).toFixed(1) + '%';
}

function printReport(report) {
  console.log('\nPeople share, no Twist (realized |move·net| / (|base| + |move·net|))');
  for (let chapter = 1; chapter <= 7; chapter++) {
    const row = report.peopleClean[chapter];
    console.log('ch' + chapter, 'w', pct(row.w), 'realized', pct(row.realized), 'if denom=|net|', pct(row.alt), 'within 5pp', pct(row.within5pp));
  }
  console.log('\nDeaths, twist deck');
  for (const id of IDS) {
    const row = report.deathsWithTwists;
    console.log(id.padEnd(8), NAME[id].padEnd(18), 'dies', pct(row.die[id]), 'falls ch1-5', pct(row.fall[id]), 'ch1', pct(row.ch1[id]));
  }
  console.log('stake leader wins', pct(report.deathsWithTwists.leaderWins), 'ch6 starts at 3', pct(report.deathsWithTwists.ch6StartsAt3));
  console.log('\nAnnotations');
  const ann = report.annotations;
  for (const key of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) console.log(key, pct(ann[key]));
  console.log('A6 mean ratio', ann.a6MeanRatio.toFixed(3), 'recommend', ann.a6RecommendedThreshold);
  console.log('pile rich', JSON.stringify(report.pileOnRichRival.killRate), 'vs', report.pileOnRichRival.baselineKillRate);
  console.log('pile weak', JSON.stringify(report.pileOnWeakRival.killRate), 'vs', report.pileOnWeakRival.baselineKillRate);
  const flagged = Object.entries(report.twists).filter(([, row]) => row.flagged).map(([id]) => id);
  console.log('twists flagged', flagged.join(',') || 'none');
  console.log('loyalty false bonus', report.loyalty.raise_loyalty_pays_false.bonusShareOfLoyalty);
  console.log('loyalty true bonus', report.loyalty.raise_loyalty_pays_true.bonusShareOfLoyalty, 'raiser slice', report.loyalty.raise_loyalty_pays_true.raiserSlice);
  console.log('seconds', report.seconds);
}

main();
