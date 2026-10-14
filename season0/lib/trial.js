import { sha256Hex } from './bytes.js';
import { characterById } from './cast.js';
import { defaultConfig, seasonStartMs } from './config.js';

/** seed = sha256(season, day, "trial"). The only random stream is the deck shuffle. */
export async function trialSeed(season, day) {
  return sha256Hex(String(season) + '|' + String(day) + '|trial');
}

export function utcDateKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export const TRIAL_LIMITS = { turns: 8, moves: 30, seconds: 60, energy: 3, playerHp: 30, draw: 3 };

/** value = floor(base * (150 + stat) / 200). Stat 50 is identity. */
export function scaledValue(base, stat) {
  return Math.floor(Number(base) * (150 + Number(stat)) / 200);
}

/** damage% = floor(100 * dealt / maxHP). Overkill is already excluded from dealt. */
export function damagePercent(dealt, maxHp) {
  const hp = Number(maxHp);
  if (!(hp > 0)) return 0;
  return Math.floor(100 * Math.min(hp, Math.max(0, Number(dealt) || 0)) / hp);
}

export function bossMaxHp(chapter, variant) {
  const ch = Math.max(1, Number(chapter) || 1);
  const scale = variant === 'D3' ? 9 : 10;
  return Math.floor(110 * (100 + 8 * (ch - 1)) * scale / 1000);
}

const GENERICS = [
  { id: 'jab', name: 'Quill Jab', cost: 1, type: 'attack', stat: 'STR', deal: 6, emoji: '✒️', text: 'Deal 6.' },
  { id: 'shield', name: 'Ink Shield', cost: 1, type: 'block', stat: 'CHA', block: 6, emoji: '🛡️', text: 'Gain 6 block.' },
  { id: 'page', name: 'Turn the Page', cost: 0, type: 'skill', stat: 'CUN', draw: 1, setup: true, emoji: '📄', text: 'Draw 1 card.' },
  { id: 'binding', name: 'Heavy Binding', cost: 2, type: 'attack', stat: 'STR', deal: 13, emoji: '📚', text: 'Deal 13.' },
  { id: 'margin', name: 'Margin Note', cost: 1, type: 'skill', stat: 'CUN', next: 5, emoji: '📝', text: 'Next attack this turn deals +5.' },
  { id: 'bookmark', name: 'Bookmark', cost: 0, type: 'skill', stat: 'LCK', keep: true, emoji: '🔖', text: 'Keep one card in hand for next turn.' },
  { id: 'bold', name: 'Bold Stroke', cost: 3, type: 'attack', stat: 'STR', deal: 22, lose: 3, emoji: '🖋️', text: 'Deal 22. Lose 3 HP.' },
  { id: 'footnote', name: 'Footnote', cost: 1, type: 'block', stat: 'CUN', block: 4, drawIfAttack: 1, emoji: '📎', text: 'Gain 4 block. If boss intends attack, draw 1.' }
];

