// Bard Card Duel engine v1 — pure, integer-only, array-only iteration, seeded.
// match = f(deckA, deckB, seed, actions[], AI version). See ../rules-spec.md.
import { CARDS, PAGES, LEGENDS } from './cards-src.mjs';
export const ENGINE_VERSION = 'duel-engine-1.1.0';
export const MAX_TURNS = 7, WIN_VERSES = 8, MAX_INK = 7, PAGE_CAP = 4, HAND_CAP = 10, LEGEND_COST = 2;
export const TRIGGER_CAP = 64, DEPTH_CAP = 8;
const CARD = {}; for (let i = 0; i < CARDS.length; i++) CARD[CARDS[i].id] = CARDS[i];
export const cardById = (id) => CARD[id];

// ---------- RNG: Mulberry32, written algorithm, uint32 state ----------
export function m32(st) { let t = (st + 0x6D2B79F5) | 0; const ns = t; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return [((t ^ (t >>> 14)) >>> 0), ns]; }
export function deriveSeed(base, k) { return m32((base + Math.imul(k, 0x9E3779B9)) | 0)[0]; }
function rnd(s, n) { const [v, ns] = m32(s.rng); s.rng = ns; return v % n; } // n>0
function shuffle(arr, seed) { let st = seed | 0; for (let i = arr.length - 1; i > 0; i--) { const r = m32(st); st = r[1]; const j = r[0] % (i + 1); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
export function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); }

// ---------- deck validation ----------
export function validateDeck(house, ids) {
  if (ids.length !== 20) return 'deck must be 20 cards';
  const cnt = {}; for (const id of ids) { const c = CARD[id]; if (!c || c.token || c.champion) return 'bad card ' + id; if (c.house !== house && c.house !== 'neutral') return 'off-House card ' + id; cnt[id] = (cnt[id] || 0) + 1; if (cnt[id] > (c.rarity === 'legendary' ? 1 : 2)) return 'too many ' + id; }
  return null;
}

// ---------- setup ----------
export const DEFAULT_RULES = { secondVerse: 0, holdAtEnd: false, winVerses: 8, secondInkTurns: 1, holdMode: 'alone', conquerVerses: 2, spineMode: 'conquer' };
export function newMatch({ houseA, deckA, houseB, deckB, seed, aiVersion = 'pilot-1.0.0', rules = {} }) {
  const R = { ...DEFAULT_RULES, ...rules };
  for (const [h, d] of [[houseA, deckA], [houseB, deckB]]) { const e = validateDeck(h, d); if (e) throw new Error(e); }
  seed = seed >>> 0;
  const first = deriveSeed(seed, 4) & 1;
  const pageIdx = [0, 1, 2, 3, 4, 5]; shuffle(pageIdx, deriveSeed(seed, 3));
  const s = { v: ENGINE_VERSION, ai: aiVersion, seed, rng: deriveSeed(seed, 5) | 0, first, active: first, phase: 'mulligan', mull: first,
    pages: [PAGES[pageIdx[0]].id, PAGES[pageIdx[1]].id], board: [[[], []], [[], []]], traps: [], nextUid: 1,
    R, players: [], enemiesAtStart: [false, false], winner: -1, reason: '', res: 0, capHit: false, log: [], step: 0 };
  const houses = [houseA, houseB], decks = [deckA, deckB];
  for (let p = 0; p < 2; p++) {
    const dk = shuffle(decks[p].slice(), deriveSeed(seed, 1 + p)).map((id) => ({ uid: s.nextUid++, id }));
    const n = p === first ? 4 : 5;
    const hand = dk.splice(0, n);
    if (p !== first) hand.push({ uid: s.nextUid++, id: 'spare_ink' });
    s.players.push({ house: houses[p], legend: LEGENDS[houses[p]].id, deck: dk, hand, champion: LEGENDS[houses[p]].champion, maxInk: 0, ink: 0, verses: p !== first ? R.secondVerse : 0, legendUsed: false, turns: 0, mulled: false });
  }
  s.log.push({ e: 'setup', first, pages: s.pages.slice() });
  return s;
}

