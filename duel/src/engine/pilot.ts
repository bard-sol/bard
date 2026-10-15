// @ts-nocheck — fixture-only pilot. Production matches use pilots.mjs v1.
import type { GameAction, GameState, PlayerView, Stance, UnitView } from '../types.js';
import { hashString, stableStringify } from './rng.js';
import { actorOf, legalActions, view } from './stub.js';

/**
 * Stub pilot. Deterministic: the same state, stance, and seed always pick the
 * same action. It scores from its own redacted view, so it does not read the
 * opponent's hand, deck order, or face-down Marginalia identity.
 * Gameplay's pilot v1 replaces this function behind the adapter.
 */
export function pilot(state: GameState, stance: Stance, seed: string): GameAction {
  const actor = actorOf(state);
  if (actor == null) throw new Error('pilot called with no actor');
  const seen = view(state, actor);
  if (seen.phase === 'mulligan') {
    const threshold = stance === 'aggressive' ? 3 : 4;
    const replace = seen.hand
      .filter((card) => card.defId !== 'spare-ink' && card.cost >= threshold)
      .map((card) => card.instanceId);
    return { type: 'mulligan', replace };
  }

  const actions = legalActions(state, actor);
  const first = actions[0];
  if (!first) throw new Error('pilot has no legal action');

  let best = first;
  let bestScore = scoreAction(seen, first, stance);
  let bestKey = stableStringify(first);
  let bestTie = hashString(`${seed}:${bestKey}`);

  for (let i = 1; i < actions.length; i++) {
    const action = actions[i]!;
    const score = scoreAction(seen, action, stance);
    const key = stableStringify(action);
    const tie = hashString(`${seed}:${key}`);
    if (score > bestScore || (score === bestScore && (tie < bestTie || (tie === bestTie && key < bestKey)))) {
      best = action;
      bestScore = score;
      bestKey = key;
      bestTie = tie;
    }
  }
  return best;
}

function scoreAction(seen: PlayerView, action: GameAction, stance: Stance): number {
  switch (action.type) {
    case 'mulligan':
      return action.replace.length === 0 ? 1 : 0;
    case 'end_turn':
      return 10;
    case 'end_main':
      return Math.max(0, bestFightScore(seen, stance) - 1);
    case 'play_character':
      return scoreCharacter(seen, action.instanceId, action.page);
    case 'play_inkwork':
      return scoreInkwork(seen, action.instanceId, action.targetId);
    case 'play_marginalia':
      return scoreMarginalia(seen, action.page, stance);
    case 'legend_power':
      return scorePower(seen, action.targetId);
    case 'attack':
      return scoreAttack(seen, action.attackerId, action.defenderId, stance);
    case 'move':
      return scoreMove(seen, action.page, stance);
    default:
      return -1;
  }
}

function scoreCharacter(seen: PlayerView, instanceId: string, page: 0 | 1): number {
  const card = seen.hand.find((candidate) => candidate.instanceId === instanceId);
  if (!card) return -1;
  let score = 240;
  if (card.cost === seen.ink) score += 25;
  else if (card.cost + 1 === seen.ink) score += 10;
  const battlefield = seen.pages[page];
  const foes = battlefield.slots.filter((slot) => slot.foe).length;
  const friends = battlefield.slots.filter((slot) => slot.you).length;
  if (foes > 0) score += 15;
  if (friends === 0) score += 12;
  if (card.keywords.includes('Swift') && foes > 0) score += 30;
  return score;
}

function scoreInkwork(seen: PlayerView, instanceId: string, targetId: string | null): number {
  if (targetId == null) return 210;
  const card = seen.hand.find((candidate) => candidate.instanceId === instanceId);
  const target = units(seen).find((unit) => unit.instanceId === targetId);
  if (!card || !target) return -1;
  if (target.warded) return 35;
  if (target.health <= 2) return target.owner === seen.you ? 20 : 260;
  return target.owner === seen.you ? 5 : 40;
}

function scoreMarginalia(seen: PlayerView, page: 0 | 1, stance: Stance): number {
  const battlefield = seen.pages[page];
  const friends = battlefield.slots.filter((slot) => slot.you).length;
  const base = stance === 'patient' ? 230 : stance === 'balanced' ? 170 : 90;
  return base + (friends > 0 ? 15 : 0);
}

function scorePower(seen: PlayerView, targetId: string): number {
  const target = units(seen).find((unit) => unit.instanceId === targetId);
  if (!target) return -1;
  if (seen.youLegend.id === 'old-wick') {
    const missing = target.maxHealth - target.health;
    return missing > 0 ? 150 + missing * 15 : 5;
  }
  const contested = seen.pages[target.page].slots.some((slot) => slot.foe);
  return contested ? 165 : 30;
}

function scoreAttack(seen: PlayerView, attackerId: string, defenderId: string, stance: Stance): number {
  const friend = units(seen).find((unit) => unit.instanceId === attackerId);
  const foe = units(seen).find((unit) => unit.instanceId === defenderId);
  if (!friend || !foe) return -1;
  return attackValue(seen, friend, foe, stance);
}

function scoreMove(seen: PlayerView, page: 0 | 1, stance: Stance): number {
  const dest = seen.pages[page];
  const friends = dest.slots.filter((slot) => slot.you).length;
  const foes = dest.slots.filter((slot) => slot.foe).length;
  if (friends === 0 && foes === 0) return stance === 'aggressive' ? 100 : stance === 'balanced' ? 55 : 20;
  if (foes > 0 && friends === 0) return stance === 'aggressive' ? 75 : 20;
  return 5;
}

function bestFightScore(seen: PlayerView, stance: Stance): number {
  let best = 0;
  for (const friend of units(seen)) {
    if (friend.owner !== seen.you || friend.exhausted) continue;
    for (const foe of units(seen)) {
      if (foe.owner === seen.you || foe.page !== friend.page) continue;
      best = Math.max(best, attackValue(seen, friend, foe, stance));
    }
    best = Math.max(best, scoreMove(seen, friend.page === 0 ? 1 : 0, stance));
  }
  return best;
}

function attackValue(seen: PlayerView, friend: UnitView, foe: UnitView, stance: Stance): number {
  const notes = seen.pages[friend.page].marginalia.some((note) => note.owner !== seen.you && note.faceDown);
  const kill = !foe.warded && friend.attack >= foe.health;
  const die = !friend.warded && foe.attack >= friend.health;
  let score = 15;
  if (kill && !die) score = 220;
  else if (kill) score = stance === 'patient' ? 45 : 155;
  else if (!die) score = stance === 'aggressive' ? 120 : 75;
  else if (stance === 'aggressive') score = 85;
  if (notes && !kill) score -= stance === 'aggressive' ? 15 : 80;
  return score;
}

function units(seen: PlayerView): UnitView[] {
  const found: UnitView[] = [];
  for (const page of seen.pages) {
    for (const slot of page.slots) {
      if (slot.you) found.push(slot.you);
      if (slot.foe) found.push(slot.foe);
    }
  }
  return found;
}
