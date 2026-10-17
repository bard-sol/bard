import { describe, expect, it } from 'vitest';
import { actorOf, createEngineAdapter } from '../src/engine/adapter.js';
import { createApp } from '../src/server/http.js';
import { MemoryMatchRepository } from '../src/server/store.js';
import { MatchService } from '../src/server/service.js';
import type { ClientPayload, GameAction, TradePreview } from '../src/types.js';
import { candleDeck, foldDeck, listen, postJson } from './support.js';

describe('end turn and preview', () => {
  it('accepts End Turn during mulligan and on turn 1 for both seats', async () => {
    const adapter = createEngineAdapter();
    for (const seed of [1, 2]) {
      const service = new MatchService(new MemoryMatchRepository(), adapter, { aiTurnMs: 0, turnTimeoutMs: 35_000 });
      const created = await service.create({ decks: [candleDeck(), foldDeck()], stance: 'balanced', seed });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.payload.view.phase).toBe('mulligan');
      const kept = await service.act(created.payload.matchId, 0, { type: 'end' });
      expect(kept.ok).toBe(true);
      if (!kept.ok) return;
      expect(kept.payload.view.phase).not.toBe('mulligan');
      const ended = await service.act(created.payload.matchId, 0, { type: 'end' });
      expect(ended.ok).toBe(true);
      service.dispose();
    }
  });

  it('gives the first three HTTP matches a 60s turn and later matches the configured 35s', async () => {
    const { app, service } = createApp({ aiTurnMs: 0, turnTimeoutMs: 35_000 });
    const server = await listen(app);
    try {
      const first = await postJson<ClientPayload>(`${server.url}/api/matches`, {
        playerDeckId: 'candle',
        opponentDeckId: 'fold',
        stance: 'balanced',
      });
      expect(first.body.turnDurationMs).toBe(20_000);
      const kept = await postJson<ClientPayload>(`${server.url}/api/matches/${first.body.matchId}/actions`, {
        action: { type: 'end' },
      });
      expect(kept.status).toBe(200);
      const playing = kept.body.view.phase === 'mulligan'
        ? (await postJson<ClientPayload>(`${server.url}/api/matches/${first.body.matchId}/actions`, { action: { type: 'end' } })).body
        : kept.body;
      if (playing.view.yourTurn && playing.view.phase !== 'mulligan') expect(playing.turnDurationMs).toBe(60_000);

      const veteran = await fetch(`${server.url}/api/matches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'bard_duel_played=3' },
        body: JSON.stringify({ playerDeckId: 'candle', opponentDeckId: 'fold', stance: 'balanced' }),
      });
      const body = (await veteran.json()) as ClientPayload;
      expect(body.turnDurationMs).toBe(20_000);
      const after = await fetch(`${server.url}/api/matches/${body.matchId}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: { type: 'end' } }),
      });
      const next = (await after.json()) as ClientPayload;
      if (next.view.yourTurn && next.view.phase !== 'mulligan') expect(next.turnDurationMs).toBe(35_000);
    } finally {
      service.dispose();
      await server.close();
    }
  });

  it('answers an illegal preview during mulligan with 200 and an empty trade', async () => {
    const { app, service } = createApp({ aiTurnMs: 0, turnTimeoutMs: 35_000 });
    const server = await listen(app);
    try {
      const created = await postJson<ClientPayload>(`${server.url}/api/matches`, {
        playerDeckId: 'candle',
        opponentDeckId: 'fold',
        stance: 'balanced',
      });
      expect(created.status).toBe(201);
      expect(created.body.view.phase).toBe('mulligan');
      const preview = await postJson<{ matchId: string; preview: TradePreview }>(`${server.url}/api/matches/${created.body.matchId}/preview`, {
        action: { type: 'attack', uid: 1, target: 2 },
      });
      expect(preview.status).toBe(200);
      expect(preview.body.preview.attackerName).toBe('');
      expect(preview.body.preview.defenderName).toBe('');
      expect(preview.body.preview.attackerId).toBe('');
      expect(JSON.stringify(preview.body)).not.toContain('"seed"');
    } finally {
      service.dispose();
      await server.close();
    }
  });

  it('previews damage without naming a face-down note', () => {
    const found = boardWithAttack();
    expect(found).not.toBeNull();
    if (!found) return;
    const { adapter, state, attack } = found;
    const page = attackPage(state, attack);
    state.traps.push({ uid: 424242, id: 't_riptide', owner: 1, page });
    const first = adapter.previewAction(state, 0, attack);
    const second = adapter.previewAction(state, 0, attack);
    const text = JSON.stringify(first);
    expect(text).toBe(JSON.stringify(second));
    expect(text).not.toContain('t_riptide');
    expect(text).not.toContain('424242');
    expect(text).not.toContain('"seed"');
    expect(first.noteMayFire).toBe(true);
    expect(first.marginNoteStrikes).toBe(false);
    expect(first.units?.length).toBeGreaterThan(0);
  });

  it('mentions an end-of-turn heal only when health changes', () => {
    const found = boardWithAttack();
    expect(found).not.toBeNull();
    if (!found) return;
    const { adapter, state } = found;
    const page = state.pages.indexOf('lanternfall');
    const unit = state.board[page]?.flat().find((entry) => entry.maxHp >= 2) ?? state.board[page]?.flat()[0];
    expect(unit).toBeTruthy();
    if (!unit) return;
    for (const side of state.board.flat()) for (const entry of side) entry.hp = entry.maxHp;
    const full = adapter.previewAction(state, 0, { type: 'end' });
    expect(full.footnote ?? null).toBeNull();
    unit.hp = Math.max(1, unit.maxHp - 1);
    const hurt = adapter.previewAction(state, 0, { type: 'end' });
    expect(hurt.footnote).toContain('Lanternfall');
    expect(JSON.stringify(hurt)).not.toContain('t_riptide');
  });
});

function boardWithAttack() {
  const adapter = createEngineAdapter();
  for (let seed = 1; seed < 30; seed++) {
    let state = adapter.initialState([candleDeck(), foldDeck()], seed);
    for (let guard = 0; guard < 40 && actorOf(state) != null; guard++) {
      const actor = actorOf(state);
      if (actor == null) break;
      const legal = adapter.legalActions(state, actor);
      const attack = legal.find((action) => action.type === 'attack');
      const lantern = state.pages.indexOf('lanternfall');
      const healed = lantern >= 0 && state.board[lantern]?.some((side) => side.length > 0);
      if (attack && actor === 0 && attack.type === 'attack' && healed) {
        return { adapter, state, attack };
      }
      const next = legal.find((action) => action.type === 'mulligan' && action.idx.length === 0)
        ?? legal.find((action) => action.type === 'play' || action.type === 'champion')
        ?? legal.find((action) => action.type === 'end');
      if (!next) break;
      state = adapter.apply(state, next);
    }
  }
  return null;
}

function attackPage(state: { board: { uid: number; page: number }[][][] }, attack: GameAction): number {
  if (attack.type !== 'attack') return 0;
  for (const page of state.board) for (const side of page) for (const unit of side) if (unit.uid === attack.uid) return unit.page;
  return 0;
}
