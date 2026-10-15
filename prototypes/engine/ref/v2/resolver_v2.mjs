// Bard S0 fight resolver v2 — JS port of resolver_v2.py (spec: ../../resolver-spec-v2.md).
// Integer-only, no Math.random, no floats. Must match the Python reference byte-for-byte (golden + fuzz).
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

const SINGLE_TARGET = ['enemy_back', 'enemy_second_back', 'enemy_two_back', 'attacker'];
const other = s => (s === 'A' ? 'B' : 'A');

class Fight {
  constructor(lineA, lineB, seed, units) {
    this.defs = {}; for (const d of units.units) this.defs[d.id] = d;
    this.tokens = units.tokens; this.traits = units.traits; this.rules = units.rules;
    this.MAX_LINE = this.rules.max_line; this.MAX_DEPTH = this.rules.max_depth;
    this.MAX_RES = this.rules.max_res_per_step; this.TURN_CAP = this.rules.turn_cap;
    this.rng = new Mulberry32(seed);
    this.log = []; this.counter = { A: 0, B: 0 }; this.lines = { A: [], B: [] };
    for (const [side, line] of [['A', lineA], ['B', lineB]])
      for (const spec of line.slice(0, this.MAX_LINE)) this.lines[side].push(this.newUnit(side, spec, null));
    this.queue = []; this.attacks = 0; this.triggers = 0; this.resThisStep = 0; this.first = null;
    this.frontGuard = { A: 0, B: 0 }; this.filed = { A: 0, B: 0 }; this.active = { A: [], B: [] };
  }

  newUnit(side, spec, tokenId) {
    const u = { uid: side + String(this.counter[side]), side, ward: false, silenced: false, acted: false, alive: true,
      destroyed: false, extra: 0, attacksMade: 0, houses: [] };
    this.counter[side]++;
    if (tokenId != null) {
      const t = this.tokens[tokenId];
      if (t.as_unit) {
        const d = this.defs[t.as_unit];
        Object.assign(u, { id: d.id, copies: 1, tier: d.tier, isToken: false, abilities: (d.ability && d.ability.ops.length) ? [d.ability] : [], passives: [...d.passives] });
      } else {
        Object.assign(u, { id: tokenId, copies: 1, tier: 0, isToken: true, abilities: [], passives: [...(t.passives || [])] });
      }
      u.atk = t.attack; u.hp = t.health;
    } else {
      const d = this.defs[spec.id], c = spec.copies ?? 1;
      Object.assign(u, { id: d.id, copies: c, tier: d.tier, isToken: false });
      const f = c >= 3 ? d.merged : d;
      u.atk = f.attack + (c < 3 ? c - 1 : 0); u.hp = f.health + (c < 3 ? c - 1 : 0);
      u.abilities = (f.ability && f.ability.ops.length) ? [f.ability] : []; u.passives = [...f.passives];
      if ('attack' in spec) u.atk = spec.attack;
      if ('health' in spec) u.hp = spec.health;
      u.houses = [d.house, ...(d.glue || [])];
    }
    u.maxhp = u.hp; u.baseAtk = u.atk;
    u.uses = u.abilities.map(() => 0); u.stitches = u.abilities.map(() => 0);
    u.endure = this.passiveSum(u, 'endure');
    return u;
  }
  addAbility(u, ab) { u.abilities.push(ab); u.uses.push(0); u.stitches.push(0); }
  passives(u, k) { return u.silenced ? [] : u.passives.filter(p => p.k === k); }
  passiveSum(u, k) {
    let s = 0;
    for (const p of this.passives(u, k)) {
      if (p.front_only) { const line = this.lines[u.side]; if (!line.length || line[0] !== u) continue; }
      s += p.n ?? 1;
    }
    return s;
  }
  ev(t, kw) { const e = { i: this.log.length, t, ...kw }; this.log.push(e); }
  idx(u) { return this.lines[u.side].indexOf(u); }
  sideHas(side, k) { for (const u of this.lines[side]) if (u.alive && this.passives(u, k).length) return u; return null; }
  blighted(u) { return this.sideHas(other(u.side), 'blight') !== null; }
  smotherLevel(side) { let lv = 0; for (const u of this.lines[other(side)]) for (const p of this.passives(u, 'smother')) lv = Math.max(lv, p.n); return lv; }

