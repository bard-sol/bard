import { describe, expect, it } from 'vitest';
import { createEngineAdapter } from '../src/engine/adapter.js';
import { MemoryMatchRepository } from '../src/server/store.js';
import { MatchService, type ClockRequest, type TimerBridge } from '../src/server/service.js';
import { candleDeck, foldDeck } from './support.js';

class Recording implements TimerBridge {
  pending: ClockRequest | null = null;
  arm(clock: ClockRequest): void {
    this.pending = clock;
  }
  disarm(): void {
    this.pending = null;
  }
}

describe('timer bridge', () => {
  it('keeps a supplied match id and does not schedule a process timer', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const bridge = new Recording();
    let scheduled = 0;
    const original = globalThis.setTimeout;
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      scheduled += 1;
      return original(...args);
    }) as typeof setTimeout;
    try {
      const service = new MatchService(new MemoryMatchRepository(), createEngineAdapter(), { aiTurnMs: 0, turnTimeoutMs: 35_000 }, bridge);
      const created = await service.create({
        id,
        decks: [candleDeck(), foldDeck()],
        stance: 'balanced',
        seed: 7,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.payload.matchId).toBe(id);
      expect(scheduled).toBe(0);
      expect(bridge.pending?.kind).toBe('human');
      expect(bridge.pending?.delayMs).toBe(20_000);
      expect(service.exportPlan(id)).toBeNull();
      service.dispose();
    } finally {
      globalThis.setTimeout = original;
    }
  });

  it('steps a stored pilot plan when the clock fires', async () => {
    const adapter = createEngineAdapter();
    for (let seed = 1; seed < 40; seed++) {
      const bridge = new Recording();
      const service = new MatchService(new MemoryMatchRepository(), adapter, { aiTurnMs: 1_000, turnTimeoutMs: 35_000 }, bridge);
      const created = await service.create({
        decks: [candleDeck(), foldDeck()],
        stance: 'patient',
        seed,
      });
      if (!created.ok) throw new Error('create failed');
      if (!created.payload.opponentThinking) {
        service.dispose();
        continue;
      }
      const id = created.payload.matchId;
      const plan = service.exportPlan(id);
      expect(plan?.next).toBe(0);
      expect(bridge.pending?.kind).toBe('pilot');
      await service.fireClock(id, 'pilot', bridge.pending?.token ?? 0);
      const advanced = service.exportPlan(id);
      expect(advanced == null || advanced.next === 1).toBe(true);
      const again = await service.get(id);
      expect(again.ok).toBe(true);
      service.dispose();
      return;
    }
    throw new Error('no opening seed handed the pilot the first turn');
  });
});