// ---------- helpers ----------
export const other = (p) => 1 - p;
function cap(s, page) { return s.pages[page] === 'torn_margin' ? 2 : PAGE_CAP; }
function findUnit(s, uid) { for (let pg = 0; pg < 2; pg++) for (let sd = 0; sd < 2; sd++) { const a = s.board[pg][sd]; for (let i = 0; i < a.length; i++) if (a[i].uid === uid) return { u: a[i], page: pg, side: sd, slot: i }; } return null; }
function allUnits(s, side) { const out = []; for (let pg = 0; pg < 2; pg++) { const a = s.board[pg][side]; for (let i = 0; i < a.length; i++) out.push(a[i]); } return out; }
function has(u, kw) { return !u.silenced && u.kw.indexOf(kw) >= 0; }
function targetable(u) { return !(has(u, 'hidden') && u.hiddenOn); }
function log(s, e) { s.log.push(e); }
function addVerse(s, p, n, why) { if (s.winner >= 0) return; s.players[p].verses += n; log(s, { e: 'verse', p, n, why, total: s.players[p].verses }); if (s.players[p].verses >= s.R.winVerses) { s.winner = p; s.reason = 'verses'; s.phase = 'over'; log(s, { e: 'end', winner: p, reason: 'verses' }); } }
function mkUnit(s, id, owner, page) { const c = CARD[id]; return { uid: s.nextUid++, id, owner, page, atk: c.atk, hp: c.hp, maxHp: c.hp, kw: c.kw.slice(), kindle: c.kindle || 0, ward: c.kw.indexOf('ward') >= 0, hiddenOn: c.kw.indexOf('hidden') >= 0, exhausted: true, attacked: false, moved: false, silenced: false, tempAtk: 0, tempRip: false }; }

// ---------- damage / heal / death ----------
function damage(s, u, n, src, hurtQ) {
  if (n <= 0 || u.hp <= 0) return 0;
  if (u.ward && !u.silenced) { u.ward = false; log(s, { e: 'ward', uid: u.uid, src }); return 0; }
  u.hp -= n; log(s, { e: 'dmg', uid: u.uid, n, src, hp: u.hp });
  if (u.hp > 0 && hurtQ) hurtQ.push(u.uid);
  return n;
}
function heal(s, u, n) { if (u.hp <= 0) return; const h = Math.min(n, u.maxHp - u.hp); if (h > 0) { u.hp += h; log(s, { e: 'heal', uid: u.uid, n: h }); } }
// Resolve hurt triggers (survivors), then deaths, repeatedly. Order: page 0 then 1; active side then other; slot order.
function settle(s, hurtQ, depth = 0) {
  for (let guard = 0; guard < 32; guard++) {
    const hq = hurtQ.splice(0, hurtQ.length);
    for (const uid of hq) { const f = findUnit(s, uid); if (f && f.u.hp > 0) fireAbilities(s, f.u, 'hurt', { page: f.page }, depth + 1); }
    const dead = [];
    for (let pg = 0; pg < 2; pg++) for (const sd of [s.active, other(s.active)]) { const a = s.board[pg][sd]; for (let i = 0; i < a.length; i++) if (a[i].hp <= 0) dead.push({ u: a[i], page: pg, side: sd }); }
    if (dead.length === 0 && hurtQ.length === 0) return;
    for (const d of dead) { const a = s.board[d.page][d.side]; a.splice(a.indexOf(d.u), 1); log(s, { e: 'death', uid: d.u.uid, id: d.u.id, page: d.page }); }
    for (const d of dead) fireAbilities(s, d.u, 'death', { page: d.page, dead: true, hurtQ }, depth + 1);
    if (s.winner >= 0) return;
  }
}
function tick(s, what) { s.res++; if (s.res > TRIGGER_CAP) { if (!s.capHit) { s.capHit = true; log(s, { e: 'trigger_cap', what }); } return false; } return true; }
function fireAbilities(s, u, t, ctx, depth) {
  if (u.silenced) return; const c = CARD[u.id];
  for (const ab of c.abilities) if (ab.t === t) {
    if (depth > DEPTH_CAP || !tick(s, u.id + ':' + t)) { log(s, { e: 'trigger_cap', uid: u.uid }); s.capHit = true; return; }
    log(s, { e: 'trigger', uid: u.uid, id: u.id, t });
    const hq = ctx.hurtQ || [];
    runFx(s, ab.fx, { owner: u.owner, self: u, page: ctx.page, target: ctx.target, trigger: ctx.trigger, hurtQ: hq }, depth);
    if (!ctx.hurtQ) settle(s, hq, depth);
  }
}

