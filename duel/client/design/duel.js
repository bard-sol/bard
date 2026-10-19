// Bard duel v1: DOM builders for the onboarding comps. Data comes from cards-v1.3.js (generated from Gameplay's cards-proto-v1.3.json).
// The PixiJS/DOM build mirrors these functions; the class names are the component names in README.md.
const V3 = '../../prototype/v3/';
// Card art: every card's image path comes from ../art-map-v1.json via cards-v1.3.js (c.art = '../art/<card_id>.png').
const BARD_IMG = '/design/bard_cut.png'; // 256px downsize of ../../prototype/v2/art/bard_cut.png
const C = (id) => D13.cards[id];
const PAGE = (id) => D13.pages.find((p) => p.id === id);
const IS_PHONE = () => innerWidth <= 600;

window.HOUSE_NAME = { candle: 'The Candle', fold: 'The Fold', tidewrack: 'The Tidewrack', neutral: 'Neutral' };
window.TYPE_NAME = { character: 'Character', inkwork: 'Inkwork', marginalia: 'Marginalia' };
window.TYPE_HINT = { character: 'Unit. Stays on a Page and fights.', inkwork: 'Spell. Happens once, then it\u2019s gone.', marginalia: 'Trap. Set face-down; fires on their turn.' };

// Keyword copy. short = on-card / chip tooltip (from the player card guide v1.3); long = the detail sheet (plain-words version of rules-spec §3).
window.KW13 = {
  bound:        { name: 'Bound',        short: 'Enemies on this Page must attack it first.', long: 'If they attack on this Page, they have to pick a Bound unit. Spells and abilities can still hit anything.' },
  ward:         { name: 'Ward',         short: 'Ignores the next damage it takes.', long: 'The next hit of 1 or more does 0, then Ward is gone. It can be given again.' },
  swift:        { name: 'Swift',        short: 'Can attack or move the turn it\u2019s played.', long: 'Units normally arrive tired and wait a turn. Swift units arrive ready.' },
  hidden:       { name: 'Hidden',       short: 'Can\u2019t be attacked or targeted until it attacks.', long: 'Random picks skip it too. Effects that hit every unit on a Page still hit it.' },
  opening_line: { name: 'Opening Line', short: 'Happens when you play it.', long: 'Resolves once it lands on its Page. With no target, nothing happens. Never on The Moot-Rings.' },
  last_word:    { name: 'Last Word',    short: 'Happens when it dies.', long: 'Resolves on the Page where it died.' },
  silence:      { name: 'Silence',      short: 'Loses all its text.', long: 'Keywords, abilities, Ward, Kindle, Hidden and Riposte are wiped. Attack and health stay. It can\u2019t gain keywords again.' },
  cleave:       { name: 'Cleave',       short: 'Also hits the units beside its target.', long: 'Only when it attacks, not when it\u2019s attacked. Hits the units either side of the target in their row.' },
  kindle:       { name: 'Kindle',       short: 'End of your turn: heal the most-hurt ally here.', long: 'Kindle N heals N to your most-damaged unit on this Page, itself included. Candle signature.', house: 'candle' },
  riposte:      { name: 'Riposte',      short: 'When attacked, it strikes first.', long: 'If the attacker dies from it, the attacker deals no damage. Fold signature.', house: 'fold' },
  board:        { name: 'Board',        short: 'Moving doesn\u2019t tire it. It can still attack.', long: 'Still one move per turn. Tidewrack signature.', house: 'tidewrack' },
};
window.KW_ORDER = ['bound','ward','swift','hidden','opening_line','last_word','silence','cleave','kindle','riposte','board'];
window.TERMS = {
  verse:   { name: 'Verse',   icon: 'verse', def: 'A point. First to 8 Verses wins.' },
  ink:     { name: 'Ink',     icon: 'ink',   def: 'Pays for cards. 1 on turn 1, +1 each turn, up to 7. Refills every turn.' },
  page:    { name: 'Page',    icon: 'page',  def: 'One of the two battlefields. Up to 4 of your units each. Each has a rule.' },
  hold:    { name: 'Hold',    icon: 'hold',  def: 'Start your turn alone on a Page: +1 Verse.' },
  conquer: { name: 'Conquer', icon: 'conquer', def: 'Clear a Page that had enemies, and keep a unit there: +2 Verses at the end of your turn.' },
  tired:   { name: 'Tired',   icon: 'tired', def: 'Can\u2019t attack or move until your next turn. New units arrive tired.' },
  legend:  { name: 'Legend',  icon: 'legend', def: 'Your House hero. A power for 2 Ink once per turn, and a champion card once per match.' },
};

