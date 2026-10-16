import { DurableObject, type DurableObjectState } from 'cloudflare:workers';
import { createEngineAdapter } from '../engine/adapter.js';
import type { ClientPayload, Deck, GameAction, Stance, TradePreview } from '../types.js';
import { parseAction, parseCreate } from '../server/parse.js';
import { RedactionError } from '../server/redact.js';
import {
  DEFAULT_AI_TURN_MS,
  DEFAULT_TURN_MS,
  type ClockRequest,
  type PilotPlan,
  type ReplayReport,
  type ServiceResult,
  type TimerBridge,
  MatchService,
} from '../server/service.js';
import { MemoryMatchRepository, type MatchRecord } from '../server/store.js';

const COOKIE = 'bard_duel_session';
const PLAYED_COOKIE = 'bard_duel_played';
const COOKIE_MAX_AGE = 2_592_000;
const SESSION_LABEL = 'bard-duel-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StoredClock {
  kind: ClockRequest['kind'];
  token: number;
  fireAt: number;
}

type WorkerResult<T> = ServiceResult<T> | { ok: false; error: 'redaction_failed' };

interface Env {
  DUEL_MATCH: {
    getByName(name: string): DuelStub;
  };
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Secret binding. Set with `wrangler secret put PASSCODE`. Never commit a value. */
  PASSCODE?: string;
  DUEL_TURN_TIMEOUT_MS?: string;
  DUEL_AI_TURN_MS?: string;
}

interface DuelStub {
  create(input: { id: string; decks: [Deck, Deck]; stance: Stance; tutorial?: boolean; matchesPlayed?: number }): Promise<WorkerResult<ClientPayload>>;
  get(id: string): Promise<WorkerResult<ClientPayload>>;
  act(id: string, action: GameAction): Promise<WorkerResult<ClientPayload>>;
  preview(id: string, action: GameAction): Promise<WorkerResult<{ matchId: string; preview: TradePreview }>>;
  replay(id: string): Promise<WorkerResult<ReplayReport>>;
}

class RecordingBridge implements TimerBridge {
  touched = false;
  pending: StoredClock | null = null;

  arm(clock: ClockRequest): void {
    this.touched = true;
    this.pending = { kind: clock.kind, token: clock.token, fireAt: Date.now() + clock.delayMs };
  }

  disarm(): void {
    this.touched = true;
    this.pending = null;
  }
}

/**
 * One match. SQLite holds the authoritative record, the pilot plan, and the
 * next alarm. Memory is only a cache for the request that is running.
 */