// ---------- selectors ----------
function sel(s, to, x) {
  const me = x.owner, op = other(me), pg = x.page;
  const f = (uid) => { const r = uid == null ? null : findUnit(s, uid); return r ? [r.u] : []; };
  switch (to) {
    case 'self': return x.self && x.self.hp > 0 && findUnit(s, x.self.uid) ? [x.self] : [];
    case 'target': return f(x.target);
    case 'target2': return f(x.target2);
    case 'trigger': return f(x.trigger);
    case 'defender': return f(x.defender);
    case 'allies_page': return s.board[pg][me].slice();
    case 'enemies_page': return s.board[pg][op].slice();
    case 'other_allies_here': return s.board[pg][me].filter((u) => !x.self || u.uid !== x.self.uid);
    case 'all_other_here': return [...s.board[pg][s.active], ...s.board[pg][other(s.active)]].filter((u) => !x.self || u.uid !== x.self.uid);
    case 'other_allies': return allUnits(s, me).filter((u) => !x.self || u.uid !== x.self.uid);
    case 'allies_target_page': { const r = x.target == null ? null : findUnit(s, x.target); const p2 = r ? r.page : x.tpage; return p2 == null ? [] : s.board[p2][me].slice(); }
    case 'random_enemy_here': { const c = s.board[pg][op].filter(targetable); return c.length ? [c[rnd(s, c.length)]] : []; }
    case 'random_ally': { const c = allUnits(s, me).filter((u) => u.hp > 0 && (!x.self || u.uid !== x.self.uid)); return c.length ? [c[rnd(s, c.length)]] : []; }
  }
  throw new Error('selector ' + to);
}
function runFx(s, fx, x, depth) {
  for (const e of fx) {
    if (s.winner >= 0) return;
    if (e.op === 'draw') { for (let i = 0; i < e.n; i++) draw(s, x.owner); continue; }
    if (e.op === 'ink') { s.players[x.owner].ink += e.n; log(s, { e: 'ink', p: x.owner, n: e.n }); continue; }
    if (e.op === 'verse') { if (e.cond === 'no_enemies_here' && s.board[x.page][other(x.owner)].length > 0) continue; addVerse(s, x.owner, e.n, 'ability'); continue; }
    const ts = sel(s, e.to, x);
    for (const u of ts) {
      switch (e.op) {
        case 'dmg': if (e.pierce && u.ward) { u.ward = false; log(s, { e: 'unward', uid: u.uid }); } damage(s, u, e.nMoved && u.moved ? e.nMoved : e.n, x.self ? x.self.uid : 'fx', x.hurtQ); break;
        case 'unward': if (u.ward) { u.ward = false; log(s, { e: 'unward', uid: u.uid }); } break;
        case 'heal': heal(s, u, e.n); break;
        case 'buff': u.atk += e.a; u.hp += e.h; u.maxHp += e.h; log(s, { e: 'buff', uid: u.uid, a: e.a, h: e.h }); break;
        case 'tempAtk': u.atk += e.a; u.tempAtk += e.a; log(s, { e: 'buff', uid: u.uid, a: e.a, h: 0, temp: true }); break;
        case 'tempRiposte': u.tempRip = true; log(s, { e: 'grant', uid: u.uid, kw: 'riposte', temp: true }); break;
        case 'grant': if (u.silenced) { log(s, { e: 'grant_blocked', uid: u.uid }); break; } if (e.kw === 'ward') u.ward = true; if (u.kw.indexOf(e.kw) < 0) u.kw.push(e.kw); log(s, { e: 'grant', uid: u.uid, kw: e.kw }); break;
        case 'silence': u.silenced = true; u.ward = false; u.tempRip = false; u.hiddenOn = false; u.kindle = 0; u.kw = []; log(s, { e: 'silence', uid: u.uid }); break;
        case 'exhaust': u.exhausted = true; break;
        case 'ready': u.exhausted = false; u.attacked = false; break;
        case 'move': moveUnit(s, u, { free: !!e.free, byEffect: true, hurtQ: x.hurtQ }, depth); break;
        default: throw new Error('op ' + e.op);
      }
    }
  }
}

