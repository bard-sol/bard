import { CAST } from '../lib/cast.js';
import { chapterByNumber } from '../lib/chapters.js';
import { chapterStartMs, formatDuration, phaseAt, reaperHeader } from '../lib/phase.js';
import { defaultConfig } from '../lib/config.js';
import { margin, scoreCast, trainedBonus } from '../lib/score.js';
import { revivalTarget } from '../lib/spend.js';
import { CHAMPION_CARRY, DEVIATION_CLUE } from '../lib/annotations.js';
import { VOID_COPY } from '../lib/voidchapter.js';

const HOUR = 3600 * 1000;

const PROFILE = {
  grenna: { twap: 0.000024, train: 12000, n: 48, active: 0.72, k: [0.8, 0.6, 0.9] },
  silas: { twap: 0.000011, train: 6000, n: 30, active: 0.41, k: [0.4, 0.5] },
  marrow: { twap: 0.000018, train: 9000, n: 36, active: 0.66, k: [0.7, 0.55] },
  pip: { twap: 0.000008, train: 2500, n: 18, active: 0.33, k: [0.2] },
  wick: { twap: 0.000014, train: 7000, n: 22, active: 0.5, k: [0.6, 0.6] },
  vey: { twap: 0.000028, train: 15000, n: 55, active: 0.8, k: [0.85, 0.7, 0.75] },
  thorn: { twap: 0.000009, train: 4000, n: 16, active: 0.28, k: [0.3] },
  twins: { twap: 0.000016, train: 8000, n: 28, active: 0.58, k: [0.5, 0.65] }
};

function wallets(profile) {
  const list = [];
  for (let i = 0; i < profile.n; i++) {
    list.push({
      balance: 800 + i * 17,
      eligible: true,
      active: i / profile.n < profile.active
    });
  }
  return list;
}

export function standings(extraTrain) {
  const bonus = extraTrain || {};
  const rows = CAST.map((c) => {
    const p = PROFILE[c.id];
    return {
      id: c.id,
      entity_id: c.id,
      entity_type: 'character',
      twap: p.twap,
      supply: 1e9,
      trainCredited: p.train + (Number(bonus[c.id]) || 0),
      encMod: 0,
      wallets: wallets(p),
      strikeAccuracies: p.k
    };
  });
  const scored = scoreCast(rows);
  scored.sort((a, b) => b.S - a.S);
  const lowest = scored[scored.length - 1];
  const second = scored[scored.length - 2];
  return scored.map((row, index) => {
    const character = CAST.find((c) => c.id === row.id);
    const trained = trainedBonus(PROFILE[row.id].train + (Number(bonus[row.id]) || 0));
    const gapBase = row.id === lowest.id ? second.S : lowest.S;
    const gap = margin(row.S, gapBase);
    return {
      ...row,
      rank: index + 1,
      character,
      trained,
      trainCredited: PROFILE[row.id].train + (Number(bonus[row.id]) || 0),
      turnout: row.U,
      handlers: PROFILE[row.id].n,
      gap,
      lowest: row.id === lowest.id
    };
  });
}

export function shortlistIds(rows) {
  return [...rows].sort((a, b) => a.S - b.S).slice(0, 2).map((r) => r.id);
}

function queryGet(query, key) {
  if (!query) return null;
  if (typeof query.get === 'function') return query.get(key);
  return query[key] == null ? null : String(query[key]);
}

/** Map a QA phase onto a clock inside that phase. Elapsed keeps the countdown moving. */
export function travelInstant(config, phase, chapter, elapsedMs) {
  const cfg = config || defaultConfig();
  const n = Math.min(cfg.chapters, Math.max(1, Number(chapter) || 1));
  const t0 = chapterStartMs(cfg, n);
  const at = {
    P0: t0 - 36 * HOUR,
    P1: t0 + 12 * HOUR,
    P2: t0 + 40 * HOUR,
    P3: t0 + 54 * HOUR,
    P4: t0 + 66 * HOUR,
    P5: t0 + 72 * HOUR + 2 * 60 * 1000,
    P6: t0 + 73 * HOUR,
    P7: t0 + 81 * HOUR,
    P8: t0 + 74 * HOUR
  };
  return (at[phase] == null ? t0 + 12 * HOUR : at[phase]) + (Number(elapsedMs) || 0);
}

function previewSnapshot(t0, cfg) {
  const windowStart = t0 + (cfg.chapter_len_s - cfg.final_window_s) * 1000;
  return windowStart + 5 * HOUR + 47 * 60 * 1000;
}