const SIGNATURES = {
  grenna: [
    { id: 'haymaker', name: 'Chain Haymaker', cost: 2, type: 'attack', stat: 'STR', deal: 10, bonusIfBlock: 6, emoji: '⛓️', text: 'Deal 10, +6 if you have block.', signature: true },
    { id: 'vow', name: 'Iron Vow', cost: 1, type: 'block', stat: 'STR', block: 8, lose: 2, emoji: '🫡', text: 'Gain 8 block. Lose 2 HP.', signature: true }
  ],
  silas: [
    { id: 'forged', name: 'Forged Signature', cost: 1, type: 'skill', stat: 'CUN', copy: true, emoji: '✒️', text: 'Copy the last card you played this turn.', signature: true },
    { id: 'redline', name: 'Redline', cost: 2, type: 'attack', stat: 'CUN', deal: 8, halveGuard: true, emoji: '✂️', text: 'Deal 8. Boss guard this turn is halved.', signature: true }
  ],
  marrow: [
    { id: 'fan', name: 'Fan Flourish', cost: 1, type: 'skill', stat: 'CHA', bossCut: 5, emoji: '🪭', text: 'Boss deals −5 damage this turn.', signature: true },
    { id: 'darling', name: 'Darling of Court', cost: 2, type: 'block', stat: 'CHA', block: 10, draw: 1, emoji: '👑', text: 'Gain 10 block. Draw 1.', signature: true }
  ],
  pip: [
    { id: 'heads', name: 'Heads I Win', cost: 1, type: 'attack', stat: 'LCK', deal: 5, doubleIfOdd: true, emoji: '🪙', text: 'Deal 5. If turn number is odd, deal double.', signature: true },
    { id: 'coin', name: 'Lucky Coin', cost: 0, type: 'skill', stat: 'LCK', energy: 1, once: true, setup: true, emoji: '✨', text: 'Gain 1 energy. Once per turn.', signature: true }
  ],
  wick: [
    { id: 'hex', name: 'Candle Hex', cost: 1, type: 'skill', stat: 'LCK', hex: 3, emoji: '🕯️', text: 'Boss takes 3 damage at each turn end.', signature: true },
    { id: 'foresight', name: 'Foresight', cost: 0, type: 'skill', stat: 'CUN', draw: 2, discardLeft: true, setup: true, emoji: '👁️', text: 'Draw 2. Discard 1 (leftmost).', signature: true }
  ],
  vey: [
    { id: 'rally', name: 'Rally the Banner', cost: 1, type: 'skill', stat: 'CHA', rally: 3, emoji: '🚩', text: 'Your attacks deal +3 for the rest of the run.', signature: true },
    { id: 'wall', name: 'Shield Wall', cost: 2, type: 'block', stat: 'CHA', block: 12, emoji: '🛡️', text: 'Gain 12 block.', signature: true }
  ],
  thorn: [
    { id: 'bite', name: 'Feral Bite', cost: 1, type: 'attack', stat: 'STR', deal: 7, againBelowHalf: true, emoji: '🐺', text: 'Deal 7. Deal 7 again if below half HP.', signature: true },
    { id: 'pounce', name: 'Pounce', cost: 0, type: 'attack', stat: 'STR', deal: 4, firstOnly: true, emoji: '🐾', text: 'Deal 4. Only as the first card in a turn.', signature: true }
  ],
  twins: [
    { id: 'spark', name: 'Twin Spark', cost: 1, type: 'attack', stat: 'STR', deal: 4, hits: 2, emoji: '✴️', text: 'Deal 4 twice.', signature: true },
    { id: 'ember', name: 'Ember & Ash', cost: 2, type: 'skill', stat: 'CHA', block: 5, next: 6, emoji: '🔥', text: 'Gain 5 block. Next attack deals +6.', signature: true }
  ]
};

export const PASSIVES = {
  grenna: { text: 'Attacks deal +1 while you have block.', blockAttack: 1 },
  silas: { text: 'The first skill each turn costs 1 less.', skillDiscount: 1 },
  marrow: { text: 'Block you gain is +1.', block: 1 },
  pip: { text: 'On odd turns, attacks deal +1.', oddAttack: 1 },
  wick: { text: 'Candle Hex also ticks for 1 at the start of your turn.', hexOpen: 1 },
  vey: { text: 'Your first block each turn is +2.', firstBlock: 2 },
  thorn: { text: 'Below half HP, attacks deal +2.', lowAttack: 2 },
  twins: { text: 'The first attack each turn deals +1.', firstAttack: 1 }
};

