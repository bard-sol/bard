/** Cel-shaded cast. Four drawn states, not overlays. Relics use the taken portrait. */

const STATE = {
  alive: 'safe',
  safe: 'safe',
  danger: 'danger',
  relic: 'taken',
  dead: 'taken',
  taken: 'taken',
  revived: 'revived'
};

export function portraitState(state) {
  return STATE[state] || 'safe';
}

export function portraitSrc(id, state) {
  return '/play/assets/avatars/' + id + '-' + portraitState(state) + '.webp';
}

export function heroSrc(id, state) {
  const key = portraitState(state);
  if (key === 'safe') return '/play/assets/hero/' + id + '.webp';
  return '/play/assets/hero/' + id + '-' + key + '.webp';
}

export function bustSvg(character, size, state) {
  const px = size || 64;
  const src = portraitSrc(character.id, state);
  const relic = state === 'relic' || state === 'taken';
  const cls = 'bust' + (relic ? ' relic' : state === 'danger' ? ' danger' : '');
  return '<img class="' + cls + '" src="' + src + '" width="' + px + '" height="' + px + '" alt="' +
    character.name + (relic ? ', relic' : '') + '">';
}
