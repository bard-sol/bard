# Bard Card Duel: match rules spec (prototype v1.1)

15 Oct 2026 (GST). Source: *Card Duel Design Brief (Riftbound × Hearthstone)* (`/workspace/user-attach-oct15b.txt`). Engine: `engine-v1.1/engine.mjs`, `duel-engine-1.1.0`, pilot `pilot-1.1.0`. Cards: `cards-proto-v1.1.json`. v1 (`rules-spec.md`, `engine/`) is unchanged and frozen.

**Changes from v1:**
1. Conquer scores **2** Verses, not 1 (§2.6).
2. The Spine: +1 Verse on a conquer there, not double holds (§10).
3. Fort Crease gives +1/+0, not +0/+1 (§10).
4. Two new effect modifiers: `unward` / `pierce`, and `nMoved` (§11).
5. The user's decisions are now rules: the second player's turn-1 Ink, Riposte lasting until your next turn, the Legend power anywhere in the play step, and the champion on your own turn only (§15).
6. Golden fixtures are `engine-v1.1/fixtures/golden-v1.1.json`. This file is the contract. If the engine and this file disagree, it's a bug, and the golden fixtures (`engine/fixtures/golden-v1.json`) settle it.

## 0. Hard rules
- **A match is a pure function** `match(deckA, deckB, seed, actions[], aiVersion)`. The scoring-match attacker is always player 0 (`A`). The defender's saved deck is player 1 (`B`), played by AI pilot v1. The full server log replays bit-for-bit (§13).
- **Integers only.** No floats anywhere in the engine, and there are no ×2 or halving effects in the prototype set. **Arrays only**: the engine never iterates object keys, maps or sets. Every "random" choice draws from one seeded RNG in a fixed order (§12).
- **Server-authoritative.** The client never holds the seed, the RNG state, either deck's order, the pilot's hand or the identity of a face-down Marginalia (§14).
- **Money never buys power.** Every card, Legend and Page is free to every player from day one.

