# Card Duel engine v1.1

Live pin for new matches. Engine v1 stays in `../v1/` so a stored v1 replay still runs on that code.

| File | Role |
|---|---|
| `engine.mjs` | `duel-engine-1.1.0`. A Conquer scores 2 Verses. Cards are imported from `../active.mjs`. |
| `cards-src.mjs` | Card, Legend, Page and starter data, plus `CARDS_VERSION`. |
| `cards-proto.json` | The same cards as JSON (`cards-proto-1.1`). |
| `pilots.mjs` | `pilot-1.1.0`. Balanced, aggressive and patient share one `evaluate`. |
| `rules-spec.md` | `rules-1.1.0`. |
| `fixtures/golden-v1.1.json` | The eight v1 golden games, replayed here. A Conquer scores 2, so a game can end once someone reaches 8 Verses. |

Fort Crease is still +0/+1 when a character is played there, and The Spine still scores 2 Verses on a hold. Those are the v1 page rules. The attached `duel-engine-v1.1.tgz` (revised page text and Gameplay's own golden file) was not in this workspace.

A later data-only card-number pass adds a new cards file and changes the cards export in `engine/active.mjs`. This engine file stays put.
