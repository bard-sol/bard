import { createServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/http.js';
import { attachLive } from './server/live.js';
import { FRIEND_TURN_MS } from './server/friends.js';
import { DEFAULT_AI_TURN_MS, DEFAULT_TURN_MS } from './server/service.js';

const port = Number(process.env.PORT ?? 5173);
const passcode = process.env.PASSCODE || undefined;
const { app, book } = createApp({
  aiTurnMs: Number(process.env.DUEL_AI_TURN_MS ?? DEFAULT_AI_TURN_MS),
  turnTimeoutMs: Number(process.env.DUEL_TURN_TIMEOUT_MS ?? DEFAULT_TURN_MS),
  friendTurnMs: Number(process.env.DUEL_FRIEND_TURN_MS ?? FRIEND_TURN_MS),
  passcode,
});

const server = createServer(app);
attachLive(server, book, passcode);
const vite = await createViteServer({
  root: process.cwd(),
  server: { middlewareMode: true, hmr: { server } },
  appType: 'spa',
});
app.use(vite.middlewares);

server.listen(port, () => {
  console.log(`[duel] http://localhost:${port}`);
});
