/** Margin-figure allies. A character's fans vote two in each chapter. No fee, no payout. */

import { CAST } from './cast.js';
import { contributionPoints } from './contribution.js';
import { asEntity } from './entity.js';
import { applyVoteCap } from './vote.js';

const HOLD_MS = 24 * 3600 * 1000;
const PENALTY_NUMBERS = ['deal', 'block', 'next', 'hex', 'rally', 'bossCut', 'bonusIfBlock', 'keepBlock', 'stripGuard', 'dealIfStaggered', 'dealDuringFinisher', 'bossCutPct'];

/** Canonical S0 allies. Numbers are the auto-fill order. Card numbers are at stat 50. */
const FIGURES = [
  { number: 1, entity_id: 'hob', name: 'Hob the Bookbinder', blurb: 'Stitches a torn page and leaves the thread for tomorrow.', glyph: 'H', color: '#c4a574', card: { name: 'Stitch Up', cost: 1, type: 'block', stat: 'CHA', block: 6, keepBlock: 3, emoji: '🧵', text: 'Block 6. Keep 3 Block into next turn.' } },
  { number: 2, entity_id: 'wren', name: 'Sister Wren', blurb: 'Holds a lamp over the next line.', glyph: 'W', color: '#f2c14e', card: { name: 'Lamplight', cost: 1, type: 'skill', stat: 'CUN', revealIntents: 2, emoji: '🕯️', text: '+1 Combo. Reveal boss\'s next two intents.' } },
  { number: 3, entity_id: 'juniper', name: 'Juniper the fox', blurb: 'Opens the lock the boss set on the margin.', glyph: 'J', color: '#19b88a', card: { name: 'Pick the Lock', cost: 0, type: 'skill', stat: 'CUN', stripGuard: 6, comboOnce: true, setup: true, emoji: '🔑', text: '+1 Combo, once per turn. Boss loses 6 guard.' } },
  { number: 4, entity_id: 'footnote', name: 'Sir Footnote', blurb: 'A small knight who hits harder once the boss stumbles.', glyph: 'F', color: '#56b4e9', card: { name: 'Tiny Charge', cost: 1, type: 'attack', stat: 'STR', deal: 3, dealIfStaggered: 7, emoji: '📌', text: 'Deal 3. Deal 7 if the boss is Staggered.' } },
  { number: 5, entity_id: 'index', name: 'Old Mother Index', blurb: 'Finds the next line and leaves it in hand.', glyph: 'O', color: '#8d6b4a', card: { name: 'Cross-Reference', cost: 1, type: 'skill', stat: 'CUN', draw: 1, comboIfDrawnAttack: 1, comboOnce: true, emoji: '📖', text: 'Draw 1. +1 Combo if it\'s an Attack, once per turn.' } },
  { number: 6, entity_id: 'croak', name: 'Baron Croak', blurb: 'Leaps and leaves the combo where it was.', glyph: 'B', color: '#6aa84f', card: { name: 'Royal Leap', cost: 2, type: 'attack', stat: 'STR', deal: 3, keepComboHalf: true, emoji: '🐸', text: 'Deal 3. Keep half your Combo (floor) instead of resetting.' } },
  { number: 7, entity_id: 'mira', name: 'Mira the Cartographer', blurb: 'Marks the spot the next blow should land.', glyph: 'M', color: '#7d6bff', card: { name: 'Mark the Map', cost: 1, type: 'skill', stat: 'CUN', next: 4, emoji: '🗺️', text: 'Next Attack deals +4.' } },
  { number: 8, entity_id: 'brannoc', name: 'Brannoc the Ferryman', blurb: 'Takes the toll in block.', glyph: 'R', color: '#4a6fa5', card: { name: 'Toll Paid', cost: 2, type: 'block', stat: 'CHA', block: 7, fullBlockDraw: 1, emoji: '⛴️', text: 'Block 7. Full block: draw 1 next turn.' } },
  { number: 9, entity_id: 'lumen', name: 'Lumen, the Moth Queen', blurb: 'The swarm lands as three separate bites.', glyph: 'L', color: '#e07a3d', card: { name: 'Dusk Swarm', cost: 2, type: 'attack', stat: 'STR', deal: 2, hits: 3, emoji: '🦋', text: 'Deal 2 three times (Combo applies to first hit only).' } },
  { number: 10, entity_id: 'grub', name: 'Grub the troll', blurb: 'Raises a wall of moss and does not explain it.', glyph: 'G', color: '#7a8c4a', card: { name: 'Moss Wall', cost: 2, type: 'block', stat: 'CHA', block: 8, emoji: '🌿', text: 'Gain 8 block.' } },
  { number: 11, entity_id: 'tilde', name: 'Tilde the hedge-witch', blurb: 'Softens the next blow before it is written.', glyph: 'T', color: '#009e73', card: { name: 'Hedge Hex', cost: 1, type: 'skill', stat: 'LCK', bossCutPct: 20, emoji: '〰️', text: 'Boss\'s next attack deals 20% less (floor).' } },
  { number: 12, entity_id: 'corvin', name: 'Corvin the raven', blurb: 'Arrives late, and harder once the ending has started.', glyph: 'C', color: '#d55e00', card: { name: 'Urgent Delivery', cost: 0, type: 'attack', stat: 'STR', deal: 3, dealDuringFinisher: 9, emoji: '📦', text: 'Deal 3. Finisher: deal 9 instead.' } }
];