  applyTraits() {
    const tiers = this.rules.trait_tiers;
    for (const side of ['A', 'B']) {
      for (const house of Object.keys(this.traits)) {
        const members = [], seen = []; let n = 0;
        for (const u of this.lines[side]) {
          if (!u.isToken && u.houses.includes(house) && !seen.includes(u.id)) {
            members.push(u); seen.push(u.id);
            n += (u.copies >= 3 && this.rules.trait_count === 'merged_counts_2') ? 2 : 1;
          }
        }
        for (const t of tiers) {
          if (n < t || (this.rules.disable_traits || []).includes(house + ':' + String(t))) continue;
          const tr = this.traits[house].tiers[String(t)];
          this.active[side].push(house + ':' + String(t));
          for (const m of members) {
            if (tr.members_ability) this.addAbility(m, tr.members_ability);
            if (tr.members_passives) for (const p of tr.members_passives) { m.passives.push(p); if (p.k === 'endure') m.endure += p.n; }
          }
          if (tr.anchor_ability) this.addAbility(members[members.length - 1], tr.anchor_ability);
          if ('side_front_guard' in tr) this.frontGuard[side] = Math.max(this.frontGuard[side], tr.side_front_guard);
        }
      }
    }
    for (const side of ['A', 'B']) for (const u of this.lines[side]) { const n = this.passiveSum(u, 'filed'); if (n) this.filed[other(side)] += n; }
  }

  select(sel, src, ctx) {
    const mine = this.lines[src.side], theirs = this.lines[other(src.side)];
    switch (sel) {
      case 'self': return src.alive ? [src] : [];
      case 'front_ally': return mine.slice(0, 1);
      case 'back_ally': return mine.length > 1 ? mine.slice(-1) : [];
      case 'all_allies': return [...mine];
      case 'other_allies': return mine.filter(u => u !== src);
      case 'ally_behind': case 'ally_ahead': case 'two_allies_ahead': case 'ally_ahead_or_self': case 'adjacent_allies': case 'adjacent_or_self': {
        if (!src.alive) return [];
        const i = this.idx(src);
        const ahead = i > 0 ? mine.slice(i - 1, i) : [], behind = mine.slice(i + 1, i + 2);
        if (sel === 'ally_behind') return behind;
        if (sel === 'ally_ahead') return ahead;
        if (sel === 'two_allies_ahead') return mine.slice(Math.max(0, i - 2), i);
        if (sel === 'ally_ahead_or_self') return ahead.length ? ahead : [src];
        const adj = [...ahead, ...behind];
        if (sel === 'adjacent_allies') return adj;
        return adj.length ? adj : [src];
      }
      case 'random_other_ally': {
        const c = mine.filter(u => u !== src);
        if (!c.length) return [];
        const r = this.rng.below(c.length); this.ev('rng', { purpose: sel, n: c.length, pick: r });
        return [c[r]];
      }
      case 'most_damaged_ally': {
        let best = null, gap = 0;
        for (const u of mine) if (u.maxhp - u.hp > gap) { best = u; gap = u.maxhp - u.hp; }
        return best ? [best] : [];
      }
      case 'enemy_front': return theirs.slice(0, 1);
      case 'enemy_back': return theirs.slice(-1);
      case 'enemy_two_back': return theirs.slice(-2);
      case 'enemy_second_back': return theirs.length >= 2 ? theirs.slice(-2, -1) : [];
      case 'all_enemies': return [...theirs];
      case 'enemy_highest_tier': { let best = null; for (const u of theirs) if (best === null || u.tier > best.tier) best = u; return best ? [best] : []; }
      case 'target': { const t = ctx.target; return t != null && t.alive ? [t] : []; }
      case 'attacker': { const t = ctx.attacker; return t != null && t.alive && t.side !== src.side ? [t] : []; }
    }
    throw new Error(sel);
  }

