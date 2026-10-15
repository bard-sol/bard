/** The Last Page. Bard narrates and is never a contestant. */
export const CAST = [
  {
    id: 'grenna', symbol: 'GRE', name: 'Grenna Ironvow', archetype: 'The Brawler',
    stats: { STR: 75, CUN: 30, CHA: 45, LCK: 50 }, signature: 'STR', weak: 'CUN',
    glyph: '▲', color: '#D55E00', text: '#F07A2E',
    hook: 'An ex-champion of the pit, fighting onto the Last Page to pay a debt she will not name.',
    voice: "I've been knocked down by better pages than this one.",
    fallback: 'Tell them the debt is paid. The page can have the rest.',
    silhouette: 'block',
    cosmetics: [
      { id: 'sash', title: 'Red sash' },
      { id: 'chain', title: 'Wrapped chain' },
      { id: 'wrap', title: 'Pit champion wrap' }
    ]
  },
  {
    id: 'silas', symbol: 'SIL', name: 'Silas Quill', archetype: 'The Schemer',
    stats: { STR: 30, CUN: 80, CHA: 50, LCK: 40 }, signature: 'CUN', weak: 'STR',
    glyph: '◆', color: '#009E73', text: '#19B88A',
    hook: "A court scribe who forged a king's will, and has been editing his own story ever since.",
    voice: 'Every ending is a draft, darling. I simply hold the pen.',
    fallback: 'Leave the draft. I already rewrote the ending.',
    silhouette: 'needle',
    cosmetics: [
      { id: 'mask', title: 'Ink half-mask' },
      { id: 'quill', title: 'Snapped quill' },
      { id: 'glove', title: 'Stained glove' }
    ]
  },
  {
    id: 'marrow', symbol: 'MAR', name: 'Lady Marrow', archetype: 'The Darling',
    stats: { STR: 30, CUN: 45, CHA: 80, LCK: 45 }, signature: 'CHA', weak: 'STR',
    glyph: '●', color: '#F0E442', text: '#F0E442',
    hook: "Vellum's beloved hostess. Guests adore her. Some of them are never seen again.",
    voice: "Oh, you're too kind. Do remember that I remember.",
    fallback: 'Be kind to the next guest. I always was.',
    silhouette: 'hourglass',
    cosmetics: [
      { id: 'fan', title: 'Ivory fan' },
      { id: 'ruff', title: 'High ruff' },
      { id: 'ribbon', title: 'Pale ribbon' }
    ]
  },
  {
    id: 'pip', symbol: 'PIP', name: 'Pip Fennick', archetype: 'The Lucky Fool',
    stats: { STR: 35, CUN: 40, CHA: 45, LCK: 80 }, signature: 'LCK', weak: 'STR',
    glyph: '✦', color: '#56B4E9', text: '#56B4E9',
    hook: 'He has survived three shipwrecks, a hanging and a dragon, every one by accident.',
    voice: "Heads I live, tails I… hang on, it's still in the air.",
    fallback: 'Heads I lived. I suppose the coin finally landed.',
    silhouette: 'round',
    cosmetics: [
      { id: 'coin', title: 'Lucky coin' },
      { id: 'coat', title: 'Patched coat' },
      { id: 'hat', title: 'Too-big tricorn' }
    ]
  },
  {
    id: 'wick', symbol: 'WIK', name: 'Old Wick', archetype: 'The Mystic',
    stats: { STR: 25, CUN: 65, CHA: 40, LCK: 70 }, signature: 'LCK', weak: 'STR',
    glyph: '☾', color: '#CC79A7', text: '#CC79A7',
    hook: 'A hermit who swears he has already read the Last Page, and will not say whose name is on it.',
    voice: "I've seen how this ends. Shall I spoil it? No. You'd only argue.",
    fallback: 'I told you I had seen this. You argued anyway.',
    silhouette: 'hunched',
    cosmetics: [
      { id: 'candle', title: 'Candle crown' },
      { id: 'staff', title: 'Crooked staff' },
      { id: 'wax', title: 'Gold wax seam' }
    ]
  },
  {
    id: 'vey', symbol: 'VEY', name: 'Captain Vey', archetype: 'The Leader',
    stats: { STR: 55, CUN: 50, CHA: 70, LCK: 25 }, signature: 'CHA', weak: 'LCK',
    glyph: '■', color: '#0072B2', text: '#4C9BE0',
    hook: 'A disgraced officer marching alone, determined to win back the soldiers she lost.',
    voice: "Fall in behind me. I've lost a war before. I won't lose you.",
    fallback: "Hold the line. I'll find you in the margin.",
    silhouette: 'banner',
    cosmetics: [
      { id: 'banner', title: 'Torn banner' },
      { id: 'coat', title: 'Tattered greatcoat' },
      { id: 'button', title: 'Tarnished button' }
    ]
  },
  {
    id: 'thorn', symbol: 'THO', name: 'Thorn', archetype: 'The Feral',
    stats: { STR: 70, CUN: 55, CHA: 25, LCK: 50 }, signature: 'STR', weak: 'CHA',
    glyph: '✕', color: '#E69F00', text: '#E69F00',
    hook: "Raised by wolves in the book's torn margins. Thorn trusts no reader.",
    voice: "Feed me, don't pet me.",
    fallback: "Don't follow. The ink is warm. That's enough.",
    silhouette: 'low',
    cosmetics: [
      { id: 'bone', title: 'Bone charm' },
      { id: 'mane', title: 'Ochre mane' },
      { id: 'cord', title: 'Knotted cord' }
    ]
  },
  {
    id: 'twins', symbol: 'TWN', name: 'Ash & Ember', archetype: 'The Twins',
    stats: { STR: 50, CUN: 50, CHA: 50, LCK: 50 }, signature: null, weak: null,
    glyph: '◐', color: '#E8E1D0', text: '#E8E1D0',
    hook: 'Two siblings, one token and one vote, and they have never agreed on anything.',
    voice: "We'll take the safe road. / We'll take the fun one.",
    fallback: 'We took the road. We took it together.',
    silhouette: 'split',
    cosmetics: [
      { id: 'coat', title: "Ash's long coat" },
      { id: 'hood', title: "Ember's hood" },
      { id: 'spark', title: 'Shared spark' }
    ]
  }
];

export function characterById(id) {
  return CAST.find((c) => c.id === id) || null;
}

export function statTotal(c) {
  const s = c.stats;
  return s.STR + s.CUN + s.CHA + s.LCK;
}