function figureRecord(row) {
  const entity = asEntity({ entity_id: row.entity_id, entity_type: 'ally' });
  return {
    number: row.number,
    entity_id: entity.entity_id,
    entity_type: entity.entity_type,
    ghost: false,
    name: row.name,
    blurb: row.blurb,
    art: '/play/assets/allies/' + row.entity_id + '.webp',
    placeholder: false,
    card: {
      id: 'ally-' + row.entity_id,
      name: row.name,
      ally: true,
      entity_id: entity.entity_id,
      entity_type: entity.entity_type,
      art: '/play/assets/allies/' + row.entity_id + '.webp',
      ...row.card
    }
  };
}

export const ALLY_POOL = FIGURES.map(figureRecord);

/** Numbers 1 and 2. The auto-fill pair, and the pair the bot sim treats as average. */
export const SIM_ALLIES = ['hob', 'wren'];

export const ALLY_QUORUM = 5;

/**
 * Last chapter's allies are fatigued, so they are skipped.
 * The fill is the two lowest numbers still available. Ghosts are not numbered.
 */
export function autoAllies({ previous, pool } = {}) {
  const tired = new Set(previous || []);
  return (pool || ALLY_POOL)
    .filter((row) => !row.ghost && Number.isFinite(row.number) && !tired.has(row.entity_id))
    .sort((a, b) => a.number - b.number || String(a.entity_id).localeCompare(String(b.entity_id)))
    .slice(0, 2)
    .map((row) => row.entity_id);
}

/**
 * A slate counts only when at least 5 wallets voted and it was not vetoed.
 * Otherwise the deck is auto-filled. Passing allies with no vote list keeps
 * that explicit pair, which is how the sim builds its deck.
 */
export function resolveDeckAllies({ allies, votes, previous, pool } = {}) {
  const slate = Array.isArray(allies) ? allies.filter(Boolean).slice(0, 2) : [];
  const wallets = new Set((votes || []).map((vote) => String(vote && vote.wallet || '')).filter(Boolean));
  if (slate.length === 2 && votes == null) {
    return { allies: slate, autoPicked: false, wallets: 0 };
  }
  if (slate.length === 2 && wallets.size >= ALLY_QUORUM) {
    return { allies: slate, autoPicked: false, wallets: wallets.size };
  }
  return { allies: autoAllies({ previous, pool }), autoPicked: true, wallets: wallets.size };
}

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