  redirect(tgt, src) {
    const line = this.lines[tgt.side];
    if (src.side === tgt.side || !line.length || line[0] === tgt) return tgt;
    for (const u of line) if (u !== tgt && u.alive && this.passives(u, 'shelter').length) { this.ev('shelter', { uid: u.uid, was: tgt.uid }); return u; }
    return tgt;
  }
  damage(tgt, n, src, hurt, pierce = false) {
    if (n <= 0 || !tgt.alive) return;
    if (tgt.ward) {
      tgt.ward = false; this.ev('ward_break', { src: src.uid, tgt: tgt.uid, pierced: pierce });
      if (!pierce) return;
    }
    if (!pierce) {
      let g = this.passiveSum(tgt, 'guard');
      const line = this.lines[tgt.side];
      if (line.length && line[0] === tgt) g += this.frontGuard[tgt.side];
      if (g > 0) { const n2 = Math.max(1, n - g); if (n2 !== n) this.ev('guard', { tgt: tgt.uid, blocked: n - n2 }); n = n2; }
    }
    tgt.hp -= n;
    this.ev('damage', { src: src.uid, tgt: tgt.uid, n, hp: tgt.hp });
    hurt.push([tgt, src]);
  }
  insertUnit(side, u, pos, src, extra) {
    const line = this.lines[side], lv = this.smotherLevel(side);
    if (lv >= 2) { this.ev('summon_fizzle', { src: src.uid, id: u.id, why: 'smother' }); return false; }
    if (lv === 1) { u.silenced = true; u.hp = 1; u.maxhp = 1; u.endure = 0; }
    pos = Math.min(pos, line.length); line.splice(pos, 0, u);
    this.ev('summon', { src: src.uid, uid: u.uid, id: u.id, slot: pos, atk: u.atk, hp: u.hp, smothered: lv === 1, ...extra });
    return true;
  }
  summon(side, tokenId, count, at, src) {
    for (let k = 0; k < count; k++) {
      if (this.lines[side].length >= this.MAX_LINE) { this.ev('summon_fizzle', { src: src.uid, id: tokenId, why: 'full' }); continue; }
      const u = this.newUnit(side, null, tokenId);
      this.insertUnit(side, u, at + k, src, {});
    }
  }

  doAttack(att, depth, extra) {
    const enemy = this.lines[other(att.side)];
    if (!enemy.length || !att.alive) return;
    let snipe = false;
    for (const p of this.passives(att, 'snipe')) if (!p.first_only || att.attacksMade === 0) snipe = true;
    let tgt = snipe ? enemy[enemy.length - 1] : enemy[0];
    tgt = this.redirect(tgt, att);
    let dmg = att.atk;
    if (att.attacksMade === 0) dmg += this.passiveSum(att, 'first_strike_bonus');
    for (const p of this.passives(att, 'giantslayer')) {
      if ((p.ratio === 2 && tgt.hp >= 2 * att.hp) || (p.ratio === 1 && tgt.hp > att.hp)) { dmg *= 2; break; }
    }
    att.attacksMade++; this.attacks++;
    const slot = enemy.indexOf(tgt);
    this.ev('attack', { src: att.uid, tgt: tgt.uid, n: dmg, extra, snipe });
    const pierce = this.passives(att, 'pierce').length > 0 || (att.attacksMade === 1 && this.passives(att, 'pierce_first').length > 0);
    const hurt = [];
    this.damage(tgt, dmg, att, hurt, pierce);
    let cl = 0;
    for (const p of this.passives(att, 'cleave')) cl = Math.max(cl, p.n === 'self_atk' ? att.atk : p.n);
    if (cl > 0 && slot + 1 < enemy.length) { this.ev('cleave', { src: att.uid, tgt: enemy[slot + 1].uid }); this.damage(enemy[slot + 1], cl, att, hurt, pierce); }
    let bh = 0;
    for (const p of this.passives(att, 'backhit')) if (!p.first_only || att.attacksMade === 1) bh = Math.max(bh, p.n);
    if (bh > 0 && enemy.length && enemy[enemy.length - 1] !== tgt) {
      const b = this.redirect(enemy[enemy.length - 1], att);
      if (b !== tgt) { this.ev('backhit', { src: att.uid, tgt: b.uid }); this.damage(b, bh, att, hurt, pierce); }
    }
    for (let i = 0; i < att.abilities.length; i++)
      if (att.abilities[i].trigger === 'on_attack') this.enqueue(att, i, 'on_attack', depth + 1, { target: tgt, target_slot: slot });
    this.afterEffect(hurt, depth);
  }

