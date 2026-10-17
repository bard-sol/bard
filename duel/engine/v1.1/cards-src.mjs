// Source of truth for cards-proto.json. Edit numbers here, run `node build-cards.mjs`.
// fx ops: dmg heal buff grant move draw silence verse ink summon. `to` selectors are defined in rules-spec §9.
const C = (o) => ({ rarity: 'common', kw: [], abilities: [], target: null, ...o });
export const PAGES = [
  { id: 'lanternfall', name: 'Lanternfall', text: 'At the end of each turn, every unit here restores 1 health.' },
  { id: 'port_foxing', name: 'Port Foxing', text: 'A unit that moves here gets +1 attack.' },
  { id: 'fort_crease', name: 'Fort Crease', text: 'Characters played here get +1/+0.' },
  { id: 'moot_rings', name: 'The Moot-Rings', text: 'Opening Lines don\'t happen here.' },
  { id: 'torn_margin', name: 'The Torn Margin', text: 'Only 2 units per side here.' },
  { id: 'spine', name: 'The Spine', text: 'Conquering this Page scores 1 extra Verse.' },
];
export const LEGENDS = {
  candle: { id: 'old_wick', name: 'Old Wick', house: 'candle', cost: 2, target: 'ally', power: [{ op: 'heal', n: 3, to: 'target' }], text: 'Restore 3 health to an ally.', champion: 'champ_old_wick' },
  fold: { id: 'ash_ember', name: 'Ash & Ember', house: 'fold', cost: 2, target: 'ally', power: [{ op: 'tempAtk', a: 1, to: 'target' }, { op: 'tempRiposte', to: 'target' }], text: 'An ally gets +1 attack this turn and Riposte until your next turn.', champion: 'champ_ash_ember' },
  tidewrack: { id: 'juniper', name: 'Juniper', house: 'tidewrack', cost: 2, target: 'ally_then_enemy_other', power: [{ op: 'move', to: 'target', free: true }, { op: 'dmg', n: 1, to: 'target2' }], text: 'Move an ally to the other Page; it deals 1 to an enemy there.', champion: 'champ_juniper' },
};
export const CARDS = [
  // ---------------- CANDLE ----------------
  C({ id: 'c_novice', name: 'Lanternfall Novice', house: 'candle', type: 'character', cost: 1, atk: 1, hp: 2, kindle: 1, kw: ['kindle'], text: 'Kindle 1.', story: 'units-v1 #15' }),
  C({ id: 'c_taper', name: 'Taper Warden', house: 'candle', type: 'character', cost: 2, atk: 2, hp: 2, kw: ['ward', 'bound'], text: 'Ward. Bound.', story: 'TODO-STORY' }),
  C({ id: 'c_wren', name: 'Sister Wren', house: 'candle', type: 'character', cost: 3, atk: 3, hp: 3, kindle: 1, kw: ['kindle', 'opening_line'], target: 'ally_here', abilities: [{ t: 'play', fx: [{ op: 'grant', kw: 'ward', to: 'target' }] }], text: 'Kindle 1. Opening Line: give an ally here Ward.', story: 'units-v1 #14' }),
  C({ id: 'c_trimmer', name: 'Wick-Trimmer', house: 'candle', type: 'character', cost: 3, atk: 3, hp: 3, kw: ['ward', 'last_word'], abilities: [{ t: 'death', fx: [{ op: 'heal', n: 2, to: 'random_ally' }] }], text: 'Ward. Last Word: restore 2 health to a random ally.', story: 'TODO-STORY' }),
  C({ id: 'c_vigil', name: 'Vigil Keeper', house: 'candle', type: 'character', cost: 4, atk: 3, hp: 4, kindle: 1, kw: ['bound', 'kindle'], text: 'Bound. Kindle 1.', story: 'TODO-STORY' }),
  C({ id: 'c_lamplighter', name: 'Lamplighter of the Stacks', house: 'candle', type: 'character', cost: 5, atk: 4, hp: 5, kindle: 1, kw: ['ward', 'kindle'], text: 'Ward. Kindle 1.', story: 'TODO-STORY' }),
  C({ id: 'c_lamps', name: 'Light the Lamps', house: 'candle', type: 'inkwork', cost: 3, target: 'page', abilities: [{ t: 'cast', fx: [{ op: 'grant', kw: 'ward', to: 'allies_page' }, { op: 'buff', a: 1, h: 0, to: 'allies_page' }] }], text: 'Your units on a Page get Ward and +1 attack.', story: 'TODO-STORY' }),
  C({ id: 'c_mend', name: 'Mending Flame', house: 'candle', type: 'inkwork', cost: 2, target: 'ally', abilities: [{ t: 'cast', fx: [{ op: 'heal', n: 3, to: 'target' }, { op: 'buff', a: 1, h: 0, to: 'target' }] }], text: 'Restore 3 health to an ally and give it +1 attack.', story: 'TODO-STORY' }),
  C({ id: 'c_snuff', name: 'Snuff the Wick', house: 'candle', type: 'inkwork', cost: 3, target: 'enemy', abilities: [{ t: 'cast', fx: [{ op: 'dmg', n: 3, to: 'target' }, { op: 'heal', n: 2, to: 'allies_target_page' }] }], text: 'Deal 3 to an enemy. Restore 2 health to your units there.', story: 'TODO-STORY' }),
  C({ id: 'c_watch', name: 'Lantern Watch', house: 'candle', type: 'marginalia', cost: 1, trap: { on: 'enemy_attack', fx: [{ op: 'grant', kw: 'ward', to: 'defender' }, { op: 'dmg', n: 1, to: 'trigger' }] }, text: 'When an enemy attacks here: the defender gets Ward; deal 1 to attacker.', story: 'TODO-STORY' }),
  // ---------------- FOLD ----------------
  C({ id: 'f_squire', name: 'Paper Squire', house: 'fold', type: 'character', cost: 1, atk: 1, hp: 2, kw: ['riposte'], text: 'Riposte.', story: 'TODO-STORY' }),
  C({ id: 'f_hinge', name: 'Hinge Duellist', house: 'fold', type: 'character', cost: 2, atk: 2, hp: 2, kw: ['riposte'], text: 'Riposte.', story: 'units-v1 #24' }),
  C({ id: 'f_corvin', name: 'Corvin', house: 'fold', type: 'character', cost: 2, atk: 2, hp: 1, kw: ['swift', 'opening_line'], target: 'enemy_here', abilities: [{ t: 'play', fx: [{ op: 'dmg', n: 1, to: 'target' }] }], text: 'Swift. Opening Line: deal 1 to an enemy here.', story: 'units-v1 #23' }),
  C({ id: 'f_adept', name: 'Twin-Blade Adept', house: 'fold', type: 'character', cost: 3, atk: 3, hp: 3, kw: ['cleave', 'riposte'], text: 'Cleave. Riposte.', story: 'TODO-STORY' }),
  C({ id: 'f_sentinel', name: 'Crease Sentinel', house: 'fold', type: 'character', cost: 4, atk: 3, hp: 5, kw: ['riposte'], abilities: [{ t: 'hurt', fx: [{ op: 'buff', a: 1, h: 0, to: 'self' }] }], text: 'Riposte. After it survives damage, +1 attack.', story: 'TODO-STORY' }),
  C({ id: 'f_master', name: 'Fold Duelmaster', house: 'fold', type: 'character', cost: 5, atk: 5, hp: 5, kw: ['cleave', 'riposte'], text: 'Cleave. Riposte.', story: 'TODO-STORY' }),
  C({ id: 'f_feint', name: 'Feint', house: 'fold', type: 'inkwork', cost: 1, target: 'ally', abilities: [{ t: 'cast', fx: [{ op: 'buff', a: 2, h: 1, to: 'target' }, { op: 'grant', kw: 'riposte', to: 'target' }] }], text: 'Give an ally +2/+1 and Riposte.', story: 'TODO-STORY' }),
  C({ id: 'f_whirl', name: 'Whirling Cut', house: 'fold', type: 'inkwork', cost: 2, target: 'page', abilities: [{ t: 'cast', fx: [{ op: 'dmg', n: 1, nMoved: 3, to: 'enemies_page' }] }], text: 'Deal 1 to every enemy on a Page, 3 to any that moved last turn.', story: 'TODO-STORY' }),
  C({ id: 'f_counter', name: 'Counter-Stance', house: 'fold', type: 'marginalia', cost: 2, trap: { on: 'enemy_attack', fx: [{ op: 'dmg', n: 3, to: 'trigger' }] }, text: 'When an enemy attacks here, deal 3 to it first.', story: 'TODO-STORY' }),
  C({ id: 'f_closed', name: 'Closed Hinge', house: 'fold', type: 'marginalia', cost: 1, trap: { on: 'enemy_move', fx: [{ op: 'dmg', n: 3, to: 'trigger' }, { op: 'exhaust', to: 'trigger' }] }, text: 'When an enemy moves here, deal 3 to it and exhaust it.', story: 'TODO-STORY' }),
  // ---------------- TIDEWRACK ----------------
  C({ id: 't_deckhand', name: 'Running-Sea Deckhand', house: 'tidewrack', type: 'character', cost: 1, atk: 1, hp: 2, kw: ['board', 'opening_line'], target: 'enemy_here', abilities: [{ t: 'play', fx: [{ op: 'unward', to: 'target' }] }], text: 'Board. Opening Line: an enemy here loses Ward.', story: 'units-v1 #12' }),
  C({ id: 't_runner', name: 'Tide Runner', house: 'tidewrack', type: 'character', cost: 2, atk: 2, hp: 2, kw: ['board', 'swift', 'opening_line'], target: 'enemy_here', abilities: [{ t: 'play', fx: [{ op: 'unward', to: 'target' }] }], text: 'Board. Swift. Opening Line: an enemy here loses Ward.', story: 'TODO-STORY' }),
  C({ id: 't_cutpurse', name: 'Harbour Cutpurse', house: 'tidewrack', type: 'character', cost: 2, atk: 2, hp: 2, kw: ['board', 'hidden'], text: 'Board. Hidden.', story: 'TODO-STORY' }),
  C({ id: 't_pip', name: 'Pip Fennick', house: 'tidewrack', type: 'character', cost: 3, atk: 3, hp: 2, kw: ['board'], abilities: [{ t: 'move', fx: [{ op: 'dmg', n: 2, pierce: true, to: 'random_enemy_here' }] }], text: 'Board. When it moves, deal 2 to a random enemy there, ignoring Ward.', story: 'units-v1 #10' }),
  C({ id: 't_smuggler', name: 'Lighthouse Smuggler', house: 'tidewrack', type: 'character', cost: 2, atk: 2, hp: 2, kw: ['board', 'opening_line'], abilities: [{ t: 'play', fx: [{ op: 'verse', n: 2, cond: 'no_enemies_here' }] }], text: 'Board. Opening Line: if no enemies are here, +2 Verses.', story: 'TODO-STORY' }),
  C({ id: 't_raider', name: 'Wreck Raider', house: 'tidewrack', type: 'character', cost: 4, atk: 4, hp: 4, kw: ['board'], abilities: [{ t: 'move', fx: [{ op: 'buff', a: 1, h: 1, to: 'self' }] }], text: 'Board. After it moves, +1/+1.', story: 'TODO-STORY' }),
  C({ id: 't_captain', name: 'Gull Captain', house: 'tidewrack', type: 'character', cost: 5, atk: 4, hp: 5, kw: ['board', 'opening_line'], abilities: [{ t: 'play', fx: [{ op: 'buff', a: 1, h: 1, to: 'other_allies' }] }], text: 'Board. Opening Line: your other units get +1/+1.', story: 'TODO-STORY' }),
  C({ id: 't_undertow', name: 'Undertow', house: 'tidewrack', type: 'inkwork', cost: 2, target: 'enemy', abilities: [{ t: 'cast', fx: [{ op: 'unward', to: 'target' }, { op: 'move', to: 'target' }] }], text: 'Move an enemy to the other Page. It loses Ward.', story: 'TODO-STORY' }),
  C({ id: 't_saltwind', name: 'Salt Wind', house: 'tidewrack', type: 'inkwork', cost: 2, target: 'ally', abilities: [{ t: 'cast', fx: [{ op: 'move', to: 'target', free: true }, { op: 'buff', a: 2, h: 1, to: 'target' }, { op: 'ready', to: 'target' }] }], text: 'Move an ally to the other Page, give it +2/+1 and ready it.', story: 'TODO-STORY' }),
  C({ id: 't_riptide', name: 'Riptide', house: 'tidewrack', type: 'marginalia', cost: 1, trap: { on: 'enemy_attack', fx: [{ op: 'dmg', n: 2, to: 'trigger' }, { op: 'move', to: 'trigger' }] }, text: 'When an enemy attacks here, deal 2 to it and move it away.', story: 'TODO-STORY' }),
  // ---------------- NEUTRAL ----------------
  C({ id: 'n_blotling', name: 'The Blotling', house: 'neutral', type: 'character', cost: 1, atk: 1, hp: 1, kw: ['last_word'], abilities: [{ t: 'death', fx: [{ op: 'dmg', n: 1, to: 'random_enemy_here' }] }], text: 'Last Word: deal 1 to a random enemy here.', story: 'units-v1 #29' }),
  C({ id: 'n_reader', name: 'The Watching Reader', house: 'neutral', type: 'character', cost: 2, atk: 1, hp: 3, kw: ['opening_line'], abilities: [{ t: 'play', fx: [{ op: 'draw', n: 1 }] }], text: 'Opening Line: draw a card.', story: 'units-v1 #32' }),
  C({ id: 'n_weeping', name: 'The Weeping Margin', house: 'neutral', type: 'character', cost: 2, atk: 1, hp: 3, kw: ['bound'], text: 'Bound.', story: 'units-v1 #30' }),
  C({ id: 'n_doodle', name: 'Deckle Doodle', house: 'neutral', type: 'character', cost: 2, atk: 3, hp: 2, kw: [], text: 'Too many legs, all hungry. (No ability.)', story: 'units-v1 #31' }),
  C({ id: 'n_wolf', name: 'The Margin Wolf', house: 'neutral', type: 'character', cost: 3, atk: 3, hp: 2, kw: ['swift'], text: 'Swift.', story: 'units-v1 #26' }),
  C({ id: 'n_hob', name: 'Hob the Bookbinder', house: 'neutral', type: 'character', cost: 3, atk: 2, hp: 3, kw: ['opening_line'], target: 'ally', abilities: [{ t: 'play', fx: [{ op: 'heal', n: 2, to: 'target' }] }], text: 'Opening Line: restore 2 health to an ally.', story: 'units-v1 #25' }),
  C({ id: 'n_errata', name: 'Sir Errata', house: 'neutral', type: 'character', cost: 4, atk: 3, hp: 4, kw: ['opening_line', 'silence'], target: 'enemy_here', abilities: [{ t: 'play', fx: [{ op: 'silence', to: 'target' }] }], text: 'Opening Line: Silence an enemy here.', story: 'units-v1 #27' }),
  C({ id: 'n_colophon', name: 'The Colophon', house: 'neutral', type: 'character', cost: 6, atk: 4, hp: 4, rarity: 'legendary', kw: ['opening_line'], abilities: [{ t: 'play', fx: [{ op: 'dmg', n: 2, to: 'all_other_here' }] }], text: 'Opening Line: deal 2 to every other unit here.', story: 'units-v1 #28' }),
  C({ id: 'n_erasure', name: 'Erasure', house: 'neutral', type: 'inkwork', cost: 2, target: 'enemy', kw: ['silence'], abilities: [{ t: 'cast', fx: [{ op: 'silence', to: 'target' }, { op: 'dmg', n: 1, to: 'target' }] }], text: 'Silence an enemy and deal 1 to it.', story: 'TODO-STORY' }),
  C({ id: 'n_snare', name: 'Inkblot Snare', house: 'neutral', type: 'marginalia', cost: 2, trap: { on: 'enemy_attack', fx: [{ op: 'dmg', n: 2, to: 'trigger' }] }, text: 'When an enemy attacks here, deal 2 to it first.', story: 'TODO-STORY' }),
  // ---------------- CHAMPIONS (side zone, not in the 40) ----------------
  C({ id: 'champ_old_wick', name: 'Old Wick, Last Reader', house: 'candle', type: 'character', champion: true, rarity: 'legendary', cost: 5, atk: 4, hp: 6, kindle: 2, kw: ['ward', 'kindle', 'opening_line'], abilities: [{ t: 'play', fx: [{ op: 'grant', kw: 'ward', to: 'other_allies_here' }] }], text: 'Ward. Kindle 2. Opening Line: other allies here get Ward.', story: 'units-v1 #13' }),
  C({ id: 'champ_ash_ember', name: 'Ash & Ember, Twin Edge', house: 'fold', type: 'character', champion: true, rarity: 'legendary', cost: 4, atk: 3, hp: 5, kw: ['riposte', 'cleave', 'swift'], text: 'Swift. Cleave. Riposte.', story: 'units-v1 #22' }),
  C({ id: 'champ_juniper', name: 'Juniper, Keybearer', house: 'tidewrack', type: 'character', champion: true, rarity: 'legendary', cost: 4, atk: 3, hp: 4, kw: ['board', 'hidden', 'opening_line'], target: 'enemy_here', abilities: [{ t: 'play', fx: [{ op: 'move', to: 'target' }] }], text: 'Board. Hidden. Opening Line: move an enemy here to the other Page.', story: 'units-v1 #11' }),
  // ---------------- TOKEN ----------------
  C({ id: 'spare_ink', name: 'Spare Ink', house: 'neutral', type: 'inkwork', token: true, cost: 0, abilities: [{ t: 'cast', fx: [{ op: 'ink', n: 1 }] }], text: 'Gain 1 Ink this turn.', story: 'n/a (rules token)' }),
];
const L = (id, n) => Array(n).fill(id);
export const STARTERS = {
  candle: [...L('c_novice', 2), ...L('c_taper', 2), ...L('c_wren', 2), ...L('c_trimmer', 2), 'c_vigil', 'c_lamplighter', 'c_lamps', 'c_mend', 'c_snuff', 'c_watch', ...L('n_weeping', 2), ...L('n_hob', 2), 'n_reader', 'n_errata'],
  fold: [...L('f_squire', 2), ...L('f_hinge', 2), ...L('f_corvin', 2), ...L('f_adept', 2), 'f_sentinel', 'f_master', 'f_feint', ...L('f_whirl', 2), 'f_counter', ...L('f_closed', 2), ...L('n_doodle', 2), 'n_wolf', 'n_erasure'],
  tidewrack: [...L('t_deckhand', 2), ...L('t_runner', 2), ...L('t_cutpurse', 2), ...L('t_pip', 2), 't_smuggler', 't_raider', 't_captain', ...L('t_undertow', 2), ...L('t_saltwind', 2), 't_riptide', ...L('n_blotling', 2), ...L('n_doodle', 2)],
};
