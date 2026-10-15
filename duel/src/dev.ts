import { createServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/http.js';
import { DEFAULT_AI_TURN_MS, DEFAULT_TURN_MS } from './server/service.js';

const port = Number(process.env.PORT ?? 5173);
const { app } = createApp({
  aiTurnMs: Number(process.env.DUEL_AI_TURN_MS ?? DEFAULT_AI_TURN_MS),
  turnTimeoutMs: Number(process.env.DUEL_TURN_TIMEOUT_MS ?? DEFAULT_TURN_MS),
});

const server = createServer(app);
const vite = await createViteServer({
  root: process.cwd(),
  server: { middlewareMode: true, hmr: { server } },
  appType: 'spa',
});
app.use(vite.middlewares);

server.listen(port, () => {
  console.log(`[duel] http://localhost:${port}`);
});