const BOSSES = [
  { chapter: 1, name: 'The Blot', blurb: 'A spreading ink stain that eats unfinished stories.', pattern: [{ kind: 'attack', n: 6 }, { kind: 'guard', n: 8 }, { kind: 'attack', n: 9 }] },
  { chapter: 2, name: 'The Margin Wolf', blurb: 'Prowls the page edges, devouring footnotes.', art: '/play/assets/props/boss-wolf.webp', pattern: [{ kind: 'attack', n: 5 }, { kind: 'attack', n: 5 }, { kind: 'buff', buff: 'attack', n: 3 }, { kind: 'attack', n: 8 }] },
  { chapter: 3, name: 'Sir Errata', blurb: 'A knight made of corrections who unwrites your moves.', pattern: [{ kind: 'attack', n: 7 }, { kind: 'debuff', debuff: 'cost' }, { kind: 'guard', n: 10 }, { kind: 'attack', n: 10 }] },
  { chapter: 4, name: 'The Paper Hydra', blurb: 'Grows a head each time its page is torn.', pattern: [{ kind: 'attack', n: 4, hits: 2, growHits: true, maxHits: 4 }, { kind: 'attack', n: 4, hits: 2, growHits: true, maxHits: 4 }, { kind: 'buff', buff: 'hits', n: 1 }] },
  { chapter: 5, name: 'Madame Redaction', blurb: 'A censor who blacks out lines of text.', pattern: [{ kind: 'debuff', debuff: 'block' }, { kind: 'attack', n: 9 }, { kind: 'attack', n: 9 }, { kind: 'guard', n: 12 }] },
  { chapter: 6, name: 'The Unbinder', blurb: 'A moth that eats book spines.', pattern: [{ kind: 'attack', n: 6 }, { kind: 'debuff', debuff: 'discard' }, { kind: 'attack', n: 12 }] },
  { chapter: 7, name: 'The Final Reader', blurb: 'The one who closes the book.', pattern: [{ kind: 'guard', n: 15 }, { kind: 'attack', n: 8 }, { kind: 'attack', n: 14 }, { kind: 'buff', buff: 'heal', n: 10 }] }
];

export const TRIAL_CARDS = GENERICS.concat(...Object.values(SIGNATURES));

export function variantFor(chapter, nowMs) {
  const start = seasonStartMs() + (Math.max(1, chapter) - 1) * defaultConfig().chapter_len_s * 1000;
  const elapsed = Number(nowMs) - start;
  const index = Math.floor(elapsed / 86400000);
  if (index <= 0) return 'D1';
  if (index === 1) return 'D2';
  return 'D3';
}

export function trialStats(charId, train) {
  const character = characterById(charId) || characterById('pip');
  const stats = { STR: character.stats.STR, CUN: character.stats.CUN, CHA: character.stats.CHA, LCK: character.stats.LCK };
  const bonus = train || {};
  for (const key of Object.keys(stats)) {
    const add = Math.max(0, Math.min(80, Math.floor(Number(bonus[key]) || 0)));
    stats[key] += add;
  }
  return { charId: character.id, stats };
}

export function trialContext({ charId, chapter, now, train, inDanger }) {
  const picked = trialStats(charId, train);
  const ch = Math.max(1, Math.min(7, Number(chapter) || 1));
  return {
    charId: picked.charId,
    chapter: ch,
    variant: variantFor(ch, Number(now) || seasonStartMs()),
    stats: picked.stats,
    inDanger: !!inDanger,
    train: train || null
  };
}

function rngFromSeed(hex) {
  let a = parseInt(String(hex).slice(0, 8), 16) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rng) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = arr[i];
    arr[i] = arr[j];
    arr[j] = swap;
  }
  return arr;
}

function deckFor(charId) {
  const signatures = SIGNATURES[charId] || SIGNATURES.pip;
  return GENERICS.concat(signatures).map((card) => ({ ...card }));
}

function bossFor(chapter) {
  return BOSSES[Math.max(0, Math.min(6, chapter - 1))];
}

function intentAt(boss, turn) {
  return boss.pattern[(turn - 1) % boss.pattern.length];
}

function attackPacket(state, intent) {
  const extra = (state.chapter - 1) + (state.variant === 'D3' ? 3 : 0) + state.attackBuff;
  return Math.max(0, intent.n + extra - state.bossCut);
}

function attackHits(state, intent) {
  let hits = intent.hits || 1;
  if (intent.growHits) hits = Math.min(intent.maxHits || 4, hits + state.hitBuff);
  return hits;
}

function intentView(state) {
  const intent = intentAt(state.boss, state.turn);
  if (intent.kind === 'attack') {
    const hits = attackHits(state, intent);
    const each = Math.max(0, intent.n + (state.chapter - 1) + (state.variant === 'D3' ? 3 : 0) + state.attackBuff);
    return { kind: 'attack', n: each, hits, icon: '⚔', label: hits > 1 ? '⚔ ' + each + '×' + hits : '⚔ ' + each };
  }
  if (intent.kind === 'guard') return { kind: 'guard', n: intent.n, icon: '🛡', label: '🛡 ' + intent.n };
  if (intent.kind === 'buff') return { kind: 'buff', icon: '✦', label: intent.buff === 'heal' ? '✦ heal ' + intent.n : '✦ +' + intent.n + ' ' + intent.buff };
  return { kind: 'debuff', icon: '☠', label: '☠ ' + intent.debuff };
}

