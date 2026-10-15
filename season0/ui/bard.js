/** Narration faces for the starry Bard. Calm is the default. */

export const BARD_MOODS = ['calm', 'smug', 'ominous', 'delighted'];

export function bardAvatarSrc(mood) {
  const name = BARD_MOODS.includes(mood) ? mood : 'calm';
  return '/play/assets/avatars/bard/' + name + '.webp';
}

/**
 * calm: ordinary chapters.
 * smug: results and chapter night.
 * ominous: the shortlist, the Reaper, and a taken moment.
 * delighted: a revival, or the season won.
 */
export function bardMood(screen) {
  if (!screen) return 'calm';
  if (screen.voided) return 'ominous';
  if (screen.phase === 'ended' || screen.revivalOpen || screen.phase === 'P8') return 'delighted';
  if (screen.phase === 'P7' || screen.chapterNight) return 'smug';
  if (
    screen.phase === 'P2' ||
    screen.phase === 'P3' ||
    screen.phase === 'P4' ||
    screen.phase === 'P5' ||
    screen.phase === 'P6' ||
    screen.marked
  ) return 'ominous';
  return 'calm';
}

const NIGHT_MOODS = ['ominous', 'smug', 'smug', 'smug', 'ominous', 'ominous', 'delighted', 'smug'];

export function bardNightMood(index, voided) {
  if (voided) return 'ominous';
  const n = Number(index) || 0;
  return NIGHT_MOODS[n] || 'smug';
}