## 1. Setup
1. **Decks.** Each deck has 20 cards from its House plus the neutrals, with at most 2 copies of a card and 1 of a Legendary (`validateDeck`). The Legend and its champion card come with the House and don't count toward the 20. In scoring matches you play your pledged House.
2. **Seeds.** `derive(seed,k) = Mulberry32(seed + imul(k, 0x9E3779B9))`, first output. Streams: deck A shuffle `k=1`, deck B shuffle `k=2`, Page draw `k=3`, first player `k=4`, the in-match RNG `k=5`, and the final tie-break `k=999`.
3. **First player** = `derive(seed,4) & 1`.
4. **Pages.** Fisher–Yates shuffle the 6 Pages in their fixed order (§10) with `derive(seed,3)` and take the first two. Index 0 is the left Page, index 1 the right.
5. **Decks are shuffled** with Fisher–Yates (`j = next() % (i+1)`, from the top index down). Card instance ids (`uid`) are integers handed out in shuffled order. The client only ever sees uids of cards that are its own or public.
6. **Opening hands.** The first player draws 4. The second player draws 5 and also gets a **Spare Ink** (0 cost, Inkwork: +1 Ink this turn).
7. **Second-player compensation (decided by the user, 15 Oct).** The second player gets Spare Ink, and their first turn also starts at **2 maximum Ink**. It's set in the setup (`rules.secondInkTurns = 1`) and stored with each replay.
8. **Mulligan, once each.** The first player chooses, then the second. A player picks any subset of their hand (Spare Ink can't be returned). The picked cards go to the bottom of their deck in hand order, then they draw that many from the top. No RNG is used.

## 2. Turn structure (the active player is P)
1. **Gain Ink.** `turns += 1`. `maxInk = min(7, turns)`, plus 1 on the second player's first turn (§1.7). `ink = maxInk`. P's units become ready (not exhausted, not attacked, not moved). Any Riposte-until-next-turn on P's units ends. P's Legend power becomes available again.
2. **Score holds.** For Page 0 then Page 1: if P has at least one unit there and the rival has none, P gains +1 Verse (`rules.holdMode = 'alone'`). The win check runs after each gain. The "+1 for more attack, +2 alone" variant (`holdMode: 'attack'`) is implemented as a setup flag but isn't used (see the v1.1 gates report).
3. **Draw** one card. If the deck is empty, nothing happens (there's no fatigue). If the hand is already at 10, the drawn card is burned, with a log event.
   After the draw, the engine records `enemiesAtStart[page]`: whether the rival has any unit on each Page. Conquer uses it.
4. **Main step (play).** P can, in any order and as often as Ink allows:
   - **Play a card from hand:**
     - A **Character** goes onto a chosen Page, up to 4 of P's units per Page (2 on The Torn Margin). It **enters exhausted** unless it has Swift.
     - An **Inkwork** resolves and goes to the discard.
     - A **Marginalia** is set face-down on a chosen Page, at most one of P's per Page.
   - **Play the champion card** from the side zone, once per match, under the same rules as a Character. "At any time" in the brief is read as *any time in your own main step*: there's no instant-speed play in the prototype.
   - **Use the Legend power**: 2 Ink, once per turn. It's allowed anywhere in the main step, not only after plays, so Legend timing is a skill choice. That's a small reading of the brief's step order and needs confirming.
5. **Fight step.** The first attack or move, or an explicit `fight` action, closes the main step: no more plays, Legend or champion this turn. Then each ready unit can either:
   - **Attack** one enemy on its own Page (§4); or
   - **Move** to the other Page once per turn (§5). A normal move exhausts the unit, so it can't also attack. A unit with **Board** moves without exhausting and can still attack after the move. A unit that has attacked can't move.
6. **End (`end` action).** These run in order:
   1. **Conquer:** for Page 0 then 1, if `enemiesAtStart[page]` was true, the rival now has no units there, and P has at least one, P gains **+2 Verses** (`rules.conquerVerses = 2`), or +3 on The Spine. Units killed in the main step by Inkwork or Opening Lines count, because the snapshot is taken after the draw.
   2. **Kindle** (§7).
   3. **Lanternfall** heals every unit on it by 1, P's side first.
   4. Temporary attack ends.
   5. If both players have taken 7 turns, the match ends (§8). Otherwise the rival starts their turn.

## 3. Keywords (8 shared, plus the 3 House signatures in the prototype)
| Keyword | Exact rule |
|---|---|
| **Bound** | When P declares an attack on a Page where the rival has at least one targetable Bound unit, the target must be a Bound unit. It doesn't restrict Inkwork or abilities. |
| **Ward** | The next damage instance of 1 or more is reduced to 0, and then Ward is spent. A 0-damage event doesn't spend it. Ward can be granted again. |
| **Swift** | Enters ready, so it can attack or move the turn it's played. |
| **Hidden** | Can't be chosen as an attack target, as a targeted ability or Inkwork target, or by a "random enemy" pick, until it declares its first attack. Area effects ("every enemy on a Page", Colophon) still hit it. Hidden ends the moment it declares an attack, before traps fire. |
| **Opening Line** | Resolves when the card is played from hand or the side zone, after it enters the Page and after Fort Crease. Targets are chosen in the play action. If there's no legal target, the card can still be played and the effect does nothing. It doesn't happen on The Moot-Rings. |
| **Last Word** | Resolves when the unit dies, in death order (§6), using the Page it died on. |
| **Silence** | The unit loses all keywords, abilities, Ward, Kindle, Hidden and temporary Riposte. Its current attack and health stay. A Silenced unit can't gain keywords afterwards. |
| **Cleave** | When this unit **attacks**, it also deals its attack to the units in the slots directly beside the defender (slot−1 and slot+1). Slots are positions in the rival's array for that Page, in play order. Cleave doesn't apply on retaliation. |
| **Kindle N** (Candle) | At the end of its owner's turn it heals N to the most-damaged allied unit on its Page, which can be itself. Ties go to the earliest slot. Does nothing if no ally is damaged. Order: Page 0 then 1, slot order. |
| **Riposte** (Fold) | When this unit is attacked, it deals its damage to the attacker **first**. If the attacker dies, the attacker deals no damage. Otherwise the attacker then deals its damage. Riposte works on the rival's turn, because that's when units get attacked. |
| **Board** (Tidewrack) | Moving doesn't exhaust this unit, and it can still attack after moving. It's still limited to one move per turn. |

## 4. Combat (an `attack` action)
1. **Legality.** The attacker is P's ready unit that hasn't attacked this turn. The target is a targetable rival unit on the same Page, and Bound applies.
2. **Declaration.** The attacker is marked attacked and exhausted, and loses Hidden.
3. **Trap window A (`enemy_attack`).** If the rival has a face-down Marginalia on this Page with the `enemy_attack` trigger, it is **revealed** (a `trap_reveal` event with the card id, visible to both players), resolves and goes to the discard. "trigger" is the attacker and "defender" is the declared target. Deaths then settle (§6).
4. If the attacker or defender is no longer on the board, or they're no longer on the same Page (for example after Riptide), the attack **fizzles**. The attacker stays exhausted.
5. **Damage.**
   - If the defender has Riposte (and isn't Silenced): the defender deals its damage to the attacker first. If the attacker survives, the attacker then deals its damage to the defender.
   - Otherwise both deal damage at once: attacker → defender, then defender → attacker, with no settling in between.
   - If the attacker has Cleave and survived to strike, it then hits the defender's neighbours.
6. **Settle** (§6).

## 5. Moving
- **A move action:** a ready unit that hasn't moved or attacked this turn goes to the other Page if P has space there. It's added to the end of the slot array.
- **Effect moves** come from Undertow, Salt Wind, Juniper's power, Juniper's champion and Riptide. They don't exhaust, don't use the once-per-turn move, and fail with a logged `move_blocked` event if the destination is full.
- **After any move, in order:**
  1. Port Foxing gives +1 attack, permanently.
  2. The unit's own `move` abilities resolve (Pip, Wreck Raider).
  3. **Trap window B (`enemy_move`):** the rival's face-down Marginalia on the destination with that trigger fires.
  4. Settle.

## 6. Damage, death and trigger order
- **Damage** is an integer of 1 or more. Ward is checked first (§3). Health can go to 0 or below. A unit that takes damage and survives goes on the *hurt queue*.
- **Settle loop** (runs after every action step that dealt damage):
  1. `hurt` abilities fire for units on the hurt queue that are still alive, in queue order (Crease Sentinel).
  2. All units at 0 health or less are collected in **death order**: Page 0 then Page 1; within a Page the active player's side first, then the rival's; then slot order.
  3. They are all removed.
  4. Their Last Words fire in that order. New damage goes back to step 1.
  The loop stops when nothing new happened. It's bounded at 32 passes.
- **Effect order:** an ability's effects resolve left to right. A multi-target effect resolves in the selector's array order (Page slot order; for "all other units here", the active side first). Random selectors pick `uniform(0..n-1)` from the in-match RNG over the candidates in array order.
- **Trigger cap:** 64 resolutions per action (every ability, trap and Legend power counts), and a nesting depth of 8. On the first breach a **visible `trigger_cap` event** is logged and further triggers in that action are skipped. The 40-card set can't reach the cap. The gates log `capHit`, and it was 0 in every gate game. No result depends on the cap.

## 7. House signatures in the prototype
- **Candle, Kindle N:** see §3. The House also leans on Ward from Lantern Watch, Light the Lamps and Sister Wren.
- **Fold, Riposte:** see §3. Ash & Ember's power gives Riposte *until the start of your next turn*, because Riposte "this turn" would never trigger (it needs the unit to be attacked). Needs confirming.
- **Tidewrack, Board:** see §3.
The other five Houses' signatures (Grit, Study, Remember, Muster, Hunt) are out of scope for the prototype.

## 8. Winning
1. **8 Verses ends the match immediately**, at whatever moment the 8th Verse is gained. That can be a hold, a conquer or an ability. Any remaining effects of that action are skipped.
2. **After both players' 7th turn**, most Verses wins. If tied, most total current health of units on the board wins. If still tied: `derive(seed,999) & 1` names the winner (0 = A).
3. With v1.1 scoring, about 60% of smart-vs-smart matches end by reaching 8 Verses and about 9% on board health. The exact numbers are in `gates-report-v1.1.md`.

## 9. Marginalia (traps)
- **Setting:** costs Ink and goes face-down onto one Page. The rival sees only that P has a face-down note on that Page. Max one per side per Page.
- **Firing:** **only on the rival's turn** (the engine enforces it), in the windows above:
  - `enemy_attack`: declare → Hidden ends → trap → damage.
  - `enemy_move`: arrival → own move ability → trap.
  Each trap fires once and is then discarded. One trap per event per side.
- **Reveal:** an event `{e:'trap_reveal', id, owner, page}` goes to both players before the trap's effect. Design shows it as the margin note flipping.
- **Playing around traps:** a face-down note tells you its Page but not its trigger. The rival's House narrows it: Fold has 2 attack traps and 1 move trap, Candle 1 attack trap, Tidewrack 1 attack trap, and neutrals 1 attack trap.

## 10. Pages (6; 2 per match)
In fixed order: Lanternfall, Port Foxing, Fort Crease, The Moot-Rings, The Torn Margin, The Spine. The rules are in `cards-proto.md`. **v1.1 Page rules:**
- **Fort Crease:** Characters played here get **+1/+0**. It applies on play only, never on a move.
- **The Spine:** conquering this Page scores 1 extra Verse, so 3 instead of 2. Holds there score normally.
- The other four Pages are unchanged.

## 11. Ability selectors (the `to` field in cards-proto.json)
- `self`
- `target` / `target2` (chosen in the action)
- `trigger` (the attacker or mover that set off a trap)
- `defender`
- `allies_page`, `enemies_page` (the chosen Page)
- `other_allies_here`
- `all_other_here`
- `other_allies` (both Pages)
- `allies_target_page` (allies on the Page of the target)
- `random_enemy_here` (excludes Hidden)
- `random_ally` (both Pages, excludes self)

v1.1 modifiers:
- `dmg.pierce`: removes Ward first, then deals the damage (Pip).
- `dmg.nMoved`: a unit that made a move action on its owner's last turn takes that amount instead (Whirling Cut). The flag is reset when its owner's next turn starts.
- `unward`: removes Ward (Deckhand, Tide Runner, Undertow).

Ops: `dmg`, `heal` (capped at max health), `unward`, `buff` (+attack/+health, permanent), `tempAtk`, `tempRiposte`, `grant`, `silence`, `move`, `ready`, `exhaust`, `draw`, `ink`, `verse` (optional condition `no_enemies_here`).

## 12. RNG
Mulberry32, uint32 state, written in `engine.mjs` (`m32`): `t = state + 0x6D2B79F5; t = imul(t ^ t>>>15, t|1); t ^= t + imul(t ^ t>>>7, t|61); out = (t ^ t>>>14)>>>0`. `rnd(n) = out % n`; the bias is under 1e-8 for n ≤ 4 and accepted. The in-match RNG is used only by random selectors (Pip, Blotling, Wick-Trimmer). The draw order is fixed by event order, so the same actions give the same draws.

## 13. Action API (the server runs it; it's the same for humans and the pilot)
- `newMatch({houseA, deckA, houseB, deckB, seed, aiVersion, rules})` → state.
- `legalActions(state)` → an array of actions. Identical cards in hand appear once (the first uid stands for them).
- `apply(state, action)` → a **new** state; the input isn't mutated (checked in parity). `applyMut` is the in-place version for sims. An illegal action throws, and the server rejects it.
- **Action shapes:**
  - `{type:'mulligan', idx:[...]}`
  - `{type:'play', uid, page?, target?}`
  - `{type:'champion', page, target?}`
  - `{type:'legend', target, target2?}`
  - `{type:'fight'}`
  - `{type:'attack', uid, target}`
  - `{type:'move', uid}`
  - `{type:'end'}`
- `replay(setup, actions)` → final state. `stateHash` is FNV-1a over the canonical JSON. A match record stores `setup` (decks, houses, seed, aiVersion, rules), the action list, `stateHash` and `logHash`.
- **Turn timer, 35 s (server-side):** on expiry the server applies `end`.

## 14. Server authority and hidden information
- The client gets `clientView(state, p)`: board, Pages, Verses, Ink, its own hand, rival hand **count**, deck **counts**, whether the rival's champion is still available, and rival traps as `{owner, page, faceDown}`. It never receives the seed, the RNG state, either deck's order or the rival's hand.
- It also gets `clientLog(state, p)`: rival draws lose their uid, a rival Marginalia play shows only its Page until revealed, and rival mulligan picks show only a count.
- The seed is published with the full log only **after the match ends**, for audit.
- The AI pilot is held to the same information as the client (`pilots.mjs: determinize`). It sees an empty rival hand and deck, rival traps only as Page positions, and its own deck reshuffled with its own seed. That seed comes from a hash of public state, never from the match seed. A pilot can't read the real RNG, and its lookahead can't trigger the real rival traps.

## 15. Rule readings (decided by the user, 15 Oct)
1. The second player starts turn 1 on 2 maximum Ink, plus Spare Ink (§1.7).
2. The Legend power can be used anywhere in the play step.
3. The champion card can be played only on your own turn.
4. Ash & Ember's Riposte lasts until the start of your next turn.
5. The match is 7 turns each. A 3–4 minute length is accepted for now; the human test will set it.

## 16. AI pilot stances (v1.1)
Every stance uses the **same** evaluation (Balanced weights), so no stance is a weaker player. The stance only breaks near-ties between actions scored within 2 points of the best:
- **Aggressive:** plays first, then prefers attacks over moves, and sets traps last.
- **Patient:** prefers setting traps, then plays and the Legend, then moves, and attacks last.
- **Balanced:** takes the top score.

The handicap, a 30% deterministic slip to the second-best action, is unchanged.
