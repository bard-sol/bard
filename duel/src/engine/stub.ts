// @ts-nocheck — fixture-only stand-in. The live match uses engine/v1.
import { CATALOG, LEGENDS, PAGES } from './stub-catalog.js';
import type {
  CardDef,
  CardInstance,
  CardView,
  Deck,
  GameAction,
  GameState,
  LegendView,
  MarginaliaInPlay,
  MarginaliaView,
  PageDef,
  PageView,
  PlayerId,
  PlayerState,
  PlayerView,
  PublicEvent,
  Unit,
  UnitView,
} from '../types.js';
import { hashString, mulberry32, shuffle, stableStringify } from './rng.js';

/**
 * Tiny stand-in for the Gameplay rules engine.
 * Verses to 8, 7 turns, 2 Pages, 4 slots a side, Ink to 7.
 * Keywords that actually resolve: Swift, Ward, and Marginalia-on-attack.
 * `initialState → legalActions → apply` is a pure function of the decks,
 * the seed, and the action list.
 */

export const STUB_AI_VERSION = 'stub-pilot-v1';
export const VERSE_GOAL = 8;
export const MAX_TURNS = 7;
export const MAX_INK = 7;
export const SLOTS = [0, 1, 2, 3] as const;
const MAX_NOTES_PER_PAGE = 2;

export class IllegalActionError extends Error {
  readonly code = 'illegal_action' as const;
  constructor() {
    super('illegal_action');
    this.name = 'IllegalActionError';
  }
}

export function sameAction(a: GameAction, b: GameAction): boolean {
  return stableStringify(a) === stableStringify(b);
}

export function actorOf(state: GameState): PlayerId | null {
  if (state.winner != null || state.phase === 'game_over') return null;
  if (state.phase === 'mulligan') return state.priority;
  return state.active;
}

export function initialState(decks: readonly [Deck, Deck], seed: string): GameState {
  const pages = drawPages(seed);
  const state: GameState = {
    active: 0,
    priority: 0,
    phase: 'mulligan',
    verse: [0, 0],
    verseGoal: VERSE_GOAL,
    maxTurns: MAX_TURNS,
    turnsCompleted: [0, 0],
    turnIndex: [0, 0],
    winner: null,
    winReason: null,
    tiebreak: (hashString(`${seed}:tiebreak`) & 1) as PlayerId,
    pages,
    units: [],
    marginalia: [],
    players: [makePlayer(decks[0], 0, seed), makePlayer(decks[1], 1, seed)],
    nextEventId: 1,
    events: [],
    revealed: [],
  };
  drawCards(state, 0, 4);
  drawCards(state, 1, 5);
  state.players[1].hand.push({ instanceId: 'p1-spare', defId: 'spare-ink', owner: 1 });
  return state;
}