function drawCards(state, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (!state.deck.length) {
      if (!state.discard.length) break;
      state.deck = shuffle(state.discard, state.rng);
      state.discard = [];
    }
    drawn.push(state.deck.pop());
  }
  state.hand.push(...drawn);
  return drawn;
}

function gainBlock(state, amount) {
  let n = Math.max(0, Math.floor(amount));
  if (state.blockHalved) n = Math.floor(n / 2);
  if (state.passive.block) n += state.passive.block;
  if (state.passive.firstBlock && !state.blockedThisTurn) n += state.passive.firstBlock;
  state.blockedThisTurn = true;
  state.playerBlock += n;
}

function dealToBoss(state, amount) {
  let dmg = Math.max(0, Math.floor(amount));
  const blocked = Math.min(state.bossGuard, dmg);
  state.bossGuard -= blocked;
  dmg -= blocked;
  const applied = Math.min(state.bossHp, dmg);
  state.bossHp -= applied;
  state.dealt += applied;
  if (state.dealt > state.bossMax) state.dealt = state.bossMax;
  if (state.bossHp <= 0) state.done = 'boss';
}

function hurtPlayer(state, amount) {
  let dmg = Math.max(0, Math.floor(amount));
  const blocked = Math.min(state.playerBlock, dmg);
  state.playerBlock -= blocked;
  dmg -= blocked;
  state.playerHp -= dmg;
  if (state.playerHp <= 0) {
    state.playerHp = 0;
    state.done = 'death';
  }
}

function attackDamage(state, card, base) {
  let dmg = scaledValue(base, state.stats[card.stat]);
  if (card.doubleIfOdd && state.turn % 2 === 1) dmg *= 2;
  if (card.bonusIfBlock && state.playerBlock > 0) dmg += scaledValue(card.bonusIfBlock, state.stats[card.stat]);
  dmg += state.nextAttack;
  dmg += state.rallyBonus;
  if (state.inDanger) dmg += 2;
  if (state.passive.blockAttack && state.playerBlock > 0) dmg += state.passive.blockAttack;
  if (state.passive.oddAttack && state.turn % 2 === 1) dmg += state.passive.oddAttack;
  if (state.passive.lowAttack && state.playerHp * 2 < TRIAL_LIMITS.playerHp) dmg += state.passive.lowAttack;
  if (state.passive.firstAttack && state.attacksThisTurn === 0) dmg += state.passive.firstAttack;
  state.nextAttack = 0;
  state.attacksThisTurn += 1;
  return dmg;
}

function playAttack(state, card) {
  const hits = card.hits || 1;
  for (let i = 0; i < hits && !state.done; i++) dealToBoss(state, attackDamage(state, card, card.deal));
  if (card.againBelowHalf && state.playerHp * 2 < TRIAL_LIMITS.playerHp && !state.done) {
    dealToBoss(state, attackDamage(state, card, card.deal));
  }
  if (card.halveGuard) state.bossGuard = Math.floor(state.bossGuard / 2);
  if (card.lose) hurtPlayer(state, card.lose);
}

function playCard(state, card, move) {
  if (card.copy) {
    if (state.lastCard && state.lastCard.id !== 'forged') playCard(state, state.lastCard, { keep: 0 });
    return;
  }
  if (card.deal) playAttack(state, card);
  if (card.block) gainBlock(state, scaledValue(card.block, state.stats[card.stat]));
  if (card.lose && !card.deal) hurtPlayer(state, card.lose);
  if (card.next) state.nextAttack += scaledValue(card.next, state.stats[card.stat]);
  if (card.draw) drawCards(state, card.draw);
  if (card.drawIfAttack && intentAt(state.boss, state.turn).kind === 'attack') drawCards(state, card.drawIfAttack);
  if (card.discardLeft && state.hand.length) state.discard.push(state.hand.shift());
  if (card.energy && !state.coinUsed) {
    state.energy += card.energy;
    state.coinUsed = true;
  }
  if (card.hex) state.hex += scaledValue(card.hex, state.stats[card.stat]);
  if (card.rally && state.rallyStacks < 2) {
    state.rallyStacks += 1;
    state.rallyBonus += scaledValue(card.rally, state.stats.CHA);
  }
  if (card.bossCut) state.bossCut += scaledValue(card.bossCut, state.stats[card.stat]);
  if (card.keep) state.keep = Number.isInteger(move.keep) ? move.keep : 0;
  state.lastCard = card;
}

