import { DurableObject, type DurableObjectState } from 'cloudflare:workers';
import { createEngineAdapter } from '../engine/adapter.js';
import type { ClientPayload, Deck, FriendBody, GameAction, PlayerId, Stance, TradePreview } from '../types.js';
import { FriendBook, FRIEND_TURN_MS, type FriendResult, type FriendSeed, type Lobby } from '../server/friends.js';
import { parseAction, parseCreate } from '../server/parse.js';
import { RedactionError } from '../server/redact.js';
import {
  FRIEND_CODE,
  authorized,
  friendCode,
  gateHtml,
  mintWho,
  passCookie,
  readCookie,
  safeEqual,
  safeNext,
  sessionToken,
  whoCookie,
  whoToken,
} from '../server/session.js';
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

const PLAYED_COOKIE = 'bard_duel_played';
const COOKIE_MAX_AGE = 2_592_000;
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
  DUEL_FRIEND_TURN_MS?: string;
}

interface DuelStub {
  create(input: { id: string; decks: [Deck, Deck]; stance: Stance; tutorial?: boolean; matchesPlayed?: number }): Promise<WorkerResult<ClientPayload>>;
  get(id: string): Promise<WorkerResult<ClientPayload>>;
  act(id: string, action: GameAction): Promise<WorkerResult<ClientPayload>>;
  preview(id: string, action: GameAction): Promise<WorkerResult<{ matchId: string; preview: TradePreview }>>;
  replay(id: string): Promise<WorkerResult<ReplayReport>>;
  openFriend(input: { code: string; session: string; deckId: string | null }): Promise<FriendResult>;
  readFriend(input: { code: string; session: string }): Promise<FriendResult>;
  joinFriend(input: { code: string; session: string; deckId: string | null }): Promise<FriendResult>;
  cancelFriend(input: { code: string; session: string }): Promise<FriendResult>;
  rematchFriend(input: { code: string; session: string }): Promise<FriendResult>;
  seedFriend(input: FriendSeed & { code: string }): Promise<FriendResult>;
  actAs(input: { code: string; session: string; action: GameAction }): Promise<WorkerResult<ClientPayload>>;
  previewAs(input: { code: string; session: string; action: GameAction }): Promise<WorkerResult<{ matchId: string; preview: TradePreview }>>;
  getAs(input: { code: string; session: string }): Promise<WorkerResult<ClientPayload>>;
  fetch(request: Request): Promise<Response>;
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
  private readonly friendTurnMs: number;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.turnTimeoutMs = parseMs(env.DUEL_TURN_TIMEOUT_MS, DEFAULT_TURN_MS);
    this.aiTurnMs = parseMs(env.DUEL_AI_TURN_MS, DEFAULT_AI_TURN_MS);
    this.friendTurnMs = parseMs(env.DUEL_FRIEND_TURN_MS, FRIEND_TURN_MS);
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

  async openFriend(input: { code: string; session: string; deckId: string | null }): Promise<FriendResult> {
    return this.withBook(input.code, (book) => book.open(input.session, input.deckId, input.code));
  }

  async readFriend(input: { code: string; session: string }): Promise<FriendResult> {
    return this.withBook(input.code, (book) => book.read(input.code, input.session));
  }

  async joinFriend(input: { code: string; session: string; deckId: string | null }): Promise<FriendResult> {
    return this.withBook(input.code, (book) => book.join(input.code, input.session, input.deckId));
  }

  async cancelFriend(input: { code: string; session: string }): Promise<FriendResult> {
    return this.withBook(input.code, (book) => book.cancel(input.code, input.session));
  }

  async seedFriend(input: FriendSeed & { code: string }): Promise<FriendResult> {
    return this.withBook(input.code, (book) => book.startMatch(input));
  }

  async rematchFriend(input: { code: string; session: string }): Promise<FriendResult> {
    return this.withBook(input.code, (book) => book.rematch(input.code, input.session, async (seed) => {
      const code = friendCode();
      const seeded = await this.env.DUEL_MATCH.getByName(code).seedFriend({ ...seed, code });
      if (!seeded.ok) return seeded;
      return this.env.DUEL_MATCH.getByName(code).readFriend({ code, session: input.session });
    }));
  }

