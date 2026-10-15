import { cardById, clientLog, clientView, LEGENDS, PAGES, type CardData, type LogProjection } from '../../engine/active.mjs';
import type { EngineState } from './state.js';
import type {
  CardType,
  CardView,
  Glyph,
  LegendView,
  MarginaliaView,
  PageView,
  PlayerId,
  PlayerView,
  PublicEvent,
  UnitView,
  WinReason,
} from '../types.js';

const POWER_LABEL: Record<string, string> = {
  old_wick: 'Kindle',
  ash_ember: 'Edge',
  juniper: 'Shift',
};

/**
 * Project the engine's redacted clientView and clientLog into the board view.
 * Hidden zones are read only through those two functions.
 */
export function projectView(state: EngineState, player: PlayerId): PlayerView {
  const raw = clientView(state, player);
  const log = clientLog(state, player);
  const foe: PlayerId = player === 0 ? 1 : 0;
  const actor: PlayerId | null = raw.phase === 'over' ? null : raw.phase === 'mulligan' ? (logActor(state, raw.phase) ) : raw.active;
  const youLegend = legendView(raw.me.house, raw.me.legendUsed);
  const foeLegend = legendView(raw.rival.house, raw.rival.legendUsed);
  const hand = raw.me.hand.map((card) => cardFace(card.id, String(card.uid)));
  if (raw.me.champion && raw.phase !== 'mulligan') hand.push(cardFace(raw.me.champion, 'champion'));

  return {
    you: player,
    active: raw.phase === 'mulligan' ? mulliganActor(state) : raw.active,
    phase: raw.phase === 'over' ? 'game_over' : raw.phase,
    yourTurn: actor === player,
    turn: [turns(log, 0), turns(log, 1)],
    turnsCompleted: [turns(log, 0), turns(log, 1)],
    maxTurns: 7,
    verse: [player === 0 ? raw.me.verses : raw.rival.verses, player === 0 ? raw.rival.verses : raw.me.verses],
    verseGoal: state.R.winVerses,
    winner: raw.winner === 0 || raw.winner === 1 ? raw.winner : null,
    winReason: raw.winner === 0 || raw.winner === 1 ? mapReason(raw.reason) : null,
    pages: [0, 1].map((index) => pageView(raw, log, index as 0 | 1, player)) as [PageView, PageView],
    youLegend,
    foeLegend,
    hand,
    foeHandCount: raw.rival.handCount,
    yourDeckCount: raw.me.deckCount,
    foeDeckCount: raw.rival.deckCount,
    ink: raw.me.ink,
    maxInk: raw.me.maxInk,
    foeInk: raw.rival.maxInk,
    foeMaxInk: raw.rival.maxInk,
    foePowerUsed: raw.rival.legendUsed,
    events: projectLog(log, foe),
  };
}

function mulliganActor(state: EngineState): PlayerId {
  return state.phase === 'mulligan' ? state.mull : state.active;
}

function logActor(state: EngineState, phase: string): PlayerId | null {
  if (phase === 'over') return null;
  if (phase === 'mulligan') return state.mull;
  return state.active;
}

function turns(log: LogProjection[], player: number): number {
  let n = 0;
  for (const event of log) {
    if (event.e === 'turn' && event.p === player && typeof event.n === 'number') n = event.n;
  }
  return n;
}

function mapReason(reason: string): WinReason {
  if (reason === 'board_health') return 'health';
  if (reason === 'seed') return 'tiebreak';
  return 'verse';
}

function legendView(house: string, used: boolean): LegendView {
  const legend = LEGENDS[house];
  return {
    id: legend?.id ?? house,
    name: legend?.name ?? house,
    house,
    powerName: POWER_LABEL[legend?.id ?? ''] ?? 'Power',
    powerText: legend?.text ?? '',
    powerCost: legend?.cost ?? 2,
    powerUsed: used,
  };
}

function pageView(raw: ReturnType<typeof clientView>, _log: LogProjection[], index: 0 | 1, viewer: PlayerId): PageView {
  const pageId = raw.pages[index] ?? '';
  const page = PAGES.find((entry) => entry.id === pageId);
  const cap = pageId === 'torn_margin' ? 2 : 4;
  const youSide = raw.board[index]?.[viewer] ?? [];
  const foeSide = raw.board[index]?.[viewer === 0 ? 1 : 0] ?? [];
  const notes = raw.traps.filter((trap) => trap.page === index);
  return {
    index,
    name: page?.name ?? pageId,
    rule: page?.text ?? '',
    slots: Array.from({ length: cap }, (_, slot) => ({
      index: slot,
      you: youSide[slot] ? unitFace(youSide[slot]!, slot) : null,
      foe: foeSide[slot] ? unitFace(foeSide[slot]!, slot) : null,
    })),
    marginalia: notes.map((trap, ordinal) => noteFace(trap, index, ordinal)),
  };
}

