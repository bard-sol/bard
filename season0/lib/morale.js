const DAY = 86400000;

export function utcDay(ms) {
  return Math.floor(Number(ms) / DAY);
}

/**
 * One cheer per UTC day. A missed day consumes one shield (streak held, not
 * increased) or breaks the streak. Shields are earned at 7, 14 and 21, max 2.
 * Cheering never counts as active for turnout.
 */
export function applyCheer({ lastDay, streak, shields, nowMs }) {
  const today = utcDay(nowMs);
  let s = streak || 0;
  let sh = shields || 0;
  if (lastDay == null) {
    s = 1;
  } else if (today === lastDay) {
    return { ok: false, reason: 'already', streak: s, shields: sh, day: today };
  } else if (today === lastDay + 1) {
    s += 1;
  } else {
    let missed = today - lastDay - 1;
    while (missed > 0 && sh > 0) {
      sh -= 1;
      missed -= 1;
    }
    if (missed > 0) s = 1;
    else s += 1;
  }
  if (s > 0 && s % 7 === 0 && sh < 2) sh += 1;
  return { ok: true, streak: s, shields: sh, day: today, activeForScore: false };
}

export function msUntilUtcReset(nowMs) {
  const next = (utcDay(nowMs) + 1) * DAY;
  return next - nowMs;
}
