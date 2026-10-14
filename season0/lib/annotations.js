import { sha256Hex } from './bytes.js';
import { defaultConfig } from './config.js';
import { SEASON_SEALS } from '../data/annotation-seals.js';

export { SEASON_SEALS };

/**
 * Sealed Annotations. Predicates only. They never change odds, weights,
 * rewards, eligibility, or tokens. Salts and plaintext stay off the repo.
 *
 * Handoff §2.3 names are not the state-file names. FIELD_MAP is the rename list.
 */
export const FIELD_MAP = [
  {
    handoff: 'S[h]',
    state: 'scores[].S',
    note: 'Written on the chapter snapshot from scoreCast at the Reaper.'
  },
  {
    handoff: 'turnout[ch][h]',
    state: 'scores[].U',
    note: 'Square-root turnout, stored on the same snapshot row as S.'
  },
  {
    handoff: 'train_spend[ch][h]',
    state: 'train_spend[id]',
    note: 'train_credited at this snapshot minus train_credited at the previous snapshot. Chapter 1 subtracts from 0. Same number as the sum of train_credits.credited for that hero and chapter.'
  },
  {
    handoff: 'revival_burn[ch]',
    state: 'revival_burn',
    note: 'tBard burned in that chapter’s revival window, including a bar that fails.'
  },
  {
    handoff: 'revival_bar_pct[h] ticks',
    state: 'revival_bar_pct[]',
    note: 'Each indexed revive burn appends {hero_id, paid, pct}. pct is cumulative paid / revival target * 100.'
  },
  {
    handoff: 'status[h]',
    state: 'status[id]',
    note: 'alive or eliminated after the chapter resolves. owed on the snapshot is the double-mark chapter and is not itself an elimination.'
  },
  {
    handoff: 'champion_id',
    state: 'champion_id',
    note: 'Set on the finale snapshot. Null until then.'
  },
  {
    handoff: 'chapter',
    state: 'chapter',
    note: 'Snapshot chapter number.'
  },
  {
    handoff: 'N_chapters',
    state: 'defaultConfig().chapters',
    note: '7 in Season 0. Read from config, not from the snapshot.'
  },
  {
    handoff: 'A6 relic holders',
    state: 'holders[id]',
    note: 'Token accounts with balance > 0 for that hero’s mint, counted at the snapshot. Season 0 has no House pledged_wallets.'
  }
];

export const ANNOTATION_IDS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];

/** Locked module predicate. Gameplay set this to 0.5% on any Reaper snapshot. */
export const A3_RATIO = defaultConfig().annotation_a3_ratio;

export function a3Ratio(config) {
  if (config && config.annotation_a3_ratio != null) return Number(config.annotation_a3_ratio);
  return defaultConfig().annotation_a3_ratio;
}

/**
 * Fields the devnet snapshot cannot fill from data that already exists.
 * The columns are still in the schema. A null means the predicate stays quiet.
 */
export const DEVNET_UNRECORDED = [
  {
    field: 'holders',
    reason: 'No hero mints are deployed. devnet.public.json has an empty pools map and a null tbard mint, so there is no token to scan. eligibility_snapshots only lists wallets the app checked. The holder count has to be written at the snapshot, and it cannot be rebuilt later from those rows.'
  },
  {
    field: 'revival_bar_pct',
    reason: 'The bar percentage is not stored on chain. Each confirmed revive burn can be written as a tick when it is indexed. A burn that was never indexed cannot be rebuilt as a series. One closing tick, filled divided by the target, is enough for A1 because the bar only rises.'
  }
];

export const CHAMPION_CARRY = {
  immunity: false,
  cosmetic: 'frontispiece-frame',
  affectsScore: false
};

export const DEVIATION_CLUE = {
  id: 'author-margin-note',
  title: 'Author margin note',
  cosmetic: true,
  equalForAll: true,
  affectsScore: false
};

export function canonicalAnnotationText(season, id, annotationText) {
  const label = String(season || 's0').replace(/^s/i, '').toUpperCase();
  const body = String(annotationText == null ? '' : annotationText).normalize('NFC').replace(/[\r\n]+$/g, '');
  return 'BARD|S' + label + '|ANN|' + id + '|' + body;
}

export async function annotationCommit(saltHex, canonical) {
  const salt = String(saltHex || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(salt)) throw new Error('salt must be 64 lowercase hex chars');
  return sha256Hex(salt + canonical);
}