function noteFace(
  trap: { uid?: number; id?: string; owner: 0 | 1; page: number; faceDown?: boolean },
  page: 0 | 1,
  ordinal: number,
): MarginaliaView {
  if (trap.faceDown || !trap.id) {
    return {
      instanceId: `sealed-${page}-${ordinal}`,
      page,
      owner: trap.owner,
      faceDown: true,
      known: false,
      name: null,
      text: null,
      glyph: null,
    };
  }
  const card = cardById(trap.id);
  return {
    instanceId: String(trap.uid ?? `note-${page}-${ordinal}`),
    page,
    owner: trap.owner,
    faceDown: false,
    known: true,
    name: card.name,
    text: card.text,
    glyph: 'note',
  };
}

function unitFace(unit: EngineState['board'][number][number][number], slot: number): UnitView {
  const card = cardById(unit.id);
  return {
    instanceId: String(unit.uid),
    defId: unit.id,
    name: card.name,
    owner: unit.owner,
    attack: unit.atk,
    health: unit.hp,
    maxHealth: unit.maxHp,
    exhausted: unit.exhausted,
    warded: Boolean(unit.ward) && !unit.silenced,
    keywords: unit.silenced ? [] : prettyKeywords(unit.kw),
    glyph: glyphFor(card),
    house: card.house,
    page: unit.page === 1 ? 1 : 0,
    slot,
  };
}

export function cardFace(id: string, instanceId: string): CardView {
  const card = cardById(id);
  return {
    instanceId,
    defId: id,
    name: card.name,
    type: card.type as CardType,
    house: card.house,
    cost: card.cost,
    attack: card.atk ?? null,
    health: card.hp ?? null,
    keywords: prettyKeywords(card.kw),
    text: card.text,
    glyph: glyphFor(card),
  };
}

function prettyKeywords(keywords: readonly string[] | undefined): string[] {
  if (!keywords) return [];
  return keywords.filter((keyword) => keyword !== 'opening_line' && keyword !== 'last_word').map(pretty);
}

function pretty(keyword: string): string {
  if (keyword.length === 0) return keyword;
  return keyword[0]!.toUpperCase() + keyword.slice(1);
}

function glyphFor(card: CardData): Glyph {
  if (card.type === 'marginalia') return 'note';
  if (card.type === 'inkwork') return 'spark';
  if (card.house === 'fold') return 'blade';
  if (card.house === 'tidewrack') return 'fox';
  if (card.house === 'candle') return 'flame';
  return 'shield';
}

function projectLog(log: LogProjection[], _foe: PlayerId): PublicEvent[] {
  const events: PublicEvent[] = [];
  log.forEach((entry, index) => {
    const text = eventText(entry);
    if (!text) return;
    const player = entry.p === 0 || entry.p === 1 ? entry.p : entry.winner === 0 || entry.winner === 1 ? entry.winner : null;
    events.push({ id: index, kind: eventKind(entry), text, player });
  });
  return events;
}

function eventKind(entry: LogProjection): PublicEvent['kind'] {
  if (entry.e === 'verse' && entry.why === 'hold') return 'hold';
  if (entry.e === 'verse' && entry.why === 'conquer') return 'conquer';
  if (entry.e === 'attack') return 'attack';
  if (entry.e === 'legend') return 'power';
  if (entry.e === 'trap_reveal' || entry.e === 'trap_set') return 'trap';
  if (entry.e === 'draw') return 'draw';
  if (entry.e === 'mulligan') return 'mulligan';
  if (entry.e === 'end') return 'win';
  if (entry.e === 'move') return 'move';
  return 'play';
}

function eventText(entry: LogProjection): string | null {
  switch (entry.e) {
    case 'verse': {
      const n = typeof entry.n === 'number' ? entry.n : 1;
      if (entry.why === 'hold') return `+${n} Hold`;
      if (entry.why === 'conquer') return `+${n} Conquer`;
      return `+${n} Verse`;
    }
    case 'play':
      if (entry.type === 'marginalia' || !entry.id) return 'A margin note is set.';
      return `${cardById(entry.id).name} is played.`;
    case 'trap_set':
      return 'A margin note is set.';
    case 'trap_reveal':
      return entry.id ? `${cardById(entry.id).name} strikes.` : 'A margin note strikes.';
    case 'attack':
      return 'Units trade.';
    case 'legend':
      return 'A Legend spends Ink.';
    case 'death':
      return entry.id ? `${cardById(entry.id).name} falls.` : 'A unit falls.';
    case 'mulligan':
      return 'Mulligan.';
    case 'turn':
      return entry.p === 0 ? 'Your turn.' : 'Rival turn.';
    case 'end':
      return 'The match ends.';
    case 'move':
      return 'A unit changes page.';
    case 'ward':
      return 'Ward fades.';
    default:
      return null;
  }
}