export function legalActions(state: GameState, player: PlayerId): GameAction[] {
  const actor = actorOf(state);
  if (actor !== player) return [];
  if (state.phase === 'mulligan') return [{ type: 'mulligan', replace: [] }];

  const actions: GameAction[] = [];
  const me = state.players[player];

  if (state.phase === 'main') {
    for (const card of me.hand) {
      const def = mustDef(card.defId);
      if (def.cost > me.ink) continue;
      if (def.type === 'character') {
        for (const page of [0, 1] as const) {
          for (const slot of SLOTS) {
            if (!occupied(state, page, player, slot)) {
              actions.push({ type: 'play_character', instanceId: card.instanceId, page, slot });
            }
          }
        }
      } else if (def.type === 'inkwork') {
        if (def.effect?.kind === 'ink') {
          actions.push({ type: 'play_inkwork', instanceId: card.instanceId, targetId: null });
        } else if (def.effect?.kind === 'damage') {
          for (const unit of state.units) {
            actions.push({ type: 'play_inkwork', instanceId: card.instanceId, targetId: unit.instanceId });
          }
        }
      } else if (def.type === 'marginalia') {
        for (const page of [0, 1] as const) {
          const count = state.marginalia.filter((note) => note.page === page && note.owner === player).length;
          if (count < MAX_NOTES_PER_PAGE) {
            actions.push({ type: 'play_marginalia', instanceId: card.instanceId, page });
          }
        }
      }
    }

    if (!me.powerUsed && me.ink >= legendOf(me.legendId).powerCost) {
      for (const ally of state.units.filter((unit) => unit.owner === player)) {
        actions.push({ type: 'legend_power', targetId: ally.instanceId });
      }
    }

    actions.push({ type: 'end_main' });
    actions.push({ type: 'end_turn' });
  }

  if (state.phase === 'fight') {
    const ready = state.units.filter((unit) => unit.owner === player && !unit.exhausted);
    for (const attacker of ready) {
      for (const defender of state.units) {
        if (defender.owner !== player && defender.page === attacker.page) {
          actions.push({ type: 'attack', attackerId: attacker.instanceId, defenderId: defender.instanceId });
        }
      }
      const other = attacker.page === 0 ? 1 : 0;
      for (const slot of SLOTS) {
        if (!occupied(state, other, player, slot)) {
          actions.push({ type: 'move', unitId: attacker.instanceId, page: other, slot });
        }
      }
    }
    actions.push({ type: 'end_turn' });
  }

  actions.sort((a, b) => (stableStringify(a) < stableStringify(b) ? -1 : stableStringify(a) > stableStringify(b) ? 1 : 0));
  return actions;
}

export function isLegal(state: GameState, player: PlayerId, action: GameAction): boolean {
  if (actorOf(state) !== player) return false;
  if (action.type === 'mulligan') return validMulligan(state, player, action.replace);
  return legalActions(state, player).some((candidate) => sameAction(candidate, action));
}

export function apply(state: GameState, action: GameAction): GameState {
  const actor = actorOf(state);
  if (actor == null || !isLegal(state, actor, action)) throw new IllegalActionError();
  const next = structuredClone(state);
  switch (action.type) {
    case 'mulligan':
      performMulligan(next, actor, action.replace);
      break;
    case 'play_character':
      playCharacter(next, actor, action.instanceId, action.page, action.slot);
      break;
    case 'play_inkwork':
      playInkwork(next, actor, action.instanceId, action.targetId);
      break;
    case 'play_marginalia':
      playMarginalia(next, actor, action.instanceId, action.page);
      break;
    case 'legend_power':
      playPower(next, actor, action.targetId);
      break;
    case 'attack':
      resolveAttack(next, actor, action.attackerId, action.defenderId);
      break;
    case 'move':
      resolveMove(next, actor, action.unitId, action.page, action.slot);
      break;
    case 'end_main':
      next.phase = 'fight';
      break;
    case 'end_turn':
      finishTurn(next);
      break;
    default: {
      const never: never = action;
      throw new IllegalActionError();
    }
  }
  return next;
}

export function view(state: GameState, player: PlayerId): PlayerView {
  const foe: PlayerId = player === 0 ? 1 : 0;
  const me = state.players[player];
  const them = state.players[foe];
  return {
    you: player,
    active: state.active,
    phase: state.phase,
    yourTurn: actorOf(state) === player,
    turn: [state.turnIndex[0], state.turnIndex[1]],
    turnsCompleted: [state.turnsCompleted[0], state.turnsCompleted[1]],
    maxTurns: state.maxTurns,
    verse: [state.verse[0], state.verse[1]],
    verseGoal: state.verseGoal,
    winner: state.winner,
    winReason: state.winReason,
    pages: [0, 1].map((index) => pageView(state, index as 0 | 1, player, foe)) as [PageView, PageView],
    youLegend: legendView(me.legendId, me.powerUsed),
    foeLegend: legendView(them.legendId, them.powerUsed),
    hand: me.hand.map(cardView),
    foeHandCount: them.hand.length,
    yourDeckCount: me.deck.length,
    foeDeckCount: them.deck.length,
    ink: me.ink,
    maxInk: me.maxInk,
    foeInk: them.ink,
    foeMaxInk: them.maxInk,
    foePowerUsed: them.powerUsed,
    events: state.events.slice(-16),
  };
}

