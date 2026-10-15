# Bard card duel

Off-chain prototype of the turn-based duel. Devnet only: there is no wallet, token, or chain code in this folder.

The landing page, the site worker (`noisysurg11`), and Supabase are untouched. This folder has its own Worker config.

## Run

```bash
cd duel
npm install
npm run dev
```

Open http://localhost:5173. Pick a stance and press Play. You are Old Wick (The Candle) against AI pilot v1 on Ash & Ember (The Fold).

```bash
npm test
npm run typecheck
npm run parity
```

`npm start` serves the match API alone on port 8787.

Timers default to a 35s human turn and about 5s for the pilot. Override them with `DUEL_TURN_TIMEOUT_MS` and `DUEL_AI_TURN_MS`.

## Versions

The live rules are the pin in `engine/active.mjs`. Gameplay v1.1 arrives as a new folder (`engine/v1.1/`) with its own cards file and rules. Point that pin at the new folder. The server records, on every match setup:

| Field | v1 |
|---|---|
| `engineVersion` | `duel-engine-1.0.0` |
| `cardsVersion` | `cards-proto-1` |
| `aiVersion` | `pilot-1.0.0` |
| `rulesVersion` | `rules-1.0.0` |
| `rules.secondInkTurns` | `1` |

`secondInkTurns: 1` is the second player's first-turn Ink. Their maximum Ink that turn is 2, not 1, and Spare Ink can take them to 3. Replay calls `replay(setup, actions)` with that same setup, so the flag is part of every replay.

`node engine/parity.mjs` replays the eight golden fixtures and checks purity plus redaction. CI runs it from `duel/` and fails on any mismatch.

## Adapter

```ts
interface EngineAdapter {
  initialState(decks, seed): EngineState
  legalActions(state, player): GameAction[]
  apply(state, action): EngineState
  view(state, player): PlayerView
  pilot(state, stance): GameAction
  replay(setup, actions): EngineState
}
```

`apply` returns a new state. `view` is built from the engine's `clientView` and `clientLog`. The pilot is `makeSmart({ stance, slip: 300, salt: 99 })` and does not receive the match seed.

Actions are the engine's: `mulligan`, `play`, `champion`, `legend`, `fight`, `attack`, `move`, `end`.

`src/engine/stub.ts` remains a tiny fixture (`npm test` still deals one stub hand). It is not on the match path.

## Server

`POST /api/matches` starts a practice match. The process draws a uint32 seed and ignores any seed in the body.

`GET /api/matches/:id` returns player 0's redacted view, their legal actions, the public version pins, and the turn clock. `?player=1` is rejected. The payload does not include the seed, either deck order, the pilot's hand, or the identity of a face-down Marginalia the viewer does not own.

`POST /api/matches/:id/actions` applies one player action. When the turn passes, the pilot's turn is paced across about 5 seconds. On expiry the server submits `end`, or a keep during mulligan.

`POST /api/matches/:id/preview` resolves an attack on a copy of the state. A margin note shows as a strike, not as a card name.

`POST /api/matches/:id/replay-verify` replays `setup` through the engine and derives pilot actions again from the pinned AI version. The response is `{ ok, actionCount, mismatches, engineVersion, cardsVersion, aiVersion, rulesVersion, secondInkTurns }` and does not include the seed or the decks.

Matches sit in `MemoryMatchRepository` behind `MatchRepository`. The hosted test stores that same record in a Durable Object.

## Private hosted test

`npm run build:worker` writes one ESM module and the static client:

| Path | What |
|---|---|
| `duel/deploy/index.js` | Worker bundle. Exports `DuelMatch` and the fetch handler. |
| `duel/deploy/client/` | Vite build. The Worker serves it on the same origin. |

Config is `duel/wrangler.duel.toml` (worker name `bard-duel`). There is no second `wrangler.toml` at the repo root. `deploy/` is build output and is not committed.

Bindings a Cloudflare API deploy needs:

| Binding | Kind | Name |
|---|---|---|
| Durable Object | class `DuelMatch`, binding `DUEL_MATCH` | migration tag `v1`, `new_sqlite_classes: ["DuelMatch"]` |
| Secret | `PASSCODE` | `wrangler secret put PASSCODE`. Never put the value in the repo or in `[vars]`. |
| Assets | `ASSETS` | directory `deploy/client`, `run_worker_first = true` |
| Vars | `DUEL_TURN_TIMEOUT_MS`, `DUEL_AI_TURN_MS` | `"35000"` and `"5000"` |

`compatibility_date` is `2026-10-15`. One Durable Object per match (`getByName(matchId)`) stores the match record, the pilot plan, and the next alarm. The client still receives only the redacted view. `?player=1` is rejected. Replay-verify returns the same report as Express, without the seed.

The Worker answers `GET /robots.txt` with `Disallow: /` and sets `X-Robots-Tag: noindex, nofollow, noarchive` on every response. Other routes require a passcode. `POST /api/unlock` with the secret sets an HttpOnly `bard_duel_session` cookie for 30 days (`Max-Age=2592000`). Local `wrangler dev` is http, so the cookie is `Secure` only on https.

```bash
cd duel
npm run build:worker
# .dev.vars is gitignored. It supplies PASSCODE for wrangler dev only.
npx wrangler dev --config wrangler.duel.toml --port 8788 --ip 127.0.0.1
```

`wrangler dev` is the local check. An API deploy uses the bindings above, on the worker named `bard-duel`, and leaves the site worker alone.

## Client

PixiJS, phone-first, and the same board on a wide window: two Pages, up to four slots a side (two on The Torn Margin), both Legends and a power button, the Verse track to 8, the hand, and an Ink counter. Drag a card onto a Page to play it. Drag one of your units onto an enemy to see the trade, then release to attack. Marginalia are face-down margin notes. A hold or a conquer pulses the Verse track.

Placeholder art is drawn from the card glyph. Styling lives in `src/client/tokens.ts`.