function bossAct(state) {
  const intent = intentAt(state.boss, state.turn);
  if (intent.kind === 'attack') {
    const each = attackPacket(state, intent);
    const hits = attackHits(state, intent);
    for (let i = 0; i < hits && !state.done; i++) hurtPlayer(state, each);
    state.bossCut = 0;
    return;
  }
  if (intent.kind === 'guard') {
    state.bossGuard += intent.n;
    return;
  }
  if (intent.kind === 'buff' && intent.buff === 'attack') state.attackBuff += intent.n;
  if (intent.kind === 'buff' && intent.buff === 'hits') state.hitBuff += intent.n;
  if (intent.kind === 'buff' && intent.buff === 'heal') state.bossHp = Math.min(state.bossMax, state.bossHp + intent.n);
  if (intent.kind === 'debuff' && intent.debuff === 'cost') state.nextCost += 1;
  if (intent.kind === 'debuff' && intent.debuff === 'block') state.blockHalvedNext = true;
  if (intent.kind === 'debuff' && intent.debuff === 'discard' && state.hand.length) {
    state.discard.push(state.hand.shift());
  }
}

function endTurn(state) {
  if (state.hex && !state.done) dealToBoss(state, state.hex);
  if (!state.done) bossAct(state);
  if (state.keep != null && state.hand.length) {
    const index = Math.max(0, Math.min(state.hand.length - 1, state.keep));
    const kept = state.hand.splice(index, 1);
    state.discard.push(...state.hand);
    state.hand = kept;
  } else {
    state.discard.push(...state.hand);
    state.hand = [];
  }
  state.keep = null;
  state.nextAttack = 0;
  state.bossCut = 0;
  state.blockHalved = false;
  if (state.done || state.turn >= TRIAL_LIMITS.turns) {
    state.done = state.done || 'turns';
    return;
  }
  state.turn += 1;
  state.playerBlock = 0;
  state.energy = TRIAL_LIMITS.energy;
  state.playedThisTurn = 0;
  state.attacksThisTurn = 0;
  state.skilledThisTurn = false;
  state.blockedThisTurn = false;
  state.coinUsed = false;
  state.lastCard = null;
  state.blockHalved = !!state.blockHalvedNext;
  state.blockHalvedNext = false;
  drawCards(state, TRIAL_LIMITS.draw);
  tickHexOpen(state);
}

function createState(seedHex, opts) {
  const ctx = opts || trialContext({ charId: 'twins', chapter: 1, now: seasonStartMs() });
  const boss = bossFor(ctx.chapter);
  const rng = rngFromSeed(seedHex);
  const state = {
    rng,
    boss,
    chapter: ctx.chapter,
    variant: ctx.variant,
    stats: ctx.stats,
    charId: ctx.charId,
    inDanger: !!ctx.inDanger,
    passive: PASSIVES[ctx.charId] || {},
    deck: shuffle(deckFor(ctx.charId), rng),
    discard: [],
    hand: [],
    turn: 1,
    energy: TRIAL_LIMITS.energy,
    playerHp: TRIAL_LIMITS.playerHp,
    playerBlock: 0,
    bossMax: bossMaxHp(ctx.chapter, ctx.variant),
    bossHp: 0,
    bossGuard: ctx.variant === 'D2' ? 10 : 0,
    dealt: 0,
    moves: 0,
    done: null,
    nextAttack: 0,
    nextCost: 0,
    rallyStacks: 0,
    rallyBonus: 0,
    hex: 0,
    attackBuff: 0,
    hitBuff: 0,
    bossCut: 0,
    blockHalved: false,
    blockHalvedNext: false,
    playedThisTurn: 0,
    attacksThisTurn: 0,
    skilledThisTurn: false,
    blockedThisTurn: false,
    coinUsed: false,
    lastCard: null,
    keep: null,
    rows: [[]]
  };
  state.bossHp = state.bossMax;
  drawCards(state, TRIAL_LIMITS.draw);
  tickHexOpen(state);
  return state;
}

