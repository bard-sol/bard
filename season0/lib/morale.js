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

/**
 * Letter, Trial, cheer, or crowd vote. The first touch of the UTC day
 * advances the streak. Repair is never for sale.
 */
export function advanceStreak(state, nowMs) {
  const current = state || {};
  const result = applyCheer({
    lastDay: current.lastDay,
    streak: current.streak,
    shields: current.shields,
    nowMs
  });
  if (!result.ok && result.reason === 'already') {
    return {
      lastDay: current.lastDay,
      streak: result.streak,
      shields: result.shields,
      advanced: false,
      day: result.day,
      repairPurchasable: false,
      activeForScore: false
    };
  }
  return {
    lastDay: result.day,
    streak: result.streak,
    shields: result.shields,
    advanced: true,
    day: result.day,
    repairPurchasable: false,
    activeForScore: false
  };
}
