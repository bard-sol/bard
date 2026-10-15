import type { CardDef, Deck, LegendDef, PageDef } from '../types.js';

/**
 * Placeholder card pool for the stub engine.
 * Gameplay's 40-card set replaces this catalog. Every card here is public
 * information. Hidden information is which copies are in a hand, the shuffled
 * order, and the face-down identity of an opponent's Marginalia.
 */

export const CATALOG: Record<string, CardDef> = {
  wickling: {
    id: 'wickling',
    name: 'Wickling',
    type: 'character',
    house: 'candle',
    cost: 1,
    attack: 1,
    health: 2,
    keywords: [],
    text: 'A small flame that keeps the page.',
    glyph: 'flame',
    effect: null,
  },
  'lantern-bearer': {
    id: 'lantern-bearer',
    name: 'Lantern Bearer',
    type: 'character',
    house: 'candle',
    cost: 2,
    attack: 2,
    health: 3,
    keywords: ['Ward'],
    text: 'Ward. Ignores the first damage it takes.',
    glyph: 'lamp',
    effect: null,
  },
  'swift-acolyte': {
    id: 'swift-acolyte',
    name: 'Swift Acolyte',
    type: 'character',
    house: 'candle',
    cost: 1,
    attack: 2,
    health: 1,
    keywords: ['Swift'],
    text: 'Swift. Can attack the turn it is played.',
    glyph: 'spark',
    effect: null,
  },
  'choir-guard': {
    id: 'choir-guard',
    name: 'Choir Guard',
    type: 'character',
    house: 'candle',
    cost: 3,
    attack: 3,
    health: 4,
    keywords: [],
    text: 'Holds the aisle.',
    glyph: 'shield',
    effect: null,
  },
  'kindle-spark': {
    id: 'kindle-spark',
    name: 'Kindle Spark',
    type: 'inkwork',
    house: 'candle',
    cost: 1,
    attack: null,
    health: null,
    keywords: [],
    text: 'Deal 2 damage to a unit.',
    glyph: 'spark',
    effect: { kind: 'damage', amount: 2 },
  },
  'margin-psalm': {
    id: 'margin-psalm',
    name: 'Margin Psalm',
    type: 'marginalia',
    house: 'candle',
    cost: 1,
    attack: null,
    health: null,
    keywords: [],
    text: 'When an enemy attacks here, deal 2 to it first.',
    glyph: 'note',
    effect: { kind: 'trap', amount: 2 },
  },
  'ash-recruit': {
    id: 'ash-recruit',
    name: 'Ash Recruit',
    type: 'character',
    house: 'fold',
    cost: 1,
    attack: 1,
    health: 2,
    keywords: [],
    text: 'First into the aisle.',
    glyph: 'recruit',
    effect: null,
  },
  'fold-duelist': {
    id: 'fold-duelist',
    name: 'Fold Duelist',
    type: 'character',
    house: 'fold',
    cost: 1,
    attack: 2,
    health: 1,
    keywords: ['Swift'],
    text: 'Swift. Can attack the turn it is played.',
    glyph: 'blade',
    effect: null,
  },
  'riposte-squire': {
    id: 'riposte-squire',
    name: 'Riposte Squire',
    type: 'character',
    house: 'fold',
    cost: 2,
    attack: 2,
    health: 2,
    keywords: [],
    text: 'Answers steel with steel.',
    glyph: 'fox',
    effect: null,
  },
  'cleave-veteran': {
    id: 'cleave-veteran',
    name: 'Cleave Veteran',
    type: 'character',
    house: 'fold',
    cost: 3,
    attack: 3,
    health: 3,
    keywords: [],
    text: 'A wide cut across the page.',
    glyph: 'blade',
    effect: null,
  },
  'folding-cut': {
    id: 'folding-cut',
    name: 'Folding Cut',
    type: 'inkwork',
    house: 'fold',
    cost: 1,
    attack: null,
    health: null,
    keywords: [],
    text: 'Deal 2 damage to a unit.',
    glyph: 'blade',
    effect: { kind: 'damage', amount: 2 },
  },
  'margin-riposte': {
    id: 'margin-riposte',
    name: 'Margin Riposte',
    type: 'marginalia',
    house: 'fold',
    cost: 1,
    attack: null,
    health: null,
    keywords: [],
    text: 'When an enemy attacks here, deal 2 to it first.',
    glyph: 'note',
    effect: { kind: 'trap', amount: 2 },
  },
  'spare-ink': {
    id: 'spare-ink',
    name: 'Spare Ink',
    type: 'inkwork',
    house: 'neutral',
    cost: 0,
    attack: null,
    health: null,
    keywords: [],
    text: 'Gain 1 Ink this turn.',
    glyph: 'spark',
    effect: { kind: 'ink', amount: 1 },
  },
};

export const LEGENDS: Record<string, LegendDef> = {
  'old-wick': {
    id: 'old-wick',
    name: 'Old Wick',
    house: 'candle',
    powerName: 'Kindle',
    powerText: 'Restore 3 health to an ally.',
    powerCost: 2,
    power: { kind: 'heal', amount: 3 },
  },
  'ash-ember': {
    id: 'ash-ember',
    name: 'Ash & Ember',
    house: 'fold',
    powerName: 'Stir',
    powerText: 'An ally gets +1 attack.',
    powerCost: 2,
    power: { kind: 'buff', amount: 1 },
  },
};

export const PAGES: PageDef[] = [
  { id: 'candle-court', name: 'Candle Court', rule: 'Wax, brass, and a long quiet.' },
  { id: 'fold-gallery', name: 'Fold Gallery', rule: 'Blades rest along the railing.' },
  { id: 'tide-steps', name: 'Tide Steps', rule: 'The floor is always wet.' },
  { id: 'margin-alley', name: 'Margin Alley', rule: 'Notes crowd the gutter.' },
];

function deck(house: string, legendId: string, pairs: string[]): Deck {
  return { house, legendId, cards: pairs.flatMap((id) => [id, id]) };
}

/** Short practice decks so a 7-turn stub match can actually finish. */
export const PRACTICE_DECKS = {
  candle: deck('candle', 'old-wick', [
    'wickling',
    'lantern-bearer',
    'swift-acolyte',
    'choir-guard',
    'kindle-spark',
    'margin-psalm',
  ]),
  fold: deck('fold', 'ash-ember', [
    'ash-recruit',
    'fold-duelist',
    'riposte-squire',
    'cleave-veteran',
    'folding-cut',
    'margin-riposte',
  ]),
} as const;

export const PRACTICE_DECK_IDS = ['candle', 'fold'] as const;
export type PracticeDeckId = (typeof PRACTICE_DECK_IDS)[number];

export function practiceDeck(id: string): Deck | null {
  if (id === 'candle' || id === 'fold') {
    const deck = PRACTICE_DECKS[id];
    return { house: deck.house, legendId: deck.legendId, cards: deck.cards.slice() };
  }
  return null;
}