export async function verifyAnnotationReveal({ season, id, text, salt, commit }) {
  const hash = await annotationCommit(salt, canonicalAnnotationText(season || 's0', id, text));
  return hash === String(commit || '').toLowerCase();
}

export function sealMemo(season, seals) {
  const list = (seals || []).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const body = list.map((row) => row.id + ':' + row.commit).join(':');
  return 'bard:v1:seal:' + (season || 's0') + ':' + body;
}

export function memoTxHref(tx) {
  if (!tx) return null;
  return 'https://explorer.solana.com/tx/' + tx + '?cluster=devnet';
}

export function turnoutLeader(scores) {
  let best = null;
  for (const row of scores || []) {
    const u = Number(row.U) || 0;
    if (!best || u > best.u || (u === best.u && String(row.id) < best.id)) best = { id: String(row.id), u };
  }
  return best ? best.id : null;
}

/** True when any two living scores are within `ratio` of the larger one. */
export function scoresWithin(scores, alive, ratio) {
  const allow = alive ? new Set(alive) : null;
  const living = (scores || []).filter((row) => !allow || allow.has(row.id));
  for (let i = 0; i < living.length; i++) {
    for (let j = i + 1; j < living.length; j++) {
      const a = Number(living[i].S) || 0;
      const b = Number(living[j].S) || 0;
      const max = Math.max(a, b);
      if (max > 0 && Math.abs(a - b) / max <= ratio) return true;
    }
  }
  return false;
}

function snapshotScores(snapshot) {
  return snapshot.scores || [];
}

function heroStatus(snapshot, id) {
  const table = snapshot.status || {};
  return table[id] || null;
}

/**
 * Chapter record stored in the state file and in chapter_hero_snapshot.
 * train_spend is the trainCredited delta. Holders may be null when no mint was scanned.
 */
export function buildChapterSnapshot(input) {
  const scores = (input.scores || []).map((row) => ({
    id: row.id,
    S: row.S,
    U: row.U
  }));
  const marked = (input.marked || []).slice();
  const revived = input.revival && input.revival.success ? input.revival.hero_id : null;
  const previous = input.previous_train_credited || {};
  const current = input.train_credited || {};
  const holderIn = input.holders || {};
  const already = new Set(input.already_eliminated || []);
  const ids = new Set([
    ...scores.map((row) => row.id),
    ...Object.keys(current),
    ...Object.keys(holderIn),
    ...already,
    ...marked
  ]);
  const train_spend = {};
  const train_credited = {};
  const holders = {};
  const status = {};
  for (const id of ids) {
    const credited = Number(current[id]) || 0;
    const before = Number(previous[id]) || 0;
    train_credited[id] = credited;
    train_spend[id] = already.has(id) ? 0 : Math.max(0, credited - before);
    holders[id] = holderIn[id] == null ? null : Number(holderIn[id]);
    if (already.has(id)) status[id] = 'eliminated';
    else if (marked.includes(id) && id !== revived) status[id] = 'eliminated';
    else status[id] = 'alive';
  }
  const target = Number(input.revival_target) || 0;
  let paid = 0;
  const ticks = [];
  for (const payment of input.revival_payments || []) {
    paid += Number(payment.paid) || 0;
    const pct = target > 0 ? (paid / target) * 100 : 0;
    ticks.push({
      hero_id: payment.hero_id || (input.revival && input.revival.hero_id) || null,
      paid,
      pct
    });
  }
  const revival = input.revival
    ? { hero_id: input.revival.hero_id, success: !!input.revival.success }
    : null;
  return {
    season: input.season || 's0',
    chapter: input.chapter,
    file_status: input.file_status || 'final',
    owed: !!input.owed,
    champion_id: input.champion_id || null,
    scores,
    train_spend,
    train_credited,
    holders,
    status,
    marked,
    revival_burn: ticks.length ? paid : Number(input.revival_burn) || 0,
    revival_bar_pct: ticks,
    revival
  };
}

