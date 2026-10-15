import { holdValue, PAGES } from '../../engine/active.mjs';
import type { GameAction, PlayerId, PublicEvent } from '../types.js';
import type { EngineState } from './state.js';

export interface ScoreNote {
  why: 'hold' | 'conquer' | 'second';
  player: PlayerId;
  page: 0 | 1 | null;
  pageName: string;
  n: number;
  turn: number;
}

/**
 * Replay the action list beside the engine and name the Page for each hold
 * and conquer. The engine log itself is not modified, so replay hashes stay valid.
 */
export function collectScoreNotes(
  open: EngineState,
  actions: readonly GameAction[],
  apply: (state: EngineState, action: GameAction) => EngineState,
): ScoreNote[] {
  const notes: ScoreNote[] = [];
  const second: PlayerId = open.first === 0 ? 1 : 0;
  const opening = open.players[second]?.verses ?? 0;
  if (opening > 0) {
    notes.push({ why: 'second', player: second, page: null, pageName: 'Start', n: opening, turn: 0 });
  }
  let state = open;
  for (const action of actions) {
    const before = state;
    let after: EngineState;
    try {
      after = apply(before, action);
    } catch {
      break;
    }
    const fresh = after.log.slice(before.log.length).filter((entry) => entry.e === 'verse');
    const conquers = fresh.filter((entry) => entry.why === 'conquer');
    const holds = fresh.filter((entry) => entry.why === 'hold');
    if (conquers.length > 0) {
      const player = before.active;
      const pages = conquerPages(before, player);
      conquers.forEach((entry, index) => {
        const page = pages[index];
        notes.push(note('conquer', player, page, before, entry.n, before.players[player]?.turns ?? 0));
      });
    }
    if (holds.length > 0) {
      const atEnd = before.R.holdAtEnd === true;
      const player = atEnd ? before.active : after.active;
      const snap = atEnd ? before : after;
      const pages = holdPages(snap, player);
      holds.forEach((entry, index) => {
        const page = pages[index];
        notes.push(note('hold', player, page, snap, entry.n, snap.players[player]?.turns ?? 0));
      });
    }
    state = after;
  }
  return notes;
}

export function applyScoreNotes(events: PublicEvent[], notes: ScoreNote[]): PublicEvent[] {
  const scored = notes.filter((item) => item.why === 'hold' || item.why === 'conquer');
  let cursor = 0;
  return events.map((event) => {
    if (event.kind !== 'hold' && event.kind !== 'conquer') return event;
    const item = scored[cursor];
    if (!item || item.why !== event.kind || item.player !== event.player) return event;
    cursor += 1;
    const text = item.why === 'hold' ? `+${item.n} Hold on ${item.pageName}` : `Conquer +${item.n} Verses on ${item.pageName}`;
    return {
      ...event,
      text,
      pageName: item.pageName,
      turn: item.turn,
      amount: item.n,
      ...(item.page != null ? { focusPage: item.page } : {}),
    };
  });
}

function note(
  why: 'hold' | 'conquer',
  player: number,
  page: number | undefined,
  state: EngineState,
  amount: unknown,
  turn: number,
): ScoreNote {
  const seat: PlayerId = player === 1 ? 1 : 0;
  const index: 0 | 1 | null = page === 0 || page === 1 ? page : null;
  return {
    why,
    player: seat,
    page: index,
    pageName: index == null ? 'Page' : pageName(state, index),
    n: typeof amount === 'number' ? amount : why === 'conquer' ? 2 : 1,
    turn,
  };
}

function conquerPages(state: EngineState, player: number): number[] {
  const pages: number[] = [];
  for (let page = 0; page < 2; page++) {
    const mine = state.board[page]?.[player]?.length ?? 0;
    const theirs = state.board[page]?.[1 - player]?.length ?? 0;
    if (state.enemiesAtStart[page] && theirs === 0 && mine > 0) pages.push(page);
  }
  return pages;
}

function holdPages(state: EngineState, player: number): number[] {
  const pages: number[] = [];
  for (let page = 0; page < 2; page++) {
    if (holdValue(state, player, page) > 0) pages.push(page);
  }
  return pages;
}

function pageName(state: EngineState, page: number): string {
  const id = state.pages[page];
  return PAGES.find((entry) => entry.id === id)?.name ?? 'Page';
}