// ───────────────────────── helpers ─────────────────────────
const hv = (h) => `--house:var(--h-${h}-a);--house-b:var(--h-${h}-b)`;
const KWRE = /\b(Opening Line|Last Word|Bound|Ward|Swift|Hidden|Silence|Cleave|Kindle(?: \d)?|Riposte|Board)\b/g;
function abil(text, mark) {
  return text.replace(KWRE, (m) => `<b class="kwt"${mark ? ` data-keyword="${m.replace(/ \d$/, '')}"` : ''}>${m}</b>`).replace(/\(No ability\.\)/, '<span class="noab">No ability.</span>');
}
function kwOf(c) { return (c.kw || []).filter((k) => KW13[k]); }
function costHTML(c, o = {}) { return `<span class="dc-cost ${o.cant ? 'cant' : ''}" title="${c.cost} Ink">${icon('ink_f', 'drop')}<b>${c.cost}</b></span>`; }
function artHTML(c, o = {}) {
  if (c.art && !(o.cssPh && c.artSource === 'placeholder')) return `<div class="dc-art ${c.artSource === 'placeholder' ? 'pending' : ''}"><img src="${c.art}" alt="" style="object-position:${o.pos || '50% 30%'}"></div>`;
  const g = c.type === 'character' ? 'house_' + c.house : TYPEI[c.type];
  return `<div class="dc-art ph ph-${c.type}"><span class="ph-g">${icon(g)}</span>${o.noTag ? '' : `<span class="ph-tag">${c.type === 'character' ? 'Sketch' : TYPE_NAME[c.type]}</span>`}</div>`;
}
function typeLine(c, o = {}) {
  const champ = c.id.startsWith('champ_');
  return `<div class="dc-type">${icon(TYPEI[c.type], 'ti')}<span>${TYPE_NAME[c.type]}</span><i>·</i><span class="hn">${icon('house_' + c.house, 'hg')}${HOUSE_NAME[c.house].replace(/^The /, '')}</span>${!champ && c.rarity === 'legendary' ? '<span class="tag">Legendary</span>' : ''}</div>`;
}
function kwChips(c, o = {}) {
  const k = kwOf(c); if (!k.length) return '';
  return `<div class="kw-chips">${k.map((x) => `<span class="kwc" data-keyword="${KW13[x].name}">${icon(KWI[x])}${KW13[x].name}${x === 'kindle' ? ' ' + (c.kindle || 1) : ''}</span>`).join('')}</div>`;
}
function statsHTML(atk, hp, o = {}) {
  return `<span class="st atk ${o.atkCls || ''}">${icon('atk')}<b>${atk}</b></span><span class="st hp ${o.hpCls || ''}">${icon('hp')}<b>${hp}</b></span>`;
}

// ───────────────────────── card faces ─────────────────────────
// size: 'inspect' | 'hand' | 'hand-s' (phone hand)
window.cardFace = function (id, o = {}) {
  const c = C(id), size = o.size || 'hand', cls = ['dc', 'sz-' + size, c.type, id.startsWith('champ_') ? 'champ' : '', o.cant ? 'cant' : '', o.sel ? 'sel' : '', o.playable ? 'playable' : '', o.cls || ''].join(' ');
  const isChar = c.type === 'character';
  const foot = isChar ? `<div class="dc-stats">${statsHTML(o.atk ?? c.atk, o.hp ?? c.hp)}</div>`
    : `<div class="dc-stats spell"><span class="hint">${size === 'hand-s' ? ({ inkwork: 'Spell', marginalia: 'Trap' })[c.type] : TYPE_HINT[c.type]}</span></div>`;
  if (size === 'hand-s') {
    const k = kwOf(c);
    return `<div class="${cls}" style="${hv(c.house)}">${artHTML(c, { noTag: true, cssPh: true })}${costHTML(c, o)}
      <span class="dc-ti">${icon(TYPEI[c.type])}</span>${id.startsWith('champ_') ? '<span class="dc-champ">Champion</span>' : ''}
      <div class="dc-body"><div class="dc-name">${c.mini}</div>${k.length ? `<div class="dc-kwi">${k.slice(0, 3).map((x) => icon(KWI[x])).join('')}</div>` : ''}<p class="dc-text">${abil(c.text)}</p></div>${foot}</div>`;
  }
  const champHtml = id.startsWith('champ_') ? '<span class="dc-champ">Champion · once per match</span>' : '';
  const art = size === 'inspect' ? `<div class="dc-art-wrap">${artHTML(c)}${champHtml}</div>` : `${artHTML(c)}${champHtml}`;
  return `<div class="${cls}" style="${hv(c.house)}">${art}${costHTML(c, o)}<button class="dc-q" aria-label="Card details">${icon('help')}</button>
    <div class="dc-body"><div class="dc-name">${c.name}</div>${typeLine(c)}
      ${size === 'inspect' ? kwChips(c) : ''}<p class="dc-text">${abil(c.text, size === 'hand')}</p></div>${foot}</div>`;
};

