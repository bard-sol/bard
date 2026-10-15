# Bard prototypes

Two phone-sized games. Neither one talks to a wallet, a token, or a chain. Renown is a win counter stored in this browser.

```bash
cd prototypes
npm install
npm run dev
```

Open the hub, then **The line** (Prototype A) or **The duel** (Prototype B). `npm run build` writes a static site to `dist/`.

## The line

Three rounds. You get 3, then 5, then 7 coins. Coins do not carry. The shop shows five units. The first two are copies of un-merged units already on your line, when you have any. A unit costs its tier. Three copies merge to level 2 (a star). A fourth copy shakes off. Sell by dragging a unit onto the Bard for 1 coin.

Fight is watch-only. The reference resolver in `engine/ref/resolver.mjs` decides the fight. The page plays that log back. Speed and Skip are the only controls. Skip still plays deaths.

Best of three. A 2–0 does not play round 3. A drawn round scores for neither side. If the match is level after round 3, the higher surviving health wins. If that is tied too, the Book's seed picks a winner. A match never ends drawn.

The opponent is a stored run with a saved line for every round. Round 3 only uses runs that stored all three rounds.

### Flags

| Flag | Default | Switch |
|---|---|---|
| Carry | `line` — the whole bought line returns at fresh stats | Hub, or `?carry=survivors` |
| Bench (the Margin) | `0` — balance numbers assume no bench | Hub, or `?bench=3` |
| House bar | `off` — a fake war is not shown | Hub, or `?housebar=mock` |
| Lane rules (duel) | off | not enabled in this build |

Survivors-only carry is in the client and off until that call is made. Summoned and stitched units never carry in either mode.

The tutorial is a practice match against the Blot, with one free reroll. Real matches always charge 1 coin to reroll. The fight in that practice is a real `resolve()` call (seed 1, a merged Deckhand and a Blotling against two Copyists skinned as blots) so the win, and a death on each side, come from the resolver.

## The duel

Margin Duel. Three lanes, four cards a side, a deck of 12, six turns. Energy equals the turn number. You win two lanes, or the higher total power, or the Book's seed. No draws.

**Ink is match points.** Raise doubles the stake from 1 to 2 to 4 to 8. The result shows the Ink won or lost. It does not change Renown, and a loss does not spend Renown. Renown still goes up by 1 when you win a real line match.

The opponent is a saved deck. Day one has no human recordings, so the ghosts are generated stand-ins: a real starter deck, a Cautious / Steady / Bold profile, scripted Raise turns, and a greedy policy (most expensive card it can afford, into the lane it is losing by the least). The policy runs from the hand the ghost actually holds, so it never sees your face-down cards. A future recording can pass a `plays` list and a `shuffleSeed` into the same `duel()` function.

Retreat loses the stake from before this turn's Raise. Bold ghosts do not retreat. Lane rules stay off.

After the first duel, open Deck and swap cards one for one. All 32 are free.

## Swap the unit sheet

Fight stats, names, and abilities come from `engine/units-s0.json` (`version` is `s0-units-v1`). Replace that file with a sheet of the same shape and the resolver, the shop, and the art lookup follow it. Keep `version` honest. The duel uses the same ids and names; its cost and power live in `src/b/cards.ts`.

Art is in `public/art/`. Tier is the shape, level 2 is the second ring (`m2`). Level-3 files are unused. House sets the fill. A long-press opens the only text-heavy sheet: name, flavour, trigger, merge.

## Metrics

Events sit in `localStorage` (`bard.proto.metrics.v1`) and, while `npm run dev` is running, also append to `prototypes/.metrics/events.jsonl` via `POST /api/metrics`. The hub button downloads a JSON summary:

- matches per day
- first real match completed
- another match started within 5 minutes of a loss or fold
- median session length, in matches (a 10-minute gap starts a new session)
- the one-question preference
- who went first in each round of a line match, and whether the first side won that round
- duel raises, retreats (after their raise, after yours, unprompted), bluff success, and bluff caught

Practice and the tutorial are not real matches.

## Determinism

```bash
npm test
```

That runs the vitest suite, then the gate:

- `node engine/ref/check_golden.mjs` — 32 golden fights, zero mismatches
- `engine/ref/fuzz_parity.sh` — 3000 fights, Python `resolver.py` against `resolver.mjs`, zero mismatches

The client imports that same `resolver.mjs`. The vitest fold walks the log and checks the end health, so playback is reading the log rather than inventing a second result. `duel()` is pure: same deck, same ghost, same seed, same log.
