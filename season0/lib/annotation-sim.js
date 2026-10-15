import { CAST } from './cast.js';
import { chooseMarked, scoreCast } from './score.js';
import { revivalTarget } from './spend.js';
import { randomField } from './survival.js';
import { buildChapterSnapshot, evaluateAnnotations } from './annotations.js';

/**
 * Read-only season observer. Uses scoreCast and chooseMarked as they are.
 * Writes the same chapter snapshot the state file stores, then runs the predicates
 * on those records. It does not change elimination math.
 *
 * Revival is once per season, opened after a mark until one bar fills or the
 * last chapter (no revival) is reached. A successful pour keeps that hero and
 * sets the next chapter to take two. Supporters Train the saved hero and
 * come back active before that next snapshot. Those are actions, not a formula change.
 */

function mulberry(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function holderCount(row) {
  return (row.wallets || []).filter((wallet) => Number(wallet.balance) > 0).length;
}

function driftHolders(row, rng) {
  const next = [];
  for (const wallet of row.wallets || []) {
    if (rng() < 0.08) continue;
    next.push({
      balance: wallet.balance,
      eligible: wallet.eligible,
      active: rng() < 0.7 ? !!wallet.active : rng() < 0.45
    });
  }
  if (rng() < 0.35) {
    next.push({
      balance: 1 + Math.floor(rng() * 200),
      eligible: rng() > 0.08,
      active: rng() < 0.5
    });
  }
  if (!next.length) next.push({ balance: 10, eligible: true, active: true });
  row.wallets = next;
}

function driftMarket(row, rng) {
  row.prevTwap = row.twap;
  row.twap = Math.max(0.05, row.twap * Math.exp((rng() - 0.48) * 0.35));
  row.swaps = Math.floor(rng() * 200);
  row.traders = Math.floor(rng() * 80);
  row.dailyAccuracies = [rng(), rng(), rng()];
}

function emptyRun() {
  return { snapshots: [], revivalTicks: [], revivals: [], championId: null, finale: false };
}

export async function simulateAnnotationSeason(seed) {
  const rng = mulberry((Number(seed) + 1) * 0x9e3779b9);
  const living = randomField(rng);
  const fallen = [];
  const run = emptyRun();
  let revivalUsed = false;
  let pendingDouble = false;

  for (let chapter = 1; chapter <= 7 && living.length > 1; chapter++) {
    const previousTrain = {};
    for (const row of living.concat(fallen)) previousTrain[row.id] = Number(row.trainCredited) || 0;
    for (const row of living) {
      driftMarket(row, rng);
      driftHolders(row, rng);
      const spend = 80 + Math.floor(rng() * 1800);
      row.trainCredited = (Number(row.trainCredited) || 0) + spend;
    }
    for (const row of fallen) {
      driftMarket(row, rng);
      driftHolders(row, rng);
    }

    const doublePage = pendingDouble;
    pendingDouble = false;
    const take = Math.min(doublePage ? 2 : 1, living.length - 1);
    const scored = scoreCast(living.map((row) => ({ ...row, chapter })));
    const marked = await chooseMarked(scored, 'ann-' + seed + '-' + chapter, take);
    const holders = {};
    for (const row of living.concat(fallen)) holders[row.id] = holderCount(row);

    let savedId = null;
    let revival = null;
    let revivalTargetValue = 0;
    let revivalPayments = [];
    if (!revivalUsed && chapter < 7 && marked.length && rng() < 0.55) {
      const heroId = marked[0].id;
      const hero = living.find((row) => row.id === heroId);
      revivalTargetValue = revivalTarget(hero ? hero.trainCredited : 0);
      const fraction = 0.2 + rng() * 0.95;
      const paid = Math.floor(fraction * revivalTargetValue);
      const step = Math.floor(paid / 8);
      let left = paid;
      revivalPayments = [];
      for (let i = 0; i < 8; i++) {
        const part = i === 7 ? left : step;
        left -= part;
        revivalPayments.push({ hero_id: heroId, paid: part });
      }
      const success = paid >= revivalTargetValue;
      revival = { hero_id: heroId, success };
      if (success) {
        revivalUsed = true;
        pendingDouble = true;
        savedId = heroId;
        if (hero) {
          hero.trainCredited = (Number(hero.trainCredited) || 0) + Math.floor(revivalTargetValue * 3);
          for (const wallet of hero.wallets || []) wallet.active = true;
        }
      }
    }

    const trainCredited = {};
    for (const row of living.concat(fallen)) trainCredited[row.id] = Number(row.trainCredited) || 0;
    const snapshot = buildChapterSnapshot({
      season: 's0',
      chapter,
      owed: doublePage,
      scores: scored.map((row) => ({ id: row.id, S: row.S, U: row.U })),
      marked: marked.map((row) => row.id),
      previous_train_credited: previousTrain,
      train_credited: trainCredited,
      holders,
      already_eliminated: fallen.map((row) => row.id),
      revival,
      revival_target: revivalTargetValue,
      revival_payments: revivalPayments
    });
    run.snapshots.push(snapshot);

    const dead = new Set(snapshot.marked.filter((id) => id !== savedId));
    for (let i = living.length - 1; i >= 0; i--) {
      if (!dead.has(living[i].id)) continue;
      fallen.push(living[i]);
      living.splice(i, 1);
    }
  }

  run.championId = living[0] ? living[0].id : null;
  run.finale = true;
  if (run.snapshots.length) run.snapshots[run.snapshots.length - 1].champion_id = run.championId;
  const evaluation = evaluateAnnotations(run);
  return { seed, championId: run.championId, ...evaluation };
}

export async function simulateAnnotationSeeds(count) {
  const total = Math.max(1, Number(count) || 1000);
  const keys = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
  const hits = {};
  for (const id of keys) hits[id] = 0;
  const variants = { a3Within1pctAny: 0, a3WithinHalfpctAny: 0, a3Within1pctFinal: 0 };
  let firedSum = 0;
  for (let i = 0; i < total; i++) {
    const season = await simulateAnnotationSeason(i);
    let n = 0;
    for (const id of keys) {
      if (season.fired[id]) {
        hits[id] += 1;
        n += 1;
      }
    }
    firedSum += n;
    if (season.variants.a3Within1pctAny) variants.a3Within1pctAny += 1;
    if (season.variants.a3WithinHalfpctAny) variants.a3WithinHalfpctAny += 1;
    if (season.variants.a3Within1pctFinal) variants.a3Within1pctFinal += 1;
  }
  const rate = {};
  for (const id of keys) rate[id] = hits[id] / total;
  const variantRate = {
    within1pctAny: variants.a3Within1pctAny / total,
    withinHalfpctAny: variants.a3WithinHalfpctAny / total,
    within1pctFinal: variants.a3Within1pctFinal / total
  };
  const flag = (name, value) => {
    const notes = [];
    if (value < 0.1 || value > 0.9) notes.push('outside 10–90%');
    if (value < 0.2 || value > 0.85) notes.push('outside 20–85%');
    return notes.length ? { name, rate: value, notes } : null;
  };
  const flagged = [];
  for (const id of keys) {
    const row = flag(id, rate[id]);
    if (row) flagged.push(row);
  }
  for (const name of Object.keys(variantRate)) {
    if (name === 'within1pctAny') continue;
    const row = flag('A3 ' + name, variantRate[name]);
    if (row) flagged.push(row);
  }
  return {
    seasons: total,
    fireRate: rate,
    a3Variants: variantRate,
    averageFired: firedSum / total,
    flagged,
    moduleA3: 'within 0.5% at any Reaper snapshot',
    moduleA4: 'first revived hero still alive after the next two-mark snapshot; no revival means no fire'
  };
}

export const SIM_CAST = CAST.map((character) => character.id);
