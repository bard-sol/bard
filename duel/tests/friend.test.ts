import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/http.js';
import type { ClientPayload, FriendBody } from '../src/types.js';
import { listen } from './support.js';

describe('friend matches', () => {
  const open: Array<{ close: () => Promise<void>; dispose: () => void }> = [];

  afterEach(async () => {
    for (const item of open) {
      item.dispose();
      await item.close();
    }
    open.length = 0;
  });

  it('gives each seat its own hand and ends a turn that nobody plays', async () => {
    const { app, service } = createApp({ aiTurnMs: 0, turnTimeoutMs: 35_000, friendTurnMs: 80 });
    const server = await listen(app);
    open.push({ close: server.close, dispose: () => service.dispose() });
    const host = jar();
    const guest = jar();
    const created = await send<FriendBody>(host, `${server.url}/api/friends`, { deckId: 'candle' });
    expect(created.status).toBe(201);
    expect(created.body.kind).toBe('lobby');
    expect(created.body.code.length).toBeGreaterThanOrEqual(10);
    const joined = await send<FriendBody>(guest, `${server.url}/api/friends/${created.body.code}/join`, { deckId: 'fold' });
    expect(joined.status).toBe(200);
    expect(joined.body.payload?.friend).toBe(true);
    const hostView = await send<ClientPayload>(host, `${server.url}/api/matches/${created.body.code}`, undefined, 'GET');
    const guestView = await send<ClientPayload>(guest, `${server.url}/api/matches/${created.body.code}`, undefined, 'GET');
    expect(hostView.body.view.you).toBe(0);
    expect(guestView.body.view.you).toBe(1);
    const guestText = JSON.stringify(guestView.body);
    for (const card of hostView.body.view.hand) expect(guestText.includes(`"${card.instanceId}"`)).toBe(false);
    expect([hostView.body.view.verse[0], guestView.body.view.verse[0]].filter((verse) => verse > 0)).toHaveLength(1);

    const stranger = await send(jar(), `${server.url}/api/matches/${created.body.code}`, undefined, 'GET');
    expect(stranger.status).toBe(403);

    await keepBoth(server.url, host, guest, created.body.code);
    const before = await send<ClientPayload>(host, `${server.url}/api/matches/${created.body.code}`, undefined, 'GET');
    expect(before.body.view.phase).not.toBe('mulligan');
    const started = before.body.generation ?? 0;
    let moved = false;
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      const again = await send<ClientPayload>(host, `${server.url}/api/matches/${created.body.code}`, undefined, 'GET');
      if ((again.body.generation ?? 0) > started) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
  });
});

function jar(): { cookie: string; take(response: Response): void } {
  return {
    cookie: '',
    take(response) {
      const lines = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
      for (const line of lines) {
        const pair = line.split(';')[0] ?? '';
        if (!pair) continue;
        const name = pair.slice(0, pair.indexOf('='));
        const rest = this.cookie.split('; ').filter((part) => part && !part.startsWith(`${name}=`));
        rest.push(pair);
        this.cookie = rest.join('; ');
      }
    },
  };
}

async function send<T>(who: { cookie: string; take(response: Response): void }, url: string, body?: unknown, method = 'POST'): Promise<{ status: number; body: T }> {
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(who.cookie ? { cookie: who.cookie } : {}),
    },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  who.take(response);
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as T) : ({} as T) };
}

async function keepBoth(url: string, host: { cookie: string; take(response: Response): void }, guest: { cookie: string; take(response: Response): void }, code: string): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    for (const who of [host, guest]) {
      const view = await send<ClientPayload>(who, `${url}/api/matches/${code}`, undefined, 'GET');
      if (view.body.view.phase === 'mulligan' && view.body.view.yourTurn) {
        await send(who, `${url}/api/matches/${code}/actions`, { action: { type: 'mulligan', idx: [] } });
      }
    }
  }
}
