/**
 * Season 0 score sim, user settings §14. Does not modify game code.
 *
 * Run: node season0/sims/score-s14.mjs
 * Participation variance: S14_BETA=1 node season0/sims/score-s14.mjs
 * Option B variants: S14_B=1 node season0/sims/score-s14.mjs
 * Probabilistic edge: S14_PICK=1 node season0/sims/score-s14.mjs
 * A3 is locked at a 0.3% Health gap.
 *
 * Moves are the share of qualifying verified clusters that play, times the
 * money edge. Unverified wallets and Readers cast nothing. Every House starts
 * a chapter at Health 100. raise_loyalty_pays stays false.
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
const INDEX = Object.fromEntries(IDS.map((id, index) => [id, index]));
const DUEL = loadDuelRates();

function loadDuelRates() {
  const parsed = JSON.parse(readFileSync(new URL('./results/duel.json', import.meta.url), 'utf8'));
  return parsed.ratesForScoreSim.byChapter;
}

function duelBars(chapter, twist) {
  const row = DUEL[chapter] || DUEL[String(chapter)];
  if (twist === 12) {
    return { lookReach: row.look40, lookPlus2: row.look55, greedyReach: row.greedy40, greedyPlus2: row.greedy55 };
  }
  return { lookReach: row.look50, lookPlus2: row.look65, greedyReach: row.greedy50, greedyPlus2: row.greedy65 };
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

function wallet(stake, oath, duel, cluster, joinedChapter) {
  return {
    stake,
    origin: stake,
    oath,
    duel,
    cluster,
    joinedChapter,
    probation: 0,
    penalized: false
  };
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
      verified.push(wallet(
        Math.exp(Math.log(100) + 0.65 * gaussian(rng)),
        rng() < 0.35,
        duels ? skill : null,
        id + ':' + i,
        0
      ));
    }
    const unverified = [];
    const nU = Math.max(4, Math.round(28 * pop));
    for (let i = 0; i < nU; i++) {
      const members = rng() < 0.18 ? 3 + Math.floor(rng() * 6) : 1;
      let stake = 0;
      for (let m = 0; m < members; m++) stake += Math.exp(Math.log(35) + 0.85 * gaussian(rng));
      unverified.push({
        stake,
        origin: stake,
        members,
        oath: false,
        penalized: false,
        cluster: id + ':u:' + i
      });
    }
    houses[id] = {
      verified,
      unverified,
      readers: Math.max(4, Math.round(36 * pop * (0.6 + rng())))
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

function lockedOf(house) {
  let total = 0;
  for (const row of house.verified) total += row.stake;
  for (const row of house.unverified) total += row.stake;
  return total;
}

function moneyMultiplier(locked, mid, edge) {
  if (!(locked > 0) || !(mid > 0)) return 1;
  return 1 + edge * Math.sqrt(locked / (3 * mid));
}

function stakePickFactor(locked, mid, reduction) {
  if (!(reduction > 0) || !(mid > 0) || !(locked > 0)) return 1;
  const curve = Math.min(1, Math.sqrt(locked / (3 * mid)));
  return 1 - reduction * curve;
}

function pickByOdds(ranked, count, factorOf, seed, salt) {
  const kept = [];
  const skipped = [];
  for (let i = 0; i < ranked.length && kept.length < count; i++) {
    const id = ranked[i];
    if (rand(seed, salt, INDEX[id], i, 7) < factorOf(id)) kept.push(id);
    else skipped.push(id);
  }
  for (const id of skipped) {
    if (kept.length >= count) break;
    kept.push(id);
  }
  return kept;
}

function armorDay(house, seed, chapter, day, twist, coef) {
  let locked = lockedOf(house);
  const fresh = [];
  const take = (row, chance, tag) => {
    if (rand(seed, chapter, day, tag, 12) < chance) {
      fresh.push(row.stake * (0.08 + 0.22 * rand(seed, chapter, day, tag, 13)));
    }
  };
  house.verified.forEach((row, index) => take(row, 0.1, index + 1));
  house.unverified.forEach((row, index) => take(row, 0.05, 1000 + index));
  const freshTotal = fresh.reduce((sum, value) => sum + value, 0);
  const used = twist === 3 ? coef * 2 : coef;
  const raw = locked > 0 ? Math.min(0.6, used * freshTotal / locked) : 0;
  let kept = 0;
  for (const amount of fresh) {
    const share = freshTotal > 0 ? raw * amount / freshTotal : 0;
    kept += Math.min(share, raw * 0.2);
  }
  let added = 0;
  const apply = (row, chance, tag) => {
    if (rand(seed, chapter, day, tag, 12) < chance) {
      const amount = row.stake * (0.08 + 0.22 * rand(seed, chapter, day, tag, 13));
      row.stake += amount;
      added += amount;
    }
  };
  house.verified.forEach((row, index) => apply(row, 0.1, index + 1));
  house.unverified.forEach((row, index) => apply(row, 0.05, 1000 + index));
  const ward = rand(seed, chapter, day, 77, 14) < 0.45 ? rand(seed, chapter, day, 78, 15) * 0.1 : 0;
  return { armor: Math.min(0.7, kept + Math.min(0.1, ward)), added };
}

function rallyBottom(house, seed, chapter, day) {
  let added = 0;
  house.verified.forEach((row, index) => {
    if (rand(seed, chapter, day, 3000 + index, 12) < 0.2) {
      const amount = row.stake * (0.08 + 0.22 * rand(seed, chapter, day, 3000 + index, 13));
      row.stake += amount;
      added += amount;
    }
  });
  return added;
}

function verifiedStakeMedian(houses, living) {
  const stakes = [];
  for (const id of living) {
    for (const row of houses[id].verified) stakes.push(row.stake);
  }
  return median(stakes);
}

function clustersOf(house, m, chapter) {
  const groups = new Map();
  for (const row of house.verified) {
    if (row.joinedChapter > chapter) continue;
    if (!(row.stake >= m / 20)) continue;
    let group = groups.get(row.cluster);
    if (!group) {
      group = { wallets: [], probation: 0, joinedChapter: row.joinedChapter };
      groups.set(row.cluster, group);
    }
    group.wallets.push(row);
    group.probation = Math.max(group.probation, row.probation || 0);
    group.joinedChapter = Math.min(group.joinedChapter, row.joinedChapter);
  }
  return [...groups.values()];
}

function applySurge(house, m, chapter, surge) {
  const groups = clustersOf(house, m, chapter);
  const established = groups.filter((group) => group.joinedChapter < chapter);
  const newcomers = groups.filter((group) => group.joinedChapter === chapter);
  const limit = Math.max(10, 0.2 * established.length);
  if (!surge || newcomers.length <= limit) return;
  for (const group of newcomers) {
    for (const row of group.wallets) {
      if (!row.surgeMarked) {
        row.probation = 2;
        row.surgeMarked = true;
      }
    }
  }
}

function tickProbation(house) {
  for (const row of house.verified) {
    if (row.probation > 0) row.probation -= 1;
  }
}

function beta43(seed, a, b, c) {
  let shape4 = 0;
  let shape3 = 0;
  for (let i = 0; i < 4; i++) shape4 += -Math.log(Math.max(1e-12, rand(seed, a, b, c, 10 + i)));
  for (let i = 0; i < 3; i++) shape3 += -Math.log(Math.max(1e-12, rand(seed, a, b, c, 20 + i)));
  const total = shape4 + shape3;
  return total > 0 ? shape4 / total : 0.5;
}

function sizeSlack(size, mid) {
  if (!(mid > 0) || !(size > 0)) return 0;
  const ratio = size / mid;
  if (ratio <= 1) return 0;
  return -0.05 * clamp(Math.log(ratio) / Math.log(2), 0, 1);
}

function participationOf(groups, rateActiveOnly) {
  let den = 0;
  let num = 0;
  let activeDen = 0;
  for (const group of groups) {
    den += 1;
    const weight = group.probation > 0 ? 0.5 : 1;
    num += weight;
    activeDen += 1;
  }
  const rate = den > 0 ? num / den : 0;
  const active = activeDen > 0 ? num / activeDen : 0;
  return rateActiveOnly ? active : rate;
}

function emptyMap(living) {
  const out = {};
  for (const id of living) out[id] = 0;
  return out;
}

function lowestOf(ids, scores, seed, salt) {
  return orderByHealth(ids, scores, seed, salt, false)[0];
}

function pour(incoming, weight, fromId, living, scores, seed, salt, crown, peekFrac, focusId) {
  if (weight <= 0) return;
  const rivals = fromId ? living.filter((id) => id !== fromId) : living.slice();
  if (!rivals.length) return;
  const lowest = focusId && rivals.includes(focusId) ? focusId : lowestOf(rivals, scores, seed, salt);
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

function applyWave(wave, armor, twist, living, crown, grossHeal, grossHit, effectiveHit, chapter, underdog, twistCrown) {
  const healMul = twist === 2 ? 1.25 : 1;
  const hitMul = twist === 1 ? 1.25 : 1;
  const scaled = {};
  for (const id of living) scaled[id] = (wave.incoming[id] || 0) * hitMul;
  const soft = softenHits(scaled, living, chapter);
  const markedCrown = twist === 4 && twistCrown ? twistCrown : crown;
  for (const id of living) {
    const crownMul = id === markedCrown && twist !== 5 ? (twist === 4 ? 2 : 1.5) : 1;
    const mercyHit = id === underdog ? 0.75 : 1;
    const mercyHeal = id === underdog ? 1.25 : 1;
    grossHeal[id] += (wave.heals[id] || 0) * healMul * mercyHeal;
    grossHit[id] += soft[id];
    effectiveHit[id] += soft[id] * (1 - (armor[id] || 0)) * crownMul * mercyHit;
  }
}

function healthNow(living, grossHeal, effectiveHit, base) {
  const health = {};
  for (const id of living) health[id] = (base && base[id] != null ? base[id] : 100) + grossHeal[id] - effectiveHit[id];
  return health;
}

function cutWallet(row) {
  if (row.penalized) return 0;
  const rate = row.oath ? 0.15 : 0.25;
  const loss = row.stake * rate;
  const originLoss = row.origin * rate;
  row.stake -= loss;
  row.origin = Math.max(0, row.origin - originLoss);
  row.penalized = true;
  return loss;
}

function smallestHouse(houses) {
  return IDS.slice().sort((a, b) => houses[a].verified.length - houses[b].verified.length || INDEX[a] - INDEX[b])[0];
}

function addMembers(house, id, count, seed, joinedChapter, salt) {
  for (let i = 0; i < count; i++) {
    const stake = Math.exp(Math.log(100) + 0.65 * gaussAt(seed, salt, i, joinedChapter, 4));
    house.verified.push(wallet(
      stake,
      rand(seed, salt, i, joinedChapter, 5) < 0.35,
      rand(seed, salt, i, joinedChapter, 6) < 0.8 ? (rand(seed, salt, i, joinedChapter, 7) < 0.35 ? 'look' : 'greedy') : null,
      id + ':new:' + joinedChapter + ':' + i,
      joinedChapter
    ));
  }
}

function plantBots(houses, id, count, seed, catchRate) {
  const stakes = [];
  for (const houseId of IDS) {
    for (const row of houses[houseId].verified) stakes.push(row.stake);
  }
  const stake = Math.max(6, median(stakes) / 20 * 1.05);
  const house = houses[id];
  for (let i = 0; i < count; i++) {
    const caught = rand(seed, 8800, i, INDEX[id], 1) < catchRate;
    house.verified.push(wallet(stake, false, 'greedy', caught ? id + ':farm' : id + ':bot:' + i, 2));
  }
}

function runSeason(seed, pristine, opts) {
  const edge = opts.edge != null ? opts.edge : 0.25;
  const coef = opts.armorCoef != null ? opts.armorCoef : 6;
  const surge = opts.surge !== false;
  const houses = structuredClone(pristine);
  if (opts.zeroReaders) {
    for (const id of IDS) houses[id].readers = 0;
  }
  const attackTarget = opts.bots ? 'grenna' : null;
  const growTarget = opts.honestGrowth ? smallestHouse(houses) : null;
  if (attackTarget) plantBots(houses, attackTarget, opts.bots, seed, opts.catch || 0);
  const twistDeck = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    .map((id) => ({ id, roll: rand(seed, 400, id, 0, 0) }))
    .sort((a, b) => a.roll - b.roll)
    .map((row) => row.id);
  let living = IDS.slice();
  let owed = false;
  let revivalUsed = false;
  let revivedId = null;
  let crown = null;
  const carryQuality = {};
  for (const id of IDS) carryQuality[id] = 0;
  const carryBonus = {};
  const a3Gap = opts.a3Gap != null ? opts.a3Gap : 0.003;
  const ghosts = [];
  const pending = [];
  let a1 = false;
  let a3 = false;
  let ch2Bottom = null;
  let ch6Set = null;
  let ch6Stay = null;
  let ch7Stay = null;
  const crownChanged = {};
  let lock0 = 0;
  for (const id of IDS) lock0 += lockedOf(houses[id]);
  let penalty = 0;
  let freshAll = 0;
  let freshDead = 0;
  let activeGap = 0;
  const partByHouse = {};
  for (const id of IDS) partByHouse[id] = [];
  let targetHealth = 0;
  let targetHealthN = 0;
  let stakeLeader = null;
  let stakeFloor = null;

  for (let chapter = 1; chapter <= 7 && living.length > 1; chapter++) {
    const twist = opts.twistMode === 'deck' ? twistDeck[chapter - 1] : 0;
    for (const move of pending) {
      if (!living.length) break;
      const dest = living[Math.min(living.length - 1, Math.floor(rand(seed, 500 + move.salt, 9, 9, 9) * living.length))];
      move.wallet.oath = false;
      move.wallet.joinedChapter = chapter;
      houses[dest][move.bucket].push(move.wallet);
    }
    pending.length = 0;
    if (growTarget && chapter === 2 && living.includes(growTarget)) {
      addMembers(houses[growTarget], growTarget, opts.honestGrowth, seed, 2, 7700);
    }
    const openedLock = {};
    for (const id of living) openedLock[id] = lockedOf(houses[id]);
    const midLock = median(living.map((id) => openedLock[id]));
    const pickFactor = (id) => stakePickFactor(openedLock[id], midLock, opts.pickReduction || 0);
    const m = verifiedStakeMedian(houses, living);
    for (const id of living) applySurge(houses[id], m, chapter, surge);
    if (chapter === 1) {
      const ranked = living.slice().sort((a, b) => openedLock[b] - openedLock[a] || INDEX[a] - INDEX[b]);
      stakeLeader = ranked[0];
      stakeFloor = ranked[ranked.length - 1];
    }
    if (chapter === 6) ch6Set = living.slice();
    const take = Math.min(owed ? 2 : 1, living.length - 1);
    owed = false;
    const grossHeal = emptyMap(living);
    const grossHit = emptyMap(living);
    const effectiveHit = emptyMap(living);
    let shortlist = [];
    let dayScores = emptyMap(living);
    const healthBase = {};
    for (const id of living) {
      const bonus = opts.carryHealth ? Math.min(0.08, carryBonus[id] || 0) : 0;
      healthBase[id] = 100 * (1 + bonus);
      dayScores[id] = healthBase[id];
    }
    const chapterHealth = () => healthNow(living, grossHeal, effectiveHit, opts.carryHealth ? healthBase : null);
    let talliesThisChapter = 0;
    let crownAtTally = null;
    let changed = false;
    const fullDay = peopleShare(chapter, twist) * 100;
    let chapterFresh = emptyMap(living);
    const noteCrown = (next) => {
      if (talliesThisChapter > 0 && next !== crownAtTally) changed = true;
      crownAtTally = next;
      talliesThisChapter += 1;
      crown = next;
    };
    const chapterRate = {};
    if (opts.participation === 'beta') {
      const sizes = {};
      const sizeList = [];
      for (const id of living) {
        sizes[id] = clustersOf(houses[id], m, chapter).length;
        sizeList.push(sizes[id]);
      }
      const midSize = median(sizeList);
      for (const id of living) {
        const draw = beta43(seed, chapter * 17, INDEX[id], 410);
        const groups = clustersOf(houses[id], m, chapter);
        const nProb = groups.filter((group) => group.probation > 0).length;
        const weight = groups.length > 0 ? (groups.length - 0.5 * nProb) / groups.length : 0;
        chapterRate[id] = clamp(draw + sizeSlack(sizes[id], midSize), 0, 1) * weight;
      }
    }

    for (let day = 0; day < 3; day++) {
      const armor = {};
      const castOf = {};
      const healShareOf = {};
      const bottom = orderByHealth(living, dayScores, seed, chapter * 1000 + day, false).slice(0, Math.min(2, living.length));
      for (const id of living) {
        const house = houses[id];
        const built = armorDay(house, seed, chapter, day, twist, coef);
        let rally = 0;
        if (opts.rally !== false && bottom.includes(id)) rally = rallyBottom(house, seed, chapter, day);
        armor[id] = built.armor;
        chapterFresh[id] += built.added + rally;
        const groups = clustersOf(house, m, chapter);
        const rate = opts.participation === 'beta' ? chapterRate[id] : participationOf(groups, false);
        const active = opts.participation === 'beta' ? chapterRate[id] : participationOf(groups, true);
        activeGap = Math.max(activeGap, Math.abs(rate - active));
        partByHouse[id].push(opts.rateActiveOnly ? active : rate);
        const nFull = groups.filter((group) => group.probation <= 0).length;
        const shop = nFull > 0
          ? (sampleCount(nFull, 0.22, seed, chapter * 10 + day, INDEX[id], 41)
            + 2 * sampleCount(nFull, 0.06, seed, chapter * 10 + day, INDEX[id], 42)
            + sampleCount(nFull, 1 / 3, seed, chapter * 10 + day, INDEX[id], 43)) / (3 * nFull)
          : 0;
        const duelMult = 1 + 0.10 * (carryQuality[id] || 0);
        castOf[id] = fullDay * (opts.rateActiveOnly ? active : rate) * moneyMultiplier(openedLock[id], midLock, edge) * duelMult * (1 + shop);
        healShareOf[id] = clamp(0.62 + (rand(seed, chapter, day, INDEX[id], 51) - 0.5) * 0.16, 0.05, 0.95);
      }
      for (const id of living) carryQuality[id] = 0;
      for (const id of living) {
        const house = houses[id];
        let lookN = 0;
        let greedyN = 0;
        for (const row of house.verified) {
          if (row.joinedChapter > chapter) continue;
          if (row.duel === 'look') lookN += 1;
          else if (row.duel === 'greedy') greedyN += 1;
        }
        const bars = duelBars(chapter, twist);
        const tag = chapter * 20 + day * 3 + INDEX[id];
        const earned = duelBonusCount(lookN, bars.lookReach, bars.lookPlus2, seed, tag)
          + duelBonusCount(greedyN, bars.greedyReach, bars.greedyPlus2, seed, tag + 80);
        const duelists = lookN + greedyN;
        carryQuality[id] = duelists > 0 ? clamp(earned / (2 * duelists), 0, 1) : 0;
      }
      const wave = (frac, scores, salt) => {
        const incoming = emptyMap(living);
        const heals = emptyMap(living);
        const peek = twist === 9 ? 0 : 0.1;
        const underdog = lowestOf(living, scores, seed, salt + 5);
        let focusId = null;
        if (opts.pickReduction > 0 && twist === 10) {
          const low = orderByHealth(living, scores, seed, salt + 13, false);
          focusId = pickByOdds(low, 1, pickFactor, seed, salt + 14)[0];
        }
        for (const id of living) {
          const heal = castOf[id] * healShareOf[id] * frac;
          const hit = castOf[id] * (1 - healShareOf[id]) * frac;
          heals[id] += heal;
          pour(incoming, hit, id, living, scores, seed, salt + INDEX[id] + 1, crown, peek, focusId);
        }
        for (const ghost of ghosts) {
          const rate = ghost.verifiedN > 0 ? ghost.ghostActive / ghost.verifiedN : 0;
          pour(incoming, fullDay * rate * 0.5 * (1 + 1 / 3) * frac, null, living, scores, seed, salt + 80 + INDEX[ghost.id], crown, peek, focusId);
        }
        return { incoming, heals, underdog };
      };
      const land = (piece, scores, salt) => {
        let twistCrown = null;
        if (opts.pickReduction > 0 && twist === 4) {
          const high = orderByHealth(living, scores, seed, salt + 11, true);
          twistCrown = pickByOdds(high, 1, pickFactor, seed, salt + 12)[0];
        }
        applyWave(piece, armor, twist, living, crown, grossHeal, grossHit, effectiveHit, chapter, piece.underdog, twistCrown);
      };
      if (twist === 10) {
        const firstSalt = chapter * 1000 + day * 10 + 1;
        land(wave(0.5, dayScores, firstSalt), dayScores, firstSalt);
        dayScores = chapterHealth();
        noteCrown(orderByHealth(living, dayScores, seed, chapter * 1000 + day * 10 + 2, true)[0]);
        const secondSalt = chapter * 1000 + day * 10 + 3;
        land(wave(0.5, dayScores, secondSalt), dayScores, secondSalt);
      } else {
        const salt = chapter * 1000 + day * 10 + 1;
        land(wave(1, dayScores, salt), dayScores, salt);
      }
      dayScores = chapterHealth();
      if (day === 1) {
        const low = orderByHealth(living, dayScores, seed, chapter * 1000 + day * 10 + 4, false);
        const slots = Math.min(2, living.length);
        shortlist = opts.pickReduction > 0
          ? pickByOdds(low, slots, pickFactor, seed, 7400 + chapter)
          : low.slice(0, slots);
      }
      noteCrown(orderByHealth(living, dayScores, seed, chapter * 1000 + day * 10 + 5, true)[0]);
    }

    crownChanged[chapter] = changed;
    const snapshot = chapterHealth();
    if (chapter === 2) {
      const ranked = orderByHealth(living, snapshot, seed, 8250, false);
      ch2Bottom = ranked.slice(0, Math.floor(ranked.length / 2));
    }
    const scored = living.slice();
    for (let i = 0; i < scored.length; i++) {
      for (let j = i + 1; j < scored.length; j++) {
        const top = Math.max(snapshot[scored[i]], snapshot[scored[j]]);
        if (top > 0 && Math.abs(snapshot[scored[i]] - snapshot[scored[j]]) / top <= a3Gap) a3 = true;
      }
    }
    const ordered = orderByHealth(living, snapshot, seed, 7200 + chapter, false);
    const marked = opts.pickReduction > 0
      ? pickByOdds(ordered, take, pickFactor, seed, 7300 + chapter)
      : ordered.slice(0, take);
    const stayed = [];
    for (const id of marked) {
      let revived = false;
      let fill = 0;
      if (chapter <= 4) {
        if (rand(seed, chapter, INDEX[id], 21, 0) < 0.58) fill = 0.25 + rand(seed, chapter, INDEX[id], 21, 1) * 1.05;
        if (chapter <= 3 && fill >= 0.5) a1 = true;
        if (!revivalUsed && fill >= 1) {
          revived = true;
          revivalUsed = true;
          owed = true;
          revivedId = id;
        }
      }
      if (!revived) {
        if (chapter <= 5) {
          for (const row of houses[id].verified) penalty += cutWallet(row);
          for (const row of houses[id].unverified) penalty += cutWallet(row);
        }
        stayed.push(id);
        freshDead += chapterFresh[id] || 0;
        const verifiedN = houses[id].verified.length;
        const keepV = [];
        houses[id].verified.forEach((row, index) => {
          if (rand(seed, chapter, INDEX[id], 60, index) < 0.18) pending.push({ wallet: row, bucket: 'verified', salt: chapter * 100 + index });
          else keepV.push(row);
        });
        const keepU = [];
        houses[id].unverified.forEach((row, index) => {
          if (rand(seed, chapter, INDEX[id], 61, index) < 0.1) pending.push({ wallet: row, bucket: 'unverified', salt: chapter * 100 + 40 + index });
          else keepU.push(row);
        });
        houses[id].verified = keepV;
        houses[id].unverified = keepU;
        const ghostActive = Math.round(keepV.length * 0.72);
        ghosts.push({ id, verifiedN, ghostActive, died: chapter });
        living = living.filter((other) => other !== id);
        if (crown === id) crown = null;
      }
    }
    freshAll += Object.values(chapterFresh).reduce((sum, value) => sum + value, 0);
    if (growTarget && snapshot[growTarget] != null) {
      targetHealth += snapshot[growTarget];
      targetHealthN += 1;
    }
    if (chapter === 6 && stayed[0]) ch6Stay = stayed[0];
    if (chapter === 7 && stayed[0]) ch7Stay = stayed[0];
    if (opts.carryHealth) {
      for (const id of living) {
        const moneyEdge = Math.max(0, moneyMultiplier(openedLock[id], midLock, edge) - 1);
        carryBonus[id] = Math.min(0.08, (carryBonus[id] || 0) + 0.02 * moneyEdge);
      }
    }
    for (const id of living) tickProbation(houses[id]);
    crown = living.length ? orderByHealth(living, snapshot, seed, chapter * 1000 + 25, true)[0] : null;
  }

  const champion = living.length === 1 ? living[0] : living.slice().sort((a, b) => INDEX[a] - INDEX[b])[0];
  const finalists = ch6Set && ch6Set.length === 3 ? ch6Set : (champion ? [champion] : []);
  let leaderTop3 = false;
  if (ch6Set && ch6Set.length === 3) leaderTop3 = !!(stakeLeader && ch6Set.includes(stakeLeader));
  else {
    const podium = new Set([champion, ch6Stay, ch7Stay].filter(Boolean));
    leaderTop3 = !!(stakeLeader && podium.has(stakeLeader));
  }
  const a2 = !!(champion && ch2Bottom && ch2Bottom.includes(champion));
  const a4 = !!(revivedId && finalists.includes(revivedId));
  const a5 = opts.a5Ch7 ? !!crownChanged[7] : !!(crownChanged[6] || crownChanged[7]);
  const firstGhost = ghosts[0] || null;
  const a6 = !!(firstGhost && firstGhost.died < 7 && firstGhost.verifiedN > 0 && firstGhost.ghostActive / firstGhost.verifiedN >= 0.6);
  const ch1Part = {};
  for (const id of IDS) {
    const rows = partByHouse[id].slice(0, 3);
    ch1Part[id] = rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null;
  }
  let originLeft = 0;
  for (const id of IDS) {
    for (const row of houses[id].verified) originLeft += row.origin;
    for (const row of houses[id].unverified) originLeft += row.origin;
  }
  let unpaidFrac = 0;
  let podiumN = 0;
  for (const id of finalists) {
    const n = houses[id] ? houses[id].verified.length : 0;
    if (!n) continue;
    podiumN += 1;
    unpaidFrac += Math.max(0, 1 - Math.min(1, 0.02 * n));
  }
  return {
    champion,
    stakeLeader,
    stakeFloor,
    ch1Part,
    a1, a2, a3, a4, a5, a6,
    leaderTop3,
    lock0,
    penalty,
    originLeft,
    freshAll,
    freshDead,
    activeGap,
    unpaidFrac,
    podiumN,
    attackTarget,
    growTarget,
    targetHealth,
    targetHealthN,
    wonTarget: attackTarget ? champion === attackTarget : growTarget ? champion === growTarget : false
  };
}

function blank() {
  return {
    n: 0, leaderWins: 0, leaderTop3: 0, lowestWins: 0,
    engagedN: 0, engagedWins: 0, idleN: 0, idleWins: 0,
    a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, a6: 0,
    lock0: 0, penalty: 0, originLeft: 0, freshAll: 0, freshDead: 0,
    activeGap: 0, unpaidFrac: 0, podiumN: 0,
    targetWins: 0, targetHealth: 0, targetHealthN: 0, focusWins: 0,
    champions: []
  };
}

function fold(acc, row) {
  acc.n += 1;
  const ranked = IDS.filter((id) => row.ch1Part[id] != null)
    .sort((a, b) => row.ch1Part[a] - row.ch1Part[b] || INDEX[a] - INDEX[b]);
  const cut = Math.floor(ranked.length / 2);
  const bottomHalf = new Set(ranked.slice(0, cut));
  const topHalf = new Set(ranked.slice(ranked.length - cut));
  const engaged = !!(row.stakeFloor && topHalf.has(row.stakeFloor));
  const idle = !!(row.stakeLeader && bottomHalf.has(row.stakeLeader));
  if (row.stakeLeader && row.champion === row.stakeLeader) acc.leaderWins += 1;
  if (row.stakeFloor && row.champion === row.stakeFloor) acc.lowestWins += 1;
  if (engaged) {
    acc.engagedN += 1;
    if (row.champion === row.stakeFloor) acc.engagedWins += 1;
  }
  if (idle) {
    acc.idleN += 1;
    if (row.champion === row.stakeLeader) acc.idleWins += 1;
  }
  if (row.a1) acc.a1 += 1;
  if (row.a2) acc.a2 += 1;
  if (row.a3) acc.a3 += 1;
  if (row.a4) acc.a4 += 1;
  if (row.a5) acc.a5 += 1;
  if (row.a6) acc.a6 += 1;
  acc.lock0 += row.lock0;
  acc.penalty += row.penalty;
  acc.originLeft += row.originLeft;
  acc.freshAll += row.freshAll;
  acc.freshDead += row.freshDead;
  acc.activeGap = Math.max(acc.activeGap, row.activeGap);
  acc.unpaidFrac += row.unpaidFrac;
  acc.podiumN += row.podiumN;
  acc.targetHealth += row.targetHealth;
  acc.targetHealthN += row.targetHealthN;
  if (row.leaderTop3) acc.leaderTop3 += 1;
  if (row.wonTarget) acc.targetWins += 1;
  if (row.champion === 'grenna') acc.focusWins += 1;
  return acc;
}

function top3Hit(row) {
  return row.ch6Set && row.ch6Set.length === 3
    ? row.ch6Set.includes(row.stakeLeader)
    : false;
}

function runLocal(opts) {
  const acc = blank();
  for (let seed = opts.seedStart; seed <= opts.seedEnd; seed++) {
    const row = runSeason(seed, buildWorld(seed), opts);
    fold(acc, row);
    if (opts.returnChampions) acc.champions.push(row.champion);
  }
  return acc;
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
        worker.on('message', (payload) => {
          results[index] = payload;
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

function rate(count, n) {
  return n ? count / n : null;
}

function view(acc) {
  const pot = (2 / 3) * acc.penalty;
  const burn = acc.penalty / 3;
  const lock = acc.lock0 || 1;
  const unpaid = pot * (acc.podiumN ? acc.unpaidFrac / acc.podiumN : 0);
  const loyaltySlice = 0.3 * pot;
  const rollover = Math.min(unpaid, 0.5 * loyaltySlice);
  const goals = {
    leaderWins: rate(acc.leaderWins, acc.n),
    leaderTop3: rate(acc.leaderTop3, acc.n),
    lowestChampion: rate(acc.lowestWins, acc.n)
  };
  goals.pass = goals.leaderWins <= 0.35 && goals.leaderTop3 >= 0.6 && goals.lowestChampion >= 0.03;
  return {
    n: acc.n,
    goals,
    conditionals: {
      engagedN: acc.engagedN,
      engagedChampion: rate(acc.engagedWins, acc.engagedN),
      idleN: acc.idleN,
      idleLeaderChampion: rate(acc.idleWins, acc.idleN)
    },
    annotations: {
      A1: rate(acc.a1, acc.n),
      A2: rate(acc.a2, acc.n),
      A3: rate(acc.a3, acc.n),
      A4: rate(acc.a4, acc.n),
      A5: rate(acc.a5, acc.n),
      A6: rate(acc.a6, acc.n)
    },
    economy: {
      penaltyOverLock: acc.penalty / lock,
      burnOverLock: burn / lock,
      flatReturn: -burn / lock,
      priceDown: (0.5 - 1) + (acc.penalty / lock) * (2 / 3 - 0.5),
      priceFlat: -burn / lock,
      priceUp: (1.5 - 1) + (acc.penalty / lock) * (2 / 3 - 1.5),
      reserveCoversBurnReturn: 0,
      freshDeadOverFresh: acc.freshAll > 0 ? acc.freshDead / acc.freshAll : 0,
      freshDeadOverLock: acc.freshDead / lock,
      unpaidOverLock: unpaid / lock,
      rolloverOverLock: rollover / lock,
      seedOverLock: (unpaid - rollover) / lock,
      activeGap: acc.activeGap
    },
    grennaWin: rate(acc.focusWins, acc.n),
    targetWin: rate(acc.targetWins, acc.n),
    targetHealth: acc.targetHealthN ? acc.targetHealth / acc.targetHealthN : null
  };
}

function task(label, opts) {
  return { label, opts: { seedStart: 1, seedEnd: SEASONS, ...opts } };
}

async function runEdgeGrid(edges, beta) {
  const tasks = [];
  for (const edge of edges) {
    for (const twistMode of ['none', 'deck']) {
      const opts = { edge, twistMode, rally: true, surge: true };
      if (beta) {
        opts.participation = 'beta';
        opts.a5Ch7 = true;
      }
      tasks.push(task('edge:' + edge + ':' + twistMode, opts));
    }
  }
  const ran = await runTasks(tasks.map((item) => item.opts));
  const byLabel = {};
  tasks.forEach((item, index) => {
    byLabel[item.label] = view(ran[index]);
  });
  return byLabel;
}

async function runBeta() {
  const started = Date.now();
  const byLabel = await runEdgeGrid([0.2, 0.25, 0.3], true);
  const cleanTop = byLabel['edge:0.25:none'].goals.leaderTop3;
  const deckTop = byLabel['edge:0.25:deck'].goals.leaderTop3;
  const ran35 = cleanTop < 0.6 || deckTop < 0.6;
  if (ran35) Object.assign(byLabel, await runEdgeGrid([0.35], true));
  const report = {
    ruleSet: 's14-beta',
    seasons: SEASONS,
    seconds: Math.round((Date.now() - started) / 1000),
    raise_loyalty_pays_default: false,
    rate_active_only_default: false,
    participation: 'Each chapter a House draws Beta(4, 3), mean 4/7. A House larger than the median qualifying-cluster count loses slack of 5 points times log2(size/median), capped at 5 points. Smaller Houses are unchanged. Probation clusters still contribute half.',
    a5: 'The Crown changes hands inside chapter 7 only. Band 15–35%. Other annotations stay on 20–85%.',
    conditionals: 'Top half and bottom half are the floor(n/2) highest and lowest chapter-1 participation rates. Ties break by House index.',
    ran35BecauseTop3Under60: ran35,
    cells: byLabel
  };
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./results/score-s14-beta.json', import.meta.url), JSON.stringify(report));
  for (const edge of ran35 ? [0.2, 0.25, 0.3, 0.35] : [0.2, 0.25, 0.3]) {
    for (const twistMode of ['none', 'deck']) {
      const cell = byLabel['edge:' + edge + ':' + twistMode];
      const g = cell.goals;
      const k = cell.conditionals;
      const a = cell.annotations;
      const line = [g.leaderWins, g.leaderTop3, g.lowestChampion].map((value) => (100 * value).toFixed(1)).join('/');
      console.log('edge', edge, twistMode, line, g.pass ? 'PASS' : '');
      console.log('  engaged', k.engagedN, k.engagedChampion, 'idle', k.idleN, k.idleLeaderChampion);
      console.log('  A', Object.entries(a).map(([key, value]) => key + '=' + (100 * value).toFixed(1)).join(' '));
    }
  }
  console.log('seconds', report.seconds);
}

function bCell(edge, twistMode, extra) {
  return {
    participation: 'beta',
    a5Ch7: true,
    a3Gap: 0.003,
    rally: true,
    surge: true,
    edge,
    twistMode,
    ...extra
  };
}

async function runOptionB() {
  const started = Date.now();
  const tasks = [];
  const add = (label, opts) => tasks.push(task(label, opts));
  for (const twistMode of ['none', 'deck']) {
    add('base:0.25:' + twistMode, bCell(0.25, twistMode));
    add('b1:0.25:' + twistMode, bCell(0.25, twistMode, { carryHealth: true }));
  }
  for (const edge of [0.45, 0.6, 0.8]) {
    for (const twistMode of ['none', 'deck']) add('b2:' + edge + ':' + twistMode, bCell(edge, twistMode));
  }
  const farmOf = [
    { prefix: 'b1:0.25', edge: 0.25, carryHealth: true },
    { prefix: 'b2:0.45', edge: 0.45 },
    { prefix: 'b2:0.6', edge: 0.6 },
    { prefix: 'b2:0.8', edge: 0.8 }
  ];
  for (const config of farmOf) {
    for (const bots of [25, 50]) {
      for (const catchRate of [0, 0.5, 0.8]) {
        for (const twistMode of ['none', 'deck']) {
          add(config.prefix + ':farm:' + bots + ':' + catchRate + ':' + twistMode, bCell(config.edge, twistMode, {
            carryHealth: !!config.carryHealth,
            bots,
            catch: catchRate
          }));
        }
      }
    }
  }
  console.log('tasks', tasks.length, 'seasons', SEASONS);
  const ran = await runTasks(tasks.map((item) => item.opts));
  const byLabel = {};
  tasks.forEach((item, index) => {
    byLabel[item.label] = view(ran[index]);
  });
  const pack = (label) => {
    const cell = byLabel[label];
    const farms = {};
    const prefix = label.split(':').slice(0, 2).join(':');
    if (prefix !== 'base:0.25') {
      for (const bots of [25, 50]) {
        farms[bots] = {};
        for (const catchRate of [0, 0.5, 0.8]) {
          const farm = byLabel[prefix + ':farm:' + bots + ':' + catchRate + ':' + label.split(':').pop()];
          farms[bots][catchRate] = farm ? farm.targetWin : null;
        }
      }
    }
    return {
      goals: cell.goals,
      conditionals: cell.conditionals,
      annotations: cell.annotations,
      farms
    };
  };
  const labels = ['base:0.25:none', 'base:0.25:deck', 'b1:0.25:none', 'b1:0.25:deck', 'b2:0.45:none', 'b2:0.45:deck', 'b2:0.6:none', 'b2:0.6:deck', 'b2:0.8:none', 'b2:0.8:deck'];
  const cells = {};
  for (const label of labels) cells[label] = pack(label);
  const report = {
    ruleSet: 's14-b',
    seasons: SEASONS,
    seconds: Math.round((Date.now() - started) / 1000),
    raise_loyalty_pays_default: false,
    participation: 'Beta(4, 3) each chapter, plus the size slack from the participation-variance run. Defaults are unchanged: equal chapter-start Health and a +25% money edge.',
    a3: 'Two living Houses within 0.3% of the higher Health at a chapter snapshot. The published §14 run stays at 0.5%.',
    a5: 'The Crown changes hands inside chapter 7 only. Band 15–35%. Other annotations stay on 20–85%.',
    b1: 'At the +25% edge, a House that survives a chapter adds 2% times its money edge (the multiplier excess) to next chapter\'s Health, capped at +8% of the 100-point base. A House at 3× median lock gains 0.5 points per chapter.',
    b2: 'Money edge +45%, +60% and +80% at 3× median, sqrt curve, no carry-over.',
    cells
  };
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./results/score-s14-b.json', import.meta.url), JSON.stringify(report));
  for (const label of labels) {
    const cell = cells[label];
    const g = cell.goals;
    const k = cell.conditionals;
    const line = [g.leaderWins, g.leaderTop3, g.lowestChampion].map((value) => (100 * value).toFixed(1)).join('/');
    console.log(label, line, g.pass ? 'PASS' : '');
    console.log('  engaged', k.engagedN, (100 * k.engagedChampion).toFixed(1), 'idle', k.idleN, (100 * k.idleLeaderChampion).toFixed(1));
    console.log('  A', Object.entries(cell.annotations).map(([key, value]) => key + '=' + (100 * value).toFixed(1)).join(' '));
    if (cell.farms[25]) {
      for (const bots of [25, 50]) {
        const row = [0, 0.5, 0.8].map((catchRate) => catchRate + ':' + (100 * cell.farms[bots][catchRate]).toFixed(1)).join(' ');
        console.log('  farm', bots, row);
      }
    }
  }
  console.log('seconds', report.seconds);
}

async function runPick() {
  const started = Date.now();
  const tasks = [];
  const add = (label, opts) => tasks.push(task(label, opts));
  const base = (reduction, twistMode, extra) => ({
    participation: 'beta',
    a5Ch7: true,
    rally: true,
    surge: true,
    edge: 0.25,
    twistMode,
    pickReduction: reduction,
    ...extra
  });
  for (const reduction of [0.15, 0.25, 0.35]) {
    for (const twistMode of ['none', 'deck']) {
      add('pick:' + reduction + ':' + twistMode, base(reduction, twistMode));
      for (const bots of [25, 50]) {
        for (const catchRate of [0, 0.5, 0.8]) {
          add('pick:' + reduction + ':farm:' + bots + ':' + catchRate + ':' + twistMode, base(reduction, twistMode, { bots, catch: catchRate }));
        }
      }
    }
  }
  console.log('tasks', tasks.length, 'seasons', SEASONS);
  const ran = await runTasks(tasks.map((item) => item.opts));
  const byLabel = {};
  tasks.forEach((item, index) => {
    byLabel[item.label] = view(ran[index]);
  });
  const cells = {};
  for (const reduction of [0.15, 0.25, 0.35]) {
    for (const twistMode of ['none', 'deck']) {
      const label = 'pick:' + reduction + ':' + twistMode;
      const cell = byLabel[label];
      const farms = {};
      for (const bots of [25, 50]) {
        farms[bots] = {};
        for (const catchRate of [0, 0.5, 0.8]) {
          farms[bots][catchRate] = byLabel['pick:' + reduction + ':farm:' + bots + ':' + catchRate + ':' + twistMode].targetWin;
        }
      }
      cells[label] = { goals: cell.goals, conditionals: cell.conditionals, annotations: cell.annotations, farms };
    }
  }
  const report = {
    ruleSet: 's14-pick',
    seasons: SEASONS,
    seconds: Math.round((Date.now() - started) / 1000),
    raise_loyalty_pays_default: false,
    participation: 'Beta(4, 3) each chapter, plus the size slack. Money edge stays +25% at 3× median. Chapter Health still starts at 100.',
    a3: 'Locked at 0.3% of the higher Health. A5 is the Crown changing hands inside chapter 7 only, band 15–35%. Other annotations stay on 20–85%.',
    pick: 'A House at or above 3× median lock is the max reduction less likely to be kept when the Reaper draws its shortlist, or when Twist 4 or Twist 10 picks a House. Below 3× the reduction follows min(1, sqrt(lock / (3 × median))). Health order is unchanged. Ties stay an unweighted VRF roll. The snapshot draw is who falls. Twist 4\'s 2× hits land on the picked House. Twist 10\'s revealed aim uses the same draw for the lowest target.',
    cells
  };
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./results/score-s14-pick.json', import.meta.url), JSON.stringify(report));
  for (const reduction of [0.15, 0.25, 0.35]) {
    for (const twistMode of ['none', 'deck']) {
      const cell = cells['pick:' + reduction + ':' + twistMode];
      const g = cell.goals;
      const k = cell.conditionals;
      const line = [g.leaderWins, g.leaderTop3, g.lowestChampion].map((value) => (100 * value).toFixed(1)).join('/');
      console.log('pick', reduction, twistMode, line, g.pass ? 'PASS' : '');
      console.log('  engaged', k.engagedN, (100 * k.engagedChampion).toFixed(1), 'idle', k.idleN, (100 * k.idleLeaderChampion).toFixed(1));
      console.log('  A', Object.entries(cell.annotations).map(([key, value]) => key + '=' + (100 * value).toFixed(1)).join(' '));
      for (const bots of [25, 50]) {
        const row = [0, 0.5, 0.8].map((catchRate) => catchRate + ':' + (100 * cell.farms[bots][catchRate]).toFixed(1)).join(' ');
        console.log('  farm', bots, row);
      }
    }
  }
  console.log('seconds', report.seconds);
}

async function main() {
  if (process.env.S14_PICK === '1') {
    await runPick();
    return;
  }
  if (process.env.S14_B === '1') {
    await runOptionB();
    return;
  }
  if (process.env.S14_BETA === '1') {
    await runBeta();
    return;
  }
  const started = Date.now();
  const tasks = [];
  for (const edge of [0.2, 0.25, 0.3]) {
    for (const twistMode of ['none', 'deck']) {
      tasks.push(task('edge:' + edge + ':' + twistMode, { edge, twistMode, rally: true, surge: true }));
    }
  }
  for (const twistMode of ['none', 'deck']) {
    tasks.push(task('armor3:' + twistMode, { edge: 0.25, armorCoef: 3, twistMode, rally: true, surge: true }));
    tasks.push(task('readers0:' + twistMode, { edge: 0.25, twistMode, zeroReaders: true, returnChampions: true, rally: true, surge: true }));
    tasks.push(task('readers1:' + twistMode, { edge: 0.25, twistMode, zeroReaders: false, returnChampions: true, rally: true, surge: true }));
  }
  for (const bots of [10, 25, 50]) {
    for (const catchRate of [0, 0.5, 0.8]) {
      for (const twistMode of ['none', 'deck']) {
        tasks.push(task('farm:' + bots + ':' + catchRate + ':' + twistMode, {
          edge: 0.25, twistMode, bots, catch: catchRate, surge: true, rally: true
        }));
      }
    }
  }
  for (const surge of [true, false]) {
    for (const twistMode of ['none', 'deck']) {
      tasks.push(task('grow:' + (surge ? 'on' : 'off') + ':' + twistMode, {
        edge: 0.25, twistMode, honestGrowth: 25, surge, rally: true
      }));
    }
  }
  console.log('tasks', tasks.length, 'seasons', SEASONS);
  const ran = await runTasks(tasks.map((item) => item.opts));
  const byLabel = {};
  tasks.forEach((item, index) => {
    byLabel[item.label] = view(ran[index]);
  });
  const readers = {};
  for (const twistMode of ['none', 'deck']) {
    const left = ran[tasks.findIndex((item) => item.label === 'readers0:' + twistMode)].champions;
    const right = ran[tasks.findIndex((item) => item.label === 'readers1:' + twistMode)].champions;
    let mismatch = 0;
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) mismatch += 1;
    readers[twistMode === 'none' ? 'clean' : 'deck'] = { seasons: left.length, championMismatches: mismatch };
  }
  const report = {
    ruleSet: 's14',
    seasons: SEASONS,
    seconds: Math.round((Date.now() - started) / 1000),
    raise_loyalty_pays_default: false,
    rate_active_only_default: false,
    moneyEdge: '1 + edge * sqrt(locked / (3 * median locked)), frozen at chapter open. Locked Bard is verified plus unverified stake.',
    participation: 'Qualifying verified clusters that play, over all qualifying clusters. A probation cluster that plays adds 0.5 to the numerator and 1 to the denominator. The builder model has every qualifying cluster play every day.',
    bots: 'Each bot locks 6 Bard, just over 1/20 of the generated median stake of 100. They verify mid chapter 1 and count from chapter 2. Caught bots share one cluster.',
    surge: 'New qualifying clusters above max(10, 20% of established clusters) play at half weight for 2 chapters.',
    readers,
    cells: byLabel
  };
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./results/score-s14.json', import.meta.url), JSON.stringify(report));
  const line = (label) => {
    const cell = byLabel[label];
    const g = cell.goals;
    return label + ' ' + [g.leaderWins, g.leaderTop3, g.lowestChampion].map((value) => (100 * value).toFixed(1)).join('/') + (g.pass ? ' PASS' : '');
  };
  for (const edge of [0.2, 0.25, 0.3]) {
    console.log(line('edge:' + edge + ':none'), '|', line('edge:' + edge + ':deck'));
  }
  for (const bots of [10, 25, 50]) {
    for (const catchRate of [0, 0.5, 0.8]) {
      const clean = byLabel['farm:' + bots + ':' + catchRate + ':none'];
      const deck = byLabel['farm:' + bots + ':' + catchRate + ':deck'];
      console.log('farm', bots, catchRate, 'clean', (100 * clean.targetWin).toFixed(1), 'deck', (100 * deck.targetWin).toFixed(1));
    }
  }
  for (const twistMode of ['none', 'deck']) {
    const on = byLabel['grow:on:' + twistMode];
    const off = byLabel['grow:off:' + twistMode];
    console.log('grow', twistMode, 'win', (100 * on.targetWin).toFixed(1), (100 * off.targetWin).toFixed(1), 'health', on.targetHealth && on.targetHealth.toFixed(1), off.targetHealth && off.targetHealth.toFixed(1));
  }
  console.log('readers', JSON.stringify(readers));
  console.log('seconds', report.seconds);
}

if (!isMainThread) {
  parentPort.postMessage(runLocal(workerData));
} else {
  main();
}