export class DuelMatch extends DurableObject<Env> {
  private readonly turnTimeoutMs: number;
  private readonly aiTurnMs: number;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.turnTimeoutMs = parseMs(env.DUEL_TURN_TIMEOUT_MS, DEFAULT_TURN_MS);
    this.aiTurnMs = parseMs(env.DUEL_AI_TURN_MS, DEFAULT_AI_TURN_MS);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS duel_match (
          slot TEXT PRIMARY KEY,
          record TEXT NOT NULL,
          plan TEXT,
          clock TEXT
        )`,
      );
    });
  }

  async create(input: { id: string; decks: [Deck, Deck]; stance: Stance; tutorial?: boolean; matchesPlayed?: number }): Promise<WorkerResult<ClientPayload>> {
    return this.run(input.id, (service) => service.create(input));
  }

  async get(id: string): Promise<WorkerResult<ClientPayload>> {
    return this.run(id, (service) => service.get(id));
  }

  async act(id: string, action: GameAction): Promise<WorkerResult<ClientPayload>> {
    return this.run(id, (service) => service.act(id, 0, action));
  }

  async preview(id: string, action: GameAction): Promise<WorkerResult<{ matchId: string; preview: TradePreview }>> {
    return this.run(id, (service) => service.preview(id, 0, action));
  }

  async replay(id: string): Promise<WorkerResult<ReplayReport>> {
    return this.run(id, (service) => service.replayVerify(id));
  }

  async alarm(): Promise<void> {
    const existing = this.read();
    if (!existing?.clock) return;
    if (existing.clock.fireAt > Date.now() + 250) {
      await this.ctx.storage.setAlarm(existing.clock.fireAt);
      return;
    }
    const due = existing.clock;
    await this.withMatch(existing.record.id, (service) => service.fireClock(existing.record.id, due.kind, due.token), true);
  }

  private async run<T>(id: string, fn: (service: MatchService) => Promise<ServiceResult<T>>): Promise<WorkerResult<T>> {
    try {
      return await this.withMatch(id, fn, false);
    } catch (error) {
      if (error instanceof RedactionError) {
        console.error(`[duel] redaction_failed ${error.leaks.join(',')}`);
        return { ok: false, error: 'redaction_failed' };
      }
      throw error;
    }
  }

  private async withMatch<T>(id: string, fn: (service: MatchService) => Promise<T>, fromAlarm: boolean): Promise<T> {
    const bridge = new RecordingBridge();
    const repo = new MemoryMatchRepository();
    const service = new MatchService(repo, createEngineAdapter(), {
      turnTimeoutMs: this.turnTimeoutMs,
      aiTurnMs: this.aiTurnMs,
    }, bridge);
    const existing = this.read();
    if (existing) {
      await repo.put(existing.record);
      service.installPlan(existing.record.id, existing.plan);
    }
    const result = await fn(service);
    const record = await repo.get(id);
    if (!record) return result;
    let clock: StoredClock | null = bridge.touched ? bridge.pending : (existing?.clock ?? null);
    if (fromAlarm && existing && record.generation === existing.record.generation && !bridge.touched) clock = null;
    this.write(record, service.exportPlan(id), clock);
    await this.syncAlarm(clock);
    return result;
  }

  private read(): { record: MatchRecord; plan: PilotPlan | null; clock: StoredClock | null } | null {
    const rows = this.ctx.storage.sql.exec('SELECT record, plan, clock FROM duel_match WHERE slot = ?', 'match').toArray();
    const row = rows[0];
    if (!row?.record) return null;
    return {
      record: JSON.parse(row.record) as MatchRecord,
      plan: row.plan ? (JSON.parse(row.plan) as PilotPlan) : null,
      clock: row.clock ? (JSON.parse(row.clock) as StoredClock) : null,
    };
  }

  private write(record: MatchRecord, plan: PilotPlan | null, clock: StoredClock | null): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO duel_match (slot, record, plan, clock) VALUES ('match', ?, ?, ?)
       ON CONFLICT(slot) DO UPDATE SET record = excluded.record, plan = excluded.plan, clock = excluded.clock`,
      JSON.stringify(record),
      plan ? JSON.stringify(plan) : null,
      clock ? JSON.stringify(clock) : null,
    );
  }

  private async syncAlarm(clock: StoredClock | null): Promise<void> {
    if (!clock) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const when = clock.fireAt < Date.now() ? Date.now() + 10 : clock.fireAt;
    await this.ctx.storage.setAlarm(when);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return seal(await route(request, env));
  },
};

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/robots.txt') return robots();
  if (request.method === 'POST' && url.pathname === '/api/metrics') return new Response(null, { status: 204 });
  if (!env.PASSCODE) return unavailable(request);

  if (request.method === 'POST' && url.pathname === '/api/unlock') return unlock(request, env.PASSCODE);
  if (!(await authorized(request, env.PASSCODE))) {
    if (url.pathname.startsWith('/api/')) return json({ error: 'unauthorized' }, 401);
    if (request.method === 'GET' || request.method === 'HEAD') return gate(false);
    return json({ error: 'unauthorized' }, 401);
  }

  if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true, service: 'bard-duel' }, 200);
  if (url.pathname === '/api/matches' && request.method === 'POST') return createMatch(request, env);
  const match = url.pathname.match(/^\/api\/matches\/([^/]+)(\/actions|\/preview|\/replay-verify)?$/);
  if (match) return matchRoute(request, env, match[1] ?? '', match[2] ?? '');
  if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
  if (!env.ASSETS) return unavailable(request);
  return env.ASSETS.fetch(request);
}

async function createMatch(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request, 65_536);
  if (body == null) return json({ error: 'bad_request' }, 400);
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const parsed = parseCreate(parsedBody);
  if (!parsed) return json({ error: 'bad_request' }, 400);
  const id = crypto.randomUUID();
  const tutorial = parsed.tutorial === true;
  const played = tutorial ? 0 : playedCount(request.headers.get('cookie'));
  try {
    const result = await env.DUEL_MATCH.getByName(id).create({
      id,
      decks: parsed.decks,
      stance: parsed.stance,
      tutorial,
      matchesPlayed: tutorial ? undefined : played,
    });
    if (!result.ok) return json({ error: result.error }, result.error === 'redaction_failed' ? 500 : 400);
    const extra = new Headers();
    if (!tutorial) extra.set('Set-Cookie', `${PLAYED_COOKIE}=${played + 1}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`);
    return json(result.payload, 201, extra);
  } catch {
    console.error('[duel] internal');
    return json({ error: 'internal' }, 500);
  }
}

