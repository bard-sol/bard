import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { practiceDeck } from '../src/catalog.js';
import type { ClientPayload, Deck, GameAction } from '../src/types.js';

export function candleDeck(): Deck {
  const deck = practiceDeck('candle');
  if (!deck) throw new Error('missing candle starter');
  return deck;
}

export function foldDeck(): Deck {
  const deck = practiceDeck('fold');
  if (!deck) throw new Error('missing fold starter');
  return deck;
}

export function listen(app: Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, reject) => {
            server.close((error) => (error ? reject(error) : done()));
          }),
      });
    });
  });
}

export async function postJson<T>(url: string, body?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as T) : ({} as T) };
}

export async function getJson<T>(url: string): Promise<{ status: number; body: T }> {
  const response = await fetch(url);
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as T) : ({} as T) };
}

/** A deterministic human who spends Ink, fights when something can attack, then passes. */
export function scriptedAction(payload: ClientPayload): GameAction {
  if (payload.view.phase === 'mulligan') return { type: 'mulligan', idx: [] };
  const legal = payload.legalActions;
  const hand = new Map(payload.view.hand.map((card) => [card.instanceId, card]));
  const cost = (action: GameAction): number => {
    if (action.type === 'champion') return hand.get('champion')?.cost ?? 0;
    if (action.type === 'play') return hand.get(String(action.uid))?.cost ?? 0;
    return 0;
  };
  const plays = legal.filter((action) => action.type === 'play' || action.type === 'champion');
  const characters = plays.filter((action) => {
    if (action.type === 'champion') return true;
    return action.type === 'play' && hand.get(String(action.uid))?.type === 'character';
  });
  if (characters.length > 0) {
    characters.sort((a, b) => cost(b) - cost(a) || JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const play = characters[0];
    if (play) return play;
  }
  const spells = plays.filter((action) => action.type === 'play' && hand.get(String(action.uid))?.type === 'inkwork' && hand.get(String(action.uid))?.defId !== 'spare_ink');
  if (spells[0]) return spells[0];
  const notes = plays.filter((action) => action.type === 'play' && hand.get(String(action.uid))?.type === 'marginalia');
  if (notes[0]) return notes[0];
  const ink = plays.filter((action) => action.type === 'play' && hand.get(String(action.uid))?.defId === 'spare_ink');
  if (ink[0]) return ink[0];
  if (payload.view.phase === 'main' && legal.some((action) => action.type === 'attack')) {
    const fight = legal.find((action) => action.type === 'fight');
    if (fight) return fight;
  }
  const attack = legal.find((action) => action.type === 'attack');
  if (attack) return attack;
  const end = legal.find((action) => action.type === 'end');
  if (end) return end;
  throw new Error(`no scripted action in ${payload.view.phase}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