/** Rows for the annotation migration. The JSON snapshot is the hashed state file. */
export function chapterSnapshotRows(snapshot) {
  const heroes = Object.keys(snapshot.status || {}).sort().map((id) => ({
    season: snapshot.season,
    chapter: snapshot.chapter,
    char_id: id,
    train_spend: snapshot.train_spend[id] == null ? 0 : snapshot.train_spend[id],
    train_credited: snapshot.train_credited[id] == null ? 0 : snapshot.train_credited[id],
    holders: snapshot.holders[id] == null ? null : snapshot.holders[id],
    status: snapshot.status[id],
    in_snapshot: (snapshot.scores || []).some((row) => row.id === id),
    s: ((snapshot.scores || []).find((row) => row.id === id) || {}).S ?? null,
    u: ((snapshot.scores || []).find((row) => row.id === id) || {}).U ?? null,
    marked: (snapshot.marked || []).includes(id)
  }));
  return {
    chapterState: {
      season: snapshot.season,
      chapter: snapshot.chapter,
      owed: !!snapshot.owed,
      champion_id: snapshot.champion_id || null,
      revival_burn: Number(snapshot.revival_burn) || 0
    },
    heroes,
    ticks: (snapshot.revival_bar_pct || []).map((tick) => ({
      season: snapshot.season,
      chapter: snapshot.chapter,
      char_id: tick.hero_id,
      paid: tick.paid,
      pct: tick.pct
    }))
  };
}

/**
 * First successful revival’s hero is still alive on the next snapshot.
 * That snapshot is the owed two-mark chapter. No revival in the season → no fire.
 */
export function a4Holds(run) {
  const snaps = run.snapshots || [];
  const revival = snaps.find((row) => row.revival && row.revival.success);
  if (!revival) return null;
  const next = snaps.find((row) => row.chapter === revival.chapter + 1);
  if (!next) return null;
  const heroId = revival.revival.hero_id;
  if (heroStatus(next, heroId) !== 'alive') return null;
  return { chapter: next.chapter, heroId };
}

function firstFall(run) {
  for (const snap of run.snapshots || []) {
    for (const id of snap.marked || []) {
      if (heroStatus(snap, id) === 'eliminated') return { chapter: snap.chapter, heroId: id };
    }
  }
  return null;
}