function pageView(state: GameState, index: 0 | 1, player: PlayerId, foe: PlayerId): PageView {
  const page = state.pages[index];
  return {
    index,
    name: page.name,
    rule: page.rule,
    slots: SLOTS.map((slot) => ({
      index: slot,
      you: unitToView(findUnit(state, index, player, slot)),
      foe: unitToView(findUnit(state, index, foe, slot)),
    })),
    marginalia: state.marginalia
      .filter((note) => note.page === index)
      .map((note, ordinal) => marginaliaToView(note, ordinal, player)),
  };
}

function marginaliaToView(note: MarginaliaInPlay, ordinal: number, viewer: PlayerId): MarginaliaView {
  const known = note.owner === viewer || !note.faceDown;
  const def = CATALOG[note.defId];
  return {
    instanceId: known ? note.instanceId : `sealed-${note.page}-${ordinal}`,
    page: note.page,
    owner: note.owner,
    faceDown: note.faceDown,
    known,
    name: known && def ? def.name : null,
    text: known && def ? def.text : null,
    glyph: known && def ? def.glyph : null,
  };
}

function unitToView(unit: Unit | null): UnitView | null {
  if (!unit) return null;
  const def = mustDef(unit.defId);
  return {
    instanceId: unit.instanceId,
    defId: unit.defId,
    name: def.name,
    owner: unit.owner,
    attack: unit.attack,
    health: unit.health,
    maxHealth: unit.maxHealth,
    exhausted: unit.exhausted,
    warded: unit.warded,
    keywords: unit.keywords.slice(),
    glyph: def.glyph,
    house: def.house,
    page: unit.page,
    slot: unit.slot,
  };
}

function cardView(card: CardInstance): CardView {
  const def = mustDef(card.defId);
  return {
    instanceId: card.instanceId,
    defId: def.id,
    name: def.name,
    type: def.type,
    house: def.house,
    cost: def.cost,
    attack: def.attack,
    health: def.health,
    keywords: def.keywords.slice(),
    text: def.text,
    glyph: def.glyph,
  };
}

function legendView(id: string, powerUsed: boolean): LegendView {
  const legend = legendOf(id);
  return {
    id: legend.id,
    name: legend.name,
    house: legend.house,
    powerName: legend.powerName,
    powerText: legend.powerText,
    powerCost: legend.powerCost,
    powerUsed,
  };
}

function makePlayer(deck: Deck, owner: PlayerId, seed: string): PlayerState {
  if (!LEGENDS[deck.legendId]) throw new Error(`unknown legend ${deck.legendId}`);
  const cards = deck.cards.map((defId, index) => {
    if (!CATALOG[defId] || defId === 'spare-ink') throw new Error(`unknown card ${defId}`);
    return { instanceId: `p${owner}-${index}-${defId}`, defId, owner };
  });
  const rand = mulberry32(hashString(`${seed}:deck:${owner}`));
  return {
    legendId: deck.legendId,
    deck: shuffle(cards, rand),
    hand: [],
    ink: 0,
    maxInk: 0,
    powerUsed: false,
  };
}

function drawPages(seed: string): [PageDef, PageDef] {
  const rand = mulberry32(hashString(`${seed}:pages`));
  const drawn = shuffle(PAGES, rand);
  const first = drawn[0];
  const second = drawn[1];
  if (!first || !second) throw new Error('page pool is short');
  return [
    { id: first.id, name: first.name, rule: first.rule },
    { id: second.id, name: second.name, rule: second.rule },
  ];
}

function drawCards(state: GameState, player: PlayerId, count: number) {
  const pile = state.players[player];
  for (let i = 0; i < count; i++) {
    const card = pile.deck.shift();
    if (!card) return;
    pile.hand.push(card);
  }
}

