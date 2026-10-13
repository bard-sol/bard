/** Human-written chapter text. Not generated at runtime. */
export const CHAPTERS = [
  {
    n: 1,
    title: 'The Unfinished Margin',
    bard: 'Chapter one. Eight of you, and only one page left. Try to look calm.',
    scene: 'The margin of the book is still wet. Something in the ink is already choosing.',
    choices: [
      { id: 'hold', label: 'Hold the margin', stat: 'STR', risk: 'SAFE' },
      { id: 'slip', label: 'Slip through a footnote', stat: 'CUN', risk: 'NORMAL' },
      { id: 'ask', label: 'Ask the readers to look', stat: 'CHA', risk: 'BOLD' }
    ]
  },
  {
    n: 2,
    title: 'The Ink Tide',
    bard: 'The tide is in. It does not care who you were on the previous page.',
    scene: 'A black tide climbs the page. It takes colour first.',
    choices: [
      { id: 'brace', label: 'Brace and take it', stat: 'STR', risk: 'BOLD' },
      { id: 'read', label: 'Read the current', stat: 'CUN', risk: 'SAFE' },
      { id: 'sing', label: 'Sing until it stills', stat: 'CHA', risk: 'NORMAL' }
    ]
  },
  {
    n: 3,
    title: 'The Closed Folio',
    bard: 'Two of you are wobbling. Good. The ink is listening.',
    scene: 'A folio slams shut on the path. The clasp is a riddle, a weight, or a favour.',
    choices: [
      { id: 'force', label: 'Force the clasp', stat: 'STR', risk: 'NORMAL' },
      { id: 'pick', label: 'Pick the riddle', stat: 'CUN', risk: 'BOLD' },
      { id: 'charm', label: 'Charm it open', stat: 'CHA', risk: 'SAFE' }
    ]
  },
  {
    n: 4,
    title: 'Names in the Gutter',
    bard: 'Someone wrote a name that is not theirs. I will not say whose.',
    scene: 'Names appear in the gutter of the page. One of them is a lie.',
    choices: [
      { id: 'strike', label: 'Strike the false name out', stat: 'STR', risk: 'SAFE' },
      { id: 'forge', label: 'Forge a better one', stat: 'CUN', risk: 'NORMAL' },
      { id: 'claim', label: 'Claim the name aloud', stat: 'CHA', risk: 'BOLD' }
    ]
  },
  {
    n: 5,
    title: 'The Candle Gallery',
    bard: 'Count the candles. One goes out for each of you who looks away.',
    scene: 'A gallery of candles. The draught knows who is afraid.',
    choices: [
      { id: 'shield', label: 'Shield the flames', stat: 'STR', risk: 'NORMAL' },
      { id: 'map', label: 'Map the draught', stat: 'CUN', risk: 'SAFE' },
      { id: 'story', label: 'Tell them a story', stat: 'CHA', risk: 'BOLD' }
    ]
  },
  {
    n: 6,
    title: 'The Torn Banner',
    bard: 'Almost the last page. Almost is where people get careless.',
    scene: 'A banner tears down the middle of the chapter. Both halves still claim the pole.',
    choices: [
      { id: 'plant', label: 'Plant the pole', stat: 'STR', risk: 'BOLD' },
      { id: 'stitch', label: 'Stitch it in secret', stat: 'CUN', risk: 'NORMAL' },
      { id: 'rally', label: 'Rally both halves', stat: 'CHA', risk: 'SAFE' }
    ]
  },
  {
    n: 7,
    title: 'The Last Page',
    bard: 'This is the page. I do not get a vote. You do.',
    scene: 'One blank page. The ink is waiting for a single name.',
    choices: [
      { id: 'stand', label: 'Stand on the page', stat: 'STR', risk: 'NORMAL' },
      { id: 'edit', label: 'Edit the last line', stat: 'CUN', risk: 'BOLD' },
      { id: 'speak', label: 'Speak the name', stat: 'CHA', risk: 'SAFE' }
    ]
  }
];

export function chapterByNumber(n) {
  return CHAPTERS.find((c) => c.n === n) || null;
}
