import type { ClientPayload, GameAction, Stance, TradePreview } from '../types.js';

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T);
  if (!response.ok) {
    const error = (body as { error?: string }).error ?? `request_failed_${response.status}`;
    throw new Error(error);
  }
  return body;
}

export function createMatch(stance: Stance, tutorial = false): Promise<ClientPayload> {
  return fetch('/api/matches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      tutorial
        ? { tutorial: true, stance: 'patient' }
        : { playerDeckId: 'candle', opponentDeckId: 'fold', stance },
    ),
  }).then((response) => readJson<ClientPayload>(response));
}

export function fetchMatch(matchId: string): Promise<ClientPayload> {
  return fetch(`/api/matches/${matchId}`).then((response) => readJson<ClientPayload>(response));
}

export function sendAction(matchId: string, action: GameAction): Promise<ClientPayload> {
  return fetch(`/api/matches/${matchId}/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  }).then((response) => readJson<ClientPayload>(response));
}

export function previewAttack(matchId: string, action: GameAction): Promise<{ matchId: string; preview: TradePreview }> {
  return fetch(`/api/matches/${matchId}/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  }).then((response) => readJson(response));
}

export function verifyReplay(matchId: string): Promise<{ ok: boolean; actionCount: number; mismatches: string[] }> {
  return fetch(`/api/matches/${matchId}/replay-verify`, { method: 'POST' }).then((response) => readJson(response));
}