// ---------- zones ----------
function draw(s, p) {
  const pl = s.players[p]; if (pl.deck.length === 0) { log(s, { e: 'draw_empty', p }); return; }
  const c = pl.deck.shift(); if (pl.hand.length >= HAND_CAP) { log(s, { e: 'burn', p, id: c.id }); return; }
  pl.hand.push(c); log(s, { e: 'draw', p, uid: c.uid });
}
function fireTraps(s, page, trapOwner, on, x, depth) {
  if (s.active === trapOwner) return; // Marginalia only fire on the rival's turn (brief)
  for (let i = 0; i < s.traps.length; i++) {
    const t = s.traps[i];
    if (t.page !== page || t.owner !== trapOwner || CARD[t.id].trap.on !== on) continue;
    s.traps.splice(i, 1); i--;
    log(s, { e: 'trap_reveal', uid: t.uid, id: t.id, owner: trapOwner, page });
    if (!tick(s, 'trap')) return;
    runFx(s, CARD[t.id].trap.fx, { owner: trapOwner, self: null, page, trigger: x.trigger, defender: x.defender, hurtQ: x.hurtQ }, depth + 1);
    return; // at most one trap fires per event per side (one trap per Page per side anyway)
  }
}
function moveUnit(s, u, o, depth = 0) {
  const f = findUnit(s, u.uid); if (!f) return false;
  const to = 1 - f.page; if (s.board[to][f.side].length >= cap(s, to)) { log(s, { e: 'move_blocked', uid: u.uid }); return false; }
  s.board[f.page][f.side].splice(f.slot, 1); s.board[to][f.side].push(u); u.page = to;
  log(s, { e: 'move', uid: u.uid, to });
  if (!o.byEffect && !o.free && !has(u, 'board')) u.exhausted = true;
  if (s.pages[to] === 'port_foxing') { u.atk += 1; log(s, { e: 'buff', uid: u.uid, a: 1, h: 0, why: 'port_foxing' }); }
  const hq = o.hurtQ || [];
  fireAbilities(s, u, 'move', { page: to, hurtQ: hq }, depth + 1);
  fireTraps(s, to, other(f.side), 'enemy_move', { trigger: u.uid, hurtQ: hq }, depth);
  if (!o.hurtQ) settle(s, hq, depth);
  return true;
}

