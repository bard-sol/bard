# Card Duel engine (server-side, Node 20, ES modules, no dependencies)

| File | Role |
|---|---|
| `engine.mjs` | Pure rules engine: `newMatch`, `legalActions`, `apply`, `applyMut`, `replay`, `stateHash`, `clientView`, `clientLog`, `validateDeck`. Spec: `../rules-spec.md`. |
| `cards-src.mjs` | Card, Legend, Page and starter data (source). `node build-cards.mjs` writes `../cards-proto.json`, and `node build-cards-md.mjs` writes `../cards-proto.md`. |
| `pilots.mjs` | `makeSmart({stance, slip, trapAware})` is the sim smart pilot, and AI pilot v1 when used with stance and `slip:300`. `makeNaive(seed)`. `determinize` strips hidden info. |
| `play.mjs` | `playMatch(setup, [pilotA, pilotB], {verify})`. It runs a match and can replay-verify it. |
| `sim.mjs`, `gates.mjs`, `analyze.mjs` | Parallel gate sims (worker_threads) and the analysis. |
| `search.mjs`, `search-check.mjs` | Deck-search gate. |
| `make-fixtures.mjs`, `fixtures/golden-v1.json`, `parity.mjs` | Golden replays and the parity, purity and leak check. `node parity.mjs` exits 1 on any mismatch, so run it in CI. |

**Server use**
```
s = newMatch(setup)
loop:
  a = clientAction (validate with legalActions) or pilot(s, 1)
  s = apply(s, a)
  send clientView(s, 0) and clientLog(s, 0) to the client
```
For production, use `AI pilot v1 = makeSmart({ stance: owner.stance, slip: 300, salt: 99 })`, and pin `aiVersion` with the engine version in each match record.

**No Python mirror.** The engine is the one implementation. Parity is cross-process replay against the golden fixtures plus a replay of every sim game: 0 mismatches in 39,000. A second implementation would only be worth it if the builder's server isn't Node.

**TypeScript.** The engine is plain JS with integer-only arithmetic. The builder can add a `.d.ts` or port it 1:1. The fixtures are the contract.