function holdersOf(snapshot, heroId) {
  const table = snapshot.holders || {};
  if (!(heroId in table) || table[heroId] == null) return null;
  const n = Number(table[heroId]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Walk recorded chapter snapshots in order. First time a predicate is true, it fires.
 * A3 uses annotation_a3_ratio (0.5%) against scores on any snapshot.
 * Variants stay available so a re-check can show the other two readings.
 */
export function evaluateAnnotations(run) {
  const fired = {};
  const variants = { a3Within1pctAny: false, a3WithinHalfpctAny: false, a3Within1pctFinal: false };
  const snaps = (run.snapshots || []).slice().sort((a, b) => a.chapter - b.chapter);
  const ratio = a3Ratio(run.config);

  for (const snap of snaps) {
    if (fired.A1 || !(snap.chapter < 4)) continue;
    for (const tick of snap.revival_bar_pct || []) {
      if (Number(tick.pct) >= 50) {
        fired.A1 = { chapter: snap.chapter };
        break;
      }
    }
  }

  snaps.forEach((snap, index) => {
    const alive = snapshotScores(snap).map((row) => row.id);
    const within1 = scoresWithin(snap.scores, alive, 0.01);
    const withinHalf = scoresWithin(snap.scores, alive, 0.005);
    const withinModule = scoresWithin(snap.scores, alive, ratio);
    if (within1) variants.a3Within1pctAny = true;
    if (withinHalf) variants.a3WithinHalfpctAny = true;
    if (withinModule && !fired.A3) fired.A3 = { chapter: snap.chapter };
    if (index === snaps.length - 1 && within1) variants.a3Within1pctFinal = true;
  });

  const held = a4Holds({ snapshots: snaps });
  if (held) fired.A4 = held;

  for (const snap of snaps) {
    if (fired.A5) break;
    const train = Object.values(snap.train_spend || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
    if ((Number(snap.revival_burn) || 0) > train) fired.A5 = { chapter: snap.chapter };
  }

  const fall = firstFall({ snapshots: snaps });
  if (fall) {
    const next = snaps.find((row) => row.chapter === fall.chapter + 1);
    const before = snaps.find((row) => row.chapter === fall.chapter);
    if (next && before) {
      const prior = holdersOf(before, fall.heroId);
      const later = holdersOf(next, fall.heroId);
      if (prior != null && later != null && prior > 0 && later >= 0.9 * prior) {
        fired.A6 = { chapter: next.chapter, heroId: fall.heroId };
      }
    }
  }

  const finaleSnap = snaps.filter((row) => row.champion_id).pop();
  const championId = run.championId || (finaleSnap && finaleSnap.champion_id) || null;
  const finale = run.finale != null ? !!run.finale : !!championId;
  if (finale && championId) {
    const opening = snaps.find((row) => row.chapter === 1) || snaps[0];
    const leader = opening ? turnoutLeader(opening.scores) : null;
    if (leader && leader !== championId) {
      const last = snaps[snaps.length - 1];
      fired.A2 = { chapter: last ? last.chapter : null };
    }
  }

  const deviations = finale ? ANNOTATION_IDS.filter((id) => !fired[id]) : [];
  return {
    fired,
    deviations,
    variants,
    clue: deviations.length ? DEVIATION_CLUE : null,
    championCarry: CHAMPION_CARRY,
    affectsScore: false
  };
}

/** Fire rates from recorded chapter snapshots, grouped by season id. */
export function recheckRecords(bySeason) {
  const names = Object.keys(bySeason || {}).filter((id) => (bySeason[id] || []).length).sort();
  if (!names.length) {
    return {
      seasons: 0,
      chapters: 0,
      fireRate: null,
      averageFired: null,
      fired: {},
      gaps: [],
      unrecorded: DEVNET_UNRECORDED,
      reason: 'no recorded chapters'
    };
  }
  const hits = {};
  for (const id of ANNOTATION_IDS) hits[id] = 0;
  const fired = {};
  const gaps = [];
  let chapters = 0;
  let firedSum = 0;
  for (const name of names) {
    const snapshots = bySeason[name].slice().sort((a, b) => a.chapter - b.chapter);
    chapters += snapshots.length;
    const championId = (snapshots.filter((row) => row.champion_id).pop() || {}).champion_id || null;
    const result = evaluateAnnotations({
      snapshots,
      finale: !!championId,
      championId
    });
    fired[name] = ANNOTATION_IDS.filter((id) => result.fired[id]);
    firedSum += fired[name].length;
    for (const id of fired[name]) hits[id] += 1;
    for (const snap of snapshots) {
      const missing = Object.values(snap.holders || {}).some((n) => n == null);
      if (missing) gaps.push({ season: name, chapter: snap.chapter, field: 'holders' });
    }
  }
  const fireRate = {};
  for (const id of ANNOTATION_IDS) fireRate[id] = hits[id] / names.length;
  return {
    seasons: names.length,
    chapters,
    fireRate,
    averageFired: firedSum / names.length,
    fired,
    gaps,
    unrecorded: DEVNET_UNRECORDED,
    moduleA3: a3Ratio()
  };
}

export function publicSealList() {
  return {
    season: SEASON_SEALS.season,
    kind: 'seal',
    seals: SEASON_SEALS.seals.map((row) => ({ id: row.id, kind: 'seal', commit: row.commit })),
    memo: sealMemo(SEASON_SEALS.season, SEASON_SEALS.seals)
  };
}

/**
 * Hashes are always public. Text and salt are returned only for ids the caller
 * already treats as opened, or as finale Deviations. Callers must not pass
 * unfired ids before the finale.
 */
export async function revealView({ season, reveals, openedIds, finale, tx }) {
  const pack = publicSealList();
  const byId = new Map((reveals || []).map((row) => [row.id, row]));
  const openedSet = new Set(openedIds || []);
  const memo = pack.memo;
  const opened = [];
  for (const id of ANNOTATION_IDS) {
    if (!openedSet.has(id)) continue;
    const secret = byId.get(id);
    const seal = pack.seals.find((row) => row.id === id);
    if (!secret || !seal) continue;
    const ok = await verifyAnnotationReveal({
      season: season || pack.season,
      id,
      text: secret.text,
      salt: secret.salt,
      commit: seal.commit
    });
    if (!ok) continue;
    opened.push({
      id,
      text: secret.text,
      salt: secret.salt,
      commit: seal.commit,
      memo,
      tx: tx || null,
      href: memoTxHref(tx)
    });
  }
  const deviations = [];
  if (finale) {
    for (const id of ANNOTATION_IDS) {
      if (openedSet.has(id)) continue;
      const secret = byId.get(id);
      const seal = pack.seals.find((row) => row.id === id);
      if (!secret || !seal) continue;
      const ok = await verifyAnnotationReveal({
        season: season || pack.season,
        id,
        text: secret.text,
        salt: secret.salt,
        commit: seal.commit
      });
      if (!ok) continue;
      deviations.push({
        id,
        text: secret.text,
        salt: secret.salt,
        commit: seal.commit,
        clue: DEVIATION_CLUE
      });
    }
  }
  return {
    ...pack,
    tx: tx || null,
    opened,
    deviations,
    clue: deviations.length ? DEVIATION_CLUE : null,
    championCarry: CHAMPION_CARRY,
    affectsScore: false
  };
}
