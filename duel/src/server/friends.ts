import { practiceDeck, PRACTICE_DECK_IDS } from '../catalog.js';
import type { ClientPayload, FriendBody, PlayerId } from '../types.js';
import type { MatchService } from './service.js';
import { friendCode } from './session.js';

export const FRIEND_TURN_MS = 60_000;

const NAMES: Record<string, string> = {
  candle: 'The Candle',
  fold: 'The Fold',
  tidewrack: 'The Tidewrack',
};

export interface Lobby {
  code: string;
  hostSession: string;
  guestSession: string | null;
  hostDeck: string;
  guestDeck: string | null;
  cancelled: boolean;
  createdAt: string;
}

export interface FriendSeed {
  sessions: [string, string];
  deckIds: [string, string];
  turnMs: number;
}

export type FriendFailure = 'not_found' | 'forbidden' | 'bad_deck' | 'cancelled';
export type FriendResult = { ok: true; body: FriendBody } | { ok: false; error: FriendFailure };

const DECKS = PRACTICE_DECK_IDS.map((id) => ({ id, name: NAMES[id] ?? id }));

export class FriendBook {
  readonly lobbies = new Map<string, Lobby>();
  onChange: ((code: string) => void) | null = null;

  constructor(
    private readonly matches: MatchService,
    private readonly turnMs: number,
  ) {}

  async open(session: string, deckId: string | null, code = friendCode()): Promise<FriendResult> {
    const deck = resolveDeck(deckId, 'candle');
    if (!deck) return { ok: false, error: 'bad_deck' };
    if (this.lobbies.has(code) || (await this.matches.isFriend(code))) return { ok: false, error: 'forbidden' };
    const lobby: Lobby = {
      code,
      hostSession: session,
      guestSession: null,
      hostDeck: deck,
      guestDeck: null,
      cancelled: false,
      createdAt: new Date().toISOString(),
    };
    this.lobbies.set(code, lobby);
    return { ok: true, body: lobbyBody(lobby, 'host') };
  }

  async read(code: string, session: string): Promise<FriendResult> {
    const seated = await this.payloadFor(code, session);
    if (seated) return { ok: true, body: matchBody(code, seated.role, seated.payload) };
    if (await this.matches.isFriend(code)) return { ok: false, error: 'forbidden' };
    const lobby = this.lobbies.get(code);
    if (!lobby) return { ok: false, error: 'not_found' };
    if (lobby.cancelled && lobby.hostSession !== session) return { ok: true, body: lobbyBody(lobby, 'open') };
    if (lobby.hostSession === session) return { ok: true, body: lobbyBody(lobby, 'host') };
    return { ok: true, body: lobbyBody(lobby, 'open') };
  }

  async join(code: string, session: string, deckId: string | null): Promise<FriendResult> {
    const already = await this.payloadFor(code, session);
    if (already) return { ok: true, body: matchBody(code, already.role, already.payload) };
    const lobby = this.lobbies.get(code);
    if (!lobby) return { ok: false, error: 'not_found' };
    if (lobby.cancelled) return { ok: false, error: 'cancelled' };
    if (lobby.hostSession === session) return { ok: true, body: lobbyBody(lobby, 'host') };
    if (lobby.guestSession && lobby.guestSession !== session) return { ok: false, error: 'forbidden' };
    const deck = resolveDeck(deckId, 'fold');
    if (!deck) return { ok: false, error: 'bad_deck' };
    const started = await this.startMatch({
      code,
      sessions: [lobby.hostSession, session],
      deckIds: [lobby.hostDeck, deck],
      turnMs: this.turnMs,
    });
    if (!started.ok) return started;
    this.lobbies.delete(code);
    this.onChange?.(code);
    const mine = await this.payloadFor(code, session);
    if (!mine) return { ok: false, error: 'forbidden' };
    return { ok: true, body: matchBody(code, mine.role, mine.payload) };
  }

  async cancel(code: string, session: string): Promise<FriendResult> {
    if (await this.matches.isFriend(code)) return { ok: false, error: 'forbidden' };
    const lobby = this.lobbies.get(code);
    if (!lobby) return { ok: false, error: 'not_found' };
    if (lobby.hostSession !== session) return { ok: false, error: 'forbidden' };
    lobby.cancelled = true;
    this.onChange?.(code);
    return { ok: true, body: lobbyBody(lobby, 'host') };
  }

  async rematch(code: string, session: string, spawn: (seed: FriendSeed) => Promise<FriendResult>): Promise<FriendResult> {
    const seat = await this.matches.seatForId(code, session);
    if (seat == null) return { ok: false, error: 'forbidden' };
    const existing = await this.matches.rematchCode(code);
    if (existing) return this.read(existing, session);
    const seed = await this.matches.friendSeed(code);
    if (!seed) return { ok: false, error: 'forbidden' };
    const marked = await this.matches.markRematch(code, 'pending');
    if (!marked) return { ok: false, error: 'forbidden' };
    const spawned = await spawn(seed);
    if (!spawned.ok) {
      await this.matches.markRematch(code, '');
      return spawned;
    }
    await this.matches.markRematch(code, spawned.body.code);
    this.onChange?.(code);
    return spawned;
  }

  async startMatch(seed: FriendSeed & { code: string }): Promise<FriendResult> {
    const decks = [practiceDeck(seed.deckIds[0]), practiceDeck(seed.deckIds[1])] as const;
    if (!decks[0] || !decks[1]) return { ok: false, error: 'bad_deck' };
    const created = await this.matches.create({
      id: seed.code,
      decks: [decks[0], decks[1]],
      stance: 'balanced',
      humanTurnMs: seed.turnMs,
      friend: { sessions: seed.sessions, deckIds: seed.deckIds },
    });
    if (!created.ok) return { ok: false, error: created.error === 'bad_deck' ? 'bad_deck' : 'forbidden' };
    return { ok: true, body: matchBody(seed.code, 'host', created.payload) };
  }

  async payloadFor(code: string, session: string): Promise<{ role: 'host' | 'guest'; payload: ClientPayload } | null> {
    const seat = await this.matches.seatForId(code, session);
    if (seat == null) return null;
    const got = await this.matches.get(code, seat);
    if (!got.ok) return null;
    return { role: seat === 0 ? 'host' : 'guest', payload: got.payload };
  }

  changed(code: string): void {
    this.onChange?.(code);
  }
}

function resolveDeck(deckId: string | null, fallback: string): string | null {
  const id = deckId && deckId.length > 0 ? deckId : fallback;
  if (!(PRACTICE_DECK_IDS as readonly string[]).includes(id)) return null;
  return practiceDeck(id) ? id : null;
}

function lobbyBody(lobby: Lobby, role: FriendBody['role']): FriendBody {
  return {
    kind: 'lobby',
    code: lobby.code,
    path: `/m/${lobby.code}`,
    role,
    cancelled: lobby.cancelled,
    decks: DECKS,
    payload: null,
  };
}

function matchBody(code: string, role: 'host' | 'guest', payload: ClientPayload): FriendBody {
  return {
    kind: 'match',
    code,
    path: `/m/${code}`,
    role,
    cancelled: false,
    decks: DECKS,
    payload,
  };
}

export type { PlayerId };