async function matchRoute(request: Request, env: Env, id: string, suffix: string): Promise<Response> {
  if (!UUID.test(id)) return json({ error: 'not_found' }, 404);
  const player = new URL(request.url).searchParams.get('player');
  if (player != null && player !== '0') return json({ error: 'forbidden_view' }, 403);
  const stub = env.DUEL_MATCH.getByName(id);
  try {
    if (suffix === '' && request.method === 'GET') return send(await stub.get(id), 'get');
    if (suffix === '/replay-verify' && request.method === 'POST') return send(await stub.replay(id), 'replay');
    if ((suffix === '/actions' || suffix === '/preview') && request.method === 'POST') {
      const body = await readBody(request, 65_536);
      if (body == null) return json({ error: 'bad_request' }, 400);
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        return json({ error: 'bad_request' }, 400);
      }
      const action = parseAction((parsedBody as { action?: unknown }).action);
      if (!action) return json({ error: 'bad_request' }, 400);
      if (suffix === '/actions') return send(await stub.act(id, action), 'act');
      return send(await stub.preview(id, action), 'preview');
    }
    return json({ error: 'not_found' }, 404);
  } catch {
    console.error('[duel] internal');
    return json({ error: 'internal' }, 500);
  }
}

function send<T>(result: WorkerResult<T>, mode: 'get' | 'act' | 'preview' | 'replay'): Response {
  if (result.ok) return json(result.payload, 200);
  if (result.error === 'redaction_failed') return json({ error: 'redaction_failed' }, 500);
  if (result.error === 'not_found') return json({ error: result.error }, 404);
  if (result.error === 'forbidden_view') return json({ error: result.error }, 403);
  if (mode === 'preview') return json({ error: result.error }, 400);
  return json({ error: result.error }, 400);
}

async function unlock(request: Request, passcode: string): Promise<Response> {
  const submitted = await readPasscode(request);
  const jsonClient = (request.headers.get('content-type') ?? '').includes('application/json');
  if (submitted == null || submitted.length === 0 || submitted.length > 200 || !(await safeEqual(submitted, passcode))) {
    return jsonClient ? json({ error: 'unauthorized' }, 401) : gate(true);
  }
  const token = await sessionToken(passcode);
  const headers = new Headers();
  headers.set('Set-Cookie', sessionCookie(token, new URL(request.url).protocol === 'https:'));
  if (!jsonClient) {
    headers.set('Location', '/');
    return new Response(null, { status: 303, headers });
  }
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

async function authorized(request: Request, passcode: string): Promise<boolean> {
  const got = readCookie(request.headers.get('cookie'), COOKIE);
  if (!got) return false;
  return safeEqual(got, await sessionToken(passcode));
}

async function sessionToken(passcode: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(passcode), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(SESSION_LABEL));
  return hex(sig);
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual(x: BufferSource, y: BufferSource): boolean };
  return subtle.timingSafeEqual(left, right);
}

function sessionCookie(token: string, secure: boolean): string {
  const parts = [`${COOKIE}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${COOKIE_MAX_AGE}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function playedCount(header: string | null): number {
  const raw = readCookie(header, PLAYED_COOKIE);
  if (!raw || !/^\d+$/.test(raw)) return 0;
  return Number(raw);
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

async function readPasscode(request: Request): Promise<string | null> {
  const type = request.headers.get('content-type') ?? '';
  const text = await readBody(request, 4_000);
  if (text == null) return null;
  if (type.includes('application/json')) {
    try {
      const body = JSON.parse(text) as { passcode?: unknown };
      return typeof body.passcode === 'string' ? body.passcode : null;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(text).get('passcode');
}

async function readBody(request: Request, limit: number): Promise<string | null> {
  const text = await request.text();
  if (text.length > limit) return null;
  return text;
}

function robots(): Response {
  return new Response('User-agent: *\nDisallow: /\n', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function unavailable(request: Request): Response {
  if (new URL(request.url).pathname.startsWith('/api/')) return json({ error: 'unavailable' }, 503);
  return new Response('This test is not configured.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function gate(rejected: boolean): Response {
  const note = rejected ? '<p class="bad">That passcode was not accepted.</p>' : '';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow, noarchive" />
  <title>Bard</title>
  <style>
    html, body { margin: 0; height: 100%; background: #140e0a; color: #f3e6d0; font-family: Georgia, serif; }
    main { min-height: 100%; display: grid; place-items: center; }
    form { display: grid; gap: 12px; width: min(320px, 88vw); }
    input, button { font: inherit; padding: 12px; border-radius: 8px; }
    input { background: #24180f; color: #f3e6d0; border: 1px solid #8a6a3b; }
    button { background: #c6a15a; color: #140e0a; border: 0; }
    .bad { color: #e0a090; margin: 0; }
  </style>
</head>
<body>
  <main>
    <form method="post" action="/api/unlock">
      <h1>Bard</h1>
      ${note}
      <input type="password" name="passcode" autocomplete="current-password" required />
      <button type="submit">Enter</button>
    </form>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: rejected ? 401 : 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function json(body: unknown, status: number, extra?: Headers): Response {
  const headers = extra ?? new Headers();
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

function seal(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function parseMs(value: string | undefined, fallback: number): number {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}
