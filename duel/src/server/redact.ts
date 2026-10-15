import { cardById } from '../../engine/active.mjs';
import type { PlayerId } from '../types.js';
import type { EngineState } from '../engine/state.js';
import type { MatchRecord } from './store.js';

const FORBIDDEN_KEYS = new Set(['seed', 'rng', 'deck', 'decks', 'deckA', 'deckB', 'tiebreak', 'players', 'state', 'log', 'setup']);

export class RedactionError extends Error {
  readonly code = 'redaction_failed' as const;
  constructor(readonly leaks: string[]) {
    super(`redaction_failed:${leaks.join('|')}`);
    this.name = 'RedactionError';
  }
}

/**
 * A client payload may contain the viewer's hand and every face-up unit.
 * It may not contain the seed, either deck order, the foe's hand, or the
 * identity of a face-down Marginalia the viewer does not own.
 */
export function assertClientSafe(payload: unknown, match: MatchRecord, viewer: PlayerId): void {
  const leaks = findLeaks(payload, match, viewer);
  if (leaks.length > 0) throw new RedactionError(leaks);
}

export function findLeaks(payload: unknown, match: MatchRecord, viewer: PlayerId): string[] {
  const leaks: string[] = [];
  if (hasForbiddenKey(payload)) leaks.push('forbidden_key');
  const state = match.state;
  const foe: PlayerId = viewer === 0 ? 1 : 0;
  const serialized = JSON.stringify(payload);
  const strings = collectStrings(payload);

  const publicIds = publicCardIds(state, viewer);
  for (const card of state.players[foe].hand) hide(card.id, publicIds, strings, serialized, leaks, 'hand');
  for (const card of state.players[foe].deck) hide(card.id, publicIds, strings, serialized, leaks, 'deck');
  for (const trap of state.traps) {
    if (trap.owner === viewer) continue;
    hide(trap.id, publicIds, strings, serialized, leaks, 'note');
    if (strings.includes(String(trap.uid))) leaks.push(`note-uid:${trap.uid}`);
  }

  for (const player of state.players) {
    const order = player.deck.map((card) => card.id);
    if (order.length >= 2 && serialized.includes(JSON.stringify(order))) leaks.push('deck_order');
    for (const card of player.deck) {
      if (strings.includes(String(card.uid))) leaks.push(`deck-uid:${card.uid}`);
    }
  }
  const foeHand = state.players[foe].hand.map((card) => card.id);
  if (foeHand.length >= 2 && serialized.includes(JSON.stringify(foeHand))) leaks.push('foe_hand');
  for (const card of state.players[foe].hand) {
    if (!publicIds.has(card.id) && strings.includes(String(card.uid))) leaks.push(`hand-uid:${card.uid}`);
  }

  if (walkSealedNotes(payload)) leaks.push('sealed_note');
  return leaks;
}

function hide(id: string, publicIds: Set<string>, strings: string[], serialized: string, leaks: string[], kind: string): void {
  if (publicIds.has(id)) return;
  const card = cardById(id);
  if (strings.includes(id)) leaks.push(`${kind}:${id}`);
  if (card.name && serialized.includes(card.name)) leaks.push(`${kind}:${card.name}`);
  if (card.text && card.text.length > 12 && serialized.includes(card.text)) leaks.push(`${kind}:text`);
}

function publicCardIds(state: EngineState, viewer: PlayerId): Set<string> {
  const ids = new Set<string>();
  for (const page of state.board) {
    for (const side of page) {
      for (const unit of side) ids.add(unit.id);
    }
  }
  for (const card of state.players[viewer].hand) ids.add(card.id);
  if (state.players[viewer].champion) ids.add(state.players[viewer].champion);
  for (const trap of state.traps) if (trap.owner === viewer) ids.add(trap.id);
  for (const entry of state.log) {
    if (entry.e === 'trap_reveal' && typeof entry.id === 'string') ids.add(entry.id);
    if (entry.e === 'death' && typeof entry.id === 'string') ids.add(entry.id);
    if (entry.e === 'enter' && typeof entry.id === 'string') ids.add(entry.id);
    if (entry.e === 'play' && typeof entry.id === 'string') {
      const owner = entry.p;
      const card = cardById(entry.id);
      if (owner === viewer || card.type !== 'marginalia') ids.add(entry.id);
    }
  }
  for (const pageId of state.pages) ids.add(pageId);
  ids.add(state.players[0].legend);
  ids.add(state.players[1].legend);
  return ids;
}

function walkSealedNotes(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => walkSealedNotes(item));
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.faceDown === true && record.known === false) {
    if (typeof record.name === 'string' || typeof record.text === 'string' || typeof record.defId === 'string') return true;
  }
  return Object.values(record).some((child) => walkSealedNotes(child));
}

function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => hasForbiddenKey(item));
  if (!value || typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKey(child)) return true;
  }
  return false;
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) collectStrings(child, out);
  }
  return out;
}