export function screenState({ config, now, query, standingsRows }) {
  const cfg = config || defaultConfig();
  const forced = queryGet(query, 'phase');
  const chapterArg = Number(queryGet(query, 'chapter') || 1);
  const elapsed = Number(queryGet(query, 'elapsed') || 0);
  const clock = forced ? travelInstant(cfg, forced, chapterArg, elapsed) : now;
  const base = phaseAt(clock, cfg);
  const voidReason = queryGet(query, 'void');
  const voided = !!voidReason && voidReason !== '0';
  const relicArg = queryGet(query, 'relic');
  const markedArg = queryGet(query, 'marked') || 'thorn';
  const reveal = queryGet(query, 'reveal') === '1';

  let phase = forced || base.phase;
  let chapter = forced ? Math.min(cfg.chapters, Math.max(1, chapterArg)) : base.chapter;
  if (forced === 'P5' || forced === 'P6' || forced === 'P7' || forced === 'P8') chapter = chapterArg;
  if (!forced && base.phase === 'ended') phase = 'ended';
  if (!forced && base.phase === 'announced') phase = 'announced';

  const t0 = chapterStartMs(cfg, phase === 'P0' || phase === 'announced' ? 1 : chapter);
  const windowClose = t0 + cfg.chapter_len_s * 1000;
  const predictLock = t0 + cfg.predict_lock_s * 1000;
  const decideClose = t0 + cfg.decide_close_s * 1000;
  const windowOpen = t0 + (cfg.chapter_len_s - cfg.final_window_s) * 1000;
  const rows = standingsRows || standings();
  const living = rows.filter((r) => r.id !== relicArg);
  const danger = ['P2', 'P3', 'P4', 'P6'].includes(phase) && !voided ? shortlistIds(living) : [];
  const marked = ['P6', 'P8'].includes(phase) && !voided ? markedArg : null;
  const revivalOpen = phase === 'P8' && !voided && chapter < cfg.chapters;
  const chapterNight = phase === 'P7' && !voided;
  const doublePage = queryGet(query, 'double') === '1';

  return {
    config: cfg,
    now: clock,
    travel: !!forced,
    phase,
    chapter,
    t0,
    windowClose,
    predictLock,
    decideClose,
    windowOpen,
    voided,
    voidReason: VOID_COPY[voidReason] ? voidReason : (voided ? 'vrf' : null),
    voidCopy: VOID_COPY[voidReason] || (voided ? VOID_COPY.vrf : null),
    marked,
    danger,
    revivalOpen,
    chapterNight,
    doublePage,
    relicId: relicArg,
    reveal,
    picksOpen: phase === 'P1' && !voided,
    decideOpen: (phase === 'P1' || phase === 'P2') && !voided,
    rows,
    chapterText: chapterByNumber(phase === 'P0' ? 1 : chapter),
    previewSnapshot: reveal && phase === 'P6' ? previewSnapshot(t0, cfg) : null
  };
}

export function headerCopy(screen) {
  const left = (ms) => formatDuration(ms - screen.now);
  if (screen.voided) {
    return {
      title: 'Chapter ' + screen.chapter + ' · voided',
      footnote: 'No elimination. The rerun keeps this chapter number.'
    };
  }
  if (screen.phase === 'P0') {
    return {
      title: 'Season opens in ' + left(screen.t0) + ' · buy now to be eligible for Chapter 1',
      footnote: 'Hold any amount for 24h. Free tBard never makes you eligible.'
    };
  }
  if (screen.phase === 'announced') {
    return {
      title: 'Season 0 is announced. The 72h buy window has not opened.',
      footnote: 'Buy during the 72 hours before Chapter 1 so the 24h hold can clear.'
    };
  }
  if (screen.phase === 'ended') {
    return { title: 'The Last Page is written.', footnote: 'Season 0 has no payout.' };
  }
  if (screen.phase === 'P4') {
    const copy = reaperHeader('P4', screen.windowClose - screen.now);
    return { title: copy.title, footnote: copy.footnote, hatch: true };
  }
  if (screen.phase === 'P5') {
    const copy = reaperHeader('P5', 0);
    return copy;
  }
  if (screen.phase === 'P1') {
    return {
      title: 'Chapter ' + screen.chapter + ' of 7 · vote closes in ' + left(screen.decideClose) + ' · picks lock in ' + left(screen.predictLock),
      footnote: 'Act before the Reaper. Nobody knows when that is.'
    };
  }
  if (screen.phase === 'P2') {
    return {
      title: 'Chapter ' + screen.chapter + ' of 7 · picks are locked · vote closes in ' + left(screen.decideClose),
      footnote: 'Drama, not a verdict. The Reaper decides.'
    };
  }
  if (screen.phase === 'P3') {
    return {
      title: 'Chapter ' + screen.chapter + ' of 7 · decide is in · final window opens in ' + left(screen.windowOpen),
      footnote: 'The shortlist used a modifier of 0. The outcome is in Verify after the draw.'
    };
  }
  if (screen.phase === 'P6') {
    const name = (CAST.find((c) => c.id === screen.marked) || {}).name || 'Unknown';
    const when = screen.previewSnapshot
      ? ' The Reaper came at ' + new Date(screen.previewSnapshot).toLocaleString() + ' · preview clock, not an ORAO draw.'
      : ' The snapshot time appears in Verify once the VRF fulfilment is posted.';
    return {
      title: 'Marked: ' + name + '.',
      footnote: 'Shown only after the mark.' + when
    };
  }
  if (screen.phase === 'P7') {
    return { title: 'Chapter night is live.', footnote: 'Standings, last words, then the page.' };
  }
  if (screen.phase === 'P8') {
    const name = (CAST.find((c) => c.id === screen.marked) || {}).name || 'Unknown';
    return {
      title: 'Revival open for ' + name + '.',
      footnote: 'Anyone can burn tBard. 100% is burned. No refunds, even if the bar fails.'
    };
  }
  return { title: 'Season 0', footnote: '' };
}

