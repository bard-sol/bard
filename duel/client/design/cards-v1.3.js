// Generated from /workspace/gameplay/duel/cards-proto-v1.3.json by tools/gen_cards.py. Do not hand-edit.
window.D13={
"version": "cards-proto-1.3",
"pages": [
{
"id": "lanternfall",
"name": "Lanternfall",
"text": "At the end of each turn, every unit here restores 1 health."
},
{
"id": "port_foxing",
"name": "Port Foxing",
"text": "A unit that moves here gets +1 attack."
},
{
"id": "fort_crease",
"name": "Fort Crease",
"text": "Characters played here get +1/+0."
},
{
"id": "moot_rings",
"name": "The Moot-Rings",
"text": "Opening Lines don't happen here."
},
{
"id": "torn_margin",
"name": "The Torn Margin",
"text": "Only 2 units per side here."
},
{
"id": "spine",
"name": "The Spine",
"text": "Conquering this Page scores 1 extra Verse."
}
],
"legends": {
"candle": {
"id": "old_wick",
"name": "Old Wick",
"house": "candle",
"cost": 2,
"target": "ally",
"power": [
{
"op": "heal",
"n": 3,
"to": "target"
}
],
"text": "Restore 3 health to an ally.",
"champion": "champ_old_wick"
},
"fold": {
"id": "ash_ember",
"name": "Ash & Ember",
"house": "fold",
"cost": 2,
"target": "ally",
"power": [
{
"op": "tempAtk",
"a": 1,
"to": "target"
},
{
"op": "tempRiposte",
"to": "target"
}
],
"text": "An ally gets +1 attack this turn and Riposte until your next turn.",
"champion": "champ_ash_ember"
},
"tidewrack": {
"id": "juniper",
"name": "Juniper",
"house": "tidewrack",
"cost": 2,
"target": "ally_then_enemy_other",
"power": [
{
"op": "move",
"to": "target",
"free": true
},
{
"op": "dmg",
"n": 1,
"to": "target2"
}
],
"text": "Move an ally to the other Page; it deals 1 to an enemy there.",
"champion": "champ_juniper"
}
},
"cards": {
"c_novice": {
"rarity": "common",
"kw": [
"kindle"
],
"abilities": [],
"target": null,
"id": "c_novice",
"name": "Lanternfall Novice",
"house": "candle",
"type": "character",
"cost": 1,
"atk": 1,
"hp": 2,
"kindle": 1,
"text": "Kindle 1.",
"story": "units-v1 #15",
"art": "../art/c_novice.png",
"artSource": "reused",
"mini": "Novice",
"todoName": false
},
"c_taper": {
"rarity": "common",
"kw": [
"ward",
"bound"
],
"abilities": [],
"target": null,
"id": "c_taper",
"name": "Taper Warden",
"house": "candle",
"type": "character",
"cost": 3,
"atk": 2,
"hp": 3,
"text": "Ward. Bound.",
"story": "TODO-STORY",
"art": "../art/c_taper.png",
"artSource": "new",
"mini": "Taper Warden",
"todoName": true
},
"c_wren": {
"rarity": "common",
"kw": [
"kindle",
"opening_line"
],
"abilities": [
{
"t": "play",
"fx": [
{
"op": "grant",
"kw": "ward",
"to": "target"
}
]
}
],
"target": "ally_here",
"id": "c_wren",
"name": "Sister Wren",
"house": "candle",
"type": "character",
"cost": 3,
"atk": 3,
"hp": 3,
"kindle": 1,
"text": "Kindle 1. Opening Line: give an ally here Ward.",
"story": "units-v1 #14",
"art": "../art/c_wren.png",
"artSource": "reused",
"mini": "Sister Wren",
"todoName": false
},
"c_trimmer": {
"rarity": "common",
"kw": [
"ward",
"last_word"
],
"abilities": [
{
"t": "death",
"fx": [
{
"op": "grant",
"kw": "ward",
"to": "random_ally"
}
]
}
],
"target": null,
"id": "c_trimmer",
"name": "Wick-Trimmer",
"house": "candle",
"type": "character",
"cost": 3,
"atk": 3,
"hp": 3,
"text": "Ward. Last Word: give a random ally Ward.",
"story": "TODO-STORY",
"art": "../art/c_trimmer.png",
"artSource": "new",
"mini": "Wick-Trimmer",
"todoName": true
},
"c_vigil": {
"rarity": "common",
"kw": [
"bound",
"kindle"
],
"abilities": [],
"target": null,
"id": "c_vigil",
"name": "Vigil Keeper",
"house": "candle",
"type": "character",
"cost": 4,
"atk": 3,
"hp": 4,
"kindle": 1,
"text": "Bound. Kindle 1.",
"story": "TODO-STORY",
"art": "../art/c_vigil.png",
"artSource": "new",
"mini": "Vigil Keeper",
"todoName": true
},
"c_lamplighter": {
"rarity": "common",
"kw": [
"ward",
"kindle"
],
"abilities": [],
"target": null,
"id": "c_lamplighter",
"name": "Lamplighter of the Stacks",
"house": "candle",
"type": "character",
"cost": 5,
"atk": 4,
"hp": 5,
"kindle": 1,
"text": "Ward. Kindle 1.",
"story": "TODO-STORY",
"art": "../art/c_lamplighter.png",
"artSource": "new",
"mini": "Lamplighter",
"todoName": true
},
"c_lamps": {
"rarity": "common",
"kw": [],
"abilities": [
{
"t": "cast",
"fx": [
{
"op": "grant",
"kw": "ward",
"to": "allies_page"
},
{
"op": "buff",
"a": 1,
"h": 0,
"to": "allies_page"
}
]
}
],
"target": "page",
"id": "c_lamps",
"name": "Light the Lamps",
"house": "candle",
"type": "inkwork",
"cost": 3,
"text": "Your units on a Page get Ward and +1 attack.",
"story": "TODO-STORY",
"art": "../art/c_lamps.png",
"artSource": "new",
"mini": "Light the Lamps",
"todoName": true
},
"c_mend": {
"rarity": "common",
"kw": [],
"abilities": [
{
"t": "cast",
"fx": [
{
"op": "heal",
"n": 3,
"to": "target"
},
{
"op": "buff",
"a": 1,
"h": 0,
"to": "target"
}
]
}
],
"target": "ally",
"id": "c_mend",
"name": "Mending Flame",
"house": "candle",
"type": "inkwork",
"cost": 1,
"text": "Restore 3 health to an ally and give it +1 attack.",
"story": "TODO-STORY",
"art": "../art/c_mend.png",
"artSource": "new",
"mini": "Mending Flame",
"todoName": true
},
"c_snuff": {
"rarity": "common",
"kw": [],
"abilities": [
{
"t": "cast",
"fx": [
{
"op": "dmg",
"n": 3,
"to": "target"
},
{
"op": "heal",
"n": 2,
"to": "allies_target_page"
}
]
}
],
"target": "enemy",
"id": "c_snuff",
"name": "Snuff the Wick",
"house": "candle",
"type": "inkwork",
"cost": 3,
"text": "Deal 3 to an enemy. Restore 2 health to your units there.",
"story": "TODO-STORY",
"art": "../art/c_snuff.png",
"artSource": "new",
"mini": "Snuff the Wick",
"todoName": true
},
"c_watch": {
"rarity": "common",
"kw": [],
"abilities": [],
"target": null,
"id": "c_watch",
"name": "Lantern Watch",
"house": "candle",
"type": "marginalia",
"cost": 1,
"trap": {
"on": "enemy_attack",
"fx": [
{
"op": "grant",
"kw": "ward",
"to": "defender"
},
{
"op": "dmg",
"n": 1,
"to": "trigger"
}
]
},
"text": "When an enemy attacks here: the defender gets Ward; deal 1 to attacker.",
"story": "TODO-STORY",
"art": "../art/c_watch.png",
"artSource": "new",
"mini": "Lantern Watch",
"todoName": true
},
"f_squire": {
"rarity": "common",
"kw": [
"riposte"
],
"abilities": [],
"target": null,
"id": "f_squire",
"name": "Paper Squire",
"house": "fold",
"type": "character",
"cost": 1,
"atk": 1,
"hp": 2,
"text": "Riposte.",
"story": "TODO-STORY",
"art": "../art/f_squire.png",
"artSource": "new",
"mini": "Paper Squire",
"todoName": true
},
"f_hinge": {
"rarity": "common",
"kw": [
"riposte"
],
"abilities": [],
"target": null,
"id": "f_hinge",
"name": "Hinge Duellist",
"house": "fold",
"type": "character",
"cost": 2,
"atk": 2,
"hp": 2,
"text": "Riposte.",
"story": "units-v1 #24",
"art": "../art/f_hinge.png",
"artSource": "reused",
"mini": "Hinge Duellist",
"todoName": false
},
"f_corvin": {
"rarity": "common",
"kw": [
"swift",
"opening_line"
],
"abilities": [
{
"t": "play",
"fx": [
{
"op": "dmg",
"n": 1,
"to": "target"
}
]
}
],
"target": "enemy_here",
"id": "f_corvin",
"name": "Corvin",
"house": "fold",
"type": "character",
"cost": 2,
"atk": 2,
"hp": 1,
"text": "Swift. Opening Line: deal 1 to an enemy here.",
"story": "units-v1 #23",
"art": "../art/f_corvin.png",
"artSource": "reused",
"mini": "Corvin",
"todoName": false
},
"f_adept": {
"rarity": "common",
"kw": [
"cleave",
"riposte"
],
"abilities": [],
"target": null,
"id": "f_adept",
"name": "Twin-Blade Adept",
"house": "fold",
"type": "character",
"cost": 3,
"atk": 3,
"hp": 3,
"text": "Cleave. Riposte.",
"story": "TODO-STORY",
"art": "../art/f_adept.png",
"artSource": "new",
"mini": "Twin-Blade",
"todoName": true
},
"f_sentinel": {
"rarity": "common",
"kw": [
"riposte"
],
"abilities": [
{
"t": "hurt",
"fx": [
{
"op": "buff",
"a": 1,
"h": 0,
"to": "self"
}
]
}
],
"target": null,
"id": "f_sentinel",
"name": "Crease Sentinel",
"house": "fold",
"type": "character",
"cost": 4,
"atk": 3,
"hp": 5,
"text": "Riposte. After it survives damage, +1 attack.",
"story": "TODO-STORY",
"art": "../art/f_sentinel.png",
"artSource": "new",
"mini": "Sentinel",
"todoName": true
},
"f_master": {
"rarity": "common",
"kw": [
"cleave",
"riposte"
],
"abilities": [],
"target": null,
"id": "f_master",
"name": "Fold Duelmaster",
"house": "fold",
"type": "character",
"cost": 5,
"atk": 5,
"hp": 5,
"text": "Cleave. Riposte.",
"story": "TODO-STORY",
"art": "../art/f_master.png",
"artSource": "new",
"mini": "Duelmaster",
"todoName": true
},
"f_feint": {
"rarity": "common",
"kw": [],
"abilities": [
{
"t": "cast",
"fx": [
{
"op": "buff",
"a": 2,
"h": 1,
"to": "target"
},
{
"op": "grant",
"kw": "riposte",
"to": "target"
}
]
}
],
"target": "ally",
"id": "f_feint",
"name": "Feint",
"house": "fold",
"type": "inkwork",
"cost": 2,
"text": "Give an ally +2/+1 and Riposte.",
"story": "TODO-STORY",
"art": "../art/f_feint.png",
"artSource": "new",
"mini": "Feint",
"todoName": true
},
"f_whirl": {
"rarity": "common",
"kw": [],
"abilities": [
{
"t": "cast",
"fx": [
{
"op": "dmg",
"n": 1,
"nMoved": 3,
"to": "enemies_page"
}
]
}
],
"target": "page",
"id": "f_whirl",
"name": "Whirling Cut",
"house": "fold",
"type": "inkwork",
"cost": 2,
"text": "Deal 1 to every enemy on a Page, 3 to any that moved last turn.",
"story": "TODO-STORY",
"art": "../art/f_whirl.png",
"artSource": "new",
"mini": "Whirling Cut",
"todoName": true
},
"f_counter": {
"rarity": "common",
"kw": [],
"abilities": [],
"target": null,
"id": "f_counter",
"name": "Counter-Stance",
"house": "fold",
"type": "marginalia",
"cost": 2,
"trap": {
"on": "enemy_attack",
"fx": [
{
"op": "dmg",
"n": 3,
"to": "trigger"
}
]
},
"text": "When an enemy attacks here, deal 3 to it first.",
"story": "TODO-STORY",
"art": "../art/f_counter.png",
"artSource": "new",
"mini": "Counter-Stance",
"todoName": true
},
"f_closed": {
"rarity": "common",
"kw": [],
"abilities": [],
"target": null,
"id": "f_closed",
"name": "Closed Hinge",
"house": "fold",
"type": "marginalia",
"cost": 1,
"trap": {
"on": "enemy_move",
"fx": [
{
"op": "dmg",
"n": 4,
"to": "trigger"
},
{
"op": "exhaust",
"to": "trigger"
}
]
},
"text": "When an enemy moves here, deal 4 to it and exhaust it.",
"story": "TODO-STORY",
"art": "../art/f_closed.png",
"artSource": "new",
"mini": "Closed Hinge",
"todoName": true
},
"t_deckhand": {
"rarity": "common",
"kw": [
"board",
"opening_line"
],
"abilities": [
{
"t": "play",
"fx": [
{
"op": "unward",
"hit": 1,
"to": "target"
}
]
}
],
"target": "enemy_here",
"id": "t_deckhand",
"name": "Running-Sea Deckhand",
"house": "tidewrack",
"type": "character",
"cost": 1,
"atk": 1,
"hp": 2,
"text": "Board. Opening Line: an enemy here loses Ward. If it did, deal 1 to it.",
"story": "units-v1 #12",
"art": "../art/t_deckhand.png",
"artSource": "reused",
"mini": "Deckhand",
"todoName": false
},
"t_runner": {
"rarity": "common",
"kw": [
"board",
"swift",
"opening_line"
],
"abilities": [
{
"t": "play",
"fx": [
{
"op": "unward",
"to": "target"
}
]
}
],
"target": "enemy_here",
"id": "t_runner",
"name": "Tide Runner",
"house": "tidewrack",
"type": "character",
"cost": 2,
"atk": 2,
"hp": 2,
"text": "Board. Swift. Opening Line: an enemy here loses Ward.",
"story": "TODO-STORY",
"art": "../art/t_runner.png",
"artSource": "new",
"mini": "Tide Runner",
"todoName": true
},
"t_cutpurse": {
"rarity": "common",
"kw": [
"board",
"hidden",
"opening_line"
],
"abilities": [
{
"t": "play",
"fx": [
{
"op": "unward",
"to": "target"
}
]
}
],
"target": "enemy_here",
"id": "t_cutpurse",
"name": "Harbour Cutpurse",
"house": "tidewrack",
"type": "character",
"cost": 2,
"atk": 2,
"hp": 2,
"text": "Board. Hidden. Opening Line: an enemy here loses Ward.",
"story": "TODO-STORY",
"art": "../art/t_cutpurse.png",
"artSource": "new",
"mini": "Cutpurse",
"todoName": true
},
"t_pip": {
"rarity": "common",
"kw": [
"board"
],
"abilities": [
{
"t": "move",
"fx": [
{
"op": "dmg",
"n": 2,
"pierce": true,
"to": "random_enemy_here"
}
]
}
],
"target": null,
"id": "t_pip",
"name": "Pip Fennick",
"house": "tidewrack",
"type": "character",
"cost": 3,
"atk": 3,
"hp": 2,
"text": "Board. When it moves, deal 2 to a random enemy there, ignoring Ward.",
"story": "units-v1 #10",
"art": "../art/t_pip.png",
"artSource": "reused",
"mini": "Pip Fennick",
"todoName": false
},
"t_smuggler": {
"rarity": "common",
"kw": [
"board",
"opening_line"
],
"abilities": [
{
"t": "play",
"fx": [
{
"op": "verse",
"n": 2,
"cond": "no_enemies_here"
}
]
}
],
"target": null,
"id": "t_smuggler",
"name": "Lighthouse Smuggler",
"house": "tidewrack",
"type": "character",
"cost": 3,
"atk": 2,
"hp": 3,
"text": "Board. Opening Line: if no enemies are here, +2 Verses.",
"story": "TODO-STORY",
"art": "../art/t_smuggler.png",
"artSource": "new",
"mini": "Smuggler",
"todoName": true
},
"t_raider": {
"rarity": "common",
"kw": [
"board"
],
"abilities": [
{
"t": "move",
"fx": [
{
"op": "buff",
"a": 1,
"h": 1,
"to": "self"
}
]
}
],
"target": null,
"id": "t_raider",
"name": "Wreck Raider",
"house": "tidewrack",
"type": "character",
"cost": 4,
"atk": 4,
"hp": 4,
"text": "Board. After it moves, +1/+1.",
"story": "TODO-STORY",
"art": "../art/t_raider.png",
"artSource": "new",
"mini": "Wreck Raider",
"todoName": true
},
"t_captain": {
"rarity": "common",
"kw": [
"board",
"opening_line"
],
"abilities": [
{
"t": "play",
"fx": [
{
"op": "buff",
"a": 1,
"h": 1,
"to": "other_allies"
}
]
}
],
"target": null,
"id": "t_captain",
"name": "Gull Captain",
"house": "tidewrack",
"type": "character",
"cost": 5,
"atk": 4,
"hp": 5,
"text": "Board. Opening Line: your other units get +1/+1.",
"story": "TODO-STORY",
"art": "../art/t_captain.png",
"artSource": "new",
"mini": "Gull Captain",
"todoName": true
},
"t_undertow": {
"rarity": "common",
"kw": [],
"abilities": [
{
"t": "cast",
"fx": [
{
"op": "unward",
"to": "target"
},
{
"op": "move",
"to": "target"
}
]
}
],
"target": "enemy",
"id": "t_undertow",
"name": "Undertow",
"house": "tidewrack",
"type": "inkwork",
"cost": 2,
"text": "Move an enemy to the other Page. It loses Ward.",
"story": "TODO-STORY",
"art": "../art/t_undertow.png",
"artSource": "new",
"mini": "Undertow",
"todoName": true
},
"t_saltwind": {
"rarity": "common",
"kw": [],
"abilities": [
{
"t": "cast",
"fx": [
{
"op": "move",
"to": "target",
"free": true
},
{
"op": "buff",
"a": 2,
"h": 1,
"to": "target"
},
{
"op": "ready",
"to": "target"
}
]
}
],
"target": "ally",
"id": "t_saltwind",
"name": "Salt Wind",
"house": "tidewrack",
"type": "inkwork",
"cost": 2,
"text": "Move an ally to the other Page, give it +2/+1 and ready it.",
"story": "TODO-STORY",
"art": "../art/t_saltwind.png",
"artSource": "new",
"mini": "Salt Wind",
"todoName": true
},
"t_riptide": {
"rarity": "common",
"kw": [],
"abilities": [],
"target": null,
"id": "t_riptide",
"name": "Riptide",
"house": "tidewrack",
"type": "marginalia",
"cost": 1,
"trap": {
"on": "enemy_attack",
"fx": [
{
"op": "dmg",
"n": 2,
"to": "trigger"
},
{
"op": "move",
"to": "trigger"
}
]
},
"text": "When an enemy attacks here, deal 2 to it and move it away.",
"story": "TODO-STORY",
"art": "../art/t_riptide.png",
"artSource": "new",
"mini": "Riptide",
"todoName": true
},
"n_blotling": {
"rarity": "common",
"kw": [
"last_word"
],
"abilities": [
{
"t": "death",
"fx": [
{
"op": "dmg",
"n": 1,
"to": "random_enemy_here"
}
]
}
],
"target": null,
"id": "n_blotling",
"name": "The Blotling",
"house": "neutral",
"type": "character",
"cost": 1,
"atk": 1,
"hp": 1,
"text": "Last Word: deal 1 to a random enemy here.",
"story": "units-v1 #29",
"art": "../art/n_blotling.png",
"artSource": "reused",
"mini": "Blotling",
"todoName": false
},
"n_reader": {
"rarity": "common",
"kw": [
"opening_line"
],
"abilities": [
{
"t": "play",
"fx": [
{
"op": "draw",
"n": 1
}
]
}
],
"target": null,
"id": "n_reader",
"name": "The Watching Reader",
"house": "neutral",
"type": "character",
"cost": 2,
"atk": 1,
"hp": 3,
"text": "Opening Line: draw a card.",
"story": "units-v1 #32",
"art": "../art/n_reader.png",
"artSource": "reused",
"mini": "Watching Reader",
"todoName": false
},
"n_weeping": {
"rarity": "common",
"kw": [
"bound"
],
"abilities": [],
"target": null,
"id": "n_weeping",
"name": "The Weeping Margin",
"house": "neutral",
"type": "character",
"cost": 2,
"atk": 1,
"hp": 3,
"text": "Bound.",
"story": "units-v1 #30",
"art": "../art/n_weeping.png",
"artSource": "reused",
"mini": "Weeping Margin",
"todoName": false
},
"n_doodle": {
"rarity": "common",
"kw": [],
"abilities": [],
"target": null,
"id": "n_doodle",
"name": "Deckle Doodle",
"house": "neutral",
"type": "character",
"cost": 2,
"atk": 3,
"hp": 2,
"text": "Too many legs, all hungry. (No ability.)",
"story": "units-v1 #31",
"art": "../art/n_doodle.png",
"artSource": "reused",
"mini": "Deckle Doodle",
"todoName": false
},
"n_wolf": {
"rarity": "common",
"kw": [
"swift"
],
"abilities": [],
"target": null,
"id": "n_wolf",
"name": "The Margin Wolf",
"house": "neutral",
"type": "character",
"cost": 3,
"atk": 3,
"hp": 3,
"text": "Swift.",
"story": "units-v1 #26",
"art": "../art/n_wolf.png",
"artSource": "reused",
"mini": "Margin Wolf",
"todoName": false
},
"n_hob": {
"rarity": "common",
"kw": [
"opening_line"
],
"abilities": [
{
"t": "play",
"fx": [
{
"op": "heal",
"n": 2,
"to": "target"
}
]
}
],
"target": "ally",
"id": "n_hob",
"name": "Hob the Bookbinder",
"house": "neutral",
"type": "character",
"cost": 3,
"atk": 2,
"hp": 3,
"text": "Opening Line: restore 2 health to an ally.",
"story": "units-v1 #25",
"art": "../art/n_hob.png",
"artSource": "reused",
"mini": "Hob",
"todoName": false
},
"n_errata": {
"rarity": "common",
"kw": [
"opening_line",
"silence"
],
"abilities": [
{
"t": "play",
"fx": [
{
"op": "silence",
"to": "target"
}
]
}
],
"target": "enemy_here",
"id": "n_errata",
"name": "Sir Errata",
"house": "neutral",
"type": "character",
"cost": 4,
"atk": 3,
"hp": 4,
"text": "Opening Line: Silence an enemy here.",
"story": "units-v1 #27",
"art": "../art/n_errata.png",
"artSource": "reused",
"mini": "Sir Errata",
"todoName": false
},
"n_colophon": {
"rarity": "legendary",
"kw": [
"opening_line"
],
"abilities": [
{
"t": "play",
"fx": [
{
"op": "dmg",
"n": 2,
"to": "all_other_here"
}
]
}
],
"target": null,
"id": "n_colophon",
"name": "The Colophon",
"house": "neutral",
"type": "character",
"cost": 6,
"atk": 4,
"hp": 4,
"text": "Opening Line: deal 2 to every other unit here.",
"story": "units-v1 #28",
"art": "../art/n_colophon.png",
"artSource": "reused",
"mini": "The Colophon",
"todoName": false
},
"n_erasure": {
"rarity": "common",
"kw": [
"silence"
],
"abilities": [
{
"t": "cast",
"fx": [
{
"op": "silence",
"to": "target"
},
{
"op": "dmg",
"n": 1,
"to": "target"
}
]
}
],
"target": "enemy",
"id": "n_erasure",
"name": "Erasure",
"house": "neutral",
"type": "inkwork",
"cost": 2,
"text": "Silence an enemy and deal 1 to it.",
"story": "TODO-STORY",
"art": "../art/n_erasure.png",
"artSource": "new",
"mini": "Erasure",
"todoName": true
},
"n_snare": {
"rarity": "common",
"kw": [],
"abilities": [],
"target": null,
"id": "n_snare",
"name": "Inkblot Snare",
"house": "neutral",
"type": "marginalia",
"cost": 2,
"trap": {
"on": "enemy_attack",
"fx": [
{
"op": "dmg",
"n": 2,
"to": "trigger"
}
]
},
"text": "When an enemy attacks here, deal 2 to it first.",
"story": "TODO-STORY",
"art": "../art/n_snare.png",
"artSource": "new",
"mini": "Inkblot Snare",
"todoName": true
},
"champ_old_wick": {
"rarity": "legendary",
"kw": [
"ward",
"kindle",
"opening_line"
],
"abilities": [
{
"t": "play",
"fx": [
{
"op": "grant",
"kw": "ward",
"to": "other_allies_here"
}
]
}
],
"target": null,
"id": "champ_old_wick",
"name": "Old Wick, Last Reader",
"house": "candle",
"type": "character",
"champion": true,
"cost": 5,
"atk": 4,
"hp": 6,
"kindle": 2,
"text": "Ward. Kindle 2. Opening Line: other allies here get Ward.",
"story": "units-v1 #13",
"art": "../art/champ_old_wick.png",
"artSource": "reused",
"mini": "Old Wick",
"todoName": false
},
"champ_ash_ember": {
"rarity": "legendary",
"kw": [
"riposte",
"cleave",
"swift"
],
"abilities": [],
"target": null,
"id": "champ_ash_ember",
"name": "Ash & Ember, Twin Edge",
"house": "fold",
"type": "character",
"champion": true,
"cost": 4,
"atk": 3,
"hp": 5,
"text": "Swift. Cleave. Riposte.",
"story": "units-v1 #22",
"art": "../art/champ_ash_ember.png",
"artSource": "reused",
"mini": "Ash & Ember",
"todoName": false
},
"champ_juniper": {
"rarity": "legendary",
"kw": [
"board",
"hidden",
"opening_line"
],
"abilities": [
{
"t": "play",
"fx": [
{
"op": "move",
"to": "target"
}
]
}
],
"target": "enemy_here",
"id": "champ_juniper",
"name": "Juniper, Keybearer",
"house": "tidewrack",
"type": "character",
"champion": true,
"cost": 4,
"atk": 3,
"hp": 4,
"text": "Board. Hidden. Opening Line: move an enemy here to the other Page.",
"story": "units-v1 #11",
"art": "../art/champ_juniper.png",
"artSource": "reused",
"mini": "Juniper",
"todoName": false
},
"spare_ink": {
"rarity": "common",
"kw": [],
"abilities": [
{
"t": "cast",
"fx": [
{
"op": "ink",
"n": 1
}
]
}
],
"target": null,
"id": "spare_ink",
"name": "Spare Ink",
"house": "neutral",
"type": "inkwork",
"token": true,
"cost": 0,
"text": "Gain 1 Ink this turn.",
"story": "n/a (rules token)",
"art": "../art/spare_ink.png",
"artSource": "new",
"mini": "Spare Ink",
"todoName": true
}
}
};
