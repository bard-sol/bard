import { SIM_ALLIES, cardsForAllies, resolveDeckAllies } from './allies.js';
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

export function bossMaxHp(chapter, variant, base) {
  const ch = Math.max(1, Number(chapter) || 1);
  const hp = base == null ? defaultConfig().trial_base_hp : Number(base);
  const scale = variant === 'D3' ? 9 : 10;
  return Math.floor(hp * (100 + 8 * (ch - 1)) * scale / 1000);
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

function deckFor(charId, allies, penalized) {
  const signatures = SIGNATURES[charId] || SIGNATURES.pip;
  const extra = cardsForAllies(allies, { penalized });
  return GENERICS.concat(signatures, extra).map((card) => ({ ...card }));
}

function bossFor(chapter) {
  return BOSSES[Math.max(0, Math.min(6, chapter - 1))];
}

function intentAt(boss, turn) {
  return boss.pattern[(turn - 1) % boss.pattern.length];
}

function attackPacket(state, intent) {
  const extra = (state.chapter - 1) + (state.variant === 'D3' ? 3 : 0) + state.attackBuff;
  let each = intent.n + extra;
  if (state.bossCutPct) each = Math.floor(each * (100 - state.bossCutPct) / 100);
  return Math.max(0, each - state.bossCut);
}

function attackHits(state, intent) {
  let hits = intent.hits || 1;
  if (intent.growHits) hits = Math.min(intent.maxHits || 4, hits + state.hitBuff);
  return hits;
}

function intentView(state, turn) {
  const at = turn || state.turn;
  const intent = intentAt(state.boss, at);
  const live = at === state.turn ? state : { ...state, bossCut: 0, bossCutPct: 0 };
  if (intent.kind === 'attack') {
    const hits = attackHits(live, intent);
    const each = attackPacket(live, intent);
    return { kind: 'attack', n: each, hits, turn: at, icon: '⚔', label: hits > 1 ? '⚔ ' + each + '×' + hits : '⚔ ' + each };
  }
  if (intent.kind === 'guard') return { kind: 'guard', n: intent.n, turn: at, icon: '🛡', label: '🛡 ' + intent.n };
  if (intent.kind === 'buff') return { kind: 'buff', turn: at, icon: '✦', label: intent.buff === 'heal' ? '✦ heal ' + intent.n : '✦ +' + intent.n + ' ' + intent.buff };
  return { kind: 'debuff', turn: at, icon: '☠', label: '☠ ' + intent.debuff };
}

function revealedIntents(state) {
  if (!state.revealUntil || state.done) return [];
  const out = [];
  const start = Math.max(state.turn + 1, state.revealFrom || 0);
  const end = Math.min(TRIAL_LIMITS.turns, state.revealUntil);
  for (let turn = start; turn <= end; turn++) out.push(intentView(state, turn));
  return out;
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

/**
 * Finisher: if this raw hit would leave the boss at or below 30% of max HP,
 * the whole hit deals floor(raw * 3 / 2), including the hit that crosses the line.
 */
export function finisherAmount(raw, bossHp, bossMax, guard) {
  const amount = Math.max(0, Math.floor(raw));
  const soaked = Math.min(Math.max(0, Math.floor(guard) || 0), amount);
  const projected = bossHp - (amount - soaked);
  if (amount > 0 && bossMax > 0 && projected * 100 <= bossMax * 30) return Math.floor(amount * 3 / 2);
  return amount;
}

function dealToBoss(state, amount) {
  let dmg = Math.max(0, Math.floor(amount));
  if (state.staggered && dmg > 0) dmg = Math.floor(dmg * 3 / 2);
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

function attackBase(state, card) {
  if (card.dealDuringFinisher && state.bossMax > 0 && state.bossHp * 100 <= state.bossMax * 30) return card.dealDuringFinisher;
  if (card.dealIfStaggered && state.staggered) return card.dealIfStaggered;
  return card.deal;
}

function attackDamage(state, card, base) {
  let dmg = scaledValue(base, state.stats[card.stat]);
  if (card.doubleIfOdd && state.turn % 2 === 1) dmg *= 2;
  if (card.doubleIfStaggered && state.staggered) dmg *= 2;
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

function strikeBoss(state, raw) {
  dealToBoss(state, finisherAmount(raw, state.bossHp, state.bossMax, state.bossGuard));
}

function playAttack(state, card) {
  let bonus = 0;
  if (state.combo > 0) {
    bonus = state.combo * state.comboBonus;
    if (!card.keepCombo) state.combo = 0;
  }
  const base = attackBase(state, card);
  const hits = card.hits || 1;
  for (let i = 0; i < hits && !state.done; i++) {
    strikeBoss(state, attackDamage(state, card, base) + (i === 0 ? bonus : 0));
  }
  if (card.againBelowHalf && state.playerHp * 2 < TRIAL_LIMITS.playerHp && !state.done) {
    strikeBoss(state, attackDamage(state, card, card.deal));
  }
  if (card.halveGuard) state.bossGuard = Math.floor(state.bossGuard / 2);
  if (card.lose) hurtPlayer(state, card.lose);
}

function playCard(state, card, move) {
  if (card.type === 'skill') state.combo = Math.min(5, state.combo + 1);
  if (card.copy) {
    if (state.lastCard && state.lastCard.id !== 'forged') playCard(state, state.lastCard, { keep: 0 });
    return;
  }
  if (card.type === 'attack') playAttack(state, card);
  if (card.block) gainBlock(state, scaledValue(card.block, state.stats[card.stat]));
  if (card.keepBlock) {
    let kept = scaledValue(card.keepBlock, state.stats[card.stat]);
    if (state.blockHalved) kept = Math.floor(kept / 2);
    state.blockKeep = Math.max(state.blockKeep || 0, kept);
  }
  if (card.fullBlockEnergy) state.fullBlockEnergy = (state.fullBlockEnergy || 0) + card.fullBlockEnergy;
  if (card.stripGuard) state.bossGuard = Math.max(0, state.bossGuard - scaledValue(card.stripGuard, state.stats[card.stat]));
  if (card.lose && !card.deal) hurtPlayer(state, card.lose);
  if (card.next) state.nextAttack += scaledValue(card.next, state.stats[card.stat]);
  if (card.draw) {
    const drawn = drawCards(state, card.draw);
    if (card.comboIfDrawnAttack && drawn.some((pulled) => pulled.type === 'attack')) {
      state.combo = Math.min(5, state.combo + card.comboIfDrawnAttack);
    }
  }
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
  if (card.bossCutPct) state.bossCutPct = scaledValue(card.bossCutPct, state.stats[card.stat]);
  if (card.revealIntents) {
    state.revealFrom = state.turn + 1;
    state.revealUntil = state.turn + card.revealIntents;
  }
  if (card.keep) state.keep = Number.isInteger(move.keep) ? move.keep : 0;
  state.lastCard = card;
}

function bossAct(state) {
  const intent = intentAt(state.boss, state.turn);
  if (state.staggered && (intent.kind === 'guard' || intent.kind === 'buff')) {
    state.fullBlockEnergy = 0;
    return;
  }
  if (intent.kind === 'attack') {
    const each = attackPacket(state, intent);
    const hits = attackHits(state, intent);
    const incoming = each * hits;
    const absorbed = incoming > 0 && state.playerBlock >= incoming;
    for (let i = 0; i < hits && !state.done; i++) hurtPlayer(state, each);
    if (absorbed && state.playerHp > 0) {
      state.staggerNext = true;
      if (state.fullBlockEnergy) state.energyNext = (state.energyNext || 0) + state.fullBlockEnergy;
    }
    state.bossCut = 0;
    state.bossCutPct = 0;
    state.fullBlockEnergy = 0;
    return;
  }
  state.fullBlockEnergy = 0;
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
  state.bossCutPct = 0;
  state.blockHalved = false;
  if (state.done || state.turn >= TRIAL_LIMITS.turns) {
    state.done = state.done || 'turns';
    return;
  }
  state.turn += 1;
  const keptBlock = state.blockKeep || 0;
  state.blockKeep = 0;
  state.playerBlock = keptBlock;
  state.energy = TRIAL_LIMITS.energy + (state.energyNext || 0);
  state.energyNext = 0;
  state.playedThisTurn = 0;
  state.attacksThisTurn = 0;
  state.skilledThisTurn = false;
  state.blockedThisTurn = false;
  state.coinUsed = false;
  state.lastCard = null;
  state.blockHalved = !!state.blockHalvedNext;
  state.blockHalvedNext = false;
  state.staggered = !!state.staggerNext;
  state.staggerNext = false;
  drawCards(state, TRIAL_LIMITS.draw);
  tickHexOpen(state);
}

function createState(seedHex, opts) {
  const ctx = opts || trialContext({ charId: 'twins', chapter: 1, now: seasonStartMs() });
  const boss = bossFor(ctx.chapter);
  const rng = rngFromSeed(seedHex);
  const picked = Array.isArray(ctx.allies) && ctx.allies.length >= 2 && ctx.allyVotes == null
    ? { allies: ctx.allies.slice(0, 2), autoPicked: !!ctx.autoPicked }
    : resolveDeckAllies({ allies: ctx.allies, votes: ctx.allyVotes || [], previous: ctx.previousAllies });
  const state = {
    rng,
    boss,
    chapter: ctx.chapter,
    variant: ctx.variant,
    stats: ctx.stats,
    charId: ctx.charId,
    inDanger: !!ctx.inDanger,
    comboBonus: ctx.comboBonus == null ? defaultConfig().trial_combo_bonus : Number(ctx.comboBonus),
    combo: 0,
    staggered: false,
    staggerNext: false,
    passive: PASSIVES[ctx.charId] || {},
    allies: picked.allies,
    autoPicked: picked.autoPicked,
    penalizedAllies: Array.isArray(ctx.penalizedAllies) ? ctx.penalizedAllies.slice() : [],
    deck: Array.isArray(ctx.fixedDeck) && ctx.fixedDeck.length
      ? ctx.fixedDeck.map((card) => ({ ...card }))
      : shuffle(deckFor(ctx.charId, picked.allies, ctx.penalizedAllies), rng),
    discard: [],
    hand: [],
    turn: 1,
    energy: TRIAL_LIMITS.energy,
    playerHp: TRIAL_LIMITS.playerHp,
    playerBlock: 0,
    bossMax: bossMaxHp(ctx.chapter, ctx.variant, ctx.baseHp),
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
    bossCutPct: 0,
    revealFrom: 0,
    revealUntil: 0,
    blockKeep: 0,
    energyNext: 0,
    fullBlockEnergy: 0,
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
  state.deckSize = state.deck.length;
  state.bossHp = Number.isFinite(ctx.openingBossHp) ? Math.max(0, Math.min(state.bossMax, ctx.openingBossHp)) : state.bossMax;
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
  let hp = state.bossHp;
  let first = true;
  const base = attackBase(state, card);
  const hit = () => {
    let raw = attackDamage(ghost, card, base);
    if (first && state.combo > 0) raw += state.combo * state.comboBonus;
    first = false;
    raw = finisherAmount(raw, hp, state.bossMax, state.bossGuard);
    if (state.staggered && raw > 0) raw = Math.floor(raw * 3 / 2);
    const soaked = Math.min(state.bossGuard, raw);
    hp = Math.max(0, hp - (raw - soaked));
    return raw;
  };
  let total = hit();
  for (let extra = 1; extra < (card.hits || 1); extra++) total += hit();
  if (card.againBelowHalf && state.playerHp * 2 < TRIAL_LIMITS.playerHp) total += hit();
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
    ally: !!card.ally,
    keepCombo: !!card.keepCombo,
    art: card.art || null,
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
    allies: state.allies,
    autoPicked: !!state.autoPicked,
    deckSize: state.deckSize,
    bossHp: state.bossHp,
    bossMax: state.bossMax,
    bossGuard: state.bossGuard,
    dealt: state.dealt,
    damagePercent: percent,
    accuracy: Math.min(1, percent / 100),
    intent: state.done ? null : intentView(state),
    revealed: revealedIntents(state),
    hand: state.hand.map((card, index) => publicCard(state, card, index)),
    passive: state.passive.text || '',
    underdog: state.inDanger ? 2 : 0,
    combo: state.combo,
    comboBonus: state.comboBonus,
    staggered: !!state.staggered,
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

function candidateMoves(view) {
  const moves = [];
  for (const card of view.hand || []) {
    if (card.playable === false) continue;
    if (card.cost > view.energy) continue;
    moves.push({ type: 'play', card: card.index });
  }
  moves.push({ type: 'end' });
  return moves;
}

function horizonSpend(after) {
  if (!after || after.done) return 0;
  const comboExtra = (after.combo || 0) * (after.comboBonus || 0);
  const attacks = (after.hand || [])
    .filter((card) => card.preview > 0 && card.playable !== false)
    .map((card) => ({
      cost: card.cost || 0,
      full: card.preview,
      rest: Math.max(0, card.preview - comboExtra)
    }))
    .sort((a, b) => b.full - a.full);
  let energy = after.energy == null ? 3 : after.energy;
  let spend = 0;
  let comboLeft = (after.combo || 0) > 0;
  for (const card of attacks) {
    if (card.cost > energy) continue;
    spend += comboLeft ? card.full : card.rest;
    if (!card.keepCombo) comboLeft = false;
    energy -= card.cost;
  }
  if (after.staggered && after.intent && (after.intent.kind === 'guard' || after.intent.kind === 'buff')) {
    spend += after.intent.n || 0;
  }
  return spend;
}

function lineScore(root, after) {
  if (!after || !after.ok) return -1e9;
  const gained = after.dealt - root.dealt;
  if (after.bossHp <= 0 || after.ended === 'boss') return 100000 + after.playerHp + gained;
  if (after.playerHp <= 0 || after.ended === 'death') return gained - 10000;
  return (gained + horizonSpend(after)) * 100 + after.playerHp * 2 + after.playerBlock;
}

function setupScore(after) {
  if (!after || !after.ok) return -1e9;
  const incoming = after.intent && after.intent.kind === 'attack' ? after.intent.n * (after.intent.hits || 1) : 0;
  const armed = incoming > 0 && after.playerBlock >= incoming ? 1 : 0;
  return (after.combo || 0) * 10 + armed * 40 + (after.staggered ? 25 : 0) + after.playerBlock;
}

function endsPlayed(extra) {
  let count = 0;
  for (const move of extra) if (move && move.type === 'end') count += 1;
  return count;
}

/**
 * Beam of width 20. It finishes the current turn and plays the next one,
 * so Combo carried across the turn and a Stagger set up now are both scored.
 * Returns the first move of the best line.
 */
export function chooseLookaheadPlay(seedHex, moves, opts) {
  const root = replayTrial(seedHex, moves, opts);
  if (!root.ok || root.done) return null;
  let beam = [{ extra: [] }];
  const finished = [];
  for (let depth = 0; depth < 16 && beam.length; depth++) {
    const ongoing = [];
    for (const node of beam) {
      const view = replayTrial(seedHex, moves.concat(node.extra), opts);
      if (!view.ok || view.done) {
        if (node.extra.length) finished.push({ extra: node.extra, score: lineScore(root, view) });
        continue;
      }
      for (const move of candidateMoves(view)) {
        const extra = node.extra.concat([move]);
        const after = replayTrial(seedHex, moves.concat(extra), opts);
        if (!after.ok) continue;
        const closed = !!after.done || endsPlayed(extra) >= 2;
        const scored = { extra, score: lineScore(root, after), setup: setupScore(after) };
        if (closed) finished.push(scored);
        else ongoing.push(scored);
      }
    }
    const byScore = ongoing.slice().sort((a, b) => b.score - a.score || b.setup - a.setup);
    const bySetup = ongoing.slice().sort((a, b) => b.setup - a.setup || b.score - a.score);
    const kept = [];
    const seen = new Set();
    const take = (list, limit) => {
      for (const item of list) {
        if (kept.length >= limit) return;
        const key = JSON.stringify(item.extra);
        if (seen.has(key)) continue;
        seen.add(key);
        kept.push(item);
      }
    };
    // Damage lines fill most of the beam. Reserved slots keep Combo and full-block
    // lines alive until the next turn, where Stagger and the combo bonus are scored.
    take(byScore, 12);
    take(bySetup, 20);
    take(byScore, 20);
    beam = kept;
  }
  if (!finished.length) return { type: 'end' };
  finished.sort((a, b) => b.score - a.score || a.extra.length - b.extra.length);
  return finished[0].extra[0] || { type: 'end' };
}

export function lookaheadMoves(seedHex, opts) {
  const moves = [];
  for (let guard = 0; guard < 40; guard++) {
    const next = chooseLookaheadPlay(seedHex, moves, opts);
    if (!next) break;
    moves.push(next);
    const view = replayTrial(seedHex, moves, opts);
    if (!view.ok || view.done || moves.length >= TRIAL_LIMITS.moves) break;
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

function trialBotOpts(baseHp, comboBonus) {
  const base = baseHp == null ? defaultConfig().trial_base_hp : Number(baseHp);
  const bonus = comboBonus == null ? defaultConfig().trial_combo_bonus : Number(comboBonus);
  const opts = trialContext({ charId: 'twins', chapter: 1, now: seasonStartMs(), inDanger: false });
  opts.baseHp = base;
  opts.comboBonus = bonus;
  return opts;
}

function targetsMet(greedy, lookahead) {
  const gap = lookahead.median - greedy.median;
  return greedy.median >= 55 && greedy.median <= 70 && gap >= 15 && lookahead.killRate >= 0.2 && lookahead.killRate <= 0.35;
}

async function summarizeBot(runs, opts, play) {
  const count = Math.max(1, Number(runs) || 300);
  const percents = [];
  let kills = 0;
  for (let i = 0; i < count; i++) {
    const seed = await trialSeed('s0', 'sim-' + String(i).padStart(4, '0'));
    const moves = play(seed, opts);
    const result = replayTrial(seed, moves, opts);
    percents.push(result.damagePercent);
    if (result.ended === 'boss') kills += 1;
  }
  percents.sort((a, b) => a - b);
  const median = count % 2 ? percents[(count - 1) / 2] : (percents[count / 2 - 1] + percents[count / 2]) / 2;
  return {
    runs: count,
    median,
    killRate: kills / count,
    kills,
    min: percents[0],
    max: percents[percents.length - 1]
  };
}

function pairOpts(allies) {
  const opts = trialBotOpts(defaultConfig().trial_base_hp, defaultConfig().trial_combo_bonus);
  opts.allies = (allies || SIM_ALLIES).slice();
  return opts;
}

/** Lookahead kill rate for one ally pair. Base HP stays at the locked config value. */
export async function simulateAllyPair(runs, allies) {
  const opts = pairOpts(allies);
  const lookahead = await summarizeBot(runs, opts, lookaheadMoves);
  return {
    allies: opts.allies,
    runs: lookahead.runs,
    median: lookahead.median,
    killRate: lookahead.killRate,
    kills: lookahead.kills
  };
}

/** Greedy and lookahead for one ally pair on the Twins. Base HP stays locked. */
export async function simulateAllyPairBots(runs, allies) {
  const opts = pairOpts(allies);
  const greedy = await summarizeBot(runs, opts, botMoves);
  const lookahead = await summarizeBot(runs, opts, lookaheadMoves);
  return {
    allies: opts.allies,
    runs: lookahead.runs,
    greedyMedian: greedy.median,
    greedyKills: greedy.killRate,
    median: lookahead.median,
    killRate: lookahead.killRate,
    kills: lookahead.kills,
    gap: lookahead.median - greedy.median
  };
}

/** Greedy bot over `runs` seeds. Chapter 1, plain day, flat 50 stats (the Twins). */
export async function simulateTrialMedian(runs, baseHp, comboBonus) {
  const opts = trialBotOpts(baseHp, comboBonus);
  const summary = await summarizeBot(runs, opts, botMoves);
  return {
    ...summary,
    character: 'twins',
    chapter: 1,
    variant: 'D1',
    stats: 50,
    currentBaseHp: opts.baseHp,
    comboBonus: opts.comboBonus,
    bossHp: bossMaxHp(1, 'D1', opts.baseHp)
  };
}

export async function simulateLookahead(runs, baseHp, comboBonus) {
  const opts = trialBotOpts(baseHp, comboBonus);
  const summary = await summarizeBot(runs, opts, lookaheadMoves);
  return { ...summary, currentBaseHp: opts.baseHp, comboBonus: opts.comboBonus };
}

/**
 * Start at Combo +3 and HP 80. If the targets miss, raise Combo to +4, then move HP by 5.
 * Too many lookahead kills or a greedy median above 70 raises HP. Too few kills, a short
 * gap, or a greedy median below 55 lowers it.
 */
export async function tuneTrialV2(runs) {
  let baseHp = 80;
  let comboBonus = 3;
  let comboRaised = false;
  const steps = [];
  let greedy;
  let lookahead;
  const seen = new Set();
  for (let step = 0; step < 12; step++) {
    const key = comboBonus + ':' + baseHp;
    if (seen.has(key)) break;
    seen.add(key);
    const opts = trialBotOpts(baseHp, comboBonus);
    greedy = await summarizeBot(runs, opts, botMoves);
    lookahead = await summarizeBot(runs, opts, lookaheadMoves);
    const gap = lookahead.median - greedy.median;
    const met = targetsMet(greedy, lookahead);
    const row = {
      baseHp,
      comboBonus,
      greedyMedian: greedy.median,
      greedyKills: greedy.killRate,
      lookaheadMedian: lookahead.median,
      lookaheadKills: lookahead.killRate,
      gap,
      met
    };
    steps.push(row);
    if (typeof process !== 'undefined' && process.stderr) {
      process.stderr.write('trial-v2 ' + JSON.stringify(row) + '\n');
    }
    if (met) break;
    if (!comboRaised) {
      comboBonus = 4;
      comboRaised = true;
      continue;
    }
    const tooStrong = lookahead.killRate > 0.35 || greedy.median > 70;
    const tooWeak = lookahead.killRate < 0.2 || greedy.median < 55;
    if (tooStrong) baseHp += 5;
    else if (tooWeak || gap < 15) baseHp -= 5;
    if (baseHp < 40 || baseHp > 160) break;
  }
  const last = steps[steps.length - 1];
  return {
    baseHp: last.baseHp,
    comboBonus: last.comboBonus,
    greedy,
    lookahead,
    met: last.met,
    steps
  };
}

/** Locked 12-card check for the auto-fill pair. Base HP is not changed. */
export async function tuneAllyDeck(runs) {
  const row = await simulateAllyPair(runs, SIM_ALLIES);
  return {
    baseHp: defaultConfig().trial_base_hp,
    comboBonus: defaultConfig().trial_combo_bonus,
    allies: row.allies,
    lookaheadKills: row.killRate,
    lookaheadMedian: row.median,
    met: row.killRate >= 0.15 && row.killRate <= 0.35
  };
}