  enqueue(src, i, trig, depth, ctx) {
    if (depth > this.MAX_DEPTH) { this.ev('chain_cap', { src: src.uid, trig }); return; }
    this.queue.push([src, i, trig, depth, ctx]);
  }
  enqueueTrigger(u, trig, depth, ctx) { for (let i = 0; i < u.abilities.length; i++) if (u.abilities[i].trigger === trig) this.enqueue(u, i, trig, depth, ctx); }
  afterEffect(hurt, depth) {
    for (const [u, s] of hurt) if (u.alive && u.hp > 0 && !u.silenced) this.enqueueTrigger(u, 'on_hurt', depth + 1, { attacker: s });
    this.deathSweep(depth);
  }
  deathSweep(depth) {
    const order = [this.first, other(this.first)];
    for (const side of order) for (const u of this.lines[side])
      if (u.hp <= 0 && !u.destroyed && u.endure > 0 && !u.silenced && !this.blighted(u)) { u.endure--; u.hp = 1; this.ev('endure', { uid: u.uid, left: u.endure }); }
    const dead = [];
    for (const side of order) { let pos = 0; for (const u of this.lines[side]) { if (u.hp <= 0) dead.push([u, pos]); else pos++; } }
    if (!dead.length) return;
    for (const [u] of dead) u.alive = false;
    for (const side of order) this.lines[side] = this.lines[side].filter(u => u.alive);
    for (const [u, slot] of dead) {
      this.ev('death', { uid: u.uid, slot });
      if (!u.silenced) this.enqueueTrigger(u, 'on_death', depth + 1, { slot });
      for (const a of this.lines[u.side]) if (!a.silenced) this.enqueueTrigger(a, 'on_ally_death', depth + 1, { dead: u, slot });
    }
  }
  wouldAct(src, ab, ctx, i = null) {
    const c = ab.cond;
    if (c != null) {
      const line = this.lines[src.side];
      if (!src.alive || !line.includes(src)) return false;
      const k = line.indexOf(src);
      if (c === 'self_back' && k !== line.length - 1) return false;
      if (c === 'self_front' && k !== 0) return false;
    }
    const died = ctx.target != null && !ctx.target.alive;
    const enemy = this.lines[other(src.side)];
    for (const op of ab.ops) {
      const o = op.op;
      if (o === 'attack_again') { if ((op.cond !== 'target_died' || died) && src.extra < op.per_turn && enemy.length) return true; }
      else if (o === 'if_target_died') { if (died) return true; }
      else if (o === 'ward' && 'if_dead_slot' in op) { if (ctx.slot === op.if_dead_slot) return true; }
      else if (o === 'return_dead_ally') { const d = ctx.dead; if (d != null && !d.isToken && (i === null || src.stitches[i] < op.max_per_fight)) return true; }
      else return true;
    }
    return false;
  }
  runQueue() {
    while (this.queue.length) {
      const [src, i, trig, depth, ctx] = this.queue.shift();
      if (this.resThisStep >= this.MAX_RES) { this.ev('step_cap', { src: src.uid, trig }); continue; }
      if ((trig !== 'on_death' && !src.alive) || src.silenced) { this.ev('fizzle', { src: src.uid, trig }); continue; }
      const ab = src.abilities[i];
      const lim = ab.limit_per_fight;
      if (lim != null && src.uses[i] >= lim) continue;
      if (!this.wouldAct(src, ab, ctx, i)) continue;
      if (this.filed[src.side] > 0) { this.filed[src.side]--; src.uses[i]++; this.ev('filed', { src: src.uid, trig }); continue; }
      this.resThisStep++;
      this.resolveAbility(src, i, ab, trig, depth, ctx, false);
    }
  }
  resolveAbility(src, i, ab, trig, depth, ctx, relayed) {
    if (i !== null) src.uses[i]++;
    this.triggers++;
    this.ev('trigger', { src: src.uid, trig, ab: i, relayed });
    const hurt = [];
    if (this.runOps(src, i, ab.ops, depth, ctx, hurt)) return;
    this.afterEffect(hurt, depth);
  }
  runOps(src, i, ops, depth, ctx, hurt) {
    for (const op of ops) {
      const o = op.op;
      if (o === 'damage') {
        const n = op.n === 'self_atk' ? src.atk : op.n;
        for (let t of this.select(op.target, src, ctx)) { if (SINGLE_TARGET.includes(op.target)) t = this.redirect(t, src); this.damage(t, n, src, hurt); }
      } else if (o === 'strike') {
        for (const t of this.select(op.target, src, ctx)) this.damage(t, src.atk, src, hurt);
      } else if (o === 'heal') {
        for (const t of this.select(op.target, src, ctx)) {
          if (this.blighted(t)) { this.ev('blighted', { tgt: t.uid }); continue; }
          const nw = Math.min(t.maxhp, t.hp + op.n);
          if (nw > t.hp) { this.ev('heal', { src: src.uid, tgt: t.uid, n: nw - t.hp, hp: nw }); t.hp = nw; }
        }
      } else if (o === 'buff') {
        for (const t of this.select(op.target, src, ctx)) {
          const dh = this.blighted(t) ? 0 : op.hp;
          t.atk += op.atk; t.hp += dh; t.maxhp += dh;
          this.ev('buff', { src: src.uid, tgt: t.uid, atk: t.atk, hp: t.hp, da: op.atk, dh });
        }
      } else if (o === 'debuff_atk') {
        for (const t of this.select(op.target, src, ctx)) { t.atk = Math.max(0, t.atk - op.n); this.ev('debuff', { src: src.uid, tgt: t.uid, atk: t.atk }); }
      } else if (o === 'ward') {
        if ('if_dead_slot' in op && ctx.slot !== op.if_dead_slot) continue;
        for (const t of this.select(op.target, src, ctx)) { t.ward = true; this.ev('ward', { src: src.uid, tgt: t.uid }); }
      } else if (o === 'grant') {
        for (const t of this.select(op.target, src, ctx)) { t.passives = [...t.passives, op.passive]; this.ev('grant', { src: src.uid, tgt: t.uid, k: op.passive.k }); }
      } else if (o === 'silence') {
        for (const t of this.select(op.target, src, ctx)) if (!t.silenced) { t.silenced = true; this.ev('silence', { src: src.uid, tgt: t.uid }); }
      } else if (o === 'summon') {
        const line = this.lines[src.side]; let at;
        if (op.at === 'self_slot') at = src.alive ? this.idx(src) : ctx.slot;
        else { const si = src.alive ? this.idx(src) : (ctx.slot ?? 0); at = (line.length > 1 && si === line.length - 1) ? 0 : line.length; }
        this.summon(src.side, op.token, op.count, at, src);
      } else if (o === 'swap_enemy_front_back') {
        const th = this.lines[other(src.side)];
        if (th.length >= 2) {
          if (this.passives(th[0], 'unmovable').length || this.passives(th[th.length - 1], 'unmovable').length) { this.ev('swap_blocked', { src: src.uid }); continue; }
          const tmp = th[0]; th[0] = th[th.length - 1]; th[th.length - 1] = tmp;
          this.ev('swap', { src: src.uid, a: th[0].uid, b: th[th.length - 1].uid });
        }
      } else if (o === 'attack_again') {
        const died = ctx.target != null && !ctx.target.alive;
        if (op.cond === 'target_died' && !died) continue;
        if (src.extra >= op.per_turn || !this.lines[other(src.side)].length || !src.alive) continue;
        if (op.gain_on_kill) { src.atk += op.gain_on_kill; this.ev('buff', { src: src.uid, tgt: src.uid, atk: src.atk, hp: src.hp, da: op.gain_on_kill, dh: 0 }); }
        src.extra++;
        this.afterEffect(hurt, depth); hurt.length = 0;
        this.doAttack(src, depth, true);
        return true;
      } else if (o === 'if_target_died') {
        if (ctx.target != null && !ctx.target.alive) { if (this.runOps(src, i, op.then, depth, ctx, hurt)) return true; }
      } else if (o === 'destroy_if_hp_le') {
        for (const t of this.select(op.target, src, ctx)) if (t.hp > 0 && t.hp <= op.n) { t.hp = 0; t.destroyed = true; this.ev('destroy', { src: src.uid, tgt: t.uid }); }
      } else if (o === 'devour_behind') {
        for (const t of this.select('ally_behind', src, ctx)) {
          const ga = t.atk * op.mult; let gh = Math.max(0, t.hp) * op.mult;
          t.hp = 0; t.destroyed = true; this.ev('destroy', { src: src.uid, tgt: t.uid });
          if (this.blighted(src)) gh = 0;
          src.atk += ga; src.hp += gh; src.maxhp += gh;
          this.ev('buff', { src: src.uid, tgt: src.uid, atk: src.atk, hp: src.hp, da: ga, dh: gh });
        }
      } else if (o === 'relay_sof') {
        for (const t of this.select('ally_behind', src, ctx)) {
          if (t.silenced || !t.abilities.length || t.abilities[0].trigger !== 'start_of_fight') continue;
          if (!this.wouldAct(t, t.abilities[0], {})) continue;
          this.resolveAbility(t, null, t.abilities[0], 'start_of_fight', depth + 1, {}, true);
        }
      } else if (o === 'return_dead_ally') {
        const d = ctx.dead;
        if (d == null || d.isToken || src.stitches[i] >= op.max_per_fight) continue;
        if (this.lines[src.side].length >= this.MAX_LINE) { this.ev('summon_fizzle', { src: src.uid, id: d.id, why: 'full' }); continue; }
        src.stitches[i]++;
        if (this.blighted(src)) { this.ev('summon_fizzle', { src: src.uid, id: d.id, why: 'blight' }); continue; }
        const u = this.newUnit(src.side, { id: d.id, copies: d.copies, attack: d.baseAtk, health: 1 }, null);
        if (this.insertUnit(src.side, u, ctx.slot, src, { returned: d.uid }) && op.ward && !u.silenced) { u.ward = true; this.ev('ward', { src: src.uid, tgt: u.uid }); }
      } else if (o === 'gain_dead_attack') {
        const d = ctx.dead;
        if (d != null && src.alive) { src.atk += d.baseAtk; this.ev('buff', { src: src.uid, tgt: src.uid, atk: src.atk, hp: src.hp, da: d.baseAtk, dh: 0 }); }
      } else if (o === 'echo_death') {
        const d = ctx.dead;
        if (d == null || d.silenced) continue;
        for (let k = 0; k < d.abilities.length; k++)
          if (d.abilities[k].trigger === 'on_death' && depth + 1 <= this.MAX_DEPTH) {
            this.ev('echo', { src: src.uid, of: d.uid });
            this.resolveAbility(d, null, d.abilities[k], 'on_death', depth + 1, { slot: ctx.slot }, true);
          }
      } else throw new Error(o);
    }
    return false;
  }

