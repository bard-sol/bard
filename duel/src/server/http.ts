import express, { type NextFunction, type Request, type Response } from 'express';
import { createEngineAdapter } from '../engine/adapter.js';
import type { PlayerId } from '../types.js';
import { parseAction, parseCreate } from './parse.js';
import { RedactionError } from './redact.js';
import { MatchService } from './service.js';
import { MemoryMatchRepository, type MatchRepository } from './store.js';

export interface AppOptions {
  repo?: MatchRepository;
  turnTimeoutMs?: number;
  aiTurnMs?: number;
}

export function createApp(options: AppOptions = {}) {
  const repo = options.repo ?? new MemoryMatchRepository();
  const service = new MatchService(repo, createEngineAdapter(), {
    turnTimeoutMs: options.turnTimeoutMs,
    aiTurnMs: options.aiTurnMs,
  });
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'bard-duel' });
  });

  app.post('/api/matches', async (req, res, next) => {
    try {
      const parsed = parseCreate(req.body);
      if (!parsed) return sendError(res, 400, 'bad_request');
      const created = await service.create({ decks: parsed.decks, stance: parsed.stance });
      if (!created.ok) return sendError(res, 400, created.error);
      res.status(201).json(created.payload);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/matches/:id', async (req, res, next) => {
    try {
      if (!allowedViewer(req)) return sendError(res, 403, 'forbidden_view');
      const result = await service.get(paramId(req));
      if (!result.ok) return sendError(res, 404, result.error);
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
      const result = await service.act(paramId(req), 0, action);
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
      const result = await service.preview(paramId(req), 0, action);
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

  return { app, service, repo };
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

export type { PlayerId };