function validMulligan(state: GameState, player: PlayerId, replace: string[]): boolean {
  if (state.phase !== 'mulligan' || state.priority !== player) return false;
  if (replace.length > state.players[player].hand.length) return false;
  const seen = new Set<string>();
  for (const id of replace) {
    if (seen.has(id)) return false;
    seen.add(id);
    if (!state.players[player].hand.some((card) => card.instanceId === id)) return false;
  }
  return true;
}

function performMulligan(state: GameState, player: PlayerId, replace: string[]) {
  const pile = state.players[player];
  const returned: CardInstance[] = [];
  for (const id of replace) {
    const index = pile.hand.findIndex((card) => card.instanceId === id);
    const [card] = pile.hand.splice(index, 1);
    if (card) returned.push(card);
  }
  drawCards(state, player, returned.length);
  pile.deck.push(...returned);
  pushEvent(state, {
    kind: 'mulligan',
    player,
    text: replace.length === 0 ? `${legendName(state, player)} keeps.` : `${legendName(state, player)} replaces ${replace.length}.`,
  });
  if (player === 0) {
    state.priority = 1;
    return;
  }
  beginTurn(state, 0);
}

function beginTurn(state: GameState, player: PlayerId) {
  if (state.winner) return;
  const pile = state.players[player];
  pile.maxInk = Math.min(MAX_INK, pile.maxInk + 1);
  pile.ink = pile.maxInk;
  pile.powerUsed = false;
  state.active = player;
  state.priority = player;
  state.turnIndex[player] += 1;
  for (const unit of state.units) {
    if (unit.owner === player) unit.exhausted = false;
  }
  for (const page of [0, 1] as const) {
    const present = state.units.filter((unit) => unit.page === page);
    if (present.length > 0 && present.every((unit) => unit.owner === player)) {
      state.verse[player] += 1;
      pushEvent(state, {
        kind: 'hold',
        player,
        text: `${legendName(state, player)} holds ${state.pages[page].name}. +1 Verse.`,
      });
    }
  }
  if (checkVerseWin(state)) return;
  const before = pile.hand.length;
  drawCards(state, player, 1);
  if (pile.hand.length > before) {
    pushEvent(state, { kind: 'draw', player, text: `${legendName(state, player)} draws.` });
  }
  state.phase = 'main';
}

function finishTurn(state: GameState) {
  const player = state.active;
  state.turnsCompleted[player] += 1;
  if (checkVerseWin(state)) return;
  if (state.turnsCompleted[0] >= state.maxTurns && state.turnsCompleted[1] >= state.maxTurns) {
    resolveTie(state);
    closeMatch(state);
    return;
  }
  beginTurn(state, player === 0 ? 1 : 0);
}

function checkVerseWin(state: GameState): boolean {
  if (state.winner) return true;
  const reached0 = state.verse[0] >= state.verseGoal;
  const reached1 = state.verse[1] >= state.verseGoal;
  if (!reached0 && !reached1) return false;
  if (reached0 && reached1) resolveTie(state);
  else {
    state.winner = reached0 ? 0 : 1;
    state.winReason = 'verse';
  }
  closeMatch(state);
  return true;
}

function resolveTie(state: GameState) {
  if (state.verse[0] !== state.verse[1]) {
    state.winner = state.verse[0] > state.verse[1] ? 0 : 1;
    state.winReason = 'verse';
    return;
  }
  const health0 = boardHealth(state, 0);
  const health1 = boardHealth(state, 1);
  if (health0 !== health1) {
    state.winner = health0 > health1 ? 0 : 1;
    state.winReason = 'health';
    return;
  }
  state.winner = state.tiebreak;
  state.winReason = 'tiebreak';
}

function closeMatch(state: GameState) {
  state.phase = 'game_over';
  const winner = state.winner ?? 0;
  const reason = state.winReason === 'verse' ? 'Verse' : state.winReason === 'health' ? 'board health' : 'the final tiebreak';
  pushEvent(state, {
    kind: 'win',
    player: winner,
    text: `${legendName(state, winner)} wins on ${reason}.`,
  });
}

