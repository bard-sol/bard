import { afterEach, describe, expect, it } from 'vitest';
import { cardById } from '../engine/active.mjs';
import { createApp } from '../src/server/http.js';
import { findLeaks } from '../src/server/redact.js';
import type { MatchService } from '../src/server/service.js';
import type { ClientPayload } from '../src/types.js';
import { getJson, listen, postJson, scriptedAction, sleep } from './support.js';

describe('end-to-end match', () => {
  const open: Array<{ close: () => Promise<void>; service: MatchService }> = [];

  afterEach(async () => {
    for (const item of open) {
      item.service.dispose();
      await item.close();
    }
    open.length = 0;
  });

  it('plays a full match against pilot v1 and verifies the replay', async () => {
    const { app, service, repo } = createApp({ aiTurnMs: 0, turnTimeoutMs: 60_000 });
    const server = await listen(app);
    open.push({ close: server.close, service });

    const created = await postJson<ClientPayload>(`${server.url}/api/matches`, {
      playerDeckId: 'candle',
      opponentDeckId: 'fold',
      stance: 'balanced',
    });
    expect(created.status).toBe(201);
    let payload = created.body;
    const seen: unknown[] = [payload];
    let previewed = false;

    for (let guard = 0; guard < 400 && payload.view.winner == null; guard++) {
      expect(payload.view.yourTurn).toBe(true);
      const action = scriptedAction(payload);
      if (!previewed && action.type === 'attack') {
        const preview = await postJson(`${server.url}/api/matches/${payload.matchId}/preview`, { action });
        expect(preview.status).toBe(200);
        seen.push(preview.body);
        previewed = true;
      }
      const next = await postJson<ClientPayload>(`${server.url}/api/matches/${payload.matchId}/actions`, { action });
      expect(next.status, JSON.stringify(action)).toBe(200);
      payload = next.body;
      seen.push(payload);
    }

    expect(payload.status).toBe('complete');
    expect(payload.view.winner === 0 || payload.view.winner === 1).toBe(true);
    expect(payload.view.turnsCompleted[0]).toBeLessThanOrEqual(7);
    expect(payload.view.turnsCompleted[1]).toBeLessThanOrEqual(7);
    expect(payload.legalActions).toEqual([]);
    expect(payload.secondInkTurns).toBe(1);

    const stored = await repo.get(payload.matchId);
    expect(stored).toBeTruthy();
    expect(stored!.log.some((entry) => entry.source === 'pilot')).toBe(true);
    expect(stored!.setup.aiVersion).toBe('pilot-1.3.0');
    expect(stored!.setup.engineVersion).toBe('duel-engine-1.3.0');
    expect(stored!.setup.cardsVersion).toBe('cards-proto-1.3');
    expect(stored!.setup.rulesVersion).toBe('rules-1.3.0');
    expect(stored!.setup.rules.secondVerse).toBe(1);
    expect(stored!.setup.rules.secondInkTurns).toBe(1);
    for (const body of seen) expect(findLeaks(body, stored!, 0)).toEqual([]);

    const verified = await postJson<{ ok: boolean; mismatches: string[]; actionCount: number; secondInkTurns: number; engineVersion: string }>(
      `${server.url}/api/matches/${payload.matchId}/replay-verify`,
    );
    expect(verified.status).toBe(200);
    expect(verified.body.ok).toBe(true);
    expect(verified.body.mismatches).toEqual([]);
    expect(verified.body.actionCount).toBe(stored!.log.length);
    expect(verified.body.secondInkTurns).toBe(1);
    expect(verified.body.engineVersion).toBe('duel-engine-1.3.0');
    expect(JSON.stringify(verified.body)).not.toContain(String(stored!.setup.seed));
    expect(cardById('spare_ink').name).toBe('Spare Ink');
  });

  it('uses a 35s human timer and paces the pilot turn', async () => {
    const { app, service, repo } = createApp({ aiTurnMs: 120, turnTimeoutMs: 35_000 });
    const server = await listen(app);
    open.push({ close: server.close, service });
    const created = await postJson<ClientPayload>(`${server.url}/api/matches`, {
      playerDeckId: 'candle',
      opponentDeckId: 'fold',
      stance: 'patient',
    });
    let body = created.body;
    if (!body.view.yourTurn) {
      expect(body.opponentThinking).toBe(true);
      expect(body.turnDurationMs).toBe(120);
      body = await waitFor(server.url, body.matchId, (next) => next.view.yourTurn);
    }
    expect(body.view.phase).toBe('mulligan');
    expect(body.turnDurationMs).toBe(20_000);
    expect(body.turnDeadline ?? 0).toBeGreaterThan(Date.now() + 10_000);

    const kept = await postJson<ClientPayload>(`${server.url}/api/matches/${body.matchId}/actions`, {
      action: { type: 'mulligan', idx: [] },
    });
    expect(kept.status).toBe(200);
    expect(kept.body.opponentThinking).toBe(true);
    expect(kept.body.view.yourTurn).toBe(false);
    expect(kept.body.turnDurationMs).toBe(120);

    const after = await waitFor(server.url, body.matchId, (next) => next.view.yourTurn && next.view.phase !== 'mulligan');
    expect(after.turnDurationMs).toBe(60_000);
    const stored = await repo.get(body.matchId);
    expect(stored!.log.some((entry) => entry.source === 'pilot')).toBe(true);
    expect(stored!.setup.rules.secondInkTurns).toBe(1);
    expect(findLeaks(after, stored!, 0)).toEqual([]);
  });
});

async function waitFor(url: string, id: string, ready: (payload: ClientPayload) => boolean): Promise<ClientPayload> {
  let latest: ClientPayload | null = null;
  for (let i = 0; i < 40; i++) {
    await sleep(50);
    const next = await getJson<ClientPayload>(`${url}/api/matches/${id}`);
    latest = next.body;
    if (ready(latest)) return latest;
  }
  throw new Error(`timed out waiting, phase ${latest?.view.phase}`);
}
