import { practiceDeck } from '../catalog.js';
import { deckError } from '../engine/adapter.js';
import type { Deck, GameAction, Stance } from '../types.js';

/** Shared by Express and the Worker so a request cannot mean two different actions. */
export function parseCreate(body: unknown): { decks: [Deck, Deck]; stance: Stance } | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const stance = parseStance(record.stance);
  const playerDeck = resolveDeck(record.playerDeck, record.playerDeckId);
  const opponentDeck = resolveDeck(record.opponentDeck, record.opponentDeckId);
  if (!stance || !playerDeck || !opponentDeck) return null;
  if (!copyLimited(playerDeck) || !copyLimited(opponentDeck)) return null;
  return { decks: [playerDeck, opponentDeck], stance };
}

export function parseAction(value: unknown): GameAction | null {
  if (!value || typeof value !== 'object') return null;
  const action = value as Record<string, unknown>;
  switch (action.type) {
    case 'mulligan': {
      if (!Array.isArray(action.idx) || action.idx.length > 10) return null;
      if (!action.idx.every((index) => Number.isInteger(index) && (index as number) >= 0 && (index as number) < 10)) return null;
      const idx = [...(action.idx as number[])].sort((a, b) => a - b);
      if (new Set(idx).size !== idx.length) return null;
      return { type: 'mulligan', idx };
    }
    case 'play': {
      const uid = asUid(action.uid);
      if (uid == null) return null;
      const page = action.page == null ? undefined : asPage(action.page);
      if (action.page != null && page == null) return null;
      const target = action.target == null ? undefined : asUid(action.target);
      if (action.target != null && target == null) return null;
      return { type: 'play', uid, page: page ?? undefined, target };
    }
    case 'champion': {
      const page = action.page == null ? undefined : asPage(action.page);
      if (action.page != null && page == null) return null;
      const target = action.target == null ? undefined : asUid(action.target);
      if (action.target != null && target == null) return null;
      return { type: 'champion', page: page ?? undefined, target };
    }
    case 'legend': {
      const target = asUid(action.target);
      if (target == null) return null;
      const target2 = action.target2 == null ? undefined : asUid(action.target2);
      if (action.target2 != null && target2 == null) return null;
      return { type: 'legend', target, target2 };
    }
    case 'fight':
      return { type: 'fight' };
    case 'attack': {
      const uid = asUid(action.uid);
      const target = asUid(action.target);
      if (uid == null || target == null) return null;
      return { type: 'attack', uid, target };
    }
    case 'move': {
      const uid = asUid(action.uid);
      if (uid == null) return null;
      return { type: 'move', uid };
    }
    case 'end':
      return { type: 'end' };
    default:
      return null;
  }
}

function parseStance(value: unknown): Stance | null {
  if (value == null) return 'balanced';
  if (value === 'aggressive' || value === 'balanced' || value === 'patient') return value;
  return null;
}

function resolveDeck(deck: unknown, deckId: unknown): Deck | null {
  if (typeof deckId === 'string' && deckId.length > 0) {
    return practiceDeck(deckId);
  }
  if (!deck || typeof deck !== 'object') return null;
  const record = deck as Record<string, unknown>;
  if (typeof record.house !== 'string' || record.house.length < 1 || record.house.length > 40) return null;
  if (typeof record.legendId !== 'string') return null;
  if (!Array.isArray(record.cards) || record.cards.length !== 20) return null;
  if (!record.cards.every((id) => typeof id === 'string' && id.length > 0 && id.length < 80)) return null;
  return { house: record.house, legendId: record.legendId, cards: record.cards as string[] };
}

function copyLimited(deck: Deck): boolean {
  return deckError(deck.house, deck.cards) == null;
}

function asUid(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 10_000 ? value : undefined;
}

function asPage(value: unknown): 0 | 1 | null {
  return value === 0 || value === 1 ? value : null;
}