function boardHealth(state: GameState, player: PlayerId): number {
  return state.units.filter((unit) => unit.owner === player).reduce((sum, unit) => sum + Math.max(0, unit.health), 0);
}

function playCharacter(state: GameState, player: PlayerId, instanceId: string, page: 0 | 1, slot: 0 | 1 | 2 | 3) {
  const card = takeHand(state, player, instanceId);
  const def = mustDef(card.defId);
  state.players[player].ink -= def.cost;
  state.revealed.push(card.defId);
  state.units.push({
    instanceId: card.instanceId,
    defId: card.defId,
    owner: player,
    attack: def.attack ?? 0,
    health: def.health ?? 1,
    maxHealth: def.health ?? 1,
    exhausted: !def.keywords.includes('Swift'),
    warded: def.keywords.includes('Ward'),
    page,
    slot,
    keywords: def.keywords.slice(),
  });
  pushEvent(state, {
    kind: 'play',
    player,
    text: `${legendName(state, player)} plays ${def.name} on ${state.pages[page].name}.`,
  });
}

function playInkwork(state: GameState, player: PlayerId, instanceId: string, targetId: string | null) {
  const card = takeHand(state, player, instanceId);
  const def = mustDef(card.defId);
  state.players[player].ink -= def.cost;
  state.revealed.push(card.defId);
  if (def.effect?.kind === 'ink') {
    state.players[player].ink += def.effect.amount;
    pushEvent(state, { kind: 'play', player, text: `${legendName(state, player)} spends Spare Ink.` });
    return;
  }
  const target = state.units.find((unit) => unit.instanceId === targetId);
  if (!target || def.effect?.kind !== 'damage') throw new IllegalActionError();
  const amount = def.effect.amount;
  const warded = target.warded;
  hurt(target, amount);
  const targetName = mustDef(target.defId).name;
  pushEvent(state, {
    kind: 'play',
    player,
    text: warded ? `${def.name} breaks Ward on ${targetName}.` : `${def.name} deals ${amount} to ${targetName}.`,
  });
  reap(state);
}

function playMarginalia(state: GameState, player: PlayerId, instanceId: string, page: 0 | 1) {
  const card = takeHand(state, player, instanceId);
  const def = mustDef(card.defId);
  state.players[player].ink -= def.cost;
  state.marginalia.push({
    instanceId: card.instanceId,
    defId: card.defId,
    owner: player,
    page,
    faceDown: true,
    amount: def.effect?.amount ?? 2,
  });
  pushEvent(state, {
    kind: 'play',
    player,
    text: `${legendName(state, player)} sets a margin note on ${state.pages[page].name}.`,
  });
}

function playPower(state: GameState, player: PlayerId, targetId: string) {
  const pile = state.players[player];
  const legend = legendOf(pile.legendId);
  const target = state.units.find((unit) => unit.instanceId === targetId && unit.owner === player);
  if (!target) throw new IllegalActionError();
  pile.ink -= legend.powerCost;
  pile.powerUsed = true;
  if (legend.power.kind === 'heal') {
    target.health = Math.min(target.maxHealth, target.health + legend.power.amount);
    pushEvent(state, {
      kind: 'power',
      player,
      text: `${legend.name} restores ${legend.power.amount} to ${mustDef(target.defId).name}.`,
    });
    return;
  }
  target.attack += legend.power.amount;
  pushEvent(state, {
    kind: 'power',
    player,
    text: `${legend.name} gives ${mustDef(target.defId).name} +${legend.power.amount} attack.`,
  });
}

