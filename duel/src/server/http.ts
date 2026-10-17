import express, { type NextFunction, type Request, type Response } from 'express';
import { createEngineAdapter } from '../engine/adapter.js';
import type { PlayerId } from '../types.js';
import { FriendBook, FRIEND_TURN_MS, type FriendResult, type FriendSeed } from './friends.js';
import { parseAction, parseCreate } from './parse.js';
import { RedactionError } from './redact.js';
import { MatchService } from './service.js';
import {
  FRIEND_CODE,
  authorized,
  friendCode,
  gateHtml,
  mintWho,
  passCookie,
  safeEqual,
  safeNext,
  sessionToken,
  whoCookie,
  whoToken,
} from './session.js';
import { MemoryMatchRepository, type MatchRepository } from './store.js';

export interface AppOptions {
  repo?: MatchRepository;
  turnTimeoutMs?: number;
  aiTurnMs?: number;
  friendTurnMs?: number;
  passcode?: string;
}

export function createApp(options: AppOptions = {}) {
  const repo = options.repo ?? new MemoryMatchRepository();
  let notify: (id: string) => void = () => {};
  const service = new MatchService(repo, createEngineAdapter(), {
    turnTimeoutMs: options.turnTimeoutMs,
    aiTurnMs: options.aiTurnMs,
    onChange: (id) => notify(id),
  });
  const book = new FriendBook(service, options.friendTurnMs ?? FRIEND_TURN_MS);
  notify = (id) => book.changed(id);
  const app = express();
  if (options.passcode) mountGate(app, options.passcode);
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'bard-duel' });
  });

  app.post('/api/metrics', (_req, res) => {
    res.status(204).end();
  });

  app.post('/api/matches', async (req, res, next) => {
    try {
      const parsed = parseCreate(req.body);
      if (!parsed) return sendError(res, 400, 'bad_request');
      const tutorial = parsed.tutorial === true;
      const played = tutorial ? 0 : playedCount(req.headers.cookie);
      const created = await service.create({
        decks: parsed.decks,
        stance: parsed.stance,
        tutorial,
        matchesPlayed: tutorial ? undefined : played,
      });
      if (!created.ok) return sendError(res, 400, created.error);
      if (!tutorial) res.setHeader('Set-Cookie', playedCookie(played + 1));
      res.status(201).json(created.payload);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/friends', async (req, res, next) => {
    try {
      const who = bindWho(req, res);
      const deckId = typeof req.body?.deckId === 'string' ? req.body.deckId : null;
      sendFriend(res, await book.open(who.token, deckId), 201);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/friends/:code', async (req, res, next) => {
    try {
      const code = friendParam(req);
      if (!code) return sendError(res, 404, 'not_found');
      const who = bindWho(req, res);
      sendFriend(res, await book.read(code, who.token), 200);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/friends/:code/join', async (req, res, next) => {
    try {
      const code = friendParam(req);
      if (!code) return sendError(res, 404, 'not_found');
      const who = bindWho(req, res);
      const deckId = typeof req.body?.deckId === 'string' ? req.body.deckId : null;
      sendFriend(res, await book.join(code, who.token, deckId), 200);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/friends/:code/cancel', async (req, res, next) => {
    try {
      const code = friendParam(req);
      if (!code) return sendError(res, 404, 'not_found');
      const who = bindWho(req, res);
      sendFriend(res, await book.cancel(code, who.token), 200);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/friends/:code/rematch', async (req, res, next) => {
    try {
      const code = friendParam(req);
      if (!code) return sendError(res, 404, 'not_found');
      const who = bindWho(req, res);
      const result = await book.rematch(code, who.token, (seed) => spawnHere(book, who.token, seed));
      sendFriend(res, result, 200);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/matches/:id', async (req, res, next) => {
    try {
      if (!allowedViewer(req)) return sendError(res, 403, 'forbidden_view');
      const seat = await seated(service, req);
      if (seat === 'forbid') return sendError(res, 403, 'forbidden_view');
      const result = await service.get(paramId(req), seat === 'ai' ? 0 : seat);
      if (!result.ok) return sendError(res, result.error === 'forbidden_view' ? 403 : 404, result.error);
      res.json(result.payload);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/matches/:id/actions', async (req, res, next) => {
    try {
      if (!allowedViewer(req)) return sendError(res, 403, 'forbidden_view');
      const action = parseAction(req.body?.action);
      if (!action) return sendError(res, 400, 'bad_request');
      const seat = await seated(service, req);
      if (seat === 'forbid') return sendError(res, 403, 'forbidden_view');
      const result = await service.act(paramId(req), seat === 'ai' ? 0 : seat, action);
      if (!result.ok) return sendError(res, result.error === 'not_found' ? 404 : result.error === 'forbidden_view' ? 403 : 400, result.error);
      res.json(result.payload);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/matches/:id/preview', async (req, res, next) => {
    try {
      if (!allowedViewer(req)) return sendError(res, 403, 'forbidden_view');
      const action = parseAction(req.body?.action);
      if (!action) return sendError(res, 400, 'bad_request');
      const seat = await seated(service, req);
      if (seat === 'forbid') return sendError(res, 403, 'forbidden_view');
      const result = await service.preview(paramId(req), seat === 'ai' ? 0 : seat, action);
      if (!result.ok) return sendError(res, result.error === 'not_found' ? 404 : 400, result.error);
      res.json(result.payload);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/matches/:id/replay-verify', async (req, res, next) => {
    try {
      const result = await service.replayVerify(paramId(req));
      if (!result.ok) return sendError(res, 404, result.error);
      res.json(result.payload);
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', (_req, res) => {
    sendError(res, 404, 'not_found');
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof RedactionError) {
      console.error(`[duel] redaction_failed ${error.leaks.join(',')}`);
      sendError(res, 500, 'redaction_failed');
      return;
    }
    console.error('[duel] internal');
    sendError(res, 500, 'internal');
  });

  return { app, service, repo, book };
}

async function spawnHere(book: FriendBook, session: string, seed: FriendSeed): Promise<FriendResult> {
  const code = friendCode();
  const started = await book.startMatch({ ...seed, code });
  if (!started.ok) return started;
  return book.read(code, session);
}

function mountGate(app: express.Express, passcode: string): void {
  app.post('/api/unlock', express.urlencoded({ extended: false, limit: '4kb' }), async (req, res) => {
    const submitted = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
    const next = safeNext(typeof req.body?.next === 'string' ? req.body.next : null);
    if (submitted.length === 0 || submitted.length > 200 || !(await safeEqual(submitted, passcode))) {
      res.status(401).type('html').send(gateHtml(true, next));
      return;
    }
    const secure = req.secure === true;
    res.append('Set-Cookie', passCookie(await sessionToken(passcode), secure));
    if (!whoToken(req.headers.cookie)) res.append('Set-Cookie', whoCookie(mintWho(), secure));
    res.redirect(303, next ?? '/');
  });
  app.use(async (req, res, next) => {
    if (req.path === '/api/health' || req.path === '/api/metrics' || req.path === '/robots.txt') return next();
    if (await authorized(req.headers.cookie, passcode)) return next();
    if (req.path.startsWith('/api/')) return sendError(res, 401, 'unauthorized');
    if (req.method === 'GET' || req.method === 'HEAD') {
      res.status(req.path === '/api/unlock' ? 401 : 200).type('html').send(gateHtml(false, safeNext(req.path)));
      return;
    }
    return sendError(res, 401, 'unauthorized');
  });
}

function bindWho(req: Request, res: Response): { token: string } {
  const existing = whoToken(req.headers.cookie);
  if (existing) return { token: existing };
  const token = mintWho();
  res.append('Set-Cookie', whoCookie(token, req.secure === true));
  return { token };
}

function friendParam(req: Request): string | null {
  const code = req.params.code;
  return typeof code === 'string' && FRIEND_CODE.test(code) ? code : null;
}

function sendFriend(res: Response, result: FriendResult, okStatus: number): void {
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'forbidden' || result.error === 'cancelled' ? 403 : 400;
    sendError(res, status, result.error);
    return;
  }
  res.status(okStatus).json(result.body);
}

async function seated(service: MatchService, req: Request): Promise<PlayerId | 'ai' | 'forbid'> {
  const id = paramId(req);
  if (!(await service.isFriend(id))) return 'ai';
  const seat = await service.seatForId(id, whoToken(req.headers.cookie));
  return seat ?? 'forbid';
}

function sendError(res: Response, status: number, error: string) {
  res.status(status).json({ error });
}

function paramId(req: Request): string {
  const id = req.params.id;
  return typeof id === 'string' ? id : '';
}

function allowedViewer(req: Request): boolean {
  const requested = req.query.player;
  if (requested == null) return true;
  return requested === '0';
}

const PLAYED_COOKIE = 'bard_duel_played';
const PLAYED_MAX_AGE = 2_592_000;

function playedCount(header: string | undefined): number {
  const raw = readCookie(header, PLAYED_COOKIE);
  if (!raw || !/^\d+$/.test(raw)) return 0;
  return Number(raw);
}

function playedCookie(next: number): string {
  return `${PLAYED_COOKIE}=${next}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${PLAYED_MAX_AGE}`;
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

export type { PlayerId };