// Board unit token. u = { id, atk, hp, maxHp, ward, hidden, silenced, tired, ready, rip, buff, dmgd, hl, tag }
window.unit = function (u, o = {}) {
  const c = C(u.id); const atk = u.atk ?? c.atk, hp = u.hp ?? c.hp, max = u.maxHp ?? c.hp;
  const kws = kwOf(c).filter((k) => k !== 'opening_line' && k !== 'silence');
  const ward = u.ward ?? (kws.includes('ward') && !u.silenced), hidden = u.hidden ?? (kws.includes('hidden') && !u.silenced);
  const cls = ['un', u.tired ? 'tired' : '', u.ready ? 'ready' : '', ward ? 'warded' : '', hidden ? 'hid' : '', u.silenced ? 'silenced' : '', u.hl || '', o.side || ''].join(' ');
  return `<div class="${cls}" style="${hv(c.house)}" data-uid="${u.uid || u.id}" data-def="${u.id}">
    ${artHTML(c, { noTag: true, cssPh: true })}
    <div class="un-kw">${kws.map((k) => `<i class="${u.silenced ? 'off' : ''}">${icon(KWI[k])}</i>`).join('')}${u.rip ? `<i class="temp">${icon('riposte')}</i>` : ''}${u.silenced ? `<i class="sil">${icon('silence')}</i>` : ''}</div>
    ${u.tired ? `<span class="un-tired" title="Tired">${icon('tired')}</span>` : ''}
    ${ward ? `<span class="un-ward">${icon('ward')}</span>` : ''}
    <div class="un-name">${c.mini}</div>
    <div class="un-st">${statsHTML(atk, hp, { atkCls: atk > c.atk ? 'up' : '', hpCls: hp < max ? 'dn' : hp > c.hp ? 'up' : '' })}</div>
    ${u.tag ? `<span class="un-tag ${u.tagCls || ''}">${u.tag}</span>` : ''}${u.float ? `<span class="un-float ${u.floatCls || ''}">${u.float}</span>` : ''}</div>`;
};
window.noteTile = function (o = {}) { // face-down Marginalia. Owner sees which one; rival sees only that a note is there.
  if (!o.id) return `<div class="note ${o.side || ''} ${o.hl || ''}" title="A face-down note">${icon('t_marginalia')}<span>Note</span></div>`;
  const c = C(o.id); return `<div class="note mine ${o.hl || ''}" title="${c.name}">${icon('t_marginalia')}<span>Yours</span></div>`;
};
const slot = (n, o = {}) => Array.from({ length: n }, (_, i) => `<div class="slot ${o.cls || ''}" data-page="${o.page ?? ''}" data-slot="${i}">${o.cls && o.cls.includes('drop') ? icon('heal') : ''}</div>`).join('');

// ───────────────────────── Page panel + rule banner ─────────────────────────
// status: contested | you | them | empty | conquer
const STATUS = {
  contested: { t: 'Contested', d: 'Both sides have units here. Clear theirs to conquer it.' },
  you: { t: 'You hold · +1', d: 'Only you have units here: +1 Verse at the start of your turn.' },
  them: { t: 'They hold · +1', d: 'Only they have units here: they score +1 Verse at the start of their turn.' },
  empty: { t: 'Empty', d: 'Nobody is here. Put a unit here alone to hold it: +1 Verse each turn.' },
  conquer: { t: 'Conquer · +2', d: 'Clear the last enemy here and stay: +2 Verses at the end of your turn.' },
};
window.pageStatus = (p) => { const y = p.you.length, r = p.rival.length; return y && r ? 'contested' : y ? 'you' : r ? 'them' : 'empty'; };
window.banner = function (pg, o = {}) {
  const P = PAGE(pg.id), st = o.status || pageStatus(pg), S = STATUS[st];
  const cap = pg.id === 'torn_margin' ? 2 : 4;
  return `<div class="pb ${o.open ? 'open' : ''} st-${st} ${o.hl || ''}" data-page="${pg.id}">
    <div class="pb-row"><span class="pb-ico">${icon('page')}</span><div class="pb-txt"><b class="pb-name">${P.name}</b><span class="pb-rule">${P.text}</span></div>
      <span class="pb-st">${icon(st === 'conquer' ? 'conquer' : 'hold')}${S.t}</span><span class="pb-chev">${icon(o.open ? 'chev_u' : 'chev_d')}</span></div>
    ${o.open ? `<div class="pb-more"><div class="pb-line">${icon('hold')}<span><b>Hold.</b> Start your turn alone here: <b>+1 Verse</b>.</span></div>
      <div class="pb-line">${icon('conquer')}<span><b>Conquer.</b> Clear their units here and keep one: <b>+${pg.id === 'spine' ? 3 : 2} Verses</b>.</span></div>
      <div class="pb-line pb-now">${icon('dot')}<span>${S.d}</span></div>
      <div class="pb-cnt"><span>You ${pg.you.length} / ${cap}</span><span>Them ${pg.rival.length} / ${cap}</span></div></div>` : ''}
  </div>`;
};
window.pagePanel = function (pg, i, o = {}) {
  const cap = pg.id === 'torn_margin' ? 2 : 4;
  const row = (side) => {
    const us = pg[side], note = side === 'you' ? pg.youNote : pg.rivalNote;
    const drop = o.drop && side === 'you' ? 'drop' : '';
    return `<div class="row ${side}" data-side="${side}">${us.map((u) => unit(u, { side })).join('')}${slot(cap - us.length, { cls: drop, page: i })}${note ? noteTile(side === 'you' ? { id: note, hl: pg.noteHl } : { side, hl: pg.noteHl }) : `<div class="note none"></div>`}</div>`;
  };
  return `<section class="page ${o.hl || ''}" data-i="${i}" style="--pi:${i}">${row('rival')}${banner(pg, { open: o.open, status: o.status })}${row('you')}</section>`;
};