  winnerOrNone() { const a = this.lines.A.length > 0, b = this.lines.B.length > 0; if (a && b) return null; if (!a && !b) return 'draw'; return a ? 'A' : 'B'; }
  snapshot() { const o = {}; for (const s of ['A', 'B']) o[s] = this.lines[s].map(u => ({ uid: u.uid, id: u.id, copies: u.copies, atk: u.atk, hp: u.hp })); return o; }
  value(side) { let v = 0; for (const u of this.lines[side]) v += u.tier * u.copies; return v; }
  pickFirst() {
    const fm = this.rules.first_mover;
    if (fm !== 'seed') {
      const la = this.lines.A.length, lb = this.lines.B.length;
      if (la !== lb) return [la < lb ? 'A' : 'B', 'fewer_units'];
      const va = this.value('A'), vb = this.value('B');
      if (va !== vb) return [va < vb ? 'A' : 'B', 'lower_value'];
      if (fm.endsWith('lower_health_then_seed')) {
        let ha = 0, hb = 0; for (const u of this.lines.A) ha += u.hp; for (const u of this.lines.B) hb += u.hp;
        if (ha !== hb) return [ha < hb ? 'A' : 'B', 'lower_health'];
      }
    }
    return [this.rng.below(2) === 0 ? 'A' : 'B', 'seed'];
  }
  run() {
    const [first, why] = this.pickFirst(); this.first = first;
    this.applyTraits();
    const sb = this.rules.second_mover_bonus, second = this.lines[other(this.first)];
    if (sb && second.length) {
      if (sb.kind === 'front_ward') second[0].ward = true;
      else if (sb.kind === 'front_hp') { second[0].hp += sb.n; second[0].maxhp += sb.n; this.ev('brace', { uid: second[0].uid, hp: second[0].hp }); }
      else if (sb.kind === 'all_hp') for (const u of second) { u.hp += sb.n; u.maxhp += sb.n; }
    }
    this.ev('start', { first: this.first, why, lines: this.snapshot(), traits: { A: [...this.active.A], B: [...this.active.B] } });
    const sides = [this.first, other(this.first)];
    const fa = this.sideHas('A', 'foresight') !== null, fb = this.sideHas('B', 'foresight') !== null;
    let order = [];
    if (fa !== fb) { const fs = fa ? 'A' : 'B'; for (const s of [fs, other(fs)]) order = order.concat(this.lines[s]); this.ev('foresight', { side: fs }); }
    else for (let k = 0; k < this.MAX_LINE; k++) for (const s of sides) if (k < this.lines[s].length) order.push(this.lines[s][k]);
    this.resThisStep = 0;
    for (const u of order) this.enqueueTrigger(u, 'start_of_fight', 1, {});
    this.runQueue();
    let w = this.winnerOrNone(), turn = this.first, passes = 0, turns = 0;
    while (w === null && turns < this.TURN_CAP) {
      turns++; this.resThisStep = 0;
      const line = this.lines[turn];
      let cands = line.filter(u => !u.acted && u.atk > 0);
      if (!cands.length) { for (const u of line) u.acted = false; cands = line.filter(u => u.atk > 0); }
      if (!cands.length) { this.ev('pass', { side: turn }); passes++; if (passes >= 2) { w = 'draw'; break; } }
      else { passes = 0; const att = cands[0]; att.acted = true; att.extra = 0; this.doAttack(att, 0, false); this.runQueue(); w = this.winnerOrNone(); }
      turn = other(turn);
    }
    if (w === null) { w = 'draw'; this.ev('turn_cap', {}); }
    let hpA = 0, hpB = 0; for (const u of this.lines.A) hpA += u.hp; for (const u of this.lines.B) hpB += u.hp;
    this.ev('end', { winner: w, hpA, hpB, survivors: this.snapshot() });
    const deaths = this.log.filter(e => e.t === 'death').length;
    return { winner: w, log: this.log, stats: { first: this.first, first_why: why, hpA, hpB, deaths, attacks: this.attacks, triggers: this.triggers, turns, rng_draws: this.rng.draws,
      traitsA: [...this.active.A], traitsB: [...this.active.B], survivorsA: this.lines.A.map(u => u.uid), survivorsB: this.lines.B.map(u => u.uid) } };
  }
}
export function resolve(lineA, lineB, seed, units) { return new Fight(lineA, lineB, seed >>> 0, units).run(); }
