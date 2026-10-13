import { defaultConfig } from './config.js';

export function chapterStartMs(config, chapter) {
  const cfg = config || defaultConfig();
  const start = Date.parse(cfg.season_start_utc);
  return start + (chapter - 1) * cfg.chapter_len_s * 1000;
}

export function chapterCloseMs(config, chapter) {
  const cfg = config || defaultConfig();
  return chapterStartMs(cfg, chapter) + cfg.chapter_len_s * 1000;
}

/**
 * Time-based phase for the chapter that contains `now`.
 * P5–P8 depend on VRF / mark and are layered by overlayPhase.
 */
export function phaseAt(nowMs, config) {
  const cfg = config || defaultConfig();
  const start = Date.parse(cfg.season_start_utc);
  const pre = start - cfg.preseason_buy_s * 1000;
  if (nowMs < pre) {
    return { phase: 'announced', chapter: 1, t0: start, seasonStart: start };
  }
  if (nowMs < start) {
    return { phase: 'P0', chapter: 1, t0: start, seasonStart: start, preseasonOpens: pre };
  }
  const len = cfg.chapter_len_s * 1000;
  let n = Math.floor((nowMs - start) / len) + 1;
  if (n > cfg.chapters) {
    return { phase: 'ended', chapter: cfg.chapters, t0: chapterStartMs(cfg, cfg.chapters), seasonStart: start };
  }
  const t0 = chapterStartMs(cfg, n);
  const dt = (nowMs - t0) / 1000;
  let phase = 'P1';
  if (dt >= cfg.chapter_len_s) phase = 'P1';
  else if (dt >= cfg.chapter_len_s - cfg.final_window_s) phase = 'P4';
  else if (dt >= cfg.decide_close_s) phase = 'P3';
  else if (dt >= cfg.shortlist_s) phase = 'P2';
  return {
    phase,
    chapter: n,
    t0,
    dt,
    seasonStart: start,
    windowStart: t0 + (cfg.chapter_len_s - cfg.final_window_s) * 1000,
    windowClose: t0 + cfg.chapter_len_s * 1000,
    predictLock: t0 + cfg.predict_lock_s * 1000,
    decideClose: t0 + cfg.decide_close_s * 1000
  };
}

/**
 * After the window closes, the hidden snapshot is still unknown until VRF.
 * overlay: { marked, markedAt, vrfPending, revivalOpen, chapterNight }
 */
export function overlayPhase(base, nowMs, chapterState, config) {
  const cfg = config || defaultConfig();
  const close = chapterCloseMs(cfg, base.chapter);
  const night = close + cfg.chapter_night_s * 1000;
  const state = chapterState || {};
  const layers = [];
  if (state.voided) layers.push('voided');
  if (nowMs >= close && nowMs < night && !state.marked && !state.voided) layers.push('P5');
  if (state.marked && !state.voided) layers.push('P6');
  if (nowMs >= night && !state.voided) layers.push('P7');
  if (state.revivalOpen && !state.voided) layers.push('P8');
  return { ...base, layers, primary: layers[0] || base.phase };
}

export function reaperHeader(phase, msLeft) {
  if (phase === 'P4') {
    return {
      title: 'The Reaper walks · window closes in ' + formatDuration(msLeft),
      footnote: 'Act before the Reaper. Nobody knows when that is. Actions after the hidden snapshot may not count.'
    };
  }
  if (phase === 'P5') {
    return {
      title: 'The page is turning…',
      footnote: 'The snapshot was hidden inside the window. Actions after it may not count.'
    };
  }
  return null;
}

export function formatDuration(ms) {
  let s = Math.max(0, Math.floor(Number(ms) / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  const sec = s % 60;
  return m + 'm ' + sec + 's';
}
