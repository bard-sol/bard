import { createServer } from 'node:http';
import { FRIEND_TURN_MS } from './friends.js';
import { createApp } from './http.js';
import { attachLive } from './live.js';
import { DEFAULT_AI_TURN_MS, DEFAULT_TURN_MS } from './service.js';

const port = Number(process.env.PORT ?? 8787);
const passcode = process.env.PASSCODE || undefined;
const { app, book } = createApp({
  aiTurnMs: Number(process.env.DUEL_AI_TURN_MS ?? DEFAULT_AI_TURN_MS),
  turnTimeoutMs: Number(process.env.DUEL_TURN_TIMEOUT_MS ?? DEFAULT_TURN_MS),
  friendTurnMs: Number(process.env.DUEL_FRIEND_TURN_MS ?? FRIEND_TURN_MS),
  passcode,
});

const server = createServer(app);
attachLive(server, book, passcode);
server.listen(port, () => {
  console.log(`[duel] match service http://localhost:${port}`);
});