// ---------- turn structure ----------
function startTurn(s, p) {
  const pl = s.players[p]; s.active = p; s.phase = 'main'; s.res = 0;
  pl.turns++; pl.maxInk = Math.min(MAX_INK, pl.turns + (p !== s.first && pl.turns <= s.R.secondInkTurns ? 1 : 0)); pl.ink = pl.maxInk; pl.legendUsed = false;
  log(s, { e: 'turn', p, n: pl.turns, ink: pl.ink });
  for (const u of allUnits(s, p)) { u.exhausted = false; u.attacked = false; u.moved = false; u.tempRip = false; }
  if (!s.R.holdAtEnd) { scoreHolds(s, p); if (s.winner >= 0) return; }
  draw(s, p);
  for (let pg = 0; pg < 2; pg++) s.enemiesAtStart[pg] = s.board[pg][other(p)].length > 0;
}
export function holdValue(s, p, pg) {
  const m = s.board[pg][p], o = s.board[pg][other(p)]; if (!m.length) return 0;
  let v = 0;
  if (s.R.holdMode === 'alone') v = o.length ? 0 : 1;
  else if (s.R.holdMode === 'attack1') { if (!o.length) v = 1; else { let am = 0, ao = 0; for (const u of m) am += Math.max(0, u.atk); for (const u of o) ao += Math.max(0, u.atk); v = am > ao ? 1 : 0; } }
  else { if (!o.length) v = 2; else { let am = 0, ao = 0; for (const u of m) am += Math.max(0, u.atk); for (const u of o) ao += Math.max(0, u.atk); v = am > ao ? 1 : 0; } }
  if (v > 0 && s.pages[pg] === 'spine' && s.R.spineMode === 'hold') v += 1;
  return v;
}
function scoreHolds(s, p) { for (let pg = 0; pg < 2; pg++) { const v = holdValue(s, p, pg); if (v > 0) { addVerse(s, p, v, 'hold'); if (s.winner >= 0) return; } } }
function endTurn(s) {
  const p = s.active; s.res = 0;
  for (let pg = 0; pg < 2; pg++) if (s.enemiesAtStart[pg] && s.board[pg][other(p)].length === 0 && s.board[pg][p].length > 0) { addVerse(s, p, s.R.conquerVerses + (s.pages[pg] === 'spine' && s.R.spineMode === 'conquer' ? 1 : 0), 'conquer'); if (s.winner >= 0) return; }
  if (s.R.holdAtEnd) { scoreHolds(s, p); if (s.winner >= 0) return; }
  for (let pg = 0; pg < 2; pg++) for (const u of s.board[pg][p].slice()) if (!u.silenced && u.kindle > 0) {
    let best = null; for (const a of s.board[pg][p]) if (a.maxHp - a.hp > 0 && (!best || a.maxHp - a.hp > best.maxHp - best.hp)) best = a;
    if (best) { log(s, { e: 'kindle', uid: u.uid }); heal(s, best, u.kindle); }
  }
  for (let pg = 0; pg < 2; pg++) if (s.pages[pg] === 'lanternfall') for (const sd of [p, other(p)]) for (const u of s.board[pg][sd]) heal(s, u, 1);
  for (const u of allUnits(s, p)) if (u.tempAtk) { u.atk -= u.tempAtk; u.tempAtk = 0; }
  log(s, { e: 'end_turn', p });
  if (s.players[0].turns >= MAX_TURNS && s.players[1].turns >= MAX_TURNS) return finalize(s);
  startTurn(s, other(p));
}
function boardHp(s, p) { let t = 0; for (const u of allUnits(s, p)) t += u.hp; return t; }
function finalize(s) {
  const a = s.players[0].verses, b = s.players[1].verses; let w, why;
  if (a !== b) { w = a > b ? 0 : 1; why = 'verses_after_7'; }
  else { const ha = boardHp(s, 0), hb = boardHp(s, 1); if (ha !== hb) { w = ha > hb ? 0 : 1; why = 'board_health'; } else { w = deriveSeed(s.seed, 999) & 1; why = 'seed'; } }
  s.winner = w; s.reason = why; s.phase = 'over'; log(s, { e: 'end', winner: w, reason: why });
}

