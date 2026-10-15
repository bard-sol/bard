import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARDS } from '../engine/active.mjs';
import { createEngineAdapter } from '../src/engine/adapter.js';
import { GuideController, guideReady, GUIDE_STEPS } from '../src/client/guide.js';
import { createApp } from '../src/server/http.js';
import { MatchService } from '../src/server/service.js';
import { MemoryMatchRepository } from '../src/server/store.js';
import { tutorialDecks } from '../src/tutorial/script.js';
import type { ClientPayload, GameAction } from '../src/types.js';
import { listen, postJson } from './support.js';

function service(): MatchService {
  return new MatchService(new MemoryMatchRepository(), createEngineAdapter(), { aiTurnMs: 0, turnTimeoutMs: 60_000 });
}

function card(payload: ClientPayload, defId: string) {
  const found = payload.view.hand.find((entry) => entry.defId === defId);
  if (!found) throw new Error(`missing ${defId}`);
  return found;
}

function unit(payload: ClientPayload, defId: string, owner: 'you' | 'foe', page = 0) {
  const slots = payload.view.pages[page]?.slots ?? [];
  const found = slots.map((slot) => (owner === 'you' ? slot.you : slot.foe)).find((entry) => entry?.defId === defId);
  if (!found) throw new Error(`missing ${owner} ${defId} on page ${page}`);
  return found;
}

async function act(match: MatchService, id: string, action: GameAction): Promise<ClientPayload> {
  const result = await match.act(id, 0, action);
  if (!result.ok) throw new Error(result.error);
  return result.payload;
}

