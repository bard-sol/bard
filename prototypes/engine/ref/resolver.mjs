// Bard S0 fight resolver — JS port of resolver.py, used to prove cross-language determinism.
// The builder may lift this into the PixiJS client/server. Integer-only; no Math.random; no floats.
export const MAX_LINE = 5, MAX_DEPTH = 8, MAX_RES_PER_STEP = 64, TURN_CAP = 80;

export class Mulberry32 {
  constructor(seed) { this.a = seed >>> 0; this.draws = 0; }
  next() {
    this.a = (this.a + 0x6D2B79F5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    this.draws++;
    return (t ^ (t >>> 14)) >>> 0;
  }
  below(n) { return this.next() % n; }
}
export function deriveSeed(base, k) { return new Mulberry32((base + Math.imul(k, 0x9E3779B9)) >>> 0).next(); }

function makeUnit(defs, tokens, side, n, spec, tokenId) {
  const u = { uid: `${side}${n}`, side, ward: false, silenced: false, acted: false, alive: true, extra: 0, uses: 0, stitches: 0 };
  if (tokenId != null) {
    const t = tokens[tokenId];
    if (t.as_unit) { const d = defs[t.as_unit]; Object.assign(u, { id: d.id, copies: 1, ability: d.ability, tier: d.tier, isToken: false, atk: t.attack, hp: t.health }); }
    else Object.assign(u, { id: tokenId, copies: 1, ability: null, tier: 0, isToken: true, atk: t.attack, hp: t.health });
  } else {
    const d = defs[spec.id], c = spec.copies ?? 1;
    Object.assign(u, { id: d.id, copies: c, tier: d.tier, isToken: false });
    if (c >= 3) Object.assign(u, { atk: d.merged.attack, hp: d.merged.health, ability: d.merged.ability });
    else Object.assign(u, { atk: d.attack + (c - 1), hp: d.health + (c - 1), ability: d.ability });
    if ('attack' in spec) u.atk = spec.attack;
    if ('health' in spec) u.hp = spec.health;
  }
  u.maxhp = u.hp; u.baseAtk = u.atk; u.baseHp = u.hp;
  return u;
}

class Fight {
  constructor(lineA, lineB, seed, units) {
    this.defs = Object.fromEntries(units.units.map(d => [d.id, d])); this.tokens = units.tokens;
    this.rng = new Mulberry32(seed); this.log = []; this.counter = { A: 0, B: 0 }; this.lines = { A: [], B: [] };
    for (const [side, line] of [['A', lineA], ['B', lineB]]) for (const spec of line.slice(0, MAX_LINE)) this.lines[side].push(this.nu(side, spec));
    this.queue = []; this.attacks = 0; this.triggers = 0; this.res = 0; this.first = null;
  }
  nu(side, spec, tokenId = null) { const u = makeUnit(this.defs, this.tokens, side, this.counter[side], spec, tokenId); this.counter[side]++; return u; }
  ev(t, kw = {}) { this.log.push({ i: this.log.length, t, ...kw }); }
  other(s) { return s === 'A' ? 'B' : 'A'; }
  idx(u) { return this.lines[u.side].indexOf(u); }
  select(sel, src, ctx) {
    const mine = this.lines[src.side], theirs = this.lines[this.other(src.side)];
    switch (sel) {
      case 'self': return src.alive ? [src] : [];
      case 'front_ally': return mine.slice(0, 1);
      case 'front_two_allies': return mine.slice(0, 2);
      case 'all_allies': return [...mine];
      case 'other_allies': return mine.filter(u => u !== src);
      case 'ally_behind': { if (!src.alive) return []; const i = this.idx(src); return mine.slice(i + 1, i + 2); }
      case 'random_other_ally': { const c = mine.filter(u => u !== src); if (!c.length) return []; const r = this.rng.below(c.length); this.ev('rng', { purpose: 'random_other_ally', n: c.length, pick: r }); return [c[r]]; }
      case 'enemy_front': return theirs.slice(0, 1);
      case 'enemy_back': return theirs.slice(-1);
      case 'all_enemies': return [...theirs];
      case 'enemy_behind_target': case 'two_behind_target': {
        const k = sel === 'enemy_behind_target' ? 1 : 2, tgt = ctx.target;
        const s = (tgt && tgt.alive && theirs.includes(tgt)) ? theirs.indexOf(tgt) + 1 : (ctx.target_slot ?? 0);
        return theirs.slice(s, s + k);
      }
      case 'target': return ctx.target && ctx.target.alive ? [ctx.target] : [];
      case 'enemy_two_highest_tier': {
        const order = theirs.map((u, i) => i).sort((a, b) => (theirs[b].tier - theirs[a].tier) || (a - b));
        return order.slice(0, 2).sort((a, b) => a - b).map(i => theirs[i]);
      }
    }
    throw new Error(sel);
  }
  damage(tgt, n, src, hurt) {
    if (n <= 0 || !tgt.alive) return;
    if (tgt.ward) { tgt.ward = false; this.ev('ward_break', { src: src.uid, tgt: tgt.uid }); return; }
    tgt.hp -= n; this.ev('damage', { src: src.uid, tgt: tgt.uid, n, hp: tgt.hp }); hurt.push(tgt);
  }
  summon(side, tokenId, count, at, src) {
    for (let k = 0; k < count; k++) {
      const line = this.lines[side];
      if (line.length >= MAX_LINE) { this.ev('summon_fizzle', { src: src.uid, token: tokenId }); continue; }
      const u = this.nu(side, null, tokenId), pos = Math.min(at + k, line.length);
      line.splice(pos, 0, u); this.ev('summon', { src: src.uid, uid: u.uid, id: u.id, slot: pos, atk: u.atk, hp: u.hp });
    }
  }
  doAttack(att, depth, extra) {
    const enemy = this.lines[this.other(att.side)];
    if (!enemy.length || !att.alive) return;
    const tgt = enemy[0]; this.attacks++;
    this.ev('attack', { src: att.uid, tgt: tgt.uid, n: att.atk, extra });
    const hurt = []; this.damage(tgt, att.atk, att, hurt);
    if (att.ability && att.ability.trigger === 'on_attack') this.enqueue(att, 'on_attack', depth + 1, { target: tgt, target_slot: 0 });
    this.afterEffect(hurt, depth);
  }
  enqueue(src, trig, depth, ctx) { if (depth > MAX_DEPTH) { this.ev('chain_cap', { src: src.uid, trig }); return; } this.queue.push([src, trig, depth, ctx]); }
  afterEffect(hurt, depth) {
    for (const u of hurt) if (u.alive && u.hp > 0 && u.ability && u.ability.trigger === 'on_hurt') this.enqueue(u, 'on_hurt', depth + 1, {});
    this.deathSweep(depth);
  }
  deathSweep(depth) {
    const order = [this.first, this.other(this.first)], dead = [];
    for (const side of order) { let pos = 0; for (const u of this.lines[side]) { if (u.hp <= 0) dead.push([u, pos]); else pos++; } }
    if (!dead.length) return;
    for (const [u] of dead) u.alive = false;
    for (const side of order) this.lines[side] = this.lines[side].filter(u => u.alive);
    for (const [u, slot] of dead) {
      this.ev('death', { uid: u.uid, slot });
      if (u.ability && u.ability.trigger === 'on_death' && !u.silenced) this.enqueue(u, 'on_death', depth + 1, { slot });
      for (const a of this.lines[u.side]) if (a.ability && a.ability.trigger === 'on_ally_death') this.enqueue(a, 'on_ally_death', depth + 1, { dead: u, slot });
    }
  }
  runQueue() {
    while (this.queue.length) {
      const [src, trig, depth, ctx] = this.queue.shift();
      if (this.res >= MAX_RES_PER_STEP) { this.ev('step_cap', { src: src.uid, trig }); continue; }
      if (trig !== 'on_death' && (!src.alive || src.silenced)) { this.ev('fizzle', { src: src.uid, trig }); continue; }
      const ab = src.ability, lim = ab.limit_per_fight;
      if (lim != null && src.uses >= lim) continue;
      this.res++; this.resolveAbility(src, ab, trig, depth, ctx, false);
    }
  }
  resolveAbility(src, ab, trig, depth, ctx, relayed) {
    const ops = ab.ops;
    if (ops.length === 1 && ops[0].op === 'attack_again') {
      const op = ops[0];
      if (op.cond === 'target_died' && !(ctx.target && !ctx.target.alive)) return;
      if (src.extra >= op.per_turn || !this.lines[this.other(src.side)].length) return;
    }
    src.uses++; this.triggers++;
    this.ev('trigger', { src: src.uid, trig, relayed });
    const hurt = [];
    for (const op of ops) {
      switch (op.op) {
        case 'damage': { const n = op.n === 'self_atk' ? src.atk : op.n; for (const t of this.select(op.target, src, ctx)) this.damage(t, n, src, hurt); break; }
        case 'heal': for (const t of this.select(op.target, src, ctx)) { const nw = Math.min(t.maxhp, t.hp + op.n); this.ev('heal', { src: src.uid, tgt: t.uid, n: nw - t.hp, hp: nw }); t.hp = nw; } break;
        case 'buff': for (const t of this.select(op.target, src, ctx)) { t.atk += op.atk; t.hp += op.hp; t.maxhp += op.hp; this.ev('buff', { src: src.uid, tgt: t.uid, atk: t.atk, hp: t.hp, da: op.atk, dh: op.hp }); } break;
        case 'debuff_atk': for (const t of this.select(op.target, src, ctx)) { t.atk = Math.max(0, t.atk - op.n); this.ev('debuff', { src: src.uid, tgt: t.uid, atk: t.atk }); } break;
        case 'ward': for (const t of this.select(op.target, src, ctx)) { t.ward = true; this.ev('ward', { src: src.uid, tgt: t.uid }); } break;
        case 'silence': for (const t of this.select(op.target, src, ctx)) { t.silenced = true; this.ev('silence', { src: src.uid, tgt: t.uid }); } break;
        case 'summon': {
          const at = op.at === 'self_slot' ? (!src.alive ? ctx.slot : this.idx(src)) : (src.alive ? this.idx(src) + 1 : (ctx.slot ?? 0));
          this.summon(src.side, op.token, op.count, at, src); break;
        }
        case 'swap_enemy_front_back': { const th = this.lines[this.other(src.side)]; if (th.length >= 2) { const x = th[0]; th[0] = th[th.length - 1]; th[th.length - 1] = x; this.ev('swap', { src: src.uid, a: th[0].uid, b: th[th.length - 1].uid }); } break; }
        case 'attack_again': src.extra++; this.doAttack(src, depth, true); return;
        case 'destroy_if_hp_le': for (const t of this.select(op.target, src, ctx)) if (t.hp <= op.n) { t.hp = 0; this.ev('destroy', { src: src.uid, tgt: t.uid }); } break;
        case 'devour_behind': for (const t of this.select('ally_behind', src, ctx)) {
          const ga = t.atk * op.mult, gh = t.hp * op.mult; t.hp = 0; this.ev('destroy', { src: src.uid, tgt: t.uid });
          src.atk += ga; src.hp += gh; src.maxhp += gh; this.ev('buff', { src: src.uid, tgt: src.uid, atk: src.atk, hp: src.hp, da: ga, dh: gh });
        } break;
        case 'relay_sof': for (const t of this.select('ally_behind', src, ctx)) if (t.ability && t.ability.trigger === 'start_of_fight' && !t.silenced) this.resolveAbility(t, t.ability, 'start_of_fight', depth + 1, {}, true); break;
        case 'return_dead_ally': {
          const d = ctx.dead;
          if (!d || d.isToken || src.stitches >= (op.max_per_fight ?? 1)) break;
          src.stitches++;
          const line = this.lines[src.side];
          if (line.length >= MAX_LINE) { this.ev('summon_fizzle', { src: src.uid, token: d.id }); break; }
          const u = this.nu(src.side, { id: d.id, copies: d.copies, attack: d.baseAtk, health: 1 }), pos = Math.min(ctx.slot, line.length);
          line.splice(pos, 0, u); this.ev('summon', { src: src.uid, uid: u.uid, id: u.id, slot: pos, atk: u.atk, hp: u.hp, returned: d.uid }); break;
        }
        default: throw new Error(op.op);
      }
    }
    this.afterEffect(hurt, depth);
  }
  winner() { const a = this.lines.A.length > 0, b = this.lines.B.length > 0; if (a && b) return null; if (!a && !b) return 'draw'; return a ? 'A' : 'B'; }
  snap() { const o = {}; for (const s of ['A', 'B']) o[s] = this.lines[s].map(u => ({ uid: u.uid, id: u.id, copies: u.copies, atk: u.atk, hp: u.hp })); return o; }
  run() {
    this.first = this.rng.below(2) === 0 ? 'A' : 'B';
    this.ev('start', { first: this.first, lines: this.snap() });
    const sides = [this.first, this.other(this.first)], order = [];
    for (let i = 0; i < MAX_LINE; i++) for (const s of sides) if (i < this.lines[s].length) order.push(this.lines[s][i]);
    this.res = 0;
    for (const u of order) if (u.ability && u.ability.trigger === 'start_of_fight') this.enqueue(u, 'start_of_fight', 1, {});
    this.runQueue();
    let w = this.winner(), turn = this.first, passes = 0, turns = 0;
    while (w === null && turns < TURN_CAP) {
      turns++; this.res = 0;
      const line = this.lines[turn];
      let c = line.filter(u => !u.acted && u.atk > 0);
      if (!c.length) { for (const u of line) u.acted = false; c = line.filter(u => u.atk > 0); }
      if (!c.length) { this.ev('pass', { side: turn }); passes++; if (passes >= 2) { w = 'draw'; break; } }
      else { passes = 0; const att = c[0]; att.acted = true; att.extra = 0; this.doAttack(att, 0, false); this.runQueue(); w = this.winner(); }
      turn = this.other(turn);
    }
    if (w === null) { w = 'draw'; this.ev('turn_cap'); }
    const hpA = this.lines.A.reduce((s, u) => s + u.hp, 0), hpB = this.lines.B.reduce((s, u) => s + u.hp, 0);
    this.ev('end', { winner: w, hpA, hpB, survivors: this.snap() });
    const deaths = this.log.filter(e => e.t === 'death').length;
    return { winner: w, log: this.log, stats: { hpA, hpB, deaths, attacks: this.attacks, triggers: this.triggers, turns, rng_draws: this.rng.draws,
      survivorsA: this.lines.A.map(u => u.uid), survivorsB: this.lines.B.map(u => u.uid) } };
  }
}
export function resolve(lineA, lineB, seed, units) { return new Fight(lineA, lineB, seed >>> 0, units).run(); }