// ───────────────────────── HUD ─────────────────────────
const pips = (n, of, cls) => `<span class="pips ${cls}">${Array.from({ length: of }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
window.verseHTML = (n, o = {}) => `<div class="verse ${o.cls || ''}" ${o.id ? `id="${o.id}"` : ''}><span class="v-l">${icon('verse')}<span class="lbl">Verse</span></span><b class="v-n">${n}<small> / 8</small></b>${o.pips === false ? '' : pips(n, 8, 'vp')}${o.delta ? `<span class="v-d">${o.delta}</span>` : ''}</div>`;
window.inkHTML = (n, max, o = {}) => `<div class="inkm ${o.cls || ''}" id="ink"><span class="v-l">${icon('ink_f')}<span class="lbl">Ink</span></span><b class="v-n">${n}<small> / ${max}</small></b><span class="drops">${Array.from({ length: IS_PHONE() ? max : 7 }, (_, i) => `<i class="${i < n ? 'on' : i < max ? 'spent' : 'off'}">${icon(i < n ? 'ink_f' : 'ink')}</i>`).join('')}</span></div>`;
// Legend power button. state: ready | used | locked | noink
window.legendBtn = function (house, state = 'ready', o = {}) {
  const L = D13.legends[house], art = C(L.champion).art;
  const sub = { ready: L.text, used: 'Used this turn. Back next turn.', locked: o.lockText || 'Fighting has started. Back next turn.', noink: L.text }[state];
  return `<button class="lgd ${state} ${o.cls || ''}" id="${o.id || 'legend'}"${o.disabled ? ' disabled' : ''} style="${hv(house)}"><span class="lg-face"><img src="${art}" alt=""><span class="lg-cost ${state === 'noink' ? 'short' : ''}">${icon('ink_f')}<b>${L.cost}</b></span>${state === 'used' ? `<span class="lg-badge">${icon('check')}</span>` : state === 'locked' ? `<span class="lg-badge">${icon('lock')}</span>` : ''}</span>
    <span class="lg-txt"><span class="lg-n">${L.name}<span class="lg-pw">Power</span></span><span class="lg-d">${sub}</span></span></button>`;
};
window.turnChip = (t, o = {}) => {
  const phase = o.phase || '';
  const bar = phase ? `<span class="t-step">${['Play', 'Fight', 'End'].map((name) => `<i class="${phase === name ? 'on' : ''}">${name}</i>`).join('<em>·</em>')}</span>` : (o.step ? `<span class="t-step">${o.step}</span>` : '');
  return `<div class="turn ${o.cls || ''}" id="turn"><span class="t-who ${o.rival ? 'rv' : ''}">${o.rival ? "Rival's turn" : 'Your turn'}</span><b>Turn ${t}<small> / 7</small></b>${bar}</div>`;
};
window.rivalBar = function (S, o = {}) {
  const R = S.rival, Y = S.you, L = D13.legends[R.house];
  return `<div class="rbar" style="${hv(R.house)}"><span class="r-av"><img src="${C(L.champion).art}" alt=""></span>
    <div class="r-id"><b>${R.name}</b><span>${HOUSE_NAME[R.house].replace(/^The /, '')} · ${icon('hand')}${R.hand} · ${icon('deck')}${R.deck}</span></div>
    <div class="race">${verseHTML(Y.verse, { id: 'yverse', pips: false })}${verseHTML(R.verse, { cls: 'rival', id: 'rverse', pips: false })}</div>
    <button class="ib help" id="help" aria-label="How to play">${icon('help')}</button></div>`;
};
window.youBar = function (S, o = {}) {
  const Y = S.you;
  const rival = S.active === 'rival';
  const label = rival ? "Rival's turn" : (o.endLabel || 'End turn');
  const phase = !rival && o.phaseLabel ? `<small class="endt-ph">${o.phaseLabel}</small>` : '';
  const stub = o.championId ? `<button type="button" class="champ-stub" data-uid="champion" data-def="${o.championId}">${C(o.championId).mini}</button>` : '';
  const spare = o.spareUid ? `<button type="button" class="spare" id="spare" data-uid="${o.spareUid}" data-def="spare_ink">+1</button>` : '';
  return `<div class="ybar" style="${hv(Y.house)}"><div class="y-res">${inkHTML(Y.ink, Y.maxInk)}${spare}</div>
    ${stub}${legendBtn(Y.house, Y.legend, { lockText: o.lockText, disabled: rival })}
    <button class="btn primary endt ${rival ? 'wait' : ''} ${o.endCls || ''}" id="endturn"${rival ? ' disabled' : ''}>${label}${phase}</button></div>`;
};
window.handHTML = function (S, o = {}) {
  const sz = IS_PHONE() ? 'hand-s' : 'hand';
  const cards = S.you.hand.map((entry, i) => {
    const id = typeof entry === 'string' ? entry : entry.id;
    const uid = typeof entry === 'string' ? '' : (entry.uid ?? '');
    const face = cardFace(id, { size: sz, cant: (entry.cant ?? C(id).cost > S.you.ink), playable: entry.playable, sel: o.sel === i || entry.sel, cls: o.handCls?.[i] || '' });
    return face.replace('<div class="', `<div data-uid="${uid}" data-def="${id}" class="`);
  });
  return `<div class="hand-wrap"><div class="hand-hd"><span class="eyebrow">Your hand · ${S.you.hand.length}</span><span class="eyebrow">${icon('deck')} Deck ${S.you.deck}</span><span class="eyebrow hint">${o.hint || 'Tap a card to read it'}</span></div>
    <div class="handrow" id="hand">${cards.join('')}</div></div>`;
};
window.statusBar = () => `<div class="status m-only"><span>9:41</span><span class="sb"><i style="width:17px;height:11px;border-radius:3px"></i><i style="width:15px;height:11px;clip-path:polygon(0 100%,100% 0,100% 100%)"></i><i style="width:25px;height:12px;border-radius:4px"></i></span></div>`;
window.bardSays = (txt, o = {}) => `<div class="bsay ${o.cls || ''}"><span class="b-av"><img src="${BARD_IMG}" alt="Bard"></span><div class="b-tx"><span class="who">Bard</span>${txt}</div></div>`;

