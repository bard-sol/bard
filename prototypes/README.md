# Bard prototypes

Two playable games. Neither one talks to a wallet, a token, or a chain. Renown is a win counter stored in this browser. The duel’s stake is Ink, match points for that game only.

```bash
cd prototypes
npm install
npm run dev
npm run build
```

`npm run dev` serves the hub at `/`. `npm run build` typechecks and writes a static site to `dist/` with root-relative asset paths, so the built `index.html` is the site root. `POST /api/metrics` exists only while the dev server is running. On a static host the request fails quietly and the game keeps the same events in `localStorage`.

## The line

Three rounds. You get 3, then 5, then 7 coins. Coins do not carry, and they never buy attack or health. The shop shows five units. The first two are copies of un-merged units already on your line, when you have any. A unit costs its tier. Three copies merge to level 2. Sell a unit for 1 coin.

The fight is the v2 resolver: `resolve(lineA, lineB, seed, units)`. It is a pure function. The page plays that log. Every trigger names its source. Attack and health update as the log says. Ward, Silence, and attack-down show as icons. Ward breaks and fizzled summons are their own lines. The second mover’s Front unit wears a **Braced** badge for the +1 health.

Best of three. The whole bought line returns each round at fresh stats. `?carry=survivors` stays off. A drawn round scores for neither side. If the match is level after round 3, surviving health wins, then the Book’s seed. A match never ends drawn.

The opponent is a stored run. Round 3 only uses runs that stored all three rounds.

Speed, Pause, and Skip are the fight controls. Hover a card for the ability (desktop). Tap ? for the sheet (phone). Click pins the popover. Layout switches at 600px and 1200px: phone, tablet drawers, and a real desktop with opponent, board, and log.

### Flags

| Flag | Default | Switch |
|---|---|---|
| Carry | `line` — the whole bought line returns | Hub, or `?carry=survivors` |
| Bench (the Margin) | `0` | Hub, or `?bench=3` |
| House bar | `off` — the matte track is always drawn; the live ink flow is the mock | Hub, or `?housebar=mock` |
| Lane rules (duel) | always on | three locations from the match seed |

The tutorial is a practice match. Real matches charge 1 coin to reroll. The soft shop timer is 60 seconds a round.

## The duel

Margin Duel v2. Three lanes, four cards a side (two at the Torn Margin), a deck of 12, six turns. Energy equals the turn number. You win two lanes, or the higher total power, or the Book’s seed. No draws.

Every card has an ability. Three locations are drawn each match and revealed on turns 1, 2, and 3. An unrevealed lane has no rule.

**Ink is match points.** Raise doubles the stake from 1 to 2 to 4 to 8. It does not change Renown, and a loss does not spend Renown. Renown still goes up by 1 when you win a real line match.

The opponent is a saved deck. With no human recording, the ghost plays its most expensive affordable cards into the lane it is losing by the least. Cautious, Steady, and Bold decide whether it retreats. A recorded `plays` list uses the same `duel()` function.

## Art

Unit art stays the v2 cutouts in `public/art/v2/units/`. The frame, type, and icons are the v3 kit (Inter and Newsreader). The live House bar, when the mock flag is on, is `public/vendor/house-bar.js`.

## Metrics

Events sit in `localStorage` (`bard.proto.metrics.v1`). While `npm run dev` is running they also POST to `/api/metrics`. A static server without that route does not affect play. The hub button downloads a JSON summary: matches per day, first real match completed, a replay within 5 minutes of a loss, median session length, the preference question, who went first, and duel raises, retreats, and bluffs.

## Determinism

```bash
npm test
```

Vitest, then the gate:

- `node engine/ref/v2/check_golden_v2.mjs` — 52 golden fights, zero mismatches
- `engine/ref/v2/fuzz_parity_v2.sh 20000` — 20,000 fights, Python against the JS resolver, zero mismatches
- `node engine/ref/v2/check_duel_parity.mjs 500` — duel replay logs against `duel_v2.py`, zero mismatches

`resolve` and `duel` take the lines (or the recorded plays) and the seed. Nothing else.