// ---------- action API ----------
function targetsFor(s, p, kind, page) {
  const op = other(p); const out = [];
  if (kind === 'ally') for (const u of allUnits(s, p)) out.push(u.uid);
  if (kind === 'ally_here') for (const u of s.board[page][p]) out.push(u.uid);
  if (kind === 'enemy') for (const u of allUnits(s, op)) if (targetable(u)) out.push(u.uid);
  if (kind === 'enemy_here') for (const u of s.board[page][op]) if (targetable(u)) out.push(u.uid);
  return out;
}
export function legalActions(s) {
  const A = []; if (s.phase === 'over') return A;
  if (s.phase === 'mulligan') {
    const pl = s.players[s.mull]; const idx = []; for (let i = 0; i < pl.hand.length; i++) if (pl.hand[i].id !== 'spare_ink') idx.push(i);
    for (let m = 0; m < (1 << idx.length); m++) { const pick = []; for (let b = 0; b < idx.length; b++) if (m & (1 << b)) pick.push(idx[b]); A.push({ type: 'mulligan', idx: pick }); }
    return A;
  }
  const p = s.active, pl = s.players[p];
  if (s.phase === 'main') {
    const seen = [];
    const cards = pl.hand.map((h) => ({ uid: h.uid, id: h.id, champ: false }));
    if (pl.champion) cards.push({ uid: 0, id: pl.champion, champ: true });
    for (const h of cards) {
      const c = CARD[h.id]; if (c.cost > pl.ink) continue; if (seen.indexOf(h.id) >= 0) continue; seen.push(h.id); // identical cards: one representative
      const base = h.champ ? { type: 'champion' } : { type: 'play', uid: h.uid };
      if (c.type === 'character') for (let pg = 0; pg < 2; pg++) { if (s.board[pg][p].length >= cap(s, pg)) continue; const ok = s.pages[pg] !== 'moot_rings'; const ts = c.target && ok ? targetsFor(s, p, c.target, pg) : []; if (ts.length) for (const t of ts) A.push({ ...base, page: pg, target: t }); else A.push({ ...base, page: pg }); }
      else if (c.type === 'marginalia') { for (let pg = 0; pg < 2; pg++) if (!s.traps.some((t) => t.owner === p && t.page === pg)) A.push({ ...base, page: pg }); }
      else if (c.target === 'page') { for (let pg = 0; pg < 2; pg++) A.push({ ...base, page: pg }); }
      else if (c.target) { for (const t of targetsFor(s, p, c.target, 0)) A.push({ ...base, target: t }); }
      else A.push(base);
    }
    if (!pl.legendUsed && pl.ink >= LEGEND_COST) {
      const L = LEGENDS[pl.house];
      if (L.target === 'ally') for (const u of allUnits(s, p)) A.push({ type: 'legend', target: u.uid });
      if (L.target === 'ally_then_enemy_other') for (const u of allUnits(s, p)) { const to = 1 - u.page; if (s.board[to][p].length >= cap(s, to)) continue; const es = s.board[to][other(p)].filter(targetable); if (es.length) for (const e of es) A.push({ type: 'legend', target: u.uid, target2: e.uid }); else A.push({ type: 'legend', target: u.uid }); }
    }
    A.push({ type: 'fight' });
  }
  if (s.phase === 'main' || s.phase === 'fight') {
    for (let pg = 0; pg < 2; pg++) for (const u of s.board[pg][p]) {
      if (u.exhausted || u.attacked) continue;
      const foes = s.board[pg][other(p)].filter(targetable); const bound = foes.filter((e) => has(e, 'bound'));
      for (const e of (bound.length ? bound : foes)) A.push({ type: 'attack', uid: u.uid, target: e.uid });
      if (!u.moved && s.board[1 - pg][p].length < cap(s, 1 - pg)) A.push({ type: 'move', uid: u.uid });
    }
  }
  A.push({ type: 'end' });
  return A;
}
const sameAct = (a, b) => a.type === b.type && a.uid === b.uid && a.page === b.page && a.target === b.target && a.target2 === b.target2 && (a.type !== 'mulligan' || a.idx.join() === b.idx.join());
export function isLegal(s, a) {
  if (a.type === 'play' && s.phase === 'main') { const h = s.players[s.active].hand.find((x) => x.uid === a.uid); if (!h) return false; const rep = legalActions(s).find((b) => b.type === 'play' && s.players[s.active].hand.find((x) => x.uid === b.uid).id === h.id && b.page === a.page && b.target === a.target); return !!rep; }
  return legalActions(s).some((b) => sameAct(a, b));
}
export function clone(s) { return structuredClone(s); }
export function apply(s, a) { const n = clone(s); applyMut(n, a); return n; }
export function applyMut(s, a, check = true) {
  if (check && !isLegal(s, a)) throw new Error('illegal action ' + JSON.stringify(a) + ' phase ' + s.phase);
  s.step++; s.res = 0; log(s, { e: 'act', p: s.phase === 'mulligan' ? s.mull : s.active, a });
  const p = s.active, pl = s.players[p];
  switch (a.type) {
    case 'mulligan': {
      const m = s.players[s.mull]; const back = a.idx.map((i) => m.hand[i]); m.hand = m.hand.filter((h) => back.indexOf(h) < 0);
      const n = back.length; m.deck.push(...back); for (let i = 0; i < n; i++) m.hand.push(m.deck.shift()); // replaced cards go to the bottom in hand order
      m.hand.sort((x, y) => (x.id === 'spare_ink') - (y.id === 'spare_ink'));
      m.mulled = true; log(s, { e: 'mulligan', p: s.mull, n });
      if (s.mull === s.first) s.mull = other(s.first); else startTurn(s, s.first);
      return s;
    }
    case 'fight': s.phase = 'fight'; return s;
    case 'end': endTurn(s); return s;
    case 'play': case 'champion': {
      let id; if (a.type === 'champion') { id = pl.champion; pl.champion = null; } else { const i = pl.hand.findIndex((h) => h.uid === a.uid); id = pl.hand[i].id; pl.hand.splice(i, 1); }
      const c = CARD[id]; pl.ink -= c.cost; log(s, { e: 'play', p, id, page: a.page, target: a.target });
      const hq = [];
      if (c.type === 'character') {
        const u = mkUnit(s, id, p, a.page); if (has(u, 'swift')) u.exhausted = false;
        if (s.pages[a.page] === 'fort_crease') { u.atk += 1; }
        s.board[a.page][p].push(u); log(s, { e: 'enter', uid: u.uid, id, page: a.page });
        if (s.pages[a.page] !== 'moot_rings') fireAbilities(s, u, 'play', { page: a.page, target: a.target, hurtQ: hq }, 0);
        settle(s, hq);
      } else if (c.type === 'marginalia') { s.traps.push({ uid: s.nextUid++, id, owner: p, page: a.page }); log(s, { e: 'trap_set', p, page: a.page }); }
      else { for (const ab of c.abilities) runFx(s, ab.fx, { owner: p, self: null, page: a.page, tpage: a.page, target: a.target, hurtQ: hq }, 0); settle(s, hq); }
      return s;
    }
    case 'legend': {
      pl.ink -= LEGEND_COST; pl.legendUsed = true; const L = LEGENDS[pl.house]; log(s, { e: 'legend', p, id: L.id, target: a.target, target2: a.target2 });
      const f = findUnit(s, a.target); const hq = [];
      runFx(s, L.power, { owner: p, self: f ? f.u : null, page: f ? f.page : 0, target: a.target, target2: a.target2, hurtQ: hq }, 0); settle(s, hq);
      return s;
    }
    case 'move': { if (s.phase === 'main') s.phase = 'fight'; const f = findUnit(s, a.uid); f.u.moved = true; moveUnit(s, f.u, {}); return s; }
    case 'attack': {
      if (s.phase === 'main') s.phase = 'fight';
      const A_ = findUnit(s, a.uid).u, D = findUnit(s, a.target).u; const page = A_.page;
      A_.attacked = true; A_.exhausted = true; A_.hiddenOn = false;
      log(s, { e: 'attack', uid: A_.uid, target: D.uid, page });
      const hq = [];
      fireTraps(s, page, other(p), 'enemy_attack', { trigger: A_.uid, defender: D.uid, hurtQ: hq }, 0);
      settle(s, hq);
      if (s.winner >= 0) return s;
      const fa = findUnit(s, A_.uid), fd = findUnit(s, D.uid);
      if (!fa || !fd || fa.page !== fd.page) { log(s, { e: 'attack_fizzle', uid: A_.uid }); return s; }
      const rip = (has(D, 'riposte') || D.tempRip) && !D.silenced;
      if (rip) { log(s, { e: 'riposte', uid: D.uid }); damage(s, A_, D.atk, D.uid, hq); if (A_.hp <= 0) { settle(s, hq); return s; } damage(s, D, A_.atk, A_.uid, hq); }
      else { damage(s, D, A_.atk, A_.uid, hq); damage(s, A_, D.atk, D.uid, hq); }
      if (has(A_, 'cleave')) { const arr = s.board[page][other(p)]; const i = arr.indexOf(D); for (const j of [i - 1, i + 1]) if (j >= 0 && j < arr.length) damage(s, arr[j], A_.atk, A_.uid, hq); }
      settle(s, hq);
      return s;
    }
  }
  throw new Error('unknown action');
}

