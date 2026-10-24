import { cardById, LEGENDS, STARTERS } from '../engine/active.mjs';
import type { Deck } from './types.js';

/** Practice houses. The 20-card lists live in the pinned cards module. */
export const PRACTICE_DECK_IDS = ['candle', 'fold', 'tidewrack'] as const;
export type PracticeDeckId = (typeof PRACTICE_DECK_IDS)[number];

export function practiceDeck(id: string): Deck | null {
  const cards = STARTERS[id];
  const legend = LEGENDS[id];
  if (!cards || !legend) return null;
  return { house: id, legendId: legend.id, cards: cards.slice() };
}

export function cardName(id: string): string | null {
  try {
    return cardById(id).name;
  } catch {
    return null;
  }
}

export function cardText(id: string): string | null {
  try {
    return cardById(id).text;
  } catch {
    return null;
  }
}
