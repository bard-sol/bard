import { afterEach, describe, expect, it } from 'vitest';
import { createEngineAdapter } from '../src/engine/adapter.js';
import { MatchService } from '../src/server/service.js';
import { MemoryMatchRepository, type MatchRecord } from '../src/server/store.js';
import { candleDeck, foldDeck, scriptedAction } from './support.js';

const adapter = createEngineAdapter();
const seed = 0xc0ffee11;

async function playSeeded(seedValue: number, stance: 'balanced' | 'aggressive' | 'patient' = 'balanced') {
  const repo = new MemoryMatchRepository();
  const service = new MatchService(repo, adapter, { aiTurnMs: 0, turnTimeoutMs: 60_000 });
  const created = await service.create({ decks: [candleDeck(), foldDeck()], stance, seed: seedValue });
  if (!created.ok) throw new Error(created.error);
  let payload = created.payload;
  for (let guard = 0; guard < 400 && payload.view.winner == null; guard++) {
    if (!payload.view.yourTurn) throw new Error(`expected the human seat, phase ${payload.view.phase}`);
    payload = expectOk(await service.act(payload.matchId, 0, scriptedAction(payload)));
  }
  const stored = await repo.get(payload.matchId);
  service.dispose();
  if (!stored) throw new Error('missing match');
  return { stored, payload };
}

function expectOk<T>(result: { ok: true; payload: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.payload;
}

describe('determinism and replay', () => {
  const services: MatchService[] = [];
  afterEach(() => {
    for (const service of services) service.dispose();
    services.length = 0;
  });

  it('records engine, cards, and AI versions plus the second-player Ink rule', async () => {
    const { stored, payload } = await playSeeded(seed, 'aggressive');
    expect(payload.view.winner === 0 || payload.view.winner === 1).toBe(true);
    expect(stored.setup.engineVersion).toBe('duel-engine-1.0.0');
    expect(stored.setup.cardsVersion).toBe('cards-proto-1');
    expect(stored.setup.aiVersion).toBe('pilot-1.0.0');
    expect(stored.setup.rulesVersion).toBe('rules-1.0.0');
    expect(stored.setup.rules.secondInkTurns).toBe(1);
    expect(stored.setup.seed).toBe(seed);
    expect(payload.engineVersion).toBe(stored.setup.engineVersion);
    expect(payload.cardsVersion).toBe(stored.setup.cardsVersion);
    expect(payload.aiVersion).toBe(stored.setup.aiVersion);
    expect(payload.secondInkTurns).toBe(1);
    expect(JSON.stringify(payload)).not.toContain(String(seed));
  });

  it('replays a match from the stored setup and the action log', async () => {
    const first = await playSeeded(seed, 'aggressive');
    const second = await playSeeded(seed, 'aggressive');
    expect(adapter.stateHash(first.stored.state)).toBe(adapter.stateHash(second.stored.state));
    expect(first.stored.log.map((entry) => entry.action)).toEqual(second.stored.log.map((entry) => entry.action));

    const repo = new MemoryMatchRepository();
    const service = new MatchService(repo, adapter, { aiTurnMs: 0, turnTimeoutMs: 60_000 });
    services.push(service);
    await repo.put(first.stored);
    const report = await service.replayVerify(first.stored.id);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.payload.ok).toBe(true);
    expect(report.payload.mismatches).toEqual([]);
    expect(report.payload.engineVersion).toBe('duel-engine-1.0.0');
    expect(report.payload.cardsVersion).toBe('cards-proto-1');
    expect(report.payload.aiVersion).toBe('pilot-1.0.0');
    expect(report.payload.secondInkTurns).toBe(1);
    expect(JSON.stringify(report.payload)).not.toContain(String(seed));

    const replayed = adapter.replay(first.stored.setup, first.stored.log.map((entry) => entry.action));
    expect(adapter.stateHash(replayed)).toBe(adapter.stateHash(first.stored.state));

    const tampered: MatchRecord = structuredClone(first.stored);
    tampered.state.players[0].verses += 1;
    await repo.put(tampered);
    const broken = await service.replayVerify(tampered.id);
    expect(broken.ok).toBe(true);
    if (!broken.ok) return;
    expect(broken.payload.ok).toBe(false);
    expect(broken.payload.mismatches.length).toBeGreaterThan(0);
  });

  it('gives the second player 2 maximum Ink on their first turn', () => {
    let state = adapter.initialState([candleDeck(), foldDeck()], seed);
    state = adapter.apply(state, { type: 'mulligan', idx: [] });
    state = adapter.apply(state, { type: 'mulligan', idx: [] });
    expect(state.players[state.first].maxInk).toBe(1);
    expect(state.players[state.first].ink).toBe(1);
    state = adapter.apply(state, { type: 'end' });
    const second = (1 - state.first) as 0 | 1;
    expect(state.players[second].turns).toBe(1);
    expect(state.players[second].maxInk).toBe(2);
    expect(state.R.secondInkTurns).toBe(1);
  });
});
