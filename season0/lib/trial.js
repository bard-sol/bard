import { sha256Hex } from './bytes.js';

/** Same boss and hand for every wallet. seed = sha256(season, day, "trial"). */
export async function trialSeed(season, day) {
  return sha256Hex(String(season) + '|' + String(day) + '|trial');
}

export function utcDateKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export const TRIAL_LIMITS = { turns: 8, moves: 30, seconds: 60, energy: 3, bossHp: 100 };

export const TRIAL_CARDS = [
  { id: 'jab', name: 'Jab', cost: 1, power: 8, emoji: '👊' },
  { id: 'hook', name: 'Hook', cost: 1, power: 9, emoji: '🪝' },
  { id: 'ink', name: 'Ink spit', cost: 1, power: 7, emoji: '🖋️' },
  { id: 'step', name: 'Sidestep', cost: 1, power: 6, emoji: '👣' },
  { id: 'spark', name: 'Spark', cost: 1, power: 10, emoji: '✨' },
  { id: 'nick', name: 'Nick', cost: 1, power: 8, emoji: '🔪' },
  { id: 'tap', name: 'Page tap', cost: 1, power: 5, emoji: '📄' },
  { id: 'grin', name: 'Grin', cost: 1, power: 7, emoji: '😼' },
  { id: 'cleave', name: 'Cleave', cost: 2, power: 16, emoji: '⚔️' },
  { id: 'verse', name: 'Verse', cost: 2, power: 14, emoji: '📜' },
  { id: 'bind', name: 'Bind', cost: 2, power: 15, emoji: '🪢' },
  { id: 'flare', name: 'Flare', cost: 2, power: 17, emoji: '🔆' },
  { id: 'riddle', name: 'Riddle', cost: 2, power: 13, emoji: '❓' },
  { id: 'guard', name: 'Guard', cost: 2, power: 12, emoji: '🛡️' },
  { id: 'howl', name: 'Howl', cost: 2, power: 16, emoji: '🐺' },
  { id: 'stitch', name: 'Stitch', cost: 2, power: 14, emoji: '🧵' },
  { id: 'oath', name: 'Oath', cost: 3, power: 24, emoji: '🫡' },
  { id: 'tide', name: 'Tide', cost: 3, power: 26, emoji: '🌊' },
  { id: 'crown', name: 'Crown', cost: 3, power: 22, emoji: '👑' },
  { id: 'ash', name: 'Ash', cost: 3, power: 23, emoji: '🔥' },
  { id: 'ember', name: 'Ember', cost: 3, power: 25, emoji: '✴️' },
  { id: 'silence', name: 'Silence', cost: 3, power: 21, emoji: '🤫' },
  { id: 'last', name: 'Last line', cost: 3, power: 28, emoji: '📖' },
  { id: 'debt', name: 'Debt', cost: 3, power: 27, emoji: '⛓️' }
];

const INTENTS = ['attack', 'guard', 'eye'];
const INTENT_ICON = { attack: '⚔️', guard: '🛡️', eye: '👁️' };

function rngFromSeed(hex) {
  let a = parseInt(String(hex).slice(0, 8), 16) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function encounterFromSeed(seedHex) {
  const rng = rngFromSeed(seedHex);
  const pool = TRIAL_CARDS.slice();
  const hand = [];
  while (hand.length < 3) {
    const index = Math.floor(rng() * pool.length);
    hand.push(pool.splice(index, 1)[0]);
  }
  const intents = [];
  for (let i = 0; i < TRIAL_LIMITS.turns; i++) intents.push(INTENTS[Math.floor(rng() * INTENTS.length)]);
  return {
    seed: seedHex,
    boss: 'The Margin',
    bossHp: TRIAL_LIMITS.bossHp,
    hand,
    intents,
    intentIcon: INTENT_ICON
  };
}

export function intentIcon(name) {
  return INTENT_ICON[name] || '•';
}

/**
 * Server-side replay. Same seed and moves always deal the same damage.
 * accuracy = min(1, damage / bossHp).
 */
export function replayTrial(seedHex, moves) {
  const encounter = encounterFromSeed(seedHex);
  const list = moves || [];
  if (list.length > TRIAL_LIMITS.moves) return { ok: false, reason: 'move_cap' };
  let energy = TRIAL_LIMITS.energy;
  let turn = 0;
  let damage = 0;
  const rows = [[]];
  for (const move of list) {
    if (turn >= TRIAL_LIMITS.turns) return { ok: false, reason: 'turn_cap' };
    if (!move || (move.type !== 'play' && move.type !== 'end')) return { ok: false, reason: 'bad_move' };
    if (move.type === 'end') {
      turn += 1;
      energy = TRIAL_LIMITS.energy;
      rows.push([]);
      continue;
    }
    const card = encounter.hand[move.card];
    if (!card) return { ok: false, reason: 'bad_card' };
    if (card.cost > energy) return { ok: false, reason: 'energy' };
    energy -= card.cost;
    const intent = encounter.intents[turn];
    const dealt = intent === 'guard' ? Math.floor(card.power / 2) : card.power;
    damage += dealt;
    rows[rows.length - 1].push(card.emoji);
  }
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  const accuracy = Math.min(1, damage / encounter.bossHp);
  return {
    ok: true,
    damage,
    accuracy,
    bossHp: encounter.bossHp,
    turnsUsed: Math.min(TRIAL_LIMITS.turns, turn + (rows.length ? 1 : 0)),
    moves: list.length,
    grid: shareGrid(rows, accuracy),
    rows,
    encounter
  };
}

export function shareGrid(rows, accuracy) {
  const body = (rows || []).filter((row) => row.length).map((row) => row.join('')).join('\n');
  return 'Bard Trial ' + Math.round(Number(accuracy) * 100) + '%\n' + body;
}

export function trialTimeOk(elapsedMs) {
  const ms = Number(elapsedMs);
  return Number.isFinite(ms) && ms >= 0 && ms <= TRIAL_LIMITS.seconds * 1000;
}

/**
 * K is the mean of daily accuracies on each UTC day in [T0, snapshot].
 * A day with no counted run is 0.
 */
export function accuraciesInWindow(t0Ms, snapshotMs, byDay) {
  if (!(Number(snapshotMs) > Number(t0Ms))) return [];
  const start = Date.parse(utcDateKey(t0Ms) + 'T00:00:00.000Z');
  const end = Date.parse(utcDateKey(snapshotMs) + 'T00:00:00.000Z');
  const out = [];
  for (let t = start; t <= end; t += 86400000) {
    const key = new Date(t).toISOString().slice(0, 10);
    const value = byDay ? byDay[key] : undefined;
    out.push(value == null ? 0 : Number(value));
  }
  return out;
}

export function meanAccuracy(values) {
  if (!values || !values.length) return 0;
  return values.reduce((sum, n) => sum + Number(n), 0) / values.length;
}

/** Stretch only. Not enabled, and it does not change the Train stat P. */
export function cardUpgradeOffer() {
  return {
    enabled: false,
    stretch: true,
    changesTrainStat: false,
    note: 'Card upgrades are a stretch goal. They are not in this Season 0 build.'
  };
}
