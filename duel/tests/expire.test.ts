import { describe, expect, it } from 'vitest';
import { LOBBY_TTL_MS, MATCH_TTL_MS, lobbyDeadline, matchDeadline, nextWake } from '../src/server/expire.js';
import { seal } from '../src/server/seal.js';

describe('storage deadlines', () => {
  it('expires a lobby after 30 minutes and a match after 24 hours', () => {
    const created = Date.parse('2026-10-16T12:00:00.000Z');
    expect(lobbyDeadline(new Date(created).toISOString()) - created).toBe(LOBBY_TTL_MS);
    expect(LOBBY_TTL_MS).toBe(30 * 60 * 1000);
    expect(matchDeadline(new Date(created).toISOString()) - created).toBe(MATCH_TTL_MS);
    expect(MATCH_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('wakes at the earliest deadline', () => {
    const now = 1_000;
    expect(nextWake([5_000, 2_000, null], now)).toBe(2_000);
    expect(nextWake([500], now)).toBe(now);
    expect(nextWake([null], now)).toBeNull();
  });
});

describe('seal', () => {
  it('passes a websocket upgrade through unchanged', () => {
    const upgrade = { status: 101, headers: new Headers(), body: null, statusText: '' } as unknown as Response;
    expect(seal(upgrade)).toBe(upgrade);
    const withSocket = { status: 200, headers: new Headers(), body: null, statusText: '', webSocket: {} } as unknown as Response;
    expect(seal(withSocket)).toBe(withSocket);
  });

  it('still tags ordinary responses', () => {
    const sealed = seal(new Response('no', { status: 401 }));
    expect(sealed.status).toBe(401);
    expect(sealed.headers.get('X-Robots-Tag')).toBe('noindex, nofollow, noarchive');
  });
});