function tickHexOpen(state) {
  if (state.passive.hexOpen && state.hex > 0 && !state.done) dealToBoss(state, 1);
}

function preview(state, card) {
  if (card.type !== 'attack') return 0;
  if (card.firstOnly && state.playedThisTurn > 0) return 0;
  const ghost = {
    ...state,
    stats: state.stats,
    passive: state.passive,
    nextAttack: state.nextAttack,
    attacksThisTurn: state.attacksThisTurn
  };
  let total = attackDamage(ghost, card, card.deal);
  if (card.hits === 2) total += attackDamage(ghost, card, card.deal);
  if (card.againBelowHalf && state.playerHp * 2 < TRIAL_LIMITS.playerHp) total += attackDamage(ghost, card, card.deal);
  return total;
}

function publicCard(state, card, index) {
  const playable = !(card.firstOnly && state.playedThisTurn > 0);
  return {
    index,
    id: card.id,
    name: card.name,
    cost: card.cost,
    type: card.type,
    stat: card.stat,
    text: card.text,
    emoji: card.emoji,
    signature: !!card.signature,
    setup: !!card.setup,
    playable,
    preview: preview(state, card),
    blockPreview: card.block ? scaledValue(card.block, state.stats[card.stat]) : 0
  };
}

function viewOf(state, ok, reason) {
  const percent = damagePercent(state.dealt, state.bossMax);
  return {
    ok: ok !== false,
    reason: reason || null,
    done: state.done,
    ended: state.done,
    turn: state.turn,
    energy: state.energy,
    moves: state.moves,
    playerHp: state.playerHp,
    playerMax: TRIAL_LIMITS.playerHp,
    playerBlock: state.playerBlock,
    boss: state.boss.name,
    blurb: state.boss.blurb,
    art: state.boss.art || null,
    chapter: state.chapter,
    variant: state.variant,
    charId: state.charId,
    bossHp: state.bossHp,
    bossMax: state.bossMax,
    bossGuard: state.bossGuard,
    dealt: state.dealt,
    damagePercent: percent,
    accuracy: Math.min(1, percent / 100),
    intent: state.done ? null : intentView(state),
    hand: state.hand.map((card, index) => publicCard(state, card, index)),
    passive: state.passive.text || '',
    underdog: state.inDanger ? 2 : 0,
    grid: shareGrid(state.rows, percent / 100)
  };
}

export function replayTrial(seedHex, moves, opts) {
  const state = createState(seedHex, opts);
  const list = moves || [];
  for (const move of list) {
    if (state.done) break;
    if (state.moves >= TRIAL_LIMITS.moves) {
      state.done = 'moves';
      break;
    }
    if (!move || (move.type !== 'play' && move.type !== 'end')) return viewOf(state, false, 'bad_move');
    state.moves += 1;
    if (move.type === 'end') {
      state.rows.push([]);
      endTurn(state);
      continue;
    }
    const card = state.hand[move.card];
    if (!card) return viewOf(state, false, 'bad_card');
    if (card.firstOnly && state.playedThisTurn > 0) return viewOf(state, false, 'first_only');
    let cost = card.cost + state.nextCost;
    if (card.type === 'skill' && state.passive.skillDiscount && !state.skilledThisTurn) cost = Math.max(0, cost - 1);
    if (cost > state.energy) return viewOf(state, false, 'energy');
    state.energy -= cost;
    state.nextCost = 0;
    state.hand.splice(move.card, 1);
    if (card.type === 'skill') state.skilledThisTurn = true;
    state.playedThisTurn += 1;
    state.rows[state.rows.length - 1].push(card.emoji);
    playCard(state, card, move);
    if (state.done) break;
    if (state.moves >= TRIAL_LIMITS.moves) state.done = 'moves';
  }
  while (state.rows.length && state.rows[state.rows.length - 1].length === 0) state.rows.pop();
  return viewOf(state, true);
}

export function projectTrial(seedHex, moves, opts) {
  return replayTrial(seedHex, moves, opts);
}