function resolveAttack(state: GameState, player: PlayerId, attackerId: string, defenderId: string) {
  const attacker = state.units.find((unit) => unit.instanceId === attackerId && unit.owner === player);
  const defender = state.units.find((unit) => unit.instanceId === defenderId && unit.owner !== player);
  if (!attacker || !defender || attacker.page !== defender.page) throw new IllegalActionError();
  const page = attacker.page;
  const hadEnemies = state.units.some((unit) => unit.page === page && unit.owner !== player);
  const trap = state.marginalia.find((note) => note.faceDown && note.page === page && note.owner !== player);
  if (trap) {
    hurt(attacker, trap.amount);
    state.marginalia = state.marginalia.filter((note) => note.instanceId !== trap.instanceId);
    pushEvent(state, {
      kind: 'trap',
      player: player === 0 ? 1 : 0,
      text: `A margin note on ${state.pages[page].name} strikes first.`,
    });
  }
  if (attacker.health <= 0) {
    reap(state);
    return;
  }
  const attackerName = mustDef(attacker.defId).name;
  const defenderName = mustDef(defender.defId).name;
  hurt(defender, attacker.attack);
  hurt(attacker, defender.attack);
  attacker.exhausted = true;
  pushEvent(state, {
    kind: 'attack',
    player,
    text: `${attackerName} strikes ${defenderName}.`,
  });
  reap(state);
  const remaining = state.units.filter((unit) => unit.page === page);
  const friends = remaining.filter((unit) => unit.owner === player);
  const enemies = remaining.filter((unit) => unit.owner !== player);
  if (hadEnemies && enemies.length === 0 && friends.length > 0 && !state.winner) {
    state.verse[player] += 1;
    pushEvent(state, {
      kind: 'conquer',
      player,
      text: `${legendName(state, player)} conquers ${state.pages[page].name}. +1 Verse.`,
    });
    checkVerseWin(state);
  }
}

function resolveMove(state: GameState, player: PlayerId, unitId: string, page: 0 | 1, slot: 0 | 1 | 2 | 3) {
  const unit = state.units.find((candidate) => candidate.instanceId === unitId && candidate.owner === player);
  if (!unit) throw new IllegalActionError();
  unit.page = page;
  unit.slot = slot;
  unit.exhausted = true;
  pushEvent(state, {
    kind: 'move',
    player,
    text: `${mustDef(unit.defId).name} moves to ${state.pages[page].name}.`,
  });
}

function hurt(unit: Unit, amount: number) {
  if (amount <= 0) return;
  if (unit.warded) {
    unit.warded = false;
    return;
  }
  unit.health -= amount;
}

function reap(state: GameState) {
  state.units = state.units.filter((unit) => unit.health > 0);
}

function takeHand(state: GameState, player: PlayerId, instanceId: string): CardInstance {
  const hand = state.players[player].hand;
  const index = hand.findIndex((card) => card.instanceId === instanceId);
  if (index < 0) throw new IllegalActionError();
  const [card] = hand.splice(index, 1);
  if (!card) throw new IllegalActionError();
  return card;
}

function occupied(state: GameState, page: 0 | 1, owner: PlayerId, slot: number): boolean {
  return state.units.some((unit) => unit.page === page && unit.owner === owner && unit.slot === slot);
}

function findUnit(state: GameState, page: 0 | 1, owner: PlayerId, slot: number): Unit | null {
  return state.units.find((unit) => unit.page === page && unit.owner === owner && unit.slot === slot) ?? null;
}

function pushEvent(state: GameState, event: Omit<PublicEvent, 'id'>) {
  state.events.push({ id: state.nextEventId, ...event });
  state.nextEventId += 1;
  if (state.events.length > 80) state.events.splice(0, state.events.length - 80);
}

function legendName(state: GameState, player: PlayerId): string {
  return legendOf(state.players[player].legendId).name;
}

function legendOf(id: string) {
  const legend = LEGENDS[id];
  if (!legend) throw new Error(`unknown legend ${id}`);
  return legend;
}

function mustDef(id: string): CardDef {
  const def = CATALOG[id];
  if (!def) throw new Error(`unknown card ${id}`);
  return def;
}