  async actAs(input: { code: string; session: string; action: GameAction }): Promise<WorkerResult<ClientPayload>> {
    return this.run(input.code, async (service) => {
      const seat = await service.seatForId(input.code, input.session);
      if (seat == null) return { ok: false, error: 'forbidden_view' };
      return service.act(input.code, seat, input.action);
    });
  }

  async previewAs(input: { code: string; session: string; action: GameAction }): Promise<WorkerResult<{ matchId: string; preview: TradePreview }>> {
    return this.run(input.code, async (service) => {
      const seat = await service.seatForId(input.code, input.session);
      if (seat == null) return { ok: false, error: 'forbidden_view' };
      return service.preview(input.code, seat, input.action);
    });
  }

  async getAs(input: { code: string; session: string }): Promise<WorkerResult<ClientPayload>> {
    return this.run(input.code, async (service) => {
      const seat = await service.seatForId(input.code, input.session);
      if (seat == null) return { ok: false, error: 'forbidden_view' };
      return service.get(input.code, seat);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const session = whoToken(request.headers.get('cookie'));
    const code = new URL(request.url).pathname.split('/')[3] ?? '';
    if (!session || !isMatchId(code)) return new Response('unauthorized', { status: 401 });
    const seat = await this.seatOf(code, session);
    if (seat == null) return new Response('forbidden', { status: 403 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [session]);
    const result = await this.getAs({ code, session });
    if (result.ok) server.send(JSON.stringify(result.payload));
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  async webSocketMessage(): Promise<void> {
    /* Actions stay on HTTP so each one is checked against that seat's legalActions. */
  }

  async webSocketClose(): Promise<void> {}

  async webSocketError(): Promise<void> {}

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
    await this.publish(id, service);
    return result;
  }

  private async withBook<T>(code: string, fn: (book: FriendBook) => Promise<T>): Promise<T> {
    const bridge = new RecordingBridge();
    const repo = new MemoryMatchRepository();
    let notify: (id: string) => void = () => {};
    const service = new MatchService(repo, createEngineAdapter(), {
      turnTimeoutMs: this.turnTimeoutMs,
      aiTurnMs: this.aiTurnMs,
      onChange: (id) => notify(id),
    }, bridge);
    const book = new FriendBook(service, this.friendTurnMs);
    notify = () => {};
    const existing = this.read();
    if (existing) {
      await repo.put(existing.record);
      service.installPlan(existing.record.id, existing.plan);
    }
    const lobby = this.readLobby();
    if (lobby) book.lobbies.set(lobby.code, lobby);
    const result = await fn(book);
    const record = await repo.get(code);
    if (record) {
      let clock: StoredClock | null = bridge.touched ? bridge.pending : (existing?.clock ?? null);
      this.write(record, service.exportPlan(code), clock);
      await this.syncAlarm(clock);
      await this.publish(code, service);
    }
    const nextLobby = book.lobbies.get(code) ?? null;
    if (record) this.writeLobby(null);
    else this.writeLobby(nextLobby);
    return result;
  }

  private async publish(id: string, service: MatchService): Promise<void> {
    if (!(await service.isFriend(id))) return;
    for (const socket of this.ctx.getWebSockets()) {
      const session = this.ctx.getTags(socket)[0];
      if (!session) continue;
      const seat = await service.seatForId(id, session);
      if (seat == null) continue;
      const view = await service.get(id, seat);
      if (view.ok) socket.send(JSON.stringify(view.payload));
    }
  }

  private async seatOf(code: string, session: string): Promise<PlayerId | null> {
    const existing = this.read();
    if (!existing?.record.friend) return null;
    if (existing.record.friend.sessions[0] === session) return 0;
    if (existing.record.friend.sessions[1] === session) return 1;
    return null;
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

  private readLobby(): Lobby | null {
    const rows = this.ctx.storage.sql.exec('SELECT record FROM duel_match WHERE slot = ?', 'lobby').toArray();
    const row = rows[0];
    if (!row?.record) return null;
    return JSON.parse(row.record) as Lobby;
  }

  private writeLobby(lobby: Lobby | null): void {
    if (!lobby) {
      this.ctx.storage.sql.exec('DELETE FROM duel_match WHERE slot = ?', 'lobby');
      return;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO duel_match (slot, record, plan, clock) VALUES ('lobby', ?, NULL, NULL)
       ON CONFLICT(slot) DO UPDATE SET record = excluded.record, plan = NULL, clock = NULL`,
      JSON.stringify(lobby),
    );
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
  if (!(await authorized(request.headers.get('cookie'), env.PASSCODE))) {
    if (url.pathname.startsWith('/api/')) return json({ error: 'unauthorized' }, 401);
    if (request.method === 'GET' || request.method === 'HEAD') return gate(false, safeNext(url.pathname));
    return json({ error: 'unauthorized' }, 401);
  }

  if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true, service: 'bard-duel' }, 200);
  if (url.pathname === '/api/matches' && request.method === 'POST') return createMatch(request, env);
  if (url.pathname === '/api/friends' && request.method === 'POST') return friendOpen(request, env);
  const friend = url.pathname.match(/^\/api\/friends\/([^/]+)(\/join|\/cancel|\/rematch)?$/);
  if (friend) return friendRoute(request, env, friend[1] ?? '', friend[2] ?? '');
  const match = url.pathname.match(/^\/api\/matches\/([^/]+)(\/actions|\/preview|\/replay-verify|\/live)?$/);
  if (match) return matchRoute(request, env, match[1] ?? '', match[2] ?? '');
  if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
  if ((request.method === 'GET' || request.method === 'HEAD') && safeNext(url.pathname)) return indexHtml(request, env);
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

async function friendOpen(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (body == null) return json({ error: 'bad_request' }, 400);
  const deckId = typeof (body as { deckId?: unknown }).deckId === 'string' ? (body as { deckId: string }).deckId : null;
  const code = friendCode();
  const { session, headers } = await ensureWho(request);
  try {
    const result = await env.DUEL_MATCH.getByName(code).openFriend({ code, session, deckId });
    return sendFriend(result, 201, headers);
  } catch {
    console.error('[duel] internal');
    return json({ error: 'internal' }, 500);
  }
}

async function friendRoute(request: Request, env: Env, code: string, suffix: string): Promise<Response> {
  if (!FRIEND_CODE.test(code)) return json({ error: 'not_found' }, 404);
  const { session, headers } = await ensureWho(request);
  const stub = env.DUEL_MATCH.getByName(code);
  try {
    if (suffix === '' && request.method === 'GET') return sendFriend(await stub.readFriend({ code, session }), 200, headers);
    if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
    if (suffix === '/join') {
      const body = await readJson(request);
      if (body == null) return json({ error: 'bad_request' }, 400);
      const deckId = typeof (body as { deckId?: unknown }).deckId === 'string' ? (body as { deckId: string }).deckId : null;
      return sendFriend(await stub.joinFriend({ code, session, deckId }), 200, headers);
    }
    if (suffix === '/cancel') return sendFriend(await stub.cancelFriend({ code, session }), 200, headers);
    if (suffix === '/rematch') return sendFriend(await stub.rematchFriend({ code, session }), 200, headers);
    return json({ error: 'not_found' }, 404);
  } catch {
    console.error('[duel] internal');
    return json({ error: 'internal' }, 500);
  }
}

async function matchRoute(request: Request, env: Env, id: string, suffix: string): Promise<Response> {
  if (!isMatchId(id)) return json({ error: 'not_found' }, 404);
  const player = new URL(request.url).searchParams.get('player');
  if (player != null && player !== '0') return json({ error: 'forbidden_view' }, 403);
  const stub = env.DUEL_MATCH.getByName(id);
  try {
    if (suffix === '/live' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') return stub.fetch(request);
    const friend = FRIEND_CODE.test(id);
    const session = whoToken(request.headers.get('cookie'));
    if (suffix === '' && request.method === 'GET') {
      if (!friend) return send(await stub.get(id), 'get');
      if (!session) return json({ error: 'forbidden_view' }, 403);
      return send(await stub.getAs({ code: id, session }), 'get');
    }
    if (suffix === '/replay-verify' && request.method === 'POST') return send(await stub.replay(id), 'replay');
    if ((suffix === '/actions' || suffix === '/preview') && request.method === 'POST') {
      const body = await readJson(request);
      if (body == null) return json({ error: 'bad_request' }, 400);
      const action = parseAction((body as { action?: unknown }).action);
      if (!action) return json({ error: 'bad_request' }, 400);
      if (!friend) {
        if (suffix === '/actions') return send(await stub.act(id, action), 'act');
        return send(await stub.preview(id, action), 'preview');
      }
      if (!session) return json({ error: 'forbidden_view' }, 403);
      if (suffix === '/actions') return send(await stub.actAs({ code: id, session, action }), 'act');
      return send(await stub.previewAs({ code: id, session, action }), 'preview');
    }
    return json({ error: 'not_found' }, 404);
  } catch {
    console.error('[duel] internal');
    return json({ error: 'internal' }, 500);
  }
}

function isMatchId(id: string): boolean {
  return UUID.test(id) || FRIEND_CODE.test(id);
}

async function ensureWho(request: Request): Promise<{ session: string; headers: Headers }> {
  const headers = new Headers();
  const existing = whoToken(request.headers.get('cookie'));
  if (existing) return { session: existing, headers };
  const session = mintWho();
  headers.set('Set-Cookie', whoCookie(session, new URL(request.url).protocol === 'https:'));
  return { session, headers };
}

function sendFriend(result: FriendResult, okStatus: number, extra?: Headers): Response {
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'forbidden' || result.error === 'cancelled' ? 403 : 400;
    return json({ error: result.error }, status, extra);
  }
  return json(result.body, okStatus, extra);
}

async function indexHtml(request: Request, env: Env): Promise<Response> {
  if (!env.ASSETS) return unavailable(request);
  const index = new URL(request.url);
  index.pathname = '/index.html';
  return env.ASSETS.fetch(new Request(index, request));
}

async function readJson(request: Request): Promise<unknown | null> {
  const body = await readBody(request, 65_536);
  if (body == null) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
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
  const form = await readPasscode(request);
  const jsonClient = (request.headers.get('content-type') ?? '').includes('application/json');
  const next = safeNext(form?.next);
  if (form == null || form.passcode.length === 0 || form.passcode.length > 200 || !(await safeEqual(form.passcode, passcode))) {
    return jsonClient ? json({ error: 'unauthorized' }, 401) : gate(true, next);
  }
  const secure = new URL(request.url).protocol === 'https:';
  const headers = new Headers();
  headers.append('Set-Cookie', passCookie(await sessionToken(passcode), secure));
  if (!whoToken(request.headers.get('cookie'))) headers.append('Set-Cookie', whoCookie(mintWho(), secure));
  if (!jsonClient) {
    headers.set('Location', next ?? '/');
    return new Response(null, { status: 303, headers });
  }
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

function playedCount(header: string | null): number {
  const raw = readCookie(header, PLAYED_COOKIE);
  if (!raw || !/^\d+$/.test(raw)) return 0;
  return Number(raw);
}

async function readPasscode(request: Request): Promise<{ passcode: string; next: string | null } | null> {
  const type = request.headers.get('content-type') ?? '';
  const text = await readBody(request, 4_000);
  if (text == null) return null;
  if (type.includes('application/json')) {
    try {
      const body = JSON.parse(text) as { passcode?: unknown; next?: unknown };
      if (typeof body.passcode !== 'string') return null;
      return { passcode: body.passcode, next: typeof body.next === 'string' ? body.next : null };
    } catch {
      return null;
    }
  }
  const params = new URLSearchParams(text);
  const passcode = params.get('passcode');
  if (passcode == null) return null;
  return { passcode, next: params.get('next') };
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

function gate(rejected: boolean, next: string | null): Response {
  return new Response(gateHtml(rejected, next), {
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
