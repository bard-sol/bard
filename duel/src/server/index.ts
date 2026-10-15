import { createApp } from './http.js';
import { DEFAULT_AI_TURN_MS, DEFAULT_TURN_MS } from './service.js';

const port = Number(process.env.PORT ?? 8787);
const { app } = createApp({
  aiTurnMs: Number(process.env.DUEL_AI_TURN_MS ?? DEFAULT_AI_TURN_MS),
  turnTimeoutMs: Number(process.env.DUEL_TURN_TIMEOUT_MS ?? DEFAULT_TURN_MS),
});

app.listen(port, () => {
  console.log(`[duel] match service http://localhost:${port}`);
});
