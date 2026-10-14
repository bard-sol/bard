import { sha256Hex } from './bytes.js';
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
    state: 'scoreCast row .S',
    note: 'Taken at the Reaper snapshot. Not stored under the name S.'
  },
  {
    handoff: 'turnout[ch][h]',
    state: 'scoreCast row .U',
    note: 'Square-root turnout of eligible wallets. Recorded per snapshot. Not stored as turnout[ch][h].'
  },
  {
    handoff: 'train_spend[ch][h]',
    state: 'missing',
    note: 'Live field is cumulative trainCredited. Chapter spend is the delta between snapshots.'
  },
  {
    handoff: 'revival_burn[ch]',
    state: 'missing',
    note: 'tBard burned toward revivalTarget during that chapter’s P8 window. 100% burn, including a failed bar.'
  },
  {
    handoff: 'revival_bar_pct[h] ticks',
    state: 'missing',
    note: 'paid / revivalTarget * 100 during the P8 window. A1 reads ticks while chapter < 4.'
  },
  {
    handoff: 'status[h]',
    state: 'missing',
    note: 'Derived. Alive if not eliminated. The owed double mark is take 2, not a status by itself.'
  },
  {
    handoff: 'champion_id',
    state: 'champion',
    note: 'Last remaining id. simulateSeason returns champion, not champion_id.'
  },
  {
    handoff: 'chapter',
    state: 'state.chapter',
    note: 'Snapshot chapter number.'
  },
  {
    handoff: 'N_chapters',
    state: 'defaultConfig().chapters',
    note: '7 in Season 0. Not stored as N_chapters.'
  },
  {
    handoff: 'A6 relic holders',
    state: 'missing',
    note: 'No pledged_wallets and no House in Season 0. S0 uses holders of the eliminated hero’s token: wallets with balance > 0.'
  }
];

export const ANNOTATION_IDS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];

/** Module predicate for A3. The sim also reports 0.5% and final-snapshot-only. */
export const A3_RATIO = 0.01;

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

function markedIds(snapshot) {
  return snapshot.marked || [];
}

function aliveIds(snapshot) {
  if (snapshot.alive) return snapshot.alive;
  return (snapshot.scores || []).map((row) => row.id);
}

/**
 * First successful revival’s hero is still in the cast after the next snapshot.
 * That next snapshot is the two-mark chapter. No revival in the season → no fire.
 */
export function a4Holds(run) {
  const revival = (run.revivals || []).find((row) => row.success);
  if (!revival) return null;
  const next = (run.snapshots || []).find((row) => row.chapter === revival.afterChapter + 1);
  if (!next) return null;
  const gone = new Set(markedIds(next));
  const still = aliveIds(next).filter((id) => !gone.has(id));
  if (!still.includes(revival.heroId)) return null;
  return { chapter: next.chapter, heroId: revival.heroId };
}

function firstFall(run) {
  const saved = new Set();
  for (const row of run.revivals || []) {
    if (row.success) saved.add(row.afterChapter + ':' + row.heroId);
  }
  for (const snap of run.snapshots || []) {
    for (const id of markedIds(snap)) {
      if (saved.has(snap.chapter + ':' + id)) continue;
      return { chapter: snap.chapter, heroId: id };
    }
  }
  return null;
}

function holdersOf(snapshot, heroId) {
  const table = snapshot.holders || {};
  const n = table[heroId];
  return Number.isFinite(n) ? n : null;
}

/**
 * Walk one season history in chapter order. First time a predicate is true, it fires.
 * A3 uses the 1% check at any Reaper snapshot.
 * Returns variants so the sim can report the other two A3 readings without a second pass.
 */
export function evaluateAnnotations(run) {
  const fired = {};
  const variants = { a3Within1pctAny: false, a3WithinHalfpctAny: false, a3Within1pctFinal: false };
  const snaps = run.snapshots || [];

  for (const tick of run.revivalTicks || []) {
    if (fired.A1) break;
    if (Number(tick.chapter) < 4 && Number(tick.pct) >= 50) {
      fired.A1 = { chapter: tick.chapter };
    }
  }

  snaps.forEach((snap, index) => {
    const alive = aliveIds(snap);
    const within1 = scoresWithin(snap.scores, alive, A3_RATIO);
    const withinHalf = scoresWithin(snap.scores, alive, 0.005);
    if (within1) {
      variants.a3Within1pctAny = true;
      if (!fired.A3) fired.A3 = { chapter: snap.chapter };
    }
    if (withinHalf) variants.a3WithinHalfpctAny = true;
    if (index === snaps.length - 1 && within1) variants.a3Within1pctFinal = true;
  });

  const held = a4Holds(run);
  if (held) fired.A4 = held;

  for (const snap of snaps) {
    if (fired.A5) break;
    const train = Object.values(snap.trainSpend || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
    if ((Number(snap.revivalBurn) || 0) > train) fired.A5 = { chapter: snap.chapter };
  }

  const fall = firstFall(run);
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

  if (run.finale && run.championId) {
    const opening = snaps.find((row) => row.chapter === 1) || snaps[0];
    const leader = opening ? turnoutLeader(opening.scores) : null;
    if (leader && leader !== run.championId) {
      const last = snaps[snaps.length - 1];
      fired.A2 = { chapter: last ? last.chapter : null };
    }
  }

  const deviations = run.finale ? ANNOTATION_IDS.filter((id) => !fired[id]) : [];
  return {
    fired,
    deviations,
    variants,
    clue: deviations.length ? DEVIATION_CLUE : null,
    championCarry: CHAMPION_CARRY,
    affectsScore: false
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
