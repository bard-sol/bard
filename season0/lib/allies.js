/** Margin-figure allies. A character's fans vote two in each chapter. No fee, no payout. */

import { CAST } from './cast.js';
import { contributionPoints } from './contribution.js';
import { asEntity } from './entity.js';
import { applyVoteCap } from './vote.js';

const HOLD_MS = 24 * 3600 * 1000;
const PENALTY_NUMBERS = ['deal', 'block', 'next', 'hex', 'rally', 'bossCut', 'bonusIfBlock'];

const FIGURES = [
  { entity_id: 'mouse', name: 'Margin Mouse', blurb: 'Lives in the white space and steals a page.', glyph: 'M', color: '#c9a46a', card: { cost: 0, type: 'skill', stat: 'CUN', draw: 1, setup: true, emoji: '🐭', text: 'Draw 1 card.' } },
  { entity_id: 'moth', name: 'Ink Moth', blurb: 'Eats the wet ink before it dries.', glyph: 'I', color: '#7d6bff', card: { cost: 1, type: 'attack', stat: 'STR', deal: 5, emoji: '🦋', text: 'Deal 5.' } },
  { entity_id: 'imp', name: 'Footnote Imp', blurb: 'Hides in the small print.', glyph: 'F', color: '#56b4e9', card: { cost: 1, type: 'block', stat: 'CHA', block: 5, emoji: '📎', text: 'Gain 5 block.' } },
  { entity_id: 'scribe', name: 'Gutter Scribe', blurb: 'Writes the line you meant to write.', glyph: 'G', color: '#19b88a', card: { cost: 1, type: 'skill', stat: 'CUN', next: 4, emoji: '✒️', text: 'Next attack this turn deals +4.' } },
  { entity_id: 'wisp', name: 'Ribbon Wisp', blurb: 'A bookmark that learned to flutter.', glyph: 'R', color: '#f0e442', card: { cost: 1, type: 'skill', stat: 'CHA', block: 4, emoji: '🎀', text: 'Gain 4 block.' } },
  { entity_id: 'candle', name: 'Candle Moth', blurb: 'Burns a hole in the villain\'s margin.', glyph: 'C', color: '#e07a3d', card: { cost: 1, type: 'skill', stat: 'LCK', hex: 2, emoji: '🕯️', text: 'Boss takes 2 damage at each turn end.' } },
  { entity_id: 'binder', name: 'Binding Imp', blurb: 'Closes the book on one good swing.', glyph: 'B', color: '#d55e00', card: { cost: 2, type: 'attack', stat: 'STR', deal: 8, emoji: '📚', text: 'Deal 8.' } },
  { entity_id: 'sprite', name: 'Quill Sprite', blurb: 'A nib with opinions.', glyph: 'Q', color: '#f07a2e', card: { cost: 1, type: 'attack', stat: 'STR', deal: 4, emoji: '🪶', text: 'Deal 4.' } },
  { entity_id: 'lantern', name: 'Lantern Boy', blurb: 'Keeps one card lit for the next page.', glyph: 'L', color: '#f2c14e', card: { cost: 0, type: 'skill', stat: 'LCK', keep: true, emoji: '🏮', text: 'Keep one card in hand for next turn.' } },
  { entity_id: 'cat', name: 'Margin Cat', blurb: 'Knocks the inkwell toward the fight.', glyph: 'K', color: '#e8a0bf', card: { cost: 1, type: 'attack', stat: 'STR', deal: 6, emoji: '🐱', text: 'Deal 6.' } },
  { entity_id: 'jacket', name: 'Dust Jacket', blurb: 'Wraps the reader before the blow lands.', glyph: 'D', color: '#8d99ae', card: { cost: 1, type: 'block', stat: 'CUN', block: 4, emoji: '📘', text: 'Gain 4 block.' } },
  { entity_id: 'errata', name: 'Errata Imp', blurb: 'Crosses out a bit of the boss\'s swing.', glyph: 'E', color: '#009e73', card: { cost: 1, type: 'skill', stat: 'CUN', bossCut: 3, emoji: '✂️', text: 'Boss deals −3 damage this turn.' } }
];