// desktop rails
window.logPanel = function (entries, o = {}) {
  return `<div class="panel logp ${o.cls || ''}" id="logp"><div class="ph"><span class="eyebrow">${o.title || 'Move log'}</span><span class="eyebrow">${o.right || ''}</span></div>
    <ol class="log">${entries.map((e) => `<li class="${e.cur ? 'cur' : ''} ${e.who || ''} ${e.done ? 'done' : ''}"><span class="lg-i">${icon(e.i || 'dot')}</span><span class="lg-t">${e.t}</span>${e.cur ? '<span class="now">Now</span>' : e.r ? `<span class="res ${e.rc || ''}">${e.r}</span>` : ''}</li>`).join('')}</ol></div>`;
};
window.inspectPanel = function (id, o = {}) {
  const c = C(id);
  return `<div class="panel insp" id="inspect"><div class="ph"><span class="eyebrow">${o.title || 'Selected card'}</span><span class="eyebrow">Hover any card</span></div>
    <div class="insp-c">${cardFace(id, { size: 'inspect' })}</div>
    <div class="insp-kw">${kwOf(c).map((k) => kwRow(k)).join('')}</div></div>`;
};
window.kwRow = (k, o = {}) => `<div class="kwrow ${KW13[k].house ? 'sig' : ''}"><span class="kw-i" ${KW13[k].house ? `style="${hv(KW13[k].house)}"` : ''}>${icon(KWI[k])}</span><div><b>${KW13[k].name}${KW13[k].house ? `<em>${HOUSE_NAME[KW13[k].house].replace(/^The /, '')}</em>` : ''}</b><span>${KW13[k].short}</span>${o.long ? `<small>${KW13[k].long}</small>` : ''}</div></div>`;

// ───────────────────────── fixtures ─────────────────────────
window.FIX = {};
FIX.main = () => ({
  turn: 4, active: 'you', step: 'Play step',
  you: { house: 'candle', verse: 2, ink: 3, maxInk: 4, legend: 'ready', hand: ['champ_old_wick', 'c_wren', 'c_snuff', 'c_lamps', 'n_doodle', 'c_mend'], deck: 13 },
  rival: { name: 'Ash & Ember', house: 'fold', verse: 3, hand: 4, deck: 13 },
  pages: [
    { id: 'lanternfall', you: [{ id: 'n_errata', ready: true }, { id: 'c_novice', tired: true }], rival: [{ id: 'f_hinge', silenced: true }], rivalNote: true, youNote: null },
    { id: 'port_foxing', you: [{ id: 'n_hob', hp: 1, ready: true }, { id: 'c_taper', ready: true }], rival: [{ id: 'f_corvin', atk: 3 }, { id: 'f_squire' }], youNote: 'c_watch', rivalNote: false },
  ],
});
FIX.mainLog = [
  { t: 'Drew a card', i: 'deck', done: true },
  { t: 'Played <b>Paper Squire</b> on Port Foxing', i: 't_character', done: true },
  { t: 'Set a <b>note</b> on Lanternfall', i: 't_marginalia', done: true },
  { t: '<b>Corvin</b> moved to Port Foxing', i: 'move', r: '+1 atk', rc: 'up', done: true },
  { t: '<b>Corvin</b> attacked <b>Hob</b>', i: 'atk', r: '−2', rc: 'dn', done: true },
  { t: 'Ended their turn', i: 'check', done: true },
  { t: '<b>Your turn 4.</b> Ink refilled to 4', i: 'ink_f', who: 'you', done: true },
  { t: 'You played <b>Lanternfall Novice</b>', i: 't_character', who: 'you', r: '−1 Ink', done: true },
];

// ───────────────────────── screen assembly ─────────────────────────
window.boardScreen = function (S, o = {}) {
  const pp = S.pages.map((p, i) => pagePanel(p, i, { open: o.open === i, drop: o.drop, hl: o.pageHl?.[i], status: o.status?.[i] }));
  const ticker = o.ticker ? `<div class="ticker"><span class="now">Now</span>${o.ticker}</div>` : '';
  const phase = S.step === 'Fight' ? 'Fight' : S.step === 'Mulligan' ? '' : 'Play';
  const ribbon = `<div class="ribbon m-only">${turnChip(S.turn, { rival: S.active === 'rival', phase })}${ticker}<button class="ib sm" id="logbtn" aria-label="Move log">${icon('log')}<span>Log</span>${o.logDot ? '<i class="dotn"></i>' : ''}</button></div>`;
  const desk = !IS_PHONE();
  return `<div class="app duel ${o.cls || ''}" style="--mine:var(--h-${S.you.house}-a);--rival:var(--h-${S.rival.house}-a)">
  ${statusBar()}
  ${desk ? `<header class="dtop"><div class="brand"><span class="word">Bard</span><span class="mode">${o.mode || 'Card Duel · Guided first match'}</span></div>${turnChip(S.turn, { rival: S.active === 'rival', phase })}<div class="dt-r"><button class="btn ghost" id="help-d">${icon('help')}How to play</button><button class="btn icon secondary" id="settings" aria-label="Settings">${icon('settings')}</button></div></header>` : ''}
  <div class="dmain">
    ${desk ? `<aside class="rail l">${o.leftRail || logPanel(o.log || FIX.mainLog, { right: `Turn ${S.turn}` })}${o.leftBard ? `<div class="panel">${bardSays(o.leftBard)}</div>` : ''}</aside>` : ''}
    <div class="center">${rivalBar(S, o)}${ribbon}<div class="pages" id="pages">${pp[0]}${pp[1]}</div>${youBar(S, o)}${handHTML(S, o)}</div>
  </div>
  <div class="ovl" id="ovl">${o.overlay || ''}</div>
</div>`;
};