export function chooseBotPlay(view) {
  if (!view || !view.ok || view.done) return null;
  const hand = view.hand.filter((card) => card.playable !== false && card.cost <= view.energy);
  const attackLeft = (card) => view.hand.some((other) => (
    other.index !== card.index && other.preview > 0 && other.playable !== false && other.cost <= view.energy - card.cost
  ));
  const setup = hand.find((card) => card.preview <= 0 && (card.setup || card.type === 'skill') && attackLeft(card));
  if (setup) return { type: 'play', card: setup.index };
  const attacks = hand.filter((card) => card.preview > 0 && view.playerHp - (card.id === 'bold' ? 3 : 0) > 0);
  if (attacks.length) {
    attacks.sort((a, b) => (b.preview / Math.max(1, b.cost)) - (a.preview / Math.max(1, a.cost)));
    return { type: 'play', card: attacks[0].index };
  }
  const draw = hand.find((card) => card.setup && card.cost === 0);
  if (draw) return { type: 'play', card: draw.index };
  const incoming = view.intent && view.intent.kind === 'attack' ? view.intent.n * (view.intent.hits || 1) : 0;
  const block = hand.find((card) => card.blockPreview > 0);
  if (block && incoming > view.playerBlock) return { type: 'play', card: block.index };
  return { type: 'end' };
}

export function botMoves(seedHex, opts) {
  const moves = [];
  for (let guard = 0; guard < 40; guard++) {
    const view = replayTrial(seedHex, moves, opts);
    const next = chooseBotPlay(view);
    if (!next) break;
    moves.push(next);
    if (moves.length >= TRIAL_LIMITS.moves) break;
  }
  return moves;
}

export function encounterFromSeed(seedHex, opts) {
  const view = replayTrial(seedHex, [], opts);
  return {
    seed: seedHex,
    boss: view.boss,
    bossHp: view.bossMax,
    hand: view.hand,
    intent: view.intent,
    chapter: view.chapter,
    variant: view.variant
  };
}

export function intentIcon(name) {
  if (!name) return '•';
  if (typeof name === 'object') return name.icon || '•';
  const icons = { attack: '⚔', guard: '🛡', buff: '✦', debuff: '☠' };
  return icons[name] || '•';
}

export function shareGrid(rows, accuracy) {
  const body = (rows || []).filter((row) => row.length).map((row) => row.join('')).join('\n');
  const percent = Math.round(Math.min(1, Number(accuracy) || 0) * 100);
  return 'Bard Trial ' + percent + '%\n' + body;
}

export function trialTimeOk(elapsedMs) {
  const ms = Number(elapsedMs);
  return Number.isFinite(ms) && ms >= 0;
}

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

export function cardUpgradeOffer() {
  return {
    enabled: false,
    stretch: true,
    changesTrainStat: false,
    note: 'Card upgrades are a stretch goal. They are not in this Season 0 build.'
  };
}

/** Greedy bot over `runs` seeds. Chapter 1, plain day, flat 50 stats (the Twins). */
export async function simulateTrialMedian(runs) {
  const count = Math.max(1, Number(runs) || 300);
  const now = seasonStartMs();
  const opts = trialContext({ charId: 'twins', chapter: 1, now, inDanger: false });
  const percents = [];
  let kills = 0;
  for (let i = 0; i < count; i++) {
    const seed = await trialSeed('s0', 'sim-' + String(i).padStart(4, '0'));
    const moves = botMoves(seed, opts);
    const result = replayTrial(seed, moves, opts);
    percents.push(result.damagePercent);
    if (result.ended === 'boss') kills += 1;
  }
  percents.sort((a, b) => a - b);
  const mid = count % 2 ? percents[(count - 1) / 2] : (percents[count / 2 - 1] + percents[count / 2]) / 2;
  const proposedBase = Math.round(110 * mid / 70);
  return {
    runs: count,
    character: 'twins',
    chapter: 1,
    variant: 'D1',
    stats: 50,
    median: mid,
    killRate: kills / count,
    kills,
    min: percents[0],
    max: percents[percents.length - 1],
    currentBaseHp: 110,
    proposedBaseHp: proposedBase,
    locked: false,
    note: mid >= 65 && mid <= 75
      ? 'Median sits in the 65–75% band. Leave the 110 base.'
      : 'Proposed base HP ' + proposedBase + ' would center this bot near 70%. The live formula stays at 110.'
  };
}
