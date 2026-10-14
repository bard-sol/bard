/**
 * Season 0 score sim, rule set v4 (§12 on top of §11). Does not modify game code.
 *
 * Run: node season0/sims/score-v4.mjs
 * One cell: ONLY=both CLAMP=0 CROWN=1.5 CONTROL=1 SEASONS=1000 node season0/sims/score-v4.mjs
 * Clamp sweep: SWEEP=1 node season0/sims/score-v4.mjs
 *
 * raise_loyalty_pays stays false and does not change Health.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

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

const CLAMP = Number(process.env.CLAMP ?? 30);
const B = Number(process.env.B || 30);
const CROWN_MUL = Number(process.env.CROWN || 1.5);
const CONTROL = process.env.CONTROL === '1';
const DUEL = loadDuelRates();

const ASSUMPTIONS = [
  'House faces are the eight cast ids, mapped as in brief-v4-fit: Pit/Grenna, Scriptorium/Silas, Gilt/Marrow, Tidewrack/Pip, Candle/Wick, Standard/Vey, Torn Margin/Thorn, Fold/Ash & Ember.',
  'Stake base is frozen at chapter open: 100 + clamp(25·ln(TWL / median TWL), −clamp, +clamp). Tallies do not recompute base. The grid runs clamp 0 and clamp ±30. The ln slope stays 25.',
  'The std rule is dropped. A full-participation day casts (B/30) × w × mean base, with B = ' + B + '. At B = 30 that is exactly w × mean base: 0.30, 0.40, or 0.50 of the chapter mean, and Twists 6 and 7 move w by 0.10. Health = base + net. Net resets at chapter open.',
  'Participation = capped raw weight / full-attendance weight at 3 moves. Shop, Fortune, and Twist 11\'s fourth move change that rate. Headcount does not. Cast = full day × participation × duel multiplier.',
  'The Duel adds at most +10% to the multiplier. Quality is bonus points earned yesterday divided by 2 per duelist, capped at 1. A kill still adds nothing beyond the damage bars.',
  'The control gives every living House that morning\'s unweighted mean participation, duel multiplier, and heal/hit mix. The 55/25/20 hit split is already the same function for every House size, in both versions.',
  'Health ties break by VRF. The lower TWL is not a tie-break. Stake rank still uses TWL.',
  'Underdog mercy: hits on the lowest-Health living House count 0.75×, and heals on it count 1.25× for score. Loyalty uses the unscaled heal weight. A tie for lowest is one VRF pick.',
  'The Crown multiplier is a knob, 1.5× or 2.0×. Twist 4 still forces 2×. Twist 5 still removes the Crown. The Crown is the top Health at the previous Tally.',
  'Anti-pile-on: incoming hit weight above the cap counts at half. The cap is 2× the living-House mean in chapters 1–5 and 1.5× in chapters 6–7. Twist hit multipliers apply first. Mercy, Armor, and the Crown apply to the softened weight. Twist 10 softens each half on its own.',
  'A5 fires when the top-Health House changes between two Tallies in the same chapter. The Crown carried in from the previous chapter does not count. A2 and A4 keep their current predicates.',
  'Revival is once per season, total. A later pour can still fill a bar for A1. From ch5 there is no revival, and the death penalty is charged immediately. Ch6 and ch7 eliminations are the podium and pay nothing.',
  'Oath ×1.5 multiplies the pot stake share only. It does not multiply TWL or Health.',
  'Unverified weight is min(1, stake / m), one weight per cluster. m is the median verified stake in living Houses, frozen at chapter open.',
  'Unverified clusters are collapsed at generation: one weight from the combined stake, not one weight per sybil.',
  'Population is unchanged. House size is lognormal (σ 0.50). A typical house has about 42 verified stakers (median stake 100, σ 0.65), 28 unverified (median stake 35, σ 0.85, 18% of them a 3–8 wallet cluster), and 36 free Readers.',
  '35% of verified stakers take the Oath. Unverified wallets in this population are not under an Oath, so their death penalty is 40%. A wallet that did hold an Oath would pay 25%.',
  '35% play the Duel at lookahead skill, 65% greedy, and 80% of stakers attempt it. The Duel multiplier is earned the day it is played and applied the next morning, including across the chapter boundary.',
  'Shop extras: 22% of stakers buy one, 6% buy two. Weight equals a normal move. Readers do not shop.',
  'Fortune is one draw a morning, equal thirds: +1 move, Spyglass, or Doodle/fragment. The +1 weighs the same as that wallet\'s move. Spyglass retargets 10% of hit weight onto the current lowest rival. Twist 9 sets that to 0. Doodles and fragments add 0.',
  'Heal split, unchanged: verified 62% of layer weight heals, unverified 48%, Readers 82%, ±8 points. The rest hits. Ghosts only hit.',
  'Hit split, unchanged: 55% on the lowest-Health rival, 25% on the Crown if that is someone else, 20% across the other rivals. Day 1 of chapter 1 has no Crown.',
  'Armor fresh locks, unchanged: 10% of verified and 5% of unverified lock new Bard equal to 8–30% of their stake. A separate 15% rollover is generated and ignored.',
  'Armor formula is min(0.60, coefficient × fresh / locked) + ward. The coefficient is 6, or 12 under Twist 3. One wallet supplies at most 20% of that pre-cap formula armor. Ward is at most 0.10. The total cap stays 0.70.',
  'Ward, unchanged: 45% of houses buy a Ward each day, uniform from 0 to 0.10.',
  'Raise, unchanged: about 18% of verified wallets Raise each chapter, at 15% of stake. If the house is shortlisted, 45% of those raisers go to 4× and the rest stay at 2×, and only if the house survives that chapter.',
  'raise_loyalty_pays stays false. Pot Loyalty is raw heal weight, without the underdog 1.25×. The true-flag comparison still stacks day-3 shortlist heals at 1.5× and a surviving raiser at 2× or 4×. Health does not use the flag.',
  'Inside a finishing House the pot is 70% stake-time (Oath ×1.5) and 30% Loyalty, verified humans only, then capped at 2% per wallet with the surplus shared by the uncapped wallets.',
  'Re-pledge, unchanged: 18% of a dead House\'s verified and 10% of its unverified move to a random living House at the next chapter open, after the penalty, with time restarted and the Oath cleared. 25% of its Readers follow. This is not Armor.',
  'Ghost retention, unchanged: 72% of verified wallets who did not re-pledge keep hitting, verified only. Their hit weight is the same full-day budget × (ghosts / verified at death) × 0.5 × (1 + 1/3). A6\'s denominator is that House\'s verified wallets at the snapshot, before re-pledge, and the bar is 60%.',
  'TWL uses chapter-open locks at weight 1. Fresh locks weigh the fraction of the chapter still ahead (day 1: 5/6, day 2: 1/2, day 3: 1/6). Move weight uses chapter-open stake, frozen with m.',
  'Even-count medians are the mean of the two central values.',
  'The Twist deck deals 7 distinct Twists per season.',
  'Twist 8 is +56h to +66h and sits after the day-3 Tally, taken as about +55h. Day-3 moves always count.',
  'Twist 10 reveals running per-House heal and hit totals at 12:00. The afternoon half aims at those totals. It does not reveal per wallet. Each half is softened alone.',
  'Twist 11 gives stakers a 4th move. Readers stay at one move.',
  'Twist 12 uses Duel bars of 40% and 55% instead of 50% and 65%.',
  'Duel boss HP is the accepted fit in results/duel.json. D1 and D2 use that HP. D3 stays on the engine\'s 0.9 scale, and D2 still starts with 10 guard.',
  'Top 3 is the set of Houses alive at the start of chapter 6 when that set has three Houses. The lowest-stake House is the chapter-1 minimum TWL.',
  DUEL.source
];

const AMBIGUITIES = [
  '§11.4 sets a full-participation day equal to w × mean base when B is 30. The grid keeps B at 30 and does not retune it.',
  'Anti-pile-on halves only the excess above the cap.',
  'Underdog mercy is applied after the pile-on soften, together with Armor and the Crown. The underdog is one House, chosen by VRF when Health is tied.',
  'Twist 10\'s afternoon half retargets from the revealed per-House totals. The reveal itself has no other effect.',
  'The Duel HP fit is unchanged. D3 stays on the engine\'s 0.9 scale. D2 still starts with 10 guard.',
  'm is the stake balance. Full-day locks use that balance as the 24h weight.',
  'The 2% pot surplus is shared by the uncapped verified wallets.',
  'A Reader\'s Fortune +1 weighs 0.5 and sits inside the Reader cap.',
  'Twist 11 gives stakers a fourth move, which raises participation against a 3-move denominator. Readers stay at one move.',
  'The first morning has no Crown.',
  'A2 and A4 keep the predicates already in the sim. §12.5 says they get re-picked after the mechanics settle.'
];

function loadDuelRates() {
  try {
    const parsed = JSON.parse(readFileSync(new URL('./results/duel.json', import.meta.url), 'utf8'));
    const byChapter = parsed.ratesForScoreSim && parsed.ratesForScoreSim.byChapter;
    if (byChapter && (byChapter[1] || byChapter['1'])) {
      return {
        byChapter,
        source: 'Duel bonus rates are the per-chapter shared-seed rates in results/duel.json. +1 is 50% damage and +2 is 65% (Twist 12: 40% and 55%). A kill adds nothing extra.'
      };
    }
  } catch {
    // The duel sim may not have been run in this checkout yet.
  }
  const flat = {
    look40: 0.75, look50: 0.55, look55: 0.4, look65: 0.2,
    greedy40: 0.55, greedy50: 0.35, greedy55: 0.22, greedy65: 0.08
  };
  const byChapter = {};
  for (let chapter = 1; chapter <= 7; chapter++) byChapter[chapter] = { ...flat };
  return {
    byChapter,
    source: 'Duel bonus rates are a placeholder because results/duel.json has no per-chapter v2 table. Rerun after the Duel sim.'
  };
}

function duelBars(chapter, twist) {
  const row = DUEL.byChapter[chapter] || DUEL.byChapter[String(chapter)];
  if (twist === 12) {
    return {
      lookReach: row.look40,
      lookPlus2: row.look55,
      greedyReach: row.greedy40,
      greedyPlus2: row.greedy55
    };
  }
  return {
    lookReach: row.look50,
    lookPlus2: row.look65,
    greedyReach: row.greedy50,
    greedyPlus2: row.greedy65
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

function fullDayBudget(meanBase, chapter, twist) {
  const w = peopleShare(chapter, twist);
  return (B / 30) * w * meanBase;
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

function vrfRoll(seed, salt, id) {
  return rand(seed, salt, INDEX[id] + 1, 901, 17);
}

function orderByHealth(ids, scores, seed, salt, highestFirst) {
  return ids.slice().sort((a, b) => {
    const diff = scores[a] - scores[b];
    if (diff !== 0) return highestFirst ? -diff : diff;
    return vrfRoll(seed, salt, a) - vrfRoll(seed, salt, b);
  });
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
  const coef = twist === 3 ? 12 : 6;
  const raw = locked > 0 ? Math.min(0.6, coef * freshTotal / locked) : 0;
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

function bases(houses, living, clampWidth) {
  const twl = {};
  const values = [];
  for (const id of living) {
    twl[id] = houseTWL(houses[id]);
    values.push(twl[id]);
  }
  const mid = median(values);
  const base = {};
  const span = clampWidth;
  for (const id of living) {
    const stake = twl[id];
    if (!(mid > 0) || !(stake > 0)) base[id] = 100 - span;
    else base[id] = clamp(100 + 25 * Math.log(stake / mid), 100 - span, 100 + span);
  }
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

function lowestOf(ids, scores, seed, salt) {
  return orderByHealth(ids, scores, seed, salt, false)[0];
}

function pour(incoming, weight, fromId, living, scores, seed, salt, crown, peekFrac) {
  if (weight <= 0) return;
  const rivals = fromId ? living.filter((id) => id !== fromId) : living.slice();
  if (!rivals.length) return;
  const lowest = lowestOf(rivals, scores, seed, salt);
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

function stdev(values) {
  const n = values.length;
  if (!n) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / n;
  let acc = 0;
  for (const value of values) acc += (value - avg) ** 2;
  return Math.sqrt(acc / n);
}

function healthOf(living, base, net) {
  const baseValues = living.map((id) => base[id]);
  const netValues = living.map((id) => net[id]);
  const stdBase = stdev(baseValues);
  const stdPeople = stdev(netValues);
  const health = {};
  for (const id of living) health[id] = base[id] + net[id];
  const sumBase = baseValues.reduce((sum, value) => sum + value, 0);
  const sumAbs = netValues.reduce((sum, value) => sum + Math.abs(value), 0);
  return {
    health,
    sumBase,
    stdBase,
    stdPeople,
    realized: stdPeople + stdBase > 0 ? stdPeople / (stdPeople + stdBase) : 0,
    mass: sumBase + sumAbs > 0 ? sumAbs / (sumBase + sumAbs) : 0
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
  const clampWidth = opts.clamp != null ? opts.clamp : CLAMP;
  const crownBase = opts.crownMul != null ? opts.crownMul : CROWN_MUL;
  const control = opts.control != null ? opts.control : CONTROL;
  const houses = structuredClone(pristine);
  const twistDeck = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    .map((id) => ({ id, roll: rand(seed, 400, id, 0, 0) }))
    .sort((a, b) => a.roll - b.roll)
    .map((row) => row.id);
  let living = IDS.slice();
  let owed = false;
  let revivalUsed = false;
  let crown = null;
  let carryQuality = {};
  for (const id of IDS) carryQuality[id] = 0;
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
  let a4 = false;
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
  let partSum = 0;
  let partN = 0;
  let baseFloor = 0;
  let baseSamples = 0;
  let deathN = 0;
  let deathLowest = 0;
  let deathSecond = 0;
  let deathOff = 0;
  let ch6Living = null;
  let ch6Set = null;
  const pileLog = [];
  let stakeLeader = null;
  let stakeFloor = null;

  const markOpen = (chapter) => {
    if (firstOpen == null) firstOpen = chapter;
  };

  for (let chapter = 1; chapter <= 7 && living.length > 1; chapter++) {
    const twist = opts.twistMode === 'force' ? opts.forceTwist : opts.twistMode === 'deck' ? twistDeck[chapter - 1] : 0;
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
    const opened = bases(houses, living, clampWidth);
    const chapterBase = opened.base;
    const meanBase = living.reduce((sum, id) => sum + chapterBase[id], 0) / living.length;
    const fullDay = fullDayBudget(meanBase, chapter, twist);
    if (chapter === 1) {
      const ranked = living.slice().sort((a, b) => opened.twl[b] - opened.twl[a] || INDEX[a] - INDEX[b]);
      stakeLeader = ranked[0];
      stakeFloor = ranked[ranked.length - 1];
    }
    if (chapter === 6) {
      ch6Living = living.length;
      ch6Set = living.slice();
    }
    const m = verifiedStakeMedian(houses, living);
    const take = Math.min(owed ? 2 : 1, living.length - 1);
    owed = false;
    const grossHeal = emptyMap(living);
    const grossHit = emptyMap(living);
    const effectiveHit = emptyMap(living);
    let shortlist = [];
    let dayScores = { ...chapterBase };
    const raiseFrac = clamp(0.1 + 0.16 * rand(seed, chapter, 30, 0, 0), 0, 0.6);
    let chapterHeal = emptyMap(living);
    let chapterShort = emptyMap(living);
    let crownChanged = false;
    let talliesThisChapter = 0;
    let crownAtTally = null;
    const noteCrown = (next) => {
      if (talliesThisChapter > 0 && next !== crownAtTally) crownChanged = true;
      crownAtTally = next;
      talliesThisChapter += 1;
      crown = next;
    };
    let chapterPile = null;
    if (opts.pileMode) {
      const attacker = living.slice().sort((a, b) => houses[b].verified.length - houses[a].verified.length || opened.twl[b] - opened.twl[a] || INDEX[a] - INDEX[b])[0];
      chapterPile = {
        attacker,
        target: chooseTarget(living, opened.twl, opened.base, attacker, opts.pileMode === 'weak' ? 'weak' : 'rich')
      };
    }

    for (let day = 0; day < 3; day++) {
      const armor = {};
      const castOf = {};
      const healShareOf = {};
      const verifiedHealShare = {};
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
        const vRaw = house.verified.length * moves + shop + fortune;
        const vPossible = house.verified.length * 3;
        const u = unverifiedWeight(house, m);
        const per = house.unverified.length ? u.weight / house.unverified.length : 0;
        const uFortune = house.unverified.length ? sampleCount(house.unverified.length, 1 / 3, seed, chapter * 10 + day, INDEX[id], 44) : 0;
        const uShop = sampleCount(house.unverified.length, 0.22, seed, chapter * 10 + day, INDEX[id], 45)
          + 2 * sampleCount(house.unverified.length, 0.06, seed, chapter * 10 + day, INDEX[id], 46);
        let uRaw = u.weight * moves + per * uShop + per * uFortune;
        const uPossible = u.weight * 3;
        sybilExtra += Math.max(0, u.sybil - u.weight);
        sybilN += 1;
        const rFortune = sampleCount(house.readers, 1 / 3, seed, chapter * 10 + day, INDEX[id], 47);
        let rRaw = house.readers * 0.5 + rFortune * 0.5;
        const rPossible = house.readers * 0.5;
        const capU = 0.5 * vRaw;
        const capR = 0.25 * vRaw;
        if (uRaw > capU) {
          uRaw = capU;
          unverifiedCap += 1;
        }
        if (rRaw > capR) {
          rRaw = capR;
          readerCap += 1;
        }
        tallies += 1;
        const drawN = house.verified.length + house.unverified.length + house.readers;
        if (firstOpen == null || chapter <= firstOpen) doodles += drawN;
        else fragments += drawN;
        const possible = vPossible + uPossible + rPossible;
        const raw = vRaw + uRaw + rRaw;
        const participation = possible > 0 ? raw / possible : 0;
        partSum += participation;
        partN += 1;
        const duelMult = 1 + 0.10 * (carryQuality[id] || 0);
        castOf[id] = fullDay * participation * duelMult;
        const vFrac = clamp(0.62 + (rand(seed, chapter, day, INDEX[id], 51) - 0.5) * 0.16, 0.05, 0.95);
        const uFrac = clamp(0.48 + (rand(seed, chapter, day, INDEX[id], 52) - 0.5) * 0.16, 0.05, 0.95);
        const rFrac = clamp(0.82 + (rand(seed, chapter, day, INDEX[id], 53) - 0.5) * 0.16, 0.05, 0.95);
        const healRaw = vRaw * vFrac + uRaw * uFrac + rRaw * rFrac;
        const hitRaw = vRaw * (1 - vFrac) + uRaw * (1 - uFrac) + rRaw * (1 - rFrac);
        const mix = healRaw + hitRaw;
        healShareOf[id] = mix > 0 ? healRaw / mix : 0;
        verifiedHealShare[id] = mix > 0 ? (vRaw * vFrac) / mix : 0;
      }
      if (control && living.length) {
        const meanCast = living.reduce((sum, id) => sum + castOf[id], 0) / living.length;
        const meanHeal = living.reduce((sum, id) => sum + healShareOf[id], 0) / living.length;
        const meanVerified = living.reduce((sum, id) => sum + verifiedHealShare[id], 0) / living.length;
        for (const id of living) {
          castOf[id] = meanCast;
          healShareOf[id] = meanHeal;
          verifiedHealShare[id] = meanVerified;
        }
      }
      carryQuality = {};
      for (const id of living) carryQuality[id] = 0;
      for (const id of living) {
        const house = houses[id];
        let lookN = 0;
        let greedyN = 0;
        for (const wallet of house.verified) {
          if (wallet.duel === 'look') lookN += 1;
          else if (wallet.duel === 'greedy') greedyN += 1;
        }
        const bars = duelBars(chapter, twist);
        const attempts = Math.round(house.unverified.length * 0.8);
        const blendedReach = 0.35 * bars.lookReach + 0.65 * bars.greedyReach;
        const blendedPlus2 = 0.35 * bars.lookPlus2 + 0.65 * bars.greedyPlus2;
        const tag = chapter * 20 + day * 3 + INDEX[id];
        const earned = duelBonusCount(lookN, bars.lookReach, bars.lookPlus2, seed, tag)
          + duelBonusCount(greedyN, bars.greedyReach, bars.greedyPlus2, seed, tag + 80)
          + duelBonusCount(attempts, blendedReach, blendedPlus2, seed, tag + 90);
        const duelists = lookN + greedyN + attempts;
        carryQuality[id] = duelists > 0 ? clamp(earned / (2 * duelists), 0, 1) : 0;
      }

      const wave = (frac, scores, salt) => {
        const incoming = emptyMap(living);
        const heals = emptyMap(living);
        const peek = twist === 9 ? 0 : 0.1;
        const underdog = lowestOf(living, scores, seed, salt + 5);
        for (const id of living) {
          const heal = castOf[id] * healShareOf[id] * frac;
          const hit = castOf[id] * (1 - healShareOf[id]) * frac;
          heals[id] += heal;
          if (day === 2 && shortlist.includes(id)) chapterShort[id] += castOf[id] * verifiedHealShare[id] * frac;
          chapterHeal[id] += castOf[id] * verifiedHealShare[id] * frac;
          const pileTarget = chapterPile && chapterPile.attacker === id ? chapterPile.target : null;
          if (pileTarget && living.includes(pileTarget) && pileTarget !== id) {
            incoming[pileTarget] += hit;
          } else {
            pour(incoming, hit, id, living, scores, seed, salt + INDEX[id] + 1, crown, peek);
          }
        }
        for (const ghost of ghosts) {
          const rate = ghost.verifiedN > 0 ? ghost.ghostActive / ghost.verifiedN : 0;
          const hits = fullDay * rate * 0.5 * (1 + 1 / 3) * frac;
          pour(incoming, hits, null, living, scores, seed, salt + 80 + INDEX[ghost.id], crown, peek);
        }
        return { incoming, heals, underdog };
      };

      const land = (piece) => {
        applyWave(piece, armor, twist, living, crown, grossHeal, grossHit, effectiveHit, chapter, piece.underdog, crownBase);
      };
      if (twist === 10) {
        land(wave(0.5, dayScores, chapter * 1000 + day * 10 + 1));
        const mid = tally(living, houses, grossHeal, effectiveHit, chapterBase);
        dayScores = mid.health;
        noteCrown(orderByHealth(living, dayScores, seed, chapter * 1000 + day * 10 + 2, true)[0]);
        land(wave(0.5, dayScores, chapter * 1000 + day * 10 + 3));
      } else {
        land(wave(1, dayScores, chapter * 1000 + day * 10 + 1));
      }
      const tallied = tally(living, houses, grossHeal, effectiveHit, chapterBase);
      dayScores = tallied.health;
      if (day === 1) {
        shortlist = orderByHealth(living, dayScores, seed, chapter * 1000 + day * 10 + 4, false).slice(0, Math.min(2, living.length));
      }
      noteCrown(orderByHealth(living, dayScores, seed, chapter * 1000 + day * 10 + 5, true)[0]);
    }

    const snapshot = tally(living, houses, grossHeal, effectiveHit, chapterBase);
    for (const id of living) {
      baseSamples += 1;
      const rail = Math.min(Math.abs(snapshot.base[id] - (100 - clampWidth)), Math.abs(snapshot.base[id] - (100 + clampWidth)));
      if (rail <= 1e-6) baseFloor += 1;
    }
    people.push({
      chapter,
      twist,
      w: peopleShare(chapter, twist),
      realized: snapshot.realized,
      mass: snapshot.mass,
      stdBase: snapshot.stdBase,
      stdPeople: snapshot.stdPeople,
      sumBase: snapshot.sumBase,
      crownChanged
    });
    if (crownChanged) {
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
      ch1Top = orderByHealth(living, snapshot.health, seed, 7100 + chapter, true)[0];
    }
    for (const id of scored) {
      roster[id] = houses[id].verified.map((wallet) => ({ stake: wallet.stake, oath: wallet.oath }));
    }
    const ordered = orderByHealth(living, snapshot.health, seed, 7200 + chapter, false);
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
        deathN += 1;
        if (shortlist[0] === id) deathLowest += 1;
        else if (shortlist[1] === id) deathSecond += 1;
        else {
          deathOff += 1;
          a4 = true;
          markOpen(chapter);
        }
      }
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
    crown = living.length ? orderByHealth(living, snapshot.health, seed, chapter * 1000 + 25, true)[0] : null;
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
    stakeFloor,
    ch1Top,
    ch6Living,
    ch6Set,
    fallen: IDS.filter((id) => fallen.has(id)),
    people,
    a1,
    a2,
    a3,
    a4,
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
    baseFloor: baseSamples ? baseFloor / baseSamples : 0,
    meanParticipation: partN ? partSum / partN : 0,
    deathN,
    deathLowest,
    deathSecond,
    deathOff,
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
  const cut = (wallet) => wallet.stake * (wallet.oath ? 0.25 : 0.4);
  for (const wallet of house.verified) loss += cut(wallet);
  for (const wallet of house.unverified) loss += cut(wallet);
  return loss;
}

function applyPenalty(house) {
  const factor = (wallet) => wallet.oath ? 0.75 : 0.6;
  for (const wallet of house.verified) wallet.stake *= factor(wallet);
  for (const wallet of house.unverified) wallet.stake *= factor(wallet);
}

function tally(living, houses, grossHeal, effectiveHit, baseFrozen) {
  const twl = {};
  for (const id of living) twl[id] = houseTWL(houses[id]);
  const net = {};
  for (const id of living) net[id] = grossHeal[id] - effectiveHit[id];
  const scored = healthOf(living, baseFrozen, net);
  return { ...scored, twl, base: baseFrozen };
}

function softenHits(incoming, living, chapter) {
  const meanHit = living.reduce((sum, id) => sum + (incoming[id] || 0), 0) / living.length;
  const cap = (chapter >= 6 ? 1.5 : 2) * meanHit;
  const out = {};
  for (const id of living) {
    const hit = incoming[id] || 0;
    out[id] = hit <= cap ? hit : cap + 0.5 * (hit - cap);
  }
  return out;
}

function applyWave(wave, armor, twist, living, crown, grossHeal, grossHit, effectiveHit, chapter, underdog, crownBase) {
  const healMul = twist === 2 ? 1.25 : 1;
  const hitMul = twist === 1 ? 1.25 : 1;
  const scaled = {};
  for (const id of living) scaled[id] = (wave.incoming[id] || 0) * hitMul;
  const soft = softenHits(scaled, living, chapter);
  for (const id of living) {
    const crownMul = id === crown && twist !== 5 ? (twist === 4 ? 2 : crownBase) : 1;
    const mercyHit = id === underdog ? 0.75 : 1;
    const mercyHeal = id === underdog ? 1.25 : 1;
    const heal = (wave.heals[id] || 0) * healMul * mercyHeal;
    grossHeal[id] += heal;
    grossHit[id] += soft[id];
    effectiveHit[id] += soft[id] * (1 - (armor[id] || 0)) * crownMul * mercyHit;
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
      mass: mean(list.map((point) => point.mass)),
      stdRatio: mean(list.map((point) => point.stdBase > 0 ? point.stdPeople / point.stdBase : 0))
    };
  }
  return out;
}

function deathTable(rows) {
  const die = Object.fromEntries(IDS.map((id) => [id, 0]));
  const fall = Object.fromEntries(IDS.map((id) => [id, 0]));
  const ch1 = Object.fromEntries(IDS.map((id) => [id, 0]));
  let leaderWins = 0;
  let leaderTop3 = 0;
  let lowestChampion = 0;
  let top3Fallback = 0;
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
    if (season.stakeFloor && season.stakeFloor === season.champion) lowestChampion += 1;
    if (season.ch6Set && season.ch6Set.length === 3) {
      if (season.ch6Set.includes(season.stakeLeader)) leaderTop3 += 1;
    } else {
      top3Fallback += 1;
      const podium = new Set();
      if (season.champion) podium.add(season.champion);
      const ch7 = season.chapterDeaths.find((row) => row.chapter === 7);
      const ch6 = season.chapterDeaths.find((row) => row.chapter === 6);
      if (ch7 && ch7.stayed[0]) podium.add(ch7.stayed[0]);
      if (ch6 && ch6.stayed[0]) podium.add(ch6.stayed[0]);
      if (podium.has(season.stakeLeader)) leaderTop3 += 1;
    }
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
    leaderTop3: leaderTop3 / n,
    lowestChampion: lowestChampion / n,
    top3Fallback: top3Fallback / n,
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
    A4deaths: rows.reduce((sum, season) => sum + season.deathN, 0),
    A4day2Lowest: rows.reduce((sum, season) => sum + season.deathLowest, 0),
    A4day2Second: rows.reduce((sum, season) => sum + season.deathSecond, 0),
    A4offShortlist: rows.reduce((sum, season) => sum + season.deathOff, 0),
    A5: rate(rows.map((season) => season.a5)),
    A5byChapter: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((chapter) => {
      const points = rows.flatMap((season) => season.people.filter((point) => point.chapter === chapter));
      return [chapter, rate(points.map((point) => point.crownChanged))];
    })),
    A6: rate(rows.map((season) => season.a6verified != null && season.a6verified >= 0.6)),
    a6MeanRatio: mean(ratios),
    a6VerifiedMean: mean(verifiedRatios),
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
      leaderTop3: next.leaderTop3,
      deltaTop3: next.leaderTop3 - base.leaderTop3,
      lowestChampion: next.lowestChampion,
      deltaLowest: next.lowestChampion - base.lowestChampion,
      armor: mean(rows.map((season) => season.armorMean)),
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

function goalLine(deaths) {
  return {
    leaderWins: deaths.leaderWins,
    leaderTop3: deaths.leaderTop3,
    lowestChampion: deaths.lowestChampion,
    ch6: deaths.ch6StartsAt3,
    top3Fallback: deaths.top3Fallback,
    pass: deaths.leaderWins <= 0.35 && deaths.leaderTop3 >= 0.6 && deaths.lowestChampion >= 0.03
  };
}

function cellOpts(cell, twistMode) {
  return {
    twistMode,
    clamp: cell.clamp,
    crownMul: cell.crown,
    control: cell.model === 'control'
  };
}

function summarizeCell(rows) {
  const deaths = deathTable(rows);
  const ann = annotationTable(rows);
  return {
    goals: goalLine(deaths),
    annotations: {
      A1: ann.A1,
      A2: ann.A2,
      A3: ann.A3,
      A4: ann.A4,
      A5: ann.A5,
      A6: ann.A6,
      A5byChapter: ann.A5byChapter,
      A4offShortlist: ann.A4offShortlist,
      A4deaths: ann.A4deaths
    }
  };
}

function runLocal(opts) {
  const rows = [];
  for (let seed = 1; seed <= SEASONS; seed++) rows.push(runSeason(seed, buildWorld(seed), opts));
  return rows;
}

function runTasks(tasks) {
  const n = Math.max(1, Math.min(4, availableParallelism() || 4));
  return new Promise((resolve, reject) => {
    const results = new Array(tasks.length);
    let cursor = 0;
    let finished = 0;
    let running = 0;
    const launch = () => {
      while (running < n && cursor < tasks.length) {
        const index = cursor++;
        running += 1;
        const worker = new Worker(new URL(import.meta.url), { workerData: tasks[index] });
        worker.on('message', (rows) => {
          results[index] = rows;
          running -= 1;
          finished += 1;
          worker.terminate();
          if (finished === tasks.length) resolve(results);
          else launch();
        });
        worker.on('error', reject);
      }
    };
    if (!tasks.length) resolve([]);
    else launch();
  });
}

function barMargin(goals) {
  return Math.min(0.35 - goals.leaderWins, goals.leaderTop3 - 0.6, goals.lowestChampion - 0.03);
}

async function runCells(cells) {
  const tasks = [];
  for (const cell of cells) {
    tasks.push(cellOpts(cell, 'none'));
    tasks.push(cellOpts(cell, 'deck'));
  }
  const chunks = await runTasks(tasks.map((opts) => ({ seedStart: 1, seedEnd: SEASONS, opts })));
  return cells.map((cell, index) => ({
    ...cell,
    clean: summarizeCell(chunks[index * 2]),
    deck: summarizeCell(chunks[index * 2 + 1])
  }));
}

async function runClampSweep() {
  const started = Date.now();
  const clamps = (process.env.CLAMPS || '0,5,8,10,12,15,20,25').split(',').map((value) => Number(value));
  const standard = await runCells(clamps.map((clamp) => ({ model: 'standard', clamp, crown: 1.5 })));
  for (const cell of standard) {
    console.log('standard', cell.clamp, 'clean', JSON.stringify(cell.clean.goals), 'deck', JSON.stringify(cell.deck.goals));
  }
  const passing = standard.filter((cell) => cell.clean.goals.pass && cell.deck.goals.pass);
  const ranked = (passing.length ? passing : standard).slice().sort((a, b) => {
    const left = Math.min(barMargin(a.clean.goals), barMargin(a.deck.goals));
    const right = Math.min(barMargin(b.clean.goals), barMargin(b.deck.goals));
    return right - left || a.clamp - b.clamp;
  });
  const best = ranked[0];
  const control = (await runCells([{ model: 'control', clamp: best.clamp, crown: 1.5 }]))[0];
  console.log('control', control.clamp, 'clean', JSON.stringify(control.clean.goals), 'deck', JSON.stringify(control.deck.goals));
  const report = {
    ruleSet: 'v4-clamp-sweep',
    budgetB: B,
    crown: 1.5,
    seasons: SEASONS,
    seconds: Math.round((Date.now() - started) / 1000),
    raise_loyalty_pays_default: false,
    clamps,
    passingClamps: passing.map((cell) => cell.clamp),
    bestClamp: best.clamp,
    bestNote: passing.length
      ? 'Best clamp is the passing value with the widest minimum margin across the three bars and both decks. A lower clamp wins a tie.'
      : 'No clamp passes all three bars on both decks. Best is the closest on the minimum margin.',
    standard,
    control,
    assumptions: ASSUMPTIONS,
    ambiguities: AMBIGUITIES
  };
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  const outName = process.env.SWEEP_OUT || './results/clamp-sweep.json';
  writeFileSync(new URL(outName, import.meta.url), JSON.stringify(report));
  console.log('passing', JSON.stringify(report.passingClamps), 'best', best.clamp, 'seconds', report.seconds);
}

async function main() {
  if (process.env.SWEEP === '1') {
    await runClampSweep();
    return;
  }
  const started = Date.now();
  if (process.env.ONLY === 'clean' || process.env.ONLY === 'deck' || process.env.ONLY === 'both') {
    const cell = { model: CONTROL ? 'control' : 'standard', clamp: CLAMP, crown: CROWN_MUL };
    const out = { seasons: SEASONS, cell };
    if (process.env.ONLY !== 'deck') out.clean = summarizeCell(runLocal(cellOpts(cell, 'none')));
    if (process.env.ONLY !== 'clean') out.deck = summarizeCell(runLocal(cellOpts(cell, 'deck')));
    console.log(JSON.stringify(out));
    return;
  }
  const cells = [];
  for (const model of ['standard', 'control']) {
    for (const clamp of [0, 30]) {
      for (const crown of [1.5, 2]) cells.push({ model, clamp, crown });
    }
  }
  const tasks = [];
  for (const cell of cells) {
    tasks.push({ cell, twistMode: 'none', opts: cellOpts(cell, 'none') });
    tasks.push({ cell, twistMode: 'deck', opts: cellOpts(cell, 'deck') });
  }
  const chunks = await runTasks(tasks.map((task) => ({ seedStart: 1, seedEnd: SEASONS, opts: task.opts })));
  const grid = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const clean = summarizeCell(chunks[i * 2]);
    const deck = summarizeCell(chunks[i * 2 + 1]);
    grid.push({ ...cell, clean, deck });
    console.log(cell.model, 'clamp', cell.clamp, 'crown', cell.crown, 'clean', JSON.stringify(clean.goals), 'deck', JSON.stringify(deck.goals));
  }
  const mainCell = grid.find((cell) => cell.model === 'standard' && cell.clamp === 30 && cell.crown === 1.5);
  const controlClamp0 = grid.filter((cell) => cell.model === 'control' && cell.clamp === 0);
  const report = {
    ruleSet: 'v4',
    budgetB: B,
    seasons: SEASONS,
    seconds: Math.round((Date.now() - started) / 1000),
    raise_loyalty_pays_default: false,
    mainConfiguration: 'standard player model, clamp ±30, Crown 1.5×',
    controlClamp0: controlClamp0.map((cell) => ({
      crown: cell.crown,
      cleanLeader: cell.clean.goals.leaderWins,
      deckLeader: cell.deck.goals.leaderWins
    })),
    grid,
    assumptions: ASSUMPTIONS,
    ambiguities: AMBIGUITIES,
    duelSource: DUEL.source
  };
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./results/score-v4.json', import.meta.url), JSON.stringify(report));
  printReport(report, mainCell);
}

function pct(value) {
  return (100 * value).toFixed(1) + '%';
}

function printReport(report, mainCell) {
  console.log('\nmodel        clamp  crown   clean leader/top3/lowest   deck leader/top3/lowest');
  for (const cell of report.grid) {
    const line = (goals) => [pct(goals.leaderWins), pct(goals.leaderTop3), pct(goals.lowestChampion)].join(' / ');
    console.log(
      cell.model.padEnd(12),
      String(cell.clamp).padStart(5),
      String(cell.crown).padStart(6),
      line(cell.clean.goals).padStart(28),
      line(cell.deck.goals).padStart(28)
    );
  }
  console.log('\nMain configuration', report.mainConfiguration);
  for (const side of ['clean', 'deck']) {
    const ann = mainCell[side].annotations;
    console.log(side);
    for (const key of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) {
      const outside = ann[key] < 0.2 || ann[key] > 0.85;
      console.log(' ', key, pct(ann[key]), outside ? 'OUTSIDE 20-85' : '');
    }
  }
  console.log('control clamp 0', JSON.stringify(report.controlClamp0));
  console.log('seconds', report.seconds);
}

if (!isMainThread) {
  const rows = [];
  for (let seed = workerData.seedStart; seed <= workerData.seedEnd; seed++) {
    rows.push(runSeason(seed, buildWorld(seed), workerData.opts));
  }
  parentPort.postMessage(rows);
} else {
  main();
}
