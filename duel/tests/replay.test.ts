import { afterEach, describe, expect, it } from 'vitest';
import { apply as applyV1, newMatch as newMatchV1, replay as replayV1, stateHash as hashV1 } from '../engine/v1/engine.mjs';
import { makeSmart as makeSmartV1 } from '../engine/v1/pilots.mjs';
import { apply as applyV11, newMatch as newMatchV11, replay as replayV11, stateHash as hashV11 } from '../engine/v1.1/engine.mjs';
import { makeSmart as makeSmartV11 } from '../engine/v1.1/pilots.mjs';
import { createEngineAdapter } from '../src/engine/adapter.js';
import { MatchService } from '../src/server/service.js';
import { MemoryMatchRepository, type MatchRecord } from '../src/server/store.js';
import type { GameAction, PlayerId } from '../src/types.js';
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
    expect(stored.setup.engineVersion).toBe('duel-engine-1.3.0');
    expect(stored.setup.cardsVersion).toBe('cards-proto-1.3');
    expect(stored.setup.aiVersion).toBe('pilot-1.3.0');
    expect(stored.setup.rulesVersion).toBe('rules-1.3.0');
    expect(stored.setup.rules.secondInkTurns).toBe(1);
    expect(stored.setup.rules.secondVerse).toBe(1);
    expect(stored.setup.seed).toBe(seed);
    expect(payload.engineVersion).toBe(stored.setup.engineVersion);
    expect(payload.cardsVersion).toBe(stored.setup.cardsVersion);
    expect(payload.aiVersion).toBe(stored.setup.aiVersion);
    expect(payload.secondInkTurns).toBe(1);
    expect(payload.secondVerse).toBe(1);
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
    expect(report.payload.engineVersion).toBe('duel-engine-1.3.0');
    expect(report.payload.cardsVersion).toBe('cards-proto-1.3');
    expect(report.payload.aiVersion).toBe('pilot-1.3.0');
    expect(report.payload.rulesVersion).toBe('rules-1.3.0');
    expect(report.payload.secondVerse).toBe(1);
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

  it('still verifies a match that was recorded on engine v1', async () => {
    const candle = candleDeck();
    const fold = foldDeck();
    const setup = {
      houseA: candle.house,
      deckA: candle.cards.slice(),
      houseB: fold.house,
      deckB: fold.cards.slice(),
      seed,
      aiVersion: 'pilot-1.0.0',
      engineVersion: 'duel-engine-1.0.0',
      cardsVersion: 'cards-proto-1',
      rulesVersion: 'rules-1.0.0',
      rules: { secondVerse: 0, holdAtEnd: false, winVerses: 8, secondInkTurns: 1 },
    };
    let state = newMatchV1(setup);
    const choose = makeSmartV1({ stance: 'balanced', slip: 300, salt: 99 });
    const log: MatchRecord['log'] = [];
    for (let guard = 0; guard < 400 && state.winner < 0; guard++) {
      const actor = (state.phase === 'mulligan' ? state.mull : state.active) as PlayerId;
      const action = choose(state, actor) as GameAction;
      log.push({ index: log.length, actor, source: actor === 1 ? 'pilot' : 'human', action });
      state = applyV1(state, action);
    }
    expect(state.v).toBe('duel-engine-1.0.0');
    expect(state.winner === 0 || state.winner === 1).toBe(true);

    const repo = new MemoryMatchRepository();
    const service = new MatchService(repo, adapter, { aiTurnMs: 0, turnTimeoutMs: 60_000 });
    services.push(service);
    const record: MatchRecord = {
      id: 'v1-old-replay',
      setup,
      stance: 'balanced',
      state,
      log,
      generation: log.length,
      turnToken: 1,
      thinking: false,
      deadline: null,
      createdAt: '2026-10-15T00:00:00.000Z',
    };
    await repo.put(record);
    const report = await service.replayVerify(record.id);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.payload.ok).toBe(true);
    expect(report.payload.mismatches).toEqual([]);
    expect(report.payload.engineVersion).toBe('duel-engine-1.0.0');
    expect(report.payload.cardsVersion).toBe('cards-proto-1');
    expect(report.payload.aiVersion).toBe('pilot-1.0.0');
    expect(hashV1(replayV1(setup, log.map((entry) => entry.action)))).toBe(adapter.stateHash(state));
  });

  it('gives the second player 2 maximum Ink on their first turn', () => {
    const opening = adapter.initialState([candleDeck(), foldDeck()], seed);
    const opener = (1 - opening.first) as 0 | 1;
    expect(opening.phase).toBe('mulligan');
    expect(opening.players[opener].verses).toBe(1);
    expect(opening.players[opening.first].verses).toBe(0);
    const openingView = adapter.view(opening, 0);
    expect(openingView.phase).toBe('mulligan');
    expect(openingView.verse[0] + openingView.verse[1]).toBe(1);
    expect(openingView.verse[opening.first === 0 ? 1 : 0]).toBe(1);

    let state = opening;
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

  it('still verifies a match that was recorded on engine v1.1', async () => {
    const candle = candleDeck();
    const fold = foldDeck();
    const setup = {
      houseA: candle.house,
      deckA: candle.cards.slice(),
      houseB: fold.house,
      deckB: fold.cards.slice(),
      seed,
      aiVersion: 'pilot-1.1.0',
      engineVersion: 'duel-engine-1.1.0',
      cardsVersion: 'cards-proto-1.1',
      rulesVersion: 'rules-1.1.0',
      rules: { secondVerse: 0, holdAtEnd: false, winVerses: 8, secondInkTurns: 1, holdMode: 'alone', conquerVerses: 2, spineMode: 'conquer' },
    };
    let state = newMatchV11(setup);
    const choose = makeSmartV11({ stance: 'balanced', slip: 300, salt: 99 });
    const log: MatchRecord['log'] = [];
    for (let guard = 0; guard < 400 && state.winner < 0; guard++) {
      const actor = (state.phase === 'mulligan' ? state.mull : state.active) as PlayerId;
      const action = choose(state, actor) as GameAction;
      log.push({ index: log.length, actor, source: actor === 1 ? 'pilot' : 'human', action });
      state = applyV11(state, action);
    }
    expect(state.v).toBe('duel-engine-1.1.0');
    expect(state.winner === 0 || state.winner === 1).toBe(true);

    const repo = new MemoryMatchRepository();
    const service = new MatchService(repo, adapter, { aiTurnMs: 0, turnTimeoutMs: 60_000 });
    services.push(service);
    const record: MatchRecord = {
      id: 'v11-old-replay',
      setup,
      stance: 'balanced',
      state,
      log,
      generation: log.length,
      turnToken: 1,
      thinking: false,
      deadline: null,
      createdAt: '2026-10-15T00:00:00.000Z',
    };
    await repo.put(record);
    const report = await service.replayVerify(record.id);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.payload.ok).toBe(true);
    expect(report.payload.mismatches).toEqual([]);
    expect(report.payload.engineVersion).toBe('duel-engine-1.1.0');
    expect(report.payload.cardsVersion).toBe('cards-proto-1.1');
    expect(report.payload.aiVersion).toBe('pilot-1.1.0');
    expect(report.payload.secondVerse).toBe(0);
    expect(hashV11(replayV11(setup, log.map((entry) => entry.action)))).toBe(adapter.stateHash(state));
  });
});