function figureRecord(row) {
  const entity = asEntity({ entity_id: row.entity_id, entity_type: 'ally' });
  return {
    entity_id: entity.entity_id,
    entity_type: entity.entity_type,
    ghost: false,
    name: row.name,
    blurb: row.blurb,
    art: '/play/assets/allies/' + row.entity_id + '.svg',
    placeholder: true,
    card: {
      id: 'ally-' + row.entity_id,
      name: row.name,
      ally: true,
      entity_id: entity.entity_id,
      entity_type: entity.entity_type,
      art: '/play/assets/allies/' + row.entity_id + '.svg',
      ...row.card
    }
  };
}

export const ALLY_POOL = FIGURES.map(figureRecord);

/** The two allies the 12-card bot sim puts in the Twins' deck. */
export const SIM_ALLIES = ['mouse', 'moth'];

export function ghostAlly(character) {
  const entity = asEntity({ entity_id: character.id, id: character.id, entity_type: 'character' });
  return {
    entity_id: entity.entity_id,
    entity_type: entity.entity_type,
    ghost: true,
    name: 'Ghost of ' + character.name,
    blurb: 'Eliminated. They answer from the margin.',
    art: '/play/assets/avatars/' + character.id + '-taken.webp',
    placeholder: false,
    card: {
      id: 'ghost-' + character.id,
      name: 'Ghost of ' + character.name,
      ally: true,
      ghost: true,
      entity_id: entity.entity_id,
      entity_type: entity.entity_type,
      art: '/play/assets/avatars/' + character.id + '-taken.webp',
      cost: 1,
      type: 'attack',
      stat: character.signature || 'STR',
      deal: 5,
      emoji: '👻',
      text: 'Deal 5.'
    }
  };
}

export function allyPool({ eliminated } = {}) {
  const dead = new Set(eliminated || []);
  const ghosts = CAST.filter((character) => dead.has(character.id)).map(ghostAlly);
  return ALLY_POOL.concat(ghosts);
}

export function findAlly(id, opts) {
  return allyPool(opts).find((row) => row.entity_id === id) || null;
}

function penalize(card) {
  const next = { ...card, sharedPenalty: true, text: card.text + ' Shared −10%.' };
  for (const key of PENALTY_NUMBERS) {
    if (next[key] > 0) next[key] = Math.floor(next[key] * 9 / 10);
  }
  return next;
}

/** Two ally cards. Numbers floor to 90% when 3 or more characters field that ally. */
export function cardsForAllies(ids, opts) {
  const penalized = new Set((opts && opts.penalized) || []);
  const seen = new Set();
  const cards = [];
  for (const id of ids || []) {
    if (seen.has(id) || cards.length >= 2) continue;
    const ally = findAlly(id, opts);
    if (!ally) continue;
    seen.add(id);
    cards.push(penalized.has(id) ? penalize(ally.card) : { ...ally.card });
  }
  return cards;
}

/**
 * The same character cannot field an ally it fielded last chapter.
 * The slate is exactly two different allies from the pool.
 */
export function slateLegal({ slate, previous, pool }) {
  const ids = Array.isArray(slate) ? slate.map(String) : [];
  if (ids.length !== 2) return { ok: false, reason: 'need_two' };
  if (ids[0] === ids[1]) return { ok: false, reason: 'duplicate' };
  const known = new Set((pool || ALLY_POOL).map((row) => row.entity_id));
  const tired = new Set(previous || []);
  for (const id of ids) {
    if (!known.has(id)) return { ok: false, reason: 'unknown_ally' };
    if (tired.has(id)) return { ok: false, reason: 'fatigued' };
  }
  return { ok: true, slate: ids };
}