// Mount + re-mount on resize (headless Chrome lays out at a different width first, then resizes).
window.mount = function (fn, after) { let w = -1, h = -1; const go = () => { if (innerWidth === w && innerHeight === h) return; w = innerWidth; h = innerHeight; let r = document.getElementById('root'); if (!r) { r = document.createElement('div'); r.id = 'root'; document.body.appendChild(r); } r.innerHTML = fn(); after && after(); }; go(); addEventListener('resize', go); };

// ───────────────────────── overlays: coach marks, labels, arrows ─────────────────────────
const rectOf = (el, root) => { const a = el.getBoundingClientRect(), b = root.getBoundingClientRect(); return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height }; };
// Bubble guide (bubble-guide-v1.md). o = { holes:[sel], point: sel (arrow target, default first hole), text, step, n, action|next, place }
// Placement rule: never cover a spotlit element. Phone: sits directly above the hand; if that would cover a hole, it moves above the
// highest covered hole (or below the target if there's no room). Desktop: beside the target (above → below → right → left), first fit wins.
const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
window.coach = function (o) {
  const app = document.querySelector('.app'), W = app.clientWidth, H = app.clientHeight, pad = o.pad ?? 6;
  const holes = o.holes.flatMap((s) => [...document.querySelectorAll(s)]).map((el) => rectOf(el, app)).map((r) => ({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }));
  const pointed = o.point ? document.querySelector(o.point) : null;
  const tgt = pointed ? rectOf(pointed, app) : (holes.length ? holes[0] : { x: W / 2, y: H / 2, w: 0, h: 0 });
  const dim = `<svg class="cm-dim" pointer-events="none" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><mask id="cm"><rect width="${W}" height="${H}" fill="#fff"/>${holes.map((h) => `<rect x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" rx="12" fill="#000"/>`).join('')}</mask></defs>
    <rect width="${W}" height="${H}" fill="rgba(5,7,10,.76)" mask="url(#cm)"/>${holes.map((h) => `<rect class="cm-ring" x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" rx="12"/>`).join('')}</svg>`;
  const ovl = document.getElementById('ovl');
  ovl.innerHTML = dim + `<button class="cm-skip">Skip tutorial</button><div class="cm-bub" id="bub"><div class="cm-tx">${o.text}${o.nudge ? `<span class="cm-nudge">${o.nudge}</span>` : ''}</div>
    <div class="cm-ft"><span class="cm-step">${o.step} / ${o.n}</span>${o.next ? `<button class="btn primary cm-next">Next</button>` : `<span class="cm-act">${icon(o.icon || 'tap')}${o.action}</span>`}</div>
    <span class="cm-bard"><img src="${BARD_IMG}" alt=""></span></div>${o.extra || ''}`;
  ovl.classList.add('on');
  const b = document.getElementById('bub'), bw = b.offsetWidth, bh = b.offsetHeight;
  const margin = 8, mascotL = 10, mascotT = 18;
  const minX = Math.min(margin + mascotL, Math.max(margin, W - bw - margin));
  const minY = Math.min(margin + mascotT, Math.max(margin, H - bh - margin));
  const maxX = Math.max(minX, W - bw - margin);
  const maxY = Math.max(minY, H - bh - margin);
  const clamp = (p) => ({ x: Math.max(minX, Math.min(maxX, p.x)), y: Math.max(minY, Math.min(maxY, p.y)), w: bw, h: bh });
  const area = (a, blk) => {
    const w = Math.max(0, Math.min(a.x + a.w, blk.x + blk.w) - Math.max(a.x, blk.x));
    const h = Math.max(0, Math.min(a.y + a.h, blk.y + blk.h) - Math.max(a.y, blk.y));
    return w * h;
  };
  const blockers = holes.filter((h) => h.w * h.h < W * H * 0.22);
  const add = (el, pad = 4) => {
    if (!el) return;
    const r = rectOf(el, app);
    if (r.w < 2 || r.h < 2) return;
    blockers.push({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 });
  };
  add(document.querySelector('.dtop'), 0);
  add(document.querySelector('.cm-skip'), 4);
  add(document.querySelector('.toast-host'), 8);
  const end = document.getElementById('endturn');
  if (end && pointed && pointed !== end && !end.contains(pointed)) add(end, 6);
  if (!IS_PHONE()) {
    const cardW = H <= 640 ? 176 : 264;
    const dockLeft = tgt.x + tgt.w / 2 > W / 2;
    document.documentElement.dataset.inspectDock = dockLeft ? 'left' : 'right';
    blockers.push(dockLeft ? { x: 0, y: 0, w: cardW, h: H } : { x: W - cardW, y: 0, w: cardW, h: H });
  } else delete document.documentElement.dataset.inspectDock;
  const gapX = 16 + mascotL, gapY = 16 + mascotT;
  const seen = (spot) => {
    const box = clamp(spot);
    return { x: box.x - mascotL, y: box.y - mascotT, w: box.w + mascotL, h: box.h + mascotT, box };
  };
  const endRect = end && pointed !== end && !(pointed && end.contains(pointed)) ? rectOf(end, app) : null;
  const dragRects = (o.drag || []).flatMap((sel) => { const el = document.querySelector(sel); return el ? [rectOf(el, app)] : []; });
  const toastRect = (() => { const el = document.querySelector('.toast'); if (!el) return null; const r = rectOf(el, app); return r.w > 2 && r.h > 2 ? r : null; })();
  const forbidden = [tgt, ...dragRects, ...(endRect ? [endRect] : []), ...(toastRect ? [toastRect] : [])];
  const mustClear = (vis) => {
    const hit = forbidden.reduce((sum, hole) => sum + area(vis, hole), 0);
    return (hit > 1 ? 1e7 : 0) + hit;
  };
  const raw = [
    { x: tgt.x + tgt.w / 2 - bw / 2, y: tgt.y - bh - gapY },
    { x: tgt.x + tgt.w / 2 - bw / 2, y: tgt.y + tgt.h + gapY },
    { x: tgt.x - bw - gapX, y: tgt.y + tgt.h / 2 - bh / 2 },
    { x: tgt.x + tgt.w + gapX, y: tgt.y + tgt.h / 2 - bh / 2 },
    { x: tgt.x - bw - gapX, y: tgt.y + tgt.h + gapY },
    { x: tgt.x + tgt.w + gapX, y: tgt.y + tgt.h + gapY },
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: minX, y: maxY },
    { x: maxX, y: maxY },
  ];
  let pos;
  if (IS_PHONE()) {
    const endTop = endRect ? endRect.y : H - 54;
    const phone = [
      { x: (W - bw) / 2, y: endTop - bh - gapY },
      { x: (W - bw) / 2, y: endRect ? endRect.y + endRect.h + 8 : maxY },
      { x: (W - bw) / 2, y: tgt.y - bh - gapY },
      { x: (W - bw) / 2, y: tgt.y + tgt.h + gapY },
      { x: minX, y: minY },
      { x: minX, y: Math.max(minY, endTop - bh - gapY) },
    ];
    pos = phone.map((spot) => {
      const vis = seen(spot);
      const cost = mustClear(vis) + blockers.reduce((sum, blk) => sum + area(vis, blk), 0);
      return { box: vis.box, cost };
    }).sort((a, b) => a.cost - b.cost)[0].box;
  } else {
    pos = raw.map((spot) => {
      const vis = seen(spot);
      const cost = mustClear(vis) + Math.abs(vis.box.x - spot.x) + Math.abs(vis.box.y - spot.y)
        + blockers.reduce((sum, blk) => sum + area(vis, blk) * 6, 0)
        + Math.hypot((vis.box.x + bw / 2) - (tgt.x + tgt.w / 2), (vis.box.y + bh / 2) - (tgt.y + tgt.h / 2)) * 0.15;
      return { placed: vis.box, cost };
    }).sort((a, b) => a.cost - b.cost)[0].placed;
  }
  const visual = (box) => ({ x: box.x - mascotL, y: box.y - mascotT, w: box.w + mascotL, h: box.h + mascotT });
  for (let nudge = 0; nudge < 8 && area(visual(pos), tgt) > 1; nudge++) {
    const vis = visual(pos);
    const down = vis.y + vis.h - tgt.y;
    const up = tgt.y + tgt.h - vis.y;
    const next = up <= down ? { x: pos.x, y: pos.y - up - 4 } : { x: pos.x, y: pos.y + down + 4 };
    const boxed = clamp(next);
    if (boxed.x === pos.x && boxed.y === pos.y) break;
    pos = boxed;
  }
  b.style.left = pos.x + 'px'; b.style.top = pos.y + 'px';
  if (o.arrow !== false && holes.length) { // arrow from the bubble edge facing the target to the target edge
    const bc = { x: pos.x + bw / 2, y: pos.y + bh / 2 }, tc = { x: tgt.x + tgt.w / 2, y: tgt.y + tgt.h / 2 };
    let x1, y1, x2, y2;
    if (tc.y < pos.y) { x1 = Math.max(pos.x + 30, Math.min(pos.x + bw - 30, tc.x)); y1 = pos.y; x2 = tc.x; y2 = tgt.y + tgt.h + 3; }
    else if (tc.y > pos.y + bh) { x1 = Math.max(pos.x + 30, Math.min(pos.x + bw - 30, tc.x)); y1 = pos.y + bh; x2 = tc.x; y2 = tgt.y - 3; }
    else if (tc.x > bc.x) { x1 = pos.x + bw; y1 = bc.y; x2 = tgt.x - 3; y2 = tc.y; } else { x1 = pos.x; y1 = bc.y; x2 = tgt.x + tgt.w + 3; y2 = tc.y; }
    if (o.arrowTo) { const t = rectOf(document.querySelector(o.arrowTo), app); x2 = t.x + t.w / 2; y2 = t.y > y1 ? t.y - 3 : t.y + t.h + 3; }
    const mx = (x1 + x2) / 2 + (Math.abs(x2 - x1) < 20 ? 0 : (y2 < y1 ? -1 : 1) * 0), my = (y1 + y2) / 2;
    const cx = (x1 + x2) / 2 + (x2 > x1 ? -1 : 1) * Math.min(40, Math.abs(y2 - y1) / 3);
    ovl.insertAdjacentHTML('beforeend', `<svg class="cm-arrow" pointer-events="none" width="${W}" height="${H}"><defs><marker id="cma" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#F1EBDF"/></marker></defs>
      <path d="M${x1} ${y1} Q${cx} ${my} ${x2} ${y2}" marker-end="url(#cma)"/></svg>`);
  }
  if (o.drag) { const f = rectOf(document.querySelector(o.drag[0]), app), t = rectOf(document.querySelector(o.drag[1]), app);
    ovl.insertAdjacentHTML('beforeend', `<svg class="cm-drag" pointer-events="none" width="${W}" height="${H}"><path d="M${f.x + f.w / 2} ${f.y + 10} Q${(f.x + t.x) / 2 + 40} ${(f.y + t.y) / 2} ${t.x + t.w / 2} ${t.y + t.h / 2}"/></svg><span class="cm-tap" style="left:${t.x + t.w / 2 - 12}px;top:${t.y + t.h / 2 - 4}px">${icon('tap')}</span>`); }
};
// labels: [{sel, t, at:'t'|'b'|'l'|'r'|'tl'..., dx, dy}]
window.labels = function (list) {
  const app = document.querySelector('.app'), ovl = document.getElementById('ovl'); let html = '', lines = '';
  list.forEach((L, i) => {
    const el = document.querySelector(L.sel); if (!el) { console.warn('no label target', L.sel); return; }
    const r = rectOf(el, app); const ax = r.x + r.w * (L.ax ?? .5), ay = r.y + r.h * (L.ay ?? .5);
    const tx = ax + (L.dx || 0), ty = ay + (L.dy || 0);
    html += `<span class="lbl-tag ${L.cls || ''}" style="left:${tx}px;top:${ty}px;${L.w ? `width:${L.w}px;` : ''}transform:translate(${L.tx ?? -50}%,${L.ty ?? -50}%)"><i>${i + 1}</i>${L.t}</span>`;
    lines += `<line x1="${ax}" y1="${ay}" x2="${tx}" y2="${ty}"/><circle cx="${ax}" cy="${ay}" r="2.5"/>`;
    if (L.box) html += `<span class="lbl-box" style="left:${r.x - 2}px;top:${r.y - 2}px;width:${r.w + 4}px;height:${r.h + 4}px"></span>`;
  });
  ovl.innerHTML = `<svg class="lbl-svg" width="${app.clientWidth}" height="${app.clientHeight}">${lines}</svg>` + html; ovl.classList.add('on', 'labels');
};
window.arrow = function (fromSel, toSel, o = {}) {
  const app = document.querySelector('.app'), a = rectOf(document.querySelector(fromSel), app), b = rectOf(document.querySelector(toSel), app);
  const x1 = a.x + a.w / 2, y1 = a.y + (o.fromTop ? 0 : a.h / 2), x2 = b.x + b.w / 2, y2 = b.y + b.h - (o.toInset ?? 10);
  const mx = (x1 + x2) / 2 + (o.bend ?? 30), my = (y1 + y2) / 2;
  const svg = `<svg class="arrow" width="${app.clientWidth}" height="${app.clientHeight}"><defs><marker id="ah" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>
    <path d="M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}" marker-end="url(#ah)"/></svg>`;
  document.getElementById('ovl').insertAdjacentHTML('afterbegin', svg); document.getElementById('ovl').classList.add('on');
};
// Numbered pins + legend card (labelled-board comps). list: [{sel, t, ax, ay}] ; box: {css} where the legend card sits.
window.pins = function (list, box, o = {}) {
  const app = document.querySelector('.app'), ovl = document.getElementById('ovl'); let html = '';
  list.forEach((L, i) => { const el = document.querySelector(L.sel); if (!el) { console.warn('no pin', L.sel); return; }
    const r = rectOf(el, app), x = r.x + r.w * (L.ax ?? 0), y = r.y + r.h * (L.ay ?? 0);
    html += `<span class="lbl-ring" style="left:${r.x - 1}px;top:${r.y - 1}px;width:${r.w + 2}px;height:${r.h + 2}px"></span><span class="pin" style="left:${x}px;top:${y}px">${(o.start || 1) + i}</span>`; });
  html += `<div class="pin-key" style="${box}"><span class="eyebrow">${o.title || 'Labels'}</span><ol style="counter-reset:k ${(o.start || 1) - 1}">${list.map((L) => `<li>${L.t}</li>`).join('')}</ol></div>`;
  ovl.innerHTML = (o.dim ? `<div class="pin-dim" style="${o.dim}"></div>` : '') + html; ovl.classList.add('on');
};
