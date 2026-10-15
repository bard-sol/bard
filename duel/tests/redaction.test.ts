import { afterEach, describe, expect, it } from 'vitest';
import { cardById } from '../engine/active.mjs';
import { createEngineAdapter } from '../src/engine/adapter.js';
import { createApp } from '../src/server/http.js';
import { findLeaks } from '../src/server/redact.js';
import type { MatchService } from '../src/server/service.js';
import type { ClientPayload } from '../src/types.js';
import { candleDeck, foldDeck, getJson, listen, postJson } from './support.js';

const adapter = createEngineAdapter();

describe('redaction', () => {
  const open: Array<{ close: () => Promise<void>; service: MatchService }> = [];

  afterEach(async () => {
    for (const item of open) {
      item.service.dispose();
      await item.close();
    }
    open.length = 0;
  });

  it('hides the foe hand, both deck orders, and a face-down marginalia identity', () => {
    const seed = 0x51eed;
    let state = adapter.initialState([candleDeck(), foldDeck()], seed);
    let raw = JSON.stringify(adapter.view(state, 0));
    expect(raw).not.toContain('"seed"');
    expect(raw).not.toContain(String(seed));
    for (const card of [...state.players[0].deck, ...state.players[1].deck, ...state.players[1].hand]) {
      expect(raw).not.toContain(`"${card.uid}"`);
    }
    for (const card of state.players[1].hand) {
      const mine = state.players[0].hand.some((held) => held.id === card.id);
      if (mine) continue;
      expect(raw).not.toContain(cardById(card.id).name);
      expect(raw).not.toContain(card.id);
    }

    state = adapter.apply(state, { type: 'mulligan', idx: [] });
    state = adapter.apply(state, { type: 'mulligan', idx: [] });
    let actor = state.active;
    let note = state.players[actor]?.hand.find((card) => cardById(card.id).type === 'marginalia' && cardById(card.id).cost <= state.players[actor].ink);
    for (let turn = 0; turn < 6 && !note; turn++) {
      state = adapter.apply(state, { type: 'end' });
      actor = state.active;
      note = state.players[actor]?.hand.find((card) => cardById(card.id).type === 'marginalia' && cardById(card.id).cost <= state.players[actor].ink);
    }
    expect(note).toBeTruthy();
    const page = 0;
    state = adapter.apply(state, { type: 'play', uid: note!.uid, page });
    const foe: 0 | 1 = actor === 0 ? 1 : 0;
    const hidden = JSON.stringify(adapter.view(state, foe));
    expect(hidden).not.toContain(note!.id);
    expect(hidden).not.toContain(cardById(note!.id).name);
    expect(hidden).not.toContain(cardById(note!.id).text);
    expect(hidden).toContain(`sealed-${page}-`);
    const owner = JSON.stringify(adapter.view(state, actor));
    expect(owner).toContain(cardById(note!.id).name);
  });

  it('keeps every HTTP payload free of the seed, deck order, and the pilot hand', async () => {
    const { app, service, repo } = createApp({ aiTurnMs: 0, turnTimeoutMs: 60_000 });
    const server = await listen(app);
    open.push({ close: server.close, service });
    const planted = 'client-supplied-seed-should-never-be-used-0001';
    const created = await postJson<ClientPayload>(`${server.url}/api/matches`, {
      playerDeckId: 'candle',
      opponentDeckId: 'fold',
      stance: 'patient',
      seed: planted,
    });
    expect(created.status).toBe(201);
    const match = await repo.get(created.body.matchId);
    expect(match).toBeTruthy();
    expect(match!.setup.seed).not.toBe(planted);
    expect(typeof match!.setup.seed).toBe('number');
    expect(match!.setup.rules.secondInkTurns).toBe(1);
    expect(match!.setup.engineVersion).toBe('duel-engine-1.0.0');
    expect(match!.setup.cardsVersion).toBe('cards-proto-1');
    expect(match!.setup.aiVersion).toBe('pilot-1.0.0');

    const bodies: unknown[] = [created.body];
    const denied = await getJson(`${server.url}/api/matches/${created.body.matchId}?player=1`);
    expect(denied.status).toBe(403);
    bodies.push(denied.body);

    const again = await getJson<ClientPayload>(`${server.url}/api/matches/${created.body.matchId}`);
    expect(again.status).toBe(200);
    bodies.push(again.body);

    const illegal = await postJson(`${server.url}/api/matches/${created.body.matchId}/actions`, {
      action: { type: 'end' },
    });
    expect(illegal.status).toBe(400);
    bodies.push(illegal.body);

    for (const body of bodies) {
      expect(JSON.stringify(body)).not.toContain(planted);
      expect(JSON.stringify(body)).not.toContain(String(match!.setup.seed));
      expect(findLeaks(body, match!, 0)).toEqual([]);
    }

    const blob = JSON.stringify(bodies);
    for (const card of match!.state.players[1].hand) {
      const mine = match!.state.players[0].hand.some((held) => held.id === card.id);
      if (mine) continue;
      expect(blob).not.toContain(cardById(card.id).name);
    }
  });
});
