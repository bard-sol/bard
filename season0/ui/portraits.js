/** Identity-colour busts. The glyph is the second identifier, never colour alone. */

const BODY = {
  block: '<rect x="14" y="28" width="36" height="22" rx="3"/>',
  needle: '<rect x="28" y="24" width="8" height="28" rx="2"/>',
  hourglass: '<path d="M20 26h24l-10 10 10 12H20l10-12z"/>',
  round: '<circle cx="32" cy="40" r="14"/>',
  hunched: '<path d="M16 48c4-16 10-20 16-20s12 6 16 20"/>',
  banner: '<rect x="30" y="24" width="4" height="28"/><path d="M34 26h16l-4 6 4 6H34"/>',
  low: '<ellipse cx="32" cy="44" rx="20" ry="10"/>',
  split: '<path d="M32 24v28M18 32h14v16H18zM32 28h14v20H32z"/>'
};

export function bustSvg(character, size) {
  const px = size || 64;
  const fill = character.color;
  const body = BODY[character.silhouette] || BODY.block;
  return (
    '<svg class="bust" viewBox="0 0 64 64" width="' + px + '" height="' + px + '" role="img" aria-label="' + character.name + '">' +
    '<circle cx="32" cy="32" r="30" fill="#121217" stroke="' + fill + '" stroke-width="3"/>' +
    '<g fill="' + fill + '">' + body + '</g>' +
    '<text x="32" y="18" text-anchor="middle" font-size="11" fill="' + fill + '">' + character.glyph + '</text>' +
    '</svg>'
  );
}
