# Card Duel engine v1.3 (`duel-engine-1.3.0`, `pilot-1.3.0`; server-side, Node 20, ES modules, no dependencies)

Golden fixtures for v1.3: **`fixtures/golden-v1.3.json`**. Spec: `../rules-spec-v1.3.md`. Cards: `../cards-proto-v1.3.json`.

| File | Role |
|---|---|
| `engine.mjs` | Pure rules engine: `newMatch`, `legalActions`, `apply`, `applyMut`, `replay`, `stateHash`, `clientView`, `clientLog`, `validateDeck`. Spec: `../rules-spec-v1.3.md`. `newMatch` defaults `aiVersion` to `CURRENT_PILOT_VERSION` (`pilot-1.3.0`). |
| `cards-src.mjs` | Card, Legend, Page and starter data (source). `node build-cards.mjs` writes `../cards-proto-v1.3.json`, and `node build-cards-md.mjs` writes `../cards-proto-v1.3.md`. |
| `pilots.mjs` | `makeSmart({stance, slip, trapAware})` is the sim smart pilot, and AI pilot v1 when used with stance and `slip: AI_SLIP` (250 since v1.2). `makeNaive(seed)`. `determinize` strips hidden info. The evaluator is integer-only: weights are scaled x10 (`EVAL_SCALE`) and the rival-hold multiplier is 13/10 with `Math.trunc` at that one step. |
| `play.mjs` | `playMatch(setup, [pilotA, pilotB], {verify})`. It runs a match and can replay-verify it. |
| `sim.mjs`, `gates.mjs`, `analyze.mjs` | Parallel gate sims (worker_threads) and the analysis. |
| `search.mjs`, `search-check.mjs` | Deck-search gate. |
| `make-fixtures.mjs`, `fixtures/golden-v1.3.json`, `parity.mjs` | Golden replays and the parity, purity and leak check. `node parity.mjs` exits 1 on any mismatch, so run it in CI. |

**Server use**
```
s = newMatch(setup)
loop:
  a = clientAction (validate with legalActions) or pilot(s, 1)
  s = apply(s, a)
  send clientView(s, 0) and clientLog(s, 0) to the client
```
For production, use `AI pilot v1 = makeSmart({ stance: owner.stance, slip: AI_SLIP, salt: 99 })` (`AI_SLIP = 250` in `pilots.mjs`), and pin `aiVersion` with the engine version in each match record.

**No Python mirror.** The engine is the one implementation. Parity is cross-process replay against the golden fixtures plus a replay of every sim game: see `../gates-report-v1.3.md` for the v1.2 count. A second implementation would only be worth it if the builder's server isn't Node.

**TypeScript.** The engine is plain JS with integer-only arithmetic in both the engine and the pilot. The builder can add a `.d.ts` or port it 1:1. The fixtures are the contract.
