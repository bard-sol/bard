/** Nightly narration at 22:00 GST (18:00 UTC). Crowd votes do not change the score. */

export const CROWD_OPTIONS = [
  { id: 'mercy', line: 'The margin asked for mercy.' },
  { id: 'ink', line: 'The ink was already sure.' },
  { id: 'page', line: 'Turn it and do not look back.' }
];

export function recapOpen(nowMs) {
  const date = new Date(nowMs);
  return date.getUTCHours() > 18 || (date.getUTCHours() === 18 && date.getUTCMinutes() >= 0);
}

export function buildRecap({ chapter, nowMs, crowdLine }) {
  const open = recapOpen(nowMs);
  return {
    chapter,
    open,
    at: '22:00 GST',
    affectsScore: false,
    narrationOnly: true,
    line: open
      ? 'Chapter ' + chapter + ' closes its evening. ' + (crowdLine || 'The crowd has not spoken yet.')
      : 'The recap opens at 22:00 GST.'
  };
}

export function castCrowdVote({ already, optionId }) {
  const option = CROWD_OPTIONS.find((row) => row.id === optionId);
  if (!option) return { ok: false, reason: 'bad_option' };
  if (already) return { ok: false, reason: 'already' };
  return { ok: true, option, narrationOnly: true, affectsScore: false, legacyPoints: 1 };
}