describe('bubble-guide v1.2', () => {
  it('reaches every guided board state from the scripted seed', async () => {
    const match = service();
    const created = await match.create({ decks: tutorialDecks(), stance: 'aggressive', tutorial: true, seed: 1 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    let payload = created.payload;
    expect(payload.tutorial).toBe(true);
    expect(payload.view.phase).toBe('main');
    expect(payload.view.yourTurn).toBe(true);
    expect(payload.view.ink).toBe(1);
    expect(payload.view.hand.map((entry) => entry.defId)).toEqual(expect.arrayContaining(['c_novice', 'n_doodle', 'c_mend', 'champ_old_wick']));
    expect(payload.view.pages.map((page) => page.name)).toEqual(['Lanternfall', 'Port Foxing']);
    expect(JSON.stringify(payload)).not.toContain('38558');

    const guide = new GuideController();
    const seen = new Set<number>([1]);
    const note = () => {
      const id = guide.step?.id;
      if (id) seen.add(id);
      if (guide.visible(true)?.id === 16 && guide.step?.id === 15) seen.add(16);
    };
    const release = () => {
      guide.sync(payload);
      note();
    };

    guide.next(payload);
    note();
    expect(guide.step?.id).toBe(2);
    guide.next(payload);
    note();
    expect(guide.step?.id).toBe(3);
    release();
    guide.pageRead = true;
    guide.sync(payload);
    note();
    expect(guide.step?.id).toBe(4);
    release();
    guide.next(payload);
    note();
    expect(guide.step?.id).toBe(5);
    release();
    guide.next(payload);
    note();
    expect(guide.step?.id).toBe(6);
    release();
    guide.keywordHeld = true;
    guide.sync(payload);
    note();
    expect(guide.step?.id).toBe(7);
    release();

    const novice = card(payload, 'c_novice');
    payload = await act(match, payload.matchId, { type: 'play', uid: Number(novice.instanceId), page: 0 });
    guide.sync(payload);
    note();
    expect(guide.step?.id).toBe(8);
    expect(unit(payload, 'c_novice', 'you').exhausted).toBe(true);
    release();
    guide.next(payload);
    note();
    expect(guide.step?.id).toBe(9);
    release();
    expect(payload.view.events.some((event) => event.kind === 'hold' && event.player === 0)).toBe(false);

    payload = await act(match, payload.matchId, { type: 'end' });
    guide.sync(payload);
    note();
    expect(guide.step?.id).toBe(10);
    guide.sync(payload);
    guide.sync(payload);
    note();
    expect(guide.step?.id).toBe(11);
    release();
    expect(payload.view.turn[0]).toBe(2);
    expect(payload.view.verse[0]).toBe(1);
    expect(unit(payload, 't_deckhand', 'foe', 1)).toBeTruthy();
    const played = payload.view.events.find((event) => event.focusDef === 't_deckhand' && event.player === 1);
    expect(played?.text).toContain('Port Foxing');
    expect(played?.focusPage).toBe(1);
    expect(payload.view.events.find((event) => event.kind === 'hold' && event.player === 0)?.pageName).toBe('Lanternfall');
    guide.next(payload);
    note();
    expect(guide.step?.id).toBe(12);
    release();

    const doodle = card(payload, 'n_doodle');
    payload = await act(match, payload.matchId, { type: 'play', uid: Number(doodle.instanceId), page: 1 });
    guide.sync(payload);
    note();
    expect(guide.step?.id).toBe(13);
    release();
    payload = await act(match, payload.matchId, { type: 'end' });
    guide.sync(payload);
    note();
    expect(guide.step?.id).toBe(14);
    expect(unit(payload, 't_deckhand', 'foe', 0)).toBeTruthy();
    guide.sync(payload);
    guide.sync(payload);
    note();
    expect(guide.step?.id).toBe(15);
    release();

    const attacker = unit(payload, 'c_novice', 'you');
    const defender = unit(payload, 't_deckhand', 'foe', 0);
    expect(guide.visible(true)?.id).toBe(16);
    seen.add(16);
    payload = await act(match, payload.matchId, { type: 'attack', uid: Number(attacker.instanceId), target: Number(defender.instanceId) });
    expect(unit(payload, 'c_novice', 'you').health).toBeGreaterThan(0);
    expect(unit(payload, 't_deckhand', 'foe', 0).health).toBeGreaterThan(0);
    guide.sync(payload);
    note();
    expect(guide.step?.id).toBe(17);
    release();
    payload = await act(match, payload.matchId, { type: 'end' });
    guide.sync(payload);
    note();
    expect(guide.step?.id).toBe(18);
    expect(unit(payload, 'n_doodle', 'you', 1).attack).toBe(3);
    expect(unit(payload, 'n_doodle', 'you', 1).health).toBe(1);
    expect(payload.view.pages[1]?.slots.some((slot) => slot.foe)).toBe(false);
    expect(payload.view.pages[1]?.marginalia.some((entry) => entry.faceDown && entry.owner !== 0)).toBe(true);
    expect(payload.view.pages[0]?.marginalia.some((entry) => entry.faceDown)).toBe(false);
    expect(JSON.stringify(payload)).not.toContain('t_riptide');
    expect(payload.view.pages[0]?.slots.filter((slot) => slot.foe).length).toBe(1);
    release();
    guide.next(payload);
    note();
    expect(guide.step?.id).toBe(19);
    release();

    const healed = unit(payload, 'n_doodle', 'you', 1);
    expect(healed.health).toBe(1);
    payload = await act(match, payload.matchId, { type: 'legend', target: Number(healed.instanceId) });
    expect(payload.view.youLegend.powerUsed).toBe(true);
    expect(unit(payload, 'n_doodle', 'you', 1).health).toBe(2);
    guide.sync(payload);
    note();
    expect(guide.step?.id).toBe(20);
    release();

    const mend = card(payload, 'c_mend');
    const ally = unit(payload, 'c_novice', 'you');
    payload = await act(match, payload.matchId, { type: 'play', uid: Number(mend.instanceId), target: Number(ally.instanceId) });
    expect(unit(payload, 'c_novice', 'you').attack).toBe(2);
    guide.sync(payload);
    note();
    expect(guide.step?.id).toBe(21);
    release();

    const killer = unit(payload, 'c_novice', 'you');
    const left = unit(payload, 't_deckhand', 'foe', 0);
    payload = await act(match, payload.matchId, { type: 'attack', uid: Number(killer.instanceId), target: Number(left.instanceId) });
    expect(payload.view.pages[0]?.slots.some((slot) => slot.foe)).toBe(false);
    expect(guide.step?.id).toBe(21);
    payload = await act(match, payload.matchId, { type: 'end' });
    const conquer = payload.view.events.find((event) => event.kind === 'conquer' && event.player === 0);
    expect(conquer?.text).toContain('2');
    expect(conquer?.pageName).toBe('Lanternfall');
    expect(conquer?.turn).toBe(4);
    guide.sync(payload);
    note();
    expect(guide.step?.id).toBe(22);
    release();
    expect(payload.view.ink).toBeGreaterThanOrEqual(5);
    expect(payload.legalActions.some((action) => action.type === 'champion')).toBe(true);

    payload = await act(match, payload.matchId, { type: 'champion', page: 0 });
    expect(payload.view.pages.some((page) => page.slots.some((slot) => slot.you?.defId === 'champ_old_wick'))).toBe(true);
    guide.sync(payload);
    note();
    expect(guide.step?.id).toBe(23);
    release();
    guide.next(payload);
    note();
    expect(guide.step?.id).toBe(24);
    release();
    guide.next(payload);
    note();
    expect(guide.step?.id).toBe(25);
    release();

    for (let guard = 0; guard < 8 && payload.view.winner == null; guard++) {
      if (!payload.view.yourTurn) break;
      payload = await act(match, payload.matchId, { type: 'end' });
    }
    expect(payload.view.winner).toBe(0);
    guide.sync(payload);
    note();
    expect(guide.step?.id).toBe(26);
    release();
    expect(guideReady(GUIDE_STEPS.find((entry) => entry.id === 26)!, payload, { pageRead: false, keywordHeld: false })).toBe(true);
    guide.next(payload);
    note();
    expect(guide.step?.id).toBe(27);

    for (let id = 1; id <= 27; id++) expect(seen.has(id), `step ${id}`).toBe(true);

    const verified = await match.replayVerify(payload.matchId);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.ok).toBe(true);
      expect(verified.payload.mismatches).toEqual([]);
      expect(verified.payload.secondVerse).toBe(1);
    }
    match.dispose();
  });

  it('serves every mapped portrait and accepts metrics without a passcode', async () => {
    const map = JSON.parse(readFileSync(new URL('../client/art-map-v1.json', import.meta.url), 'utf8')) as {
      map: Record<string, { path: string }>;
    };
    const ids = (CARDS as Array<{ id: string }>).map((card) => card.id);
    expect(ids.length).toBeGreaterThan(40);
    for (const id of ids) {
      expect(map.map[id], id).toBeTruthy();
      expect(existsSync(new URL(`../client/${map.map[id]!.path}`, import.meta.url))).toBe(true);
    }
    expect(existsSync(new URL('../client/art/_fallback.png', import.meta.url))).toBe(true);

    const { app } = createApp({ aiTurnMs: 0 });
    const server = await listen(app);
    try {
      const metrics = await fetch(`${server.url}/api/metrics`, { method: 'POST', body: '{}' });
      expect(metrics.status).toBe(204);
      const created = await postJson<ClientPayload>(`${server.url}/api/matches`, { tutorial: true });
      expect(created.status).toBe(201);
      expect(created.body.tutorial).toBe(true);
      expect(JSON.stringify(created.body)).not.toMatch(/"seed"/);
    } finally {
      await server.close();
    }
  });
});