/** An ally fielded by 3 or more characters is −10% for every one of them. */
export function sharedPenaltyIds(picks) {
  const who = new Map();
  for (const row of picks || []) {
    const entity = asEntity({ entity_id: row.entity_id, id: row.charId || row.id, entity_type: row.entity_type || 'character' });
    for (const id of new Set(row.allies || row.slate || [])) {
      if (!who.has(id)) who.set(id, new Set());
      who.get(id).add(entity.entity_id);
    }
  }
  return [...who].filter(([, set]) => set.size >= 3).map(([id]) => id);
}

function heldFor(row) {
  if (row.held === true) return true;
  if (Number(row.heldHours) >= 24) return true;
  return Number(row.heldMs) >= HOLD_MS;
}

/** One row per cluster. CP sums inside the cluster. The proposer wallet is the holder with the most CP. */
export function rankProposers(wallets) {
  const groups = new Map();
  for (const row of wallets || []) {
    if (!row || !row.wallet) continue;
    const cluster = String(row.cluster || row.wallet);
    const cp = row.cp != null ? Number(row.cp) : contributionPoints(row).cp;
    const member = { wallet: String(row.wallet), cp, held: heldFor(row), cluster };
    if (!groups.has(cluster)) groups.set(cluster, []);
    groups.get(cluster).push(member);
  }
  const ranked = [];
  for (const [cluster, members] of groups) {
    const eligible = members.filter((member) => member.held);
    if (!eligible.length) continue;
    const cp = members.reduce((sum, member) => sum + member.cp, 0);
    eligible.sort((a, b) => b.cp - a.cp || a.wallet.localeCompare(b.wallet));
    ranked.push({
      cluster,
      wallet: eligible[0].wallet,
      cp,
      entity_id: cluster,
      entity_type: 'cluster'
    });
  }
  ranked.sort((a, b) => b.cp - a.cp || a.wallet.localeCompare(b.wallet));
  return ranked;
}

/**
 * The seat walks the CP ranking, one step per chapter, and skips anyone
 * who already failed a veto this chapter. One holder means that holder.
 */
export function pickProposer({ wallets, chapter, skip }) {
  const ranked = rankProposers(wallets);
  if (!ranked.length) return null;
  const blocked = new Set(skip || []);
  const start = (Math.max(1, Number(chapter) || 1) - 1) % ranked.length;
  for (let step = 0; step < ranked.length; step++) {
    const candidate = ranked[(start + step) % ranked.length];
    if (!blocked.has(candidate.wallet)) return candidate;
  }
  return null;
}

export function lineupPayment(body) {
  const src = body || {};
  if (src.pay != null || src.bid != null || src.fee != null || src.price != null || src.sol != null || src.token != null) {
    return { ok: false, reason: 'lineup_is_free' };
  }
  return { ok: true, payout: false, fee: false, cosmetic: true };
}

/**
 * Holders veto with capped weight. Abstaining counts against the veto:
 * the slate stands unless veto weight is more than half of the roster.
 */
export function tallyVeto(roster, votes) {
  const list = roster || [];
  const vetoBy = new Map((votes || []).map((vote) => [String(vote.wallet), !!vote.veto]));
  const weights = list.map((row) => {
    const weight = Number(row.weight != null ? row.weight : row.balance);
    return weight > 0 ? weight : 1;
  });
  const capped = applyVoteCap(weights, { cap: 0.02, relaxUnder: 50 });
  let veto = 0;
  let total = 0;
  list.forEach((row, index) => {
    total += capped[index];
    if (vetoBy.get(String(row.wallet))) veto += capped[index];
  });
  return {
    passed: !(total > 0 && veto > total / 2),
    veto,
    total,
    share: total > 0 ? veto / total : 0,
    cap: 0.02,
    payout: false,
    fee: false,
    affectsScore: false
  };
}

export function castAllyVote({ already, veto }) {
  if (already) return { ok: false, reason: 'already' };
  if (typeof veto !== 'boolean') return { ok: false, reason: 'bad_option' };
  return { ok: true, veto, narrationOnly: true, affectsScore: false, payout: false, fee: false, legacyPoints: 0 };
}