export function bannerStack(screen) {
  const items = [];
  for (const ann of screen.annotations || []) {
    items.push({
      id: 'annotation-' + ann.id,
      tone: 'info',
      title: 'Annotation ' + ann.id,
      body: ann.text,
      sealId: ann.id,
      memo: ann.memo,
      tx: ann.tx || null,
      href: ann.href || null
    });
  }
  if (screen.deviations && screen.deviations.length) {
    const lines = screen.deviations.map((row) => (row.text ? row.id + ' — ' + row.text : row.id)).join(' ');
    items.push({
      id: 'deviations',
      tone: 'info',
      title: 'Deviations',
      body: lines + ' Each grants ' + DEVIATION_CLUE.title + ' to everyone.',
      clue: DEVIATION_CLUE.title
    });
  }
  if (screen.phase === 'ended') {
    items.push({
      id: 'frontispiece',
      tone: 'info',
      title: 'Frontispiece frame',
      body: 'Cosmetic only. The champion carries ' + CHAMPION_CARRY.cosmetic + ' and is not immune next season.'
    });
  }
  if (screen.voided) {
    const rerun = new Date(screen.t0 + screen.config.chapter_len_s * 1000);
    items.push({
      id: 'void',
      tone: 'info',
      title: 'Chapter ' + screen.chapter + ' voided: no elimination. Rerunning from ' + rerun.toLocaleString() + '.',
      body: 'Reason: ' + screen.voidCopy
    });
  }
  if (screen.revivalOpen) {
    const row = screen.rows.find((r) => r.id === screen.marked);
    const target = revivalTarget(row ? row.trainCredited : 0, screen.config);
    const name = (CAST.find((c) => c.id === screen.marked) || {}).name;
    items.push({
      id: 'revival',
      tone: 'revive',
      title: 'Revive ' + name,
      body: 'Anyone can contribute. 100% burn, no refunds.',
      target,
      name
    });
  }
  if (screen.phase === 'P6' && screen.marked && !screen.voided) {
    items.push({
      id: 'words',
      tone: 'info',
      title: (CAST.find((c) => c.id === screen.marked) || {}).name + "'s top squad is choosing last words",
      body: '6h from the mark. Filter, then bot review. No appeals.'
    });
  }
  if (screen.danger.length && !screen.voided) {
    const names = screen.danger.map((id) => CAST.find((c) => c.id === id).name).join(' · ');
    items.push({
      id: 'danger',
      tone: 'danger',
      title: 'In danger · ' + names,
      body: 'Drama, not a verdict. The Reaper decides.'
    });
  }
  if (screen.doublePage) {
    items.push({
      id: 'double',
      tone: 'danger',
      title: 'Double page: the Reaper takes two this chapter',
      body: 'A revival succeeded. The next mark takes two.'
    });
  }
  if (screen.chapterNight) {
    items.push({ id: 'night', tone: 'info', title: 'Chapter night is live', body: 'Open the stage.' });
  }
  return { visible: items.slice(0, 2), extra: Math.max(0, items.length - 2), all: items };
}

export const ELIGIBILITY_NOTE = 'Free tBard pays for actions. It never makes you eligible. Holding the character for 24h does.';

export const RELIC_NOTE = 'Relics just trade in Season 0. No comeback vote and no relic burns. Relic art is in this app only. The token image in wallets and explorers does not change.';

export const VOID_SHORT = {
  vrf: 'randomness failed',
  indexer: 'data outage',
  exploit: 'exploit'
};

export function voidCardLine(reason) {
  const short = VOID_SHORT[reason] || VOID_SHORT.vrf;
  return 'Voided · ' + short + ' · stakes returned · Train kept';
}

export const PREDICT_NOTE = 'A pick counts only if both the signed time and the server receipt are before the lock.';