// ---------- replay & views ----------
export function replay(setup, actions) { const s = newMatch(setup); for (const a of actions) applyMut(s, a); return s; }
export function stateHash(s) { return fnv(JSON.stringify(s)); }
// What the client may see: no seed, no rng, no deck order, no rival hand, no rival trap identity.
export function clientView(s, p) {
  const op = other(p);
  return { v: s.v, phase: s.phase, active: s.active, first: s.first, pages: s.pages.slice(), board: s.board, winner: s.winner, reason: s.reason,
    me: { ...s.players[p], deck: undefined, deckCount: s.players[p].deck.length },
    rival: { house: s.players[op].house, legend: s.players[op].legend, verses: s.players[op].verses, maxInk: s.players[op].maxInk, handCount: s.players[op].hand.length, deckCount: s.players[op].deck.length, championAvailable: !!s.players[op].champion, legendUsed: s.players[op].legendUsed },
    traps: s.traps.map((t) => (t.owner === p ? t : { owner: t.owner, page: t.page, faceDown: true })) };
}

// Redacted event log for player p: rival draws lose their uid, rival Marginalia plays lose their identity
// until revealed, rival mulligan picks are hidden. The server keeps the full log for replay/audit.
export function clientLog(s, p) {
  const out = [];
  for (const e of s.log) {
    if (e.e === 'draw' && e.p !== p) { out.push({ e: 'draw', p: e.p }); continue; }
    if (e.e === 'mulligan') { out.push(e); continue; }
    if (e.e === 'act' && e.p !== p) { if (e.a.type === 'mulligan') { out.push({ e: 'act', p: e.p, a: { type: 'mulligan', n: e.a.idx.length } }); continue; } if (e.a.type === 'play' && e.a.page !== undefined && e.a.target === undefined) { const nxt = s.log[s.log.indexOf(e) + 1]; if (nxt && nxt.e === 'play' && cardById(nxt.id).type === 'marginalia') { out.push({ e: 'act', p: e.p, a: { type: 'set_marginalia', page: e.a.page } }); continue; } } }
    if (e.e === 'play' && e.p !== p && cardById(e.id).type === 'marginalia') { out.push({ e: 'play', p: e.p, type: 'marginalia', page: e.page }); continue; }
    if (e.e === 'setup') { out.push({ e: 'setup', first: e.first, pages: e.pages }); continue; }
    out.push(e);
  }
  return out;
}
