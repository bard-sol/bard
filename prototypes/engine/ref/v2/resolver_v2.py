"""Bard S0 deterministic fight resolver v2 (reference). Spec: ../../resolver-spec-v2.md.
resolve(lineA, lineB, seed, units) -> {"winner": "A"|"B"|"draw", "log": [...], "stats": {...}}
A line is a list (front first, max 5) of {"id": unitId, "copies": 1|2|3}. copies 2 = +1/+1, 3 = merged form.
Pure: integer maths only, no globals mutated, iteration only over lists / insertion-ordered dicts.
"""
M32 = 0xFFFFFFFF

def imul(a, b):
    return ((a & M32) * (b & M32)) & M32

class Mulberry32:
    def __init__(self, seed):
        self.a = seed & M32; self.draws = 0
    def next(self):
        self.a = (self.a + 0x6D2B79F5) & M32
        t = self.a
        t = imul(t ^ (t >> 15), t | 1)
        t = (t + imul(t ^ (t >> 7), t | 61)) & M32 ^ t
        self.draws += 1
        return (t ^ (t >> 14)) & M32
    def below(self, n):
        return self.next() % n

def derive_seed(base, k):
    return Mulberry32((base + imul(k, 0x9E3779B9)) & M32).next()

SINGLE_TARGET = ("enemy_back", "enemy_second_back", "enemy_two_back", "attacker")   # enemy hits Shelter can redirect

class Unit:
    pass

class Fight:
    def __init__(self, lineA, lineB, seed, units):
        self.defs = {d["id"]: d for d in units["units"]}
        self.tokens = units["tokens"]; self.traits = units["traits"]; self.rules = units["rules"]
        self.MAX_LINE = self.rules["max_line"]; self.MAX_DEPTH = self.rules["max_depth"]
        self.MAX_RES = self.rules["max_res_per_step"]; self.TURN_CAP = self.rules["turn_cap"]
        self.rng = Mulberry32(seed)
        self.log = []; self.counter = {"A": 0, "B": 0}
        self.lines = {"A": [], "B": []}
        for side, line in (("A", lineA), ("B", lineB)):
            for spec in line[:self.MAX_LINE]:
                self.lines[side].append(self.new_unit(side, spec, None))
        self.queue = []; self.attacks = 0; self.triggers = 0; self.res_this_step = 0
        self.first = None
        self.front_guard = {"A": 0, "B": 0}; self.filed = {"A": 0, "B": 0}
        self.active = {"A": [], "B": []}

    # ---------- units ----------
    def new_unit(self, side, spec, token_id):
        u = Unit()
        u.uid = side + str(self.counter[side]); self.counter[side] += 1
        u.side = side; u.ward = False; u.silenced = False; u.acted = False; u.alive = True
        u.destroyed = False; u.extra_this_turn = 0; u.attacks_made = 0
        u.uses = []; u.stitches = []; u.houses = []
        if token_id is not None:
            t = self.tokens[token_id]
            if t.get("as_unit"):
                d = self.defs[t["as_unit"]]
                u.id = d["id"]; u.copies = 1; u.tier = d["tier"]; u.is_token = False
                u.abilities = [d["ability"]] if d["ability"] and d["ability"]["ops"] else []; u.passives = list(d["passives"])
            else:
                u.id = token_id; u.copies = 1; u.tier = 0; u.is_token = True
                u.abilities = []; u.passives = list(t.get("passives", []))
            u.atk, u.hp = t["attack"], t["health"]
        else:
            d = self.defs[spec["id"]]; c = spec.get("copies", 1)
            u.id = d["id"]; u.copies = c; u.tier = d["tier"]; u.is_token = False
            f = d["merged"] if c >= 3 else d
            u.atk = f["attack"] + (c - 1 if c < 3 else 0); u.hp = f["health"] + (c - 1 if c < 3 else 0)
            u.abilities = [f["ability"]] if f["ability"] and f["ability"]["ops"] else []; u.passives = list(f["passives"])
            if "attack" in spec: u.atk = spec["attack"]
            if "health" in spec: u.hp = spec["health"]
            u.houses = [d["house"]] + list(d.get("glue", []))
        u.maxhp = u.hp; u.base_atk = u.atk
        u.uses = [0 for _ in u.abilities]; u.stitches = [0 for _ in u.abilities]
        u.endure = self.passive_sum(u, "endure")
        return u

    def add_ability(self, u, ab):
        u.abilities.append(ab); u.uses.append(0); u.stitches.append(0)

    def passives(self, u, k):
        if u.silenced: return []
        return [p for p in u.passives if p["k"] == k]
    def passive_sum(self, u, k):
        s = 0
        for p in self.passives(u, k):
            if p.get("front_only"):
                line = self.lines[u.side]
                if not line or line[0] is not u: continue
            s += p.get("n", 1)
        return s

    def ev(self, t, **kw):
        e = {"i": len(self.log), "t": t}; e.update(kw); self.log.append(e)

    @staticmethod
    def other(side): return "B" if side == "A" else "A"
    def idx(self, u): return self.lines[u.side].index(u)
    def side_has(self, side, k):
        for u in self.lines[side]:
            if u.alive and self.passives(u, k): return u
        return None
    def blighted(self, u): return self.side_has(self.other(u.side), "blight") is not None
    def smother_level(self, side):
        lv = 0
        for u in self.lines[self.other(side)]:
            for p in self.passives(u, "smother"): lv = max(lv, p["n"])
        return lv

    # ---------- traits ----------
    def apply_traits(self):
        tiers = self.rules["trait_tiers"]
        for side in ("A", "B"):
            for house in self.traits:
                members = []; seen = []; n = 0
                for u in self.lines[side]:
                    if not u.is_token and house in u.houses and u.id not in seen:
                        members.append(u); seen.append(u.id)
                        n += 2 if (u.copies >= 3 and self.rules["trait_count"] == "merged_counts_2") else 1
                for t in tiers:
                    if n < t or (house + ":" + str(t)) in self.rules.get("disable_traits", []): continue
                    tr = self.traits[house]["tiers"][str(t)]
                    self.active[side].append(house + ":" + str(t))
                    for m in members:
                        if "members_ability" in tr: self.add_ability(m, tr["members_ability"])
                        if "members_passives" in tr:
                            for p in tr["members_passives"]:
                                m.passives.append(p)
                                if p["k"] == "endure": m.endure += p["n"]
                    if "anchor_ability" in tr: self.add_ability(members[-1], tr["anchor_ability"])
                    if "side_front_guard" in tr: self.front_guard[side] = max(self.front_guard[side], tr["side_front_guard"])
        for side in ("A", "B"):
            for u in self.lines[side]:
                n = self.passive_sum(u, "filed")
                if n: self.filed[self.other(side)] += n

    # ---------- selectors ----------
    def select(self, sel, src, ctx):
        mine = self.lines[src.side]; theirs = self.lines[self.other(src.side)]
        if sel == "self": return [src] if src.alive else []
        if sel == "front_ally": return mine[:1]
        if sel == "back_ally": return mine[-1:] if len(mine) > 1 else []
        if sel == "all_allies": return list(mine)
        if sel == "other_allies": return [u for u in mine if u is not src]
        if sel in ("ally_behind", "ally_ahead", "two_allies_ahead", "ally_ahead_or_self", "adjacent_allies", "adjacent_or_self"):
            if not src.alive: return []
            i = self.idx(src)
            ahead = mine[i-1:i] if i > 0 else []; behind = mine[i+1:i+2]
            if sel == "ally_behind": return behind
            if sel == "ally_ahead": return ahead
            if sel == "two_allies_ahead": return mine[max(0, i - 2):i]
            if sel == "ally_ahead_or_self": return ahead if ahead else [src]
            adj = ahead + behind
            if sel == "adjacent_allies": return adj
            return adj if adj else [src]
        if sel == "random_other_ally":
            c = [u for u in mine if u is not src]
            if not c: return []
            r = self.rng.below(len(c)); self.ev("rng", purpose=sel, n=len(c), pick=r)
            return [c[r]]
        if sel == "most_damaged_ally":
            best = None; gap = 0
            for u in mine:
                if u.maxhp - u.hp > gap: best = u; gap = u.maxhp - u.hp
            return [best] if best is not None else []
        if sel == "enemy_front": return theirs[:1]
        if sel == "enemy_back": return theirs[-1:]
        if sel == "enemy_two_back": return theirs[-2:]
        if sel == "enemy_second_back": return theirs[-2:-1] if len(theirs) >= 2 else []
        if sel == "all_enemies": return list(theirs)
        if sel == "enemy_highest_tier":
            best = None
            for u in theirs:
                if best is None or u.tier > best.tier: best = u
            return [best] if best is not None else []
        if sel == "target":
            t = ctx.get("target"); return [t] if t is not None and t.alive else []
        if sel == "attacker":
            t = ctx.get("attacker")
            return [t] if t is not None and t.alive and t.side != src.side else []
        raise ValueError(sel)

    # ---------- primitives ----------
    def redirect(self, tgt, src):
        """Shelter: an enemy hit aimed at a non-Front unit lands on the first living Shelter unit instead."""
        line = self.lines[tgt.side]
        if src.side == tgt.side or not line or line[0] is tgt: return tgt
        for u in line:
            if u is not tgt and u.alive and self.passives(u, "shelter"):
                self.ev("shelter", uid=u.uid, was=tgt.uid); return u
        return tgt

    def damage(self, tgt, n, src, hurt, pierce=False):
        if n <= 0 or not tgt.alive: return
        if tgt.ward:
            tgt.ward = False; self.ev("ward_break", src=src.uid, tgt=tgt.uid, pierced=pierce)
            if not pierce: return
        if not pierce:
            g = self.passive_sum(tgt, "guard")
            line = self.lines[tgt.side]
            if line and line[0] is tgt: g += self.front_guard[tgt.side]
            if g > 0:
                n2 = max(1, n - g)
                if n2 != n: self.ev("guard", tgt=tgt.uid, blocked=n - n2)
                n = n2
        tgt.hp -= n
        self.ev("damage", src=src.uid, tgt=tgt.uid, n=n, hp=tgt.hp)
        hurt.append((tgt, src))

    def insert_unit(self, side, u, pos, src, extra):
        line = self.lines[side]
        lv = self.smother_level(side)
        if lv >= 2:
            self.ev("summon_fizzle", src=src.uid, id=u.id, why="smother"); return False
        if lv == 1:
            u.silenced = True; u.hp = 1; u.maxhp = 1; u.endure = 0
        pos = min(pos, len(line)); line.insert(pos, u)
        e = {"src": src.uid, "uid": u.uid, "id": u.id, "slot": pos, "atk": u.atk, "hp": u.hp, "smothered": lv == 1}
        e.update(extra); self.ev("summon", **e)
        return True

    def summon(self, side, token_id, count, at, src):
        for k in range(count):
            if len(self.lines[side]) >= self.MAX_LINE:
                self.ev("summon_fizzle", src=src.uid, id=token_id, why="full"); continue
            u = self.new_unit(side, None, token_id)
            self.insert_unit(side, u, at + k, src, {})

    # ---------- attacks ----------
    def do_attack(self, att, depth, extra):
        enemy = self.lines[self.other(att.side)]
        if not enemy or not att.alive: return
        snipe = False
        for p in self.passives(att, "snipe"):
            if not p.get("first_only") or att.attacks_made == 0: snipe = True
        tgt = enemy[-1] if snipe else enemy[0]
        tgt = self.redirect(tgt, att)
        dmg = att.atk
        if att.attacks_made == 0: dmg += self.passive_sum(att, "first_strike_bonus")
        for p in self.passives(att, "giantslayer"):
            if (p["ratio"] == 2 and tgt.hp >= 2 * att.hp) or (p["ratio"] == 1 and tgt.hp > att.hp):
                dmg *= 2; break
        att.attacks_made += 1; self.attacks += 1
        slot = enemy.index(tgt)
        self.ev("attack", src=att.uid, tgt=tgt.uid, n=dmg, extra=extra, snipe=snipe)
        pierce = len(self.passives(att, "pierce")) > 0 or (att.attacks_made == 1 and len(self.passives(att, "pierce_first")) > 0)
        hurt = []
        self.damage(tgt, dmg, att, hurt, pierce)
        cl = 0
        for p in self.passives(att, "cleave"):
            cl = max(cl, att.atk if p["n"] == "self_atk" else p["n"])
        if cl > 0 and slot + 1 < len(enemy):
            self.ev("cleave", src=att.uid, tgt=enemy[slot + 1].uid)
            self.damage(enemy[slot + 1], cl, att, hurt, pierce)
        bh = 0
        for p in self.passives(att, "backhit"):
            if not p.get("first_only") or att.attacks_made == 1: bh = max(bh, p["n"])
        if bh > 0 and enemy and enemy[-1] is not tgt:
            b = self.redirect(enemy[-1], att)
            if b is not tgt:
                self.ev("backhit", src=att.uid, tgt=b.uid)
                self.damage(b, bh, att, hurt, pierce)
        for i in range(len(att.abilities)):
            if att.abilities[i]["trigger"] == "on_attack":
                self.enqueue(att, i, "on_attack", depth + 1, {"target": tgt, "target_slot": slot})
        self.after_effect(hurt, depth)

    # ---------- queue ----------
    def enqueue(self, src, i, trig, depth, ctx):
        if depth > self.MAX_DEPTH:
            self.ev("chain_cap", src=src.uid, trig=trig); return
        self.queue.append((src, i, trig, depth, ctx))

    def enqueue_trigger(self, u, trig, depth, ctx):
        for i in range(len(u.abilities)):
            if u.abilities[i]["trigger"] == trig: self.enqueue(u, i, trig, depth, ctx)

    def after_effect(self, hurt, depth):
        for u, s in hurt:
            if u.alive and u.hp > 0 and not u.silenced:
                self.enqueue_trigger(u, "on_hurt", depth + 1, {"attacker": s})
        self.death_sweep(depth)

    def death_sweep(self, depth):
        order = [self.first, self.other(self.first)]
        for side in order:
            for u in self.lines[side]:
                if u.hp <= 0 and not u.destroyed and u.endure > 0 and not u.silenced and not self.blighted(u):
                    u.endure -= 1; u.hp = 1; self.ev("endure", uid=u.uid, left=u.endure)
        dead = []
        for side in order:
            pos = 0
            for u in self.lines[side]:
                if u.hp <= 0: dead.append((u, pos))
                else: pos += 1
        if not dead: return
        for u, _ in dead: u.alive = False
        for side in order:
            self.lines[side] = [u for u in self.lines[side] if u.alive]
        for u, slot in dead:
            self.ev("death", uid=u.uid, slot=slot)
            if not u.silenced: self.enqueue_trigger(u, "on_death", depth + 1, {"slot": slot})
            for a in self.lines[u.side]:
                if not a.silenced: self.enqueue_trigger(a, "on_ally_death", depth + 1, {"dead": u, "slot": slot})

    def would_act(self, src, ab, ctx, i=None):
        c = ab.get("cond")
        if c is not None:
            line = self.lines[src.side]
            if not src.alive or src not in line: return False
            i = line.index(src)
            if c == "self_back" and i != len(line) - 1: return False
            if c == "self_front" and i != 0: return False
        died = ctx.get("target") is not None and not ctx["target"].alive
        enemy = self.lines[self.other(src.side)]
        for op in ab["ops"]:
            o = op["op"]
            if o == "attack_again":
                if (op["cond"] != "target_died" or died) and src.extra_this_turn < op["per_turn"] and enemy: return True
            elif o == "if_target_died":
                if died: return True
            elif o == "ward" and "if_dead_slot" in op:
                if ctx.get("slot") == op["if_dead_slot"]: return True
            elif o == "return_dead_ally":
                d = ctx.get("dead")
                if d is not None and not d.is_token and (i is None or src.stitches[i] < op["max_per_fight"]): return True
            else:
                return True
        return False

    def run_queue(self):
        while self.queue:
            src, i, trig, depth, ctx = self.queue.pop(0)
            if self.res_this_step >= self.MAX_RES:
                self.ev("step_cap", src=src.uid, trig=trig); continue
            if (trig != "on_death" and not src.alive) or src.silenced:
                self.ev("fizzle", src=src.uid, trig=trig); continue
            ab = src.abilities[i]
            lim = ab.get("limit_per_fight")
            if lim is not None and src.uses[i] >= lim: continue
            if not self.would_act(src, ab, ctx, i): continue
            if self.filed[src.side] > 0:
                self.filed[src.side] -= 1; src.uses[i] += 1
                self.ev("filed", src=src.uid, trig=trig); continue
            self.res_this_step += 1
            self.resolve_ability(src, i, ab, trig, depth, ctx, False)

    def resolve_ability(self, src, i, ab, trig, depth, ctx, relayed):
        if i is not None: src.uses[i] += 1
        self.triggers += 1
        self.ev("trigger", src=src.uid, trig=trig, ab=i, relayed=relayed)
        hurt = []
        if self.run_ops(src, i, ab["ops"], depth, ctx, hurt): return
        self.after_effect(hurt, depth)

    def run_ops(self, src, i, ops, depth, ctx, hurt):
        """Returns True if an attack_again took over (it runs its own after_effect)."""
        for op in ops:
            o = op["op"]
            if o == "damage":
                n = src.atk if op["n"] == "self_atk" else op["n"]
                for t in self.select(op["target"], src, ctx):
                    if op["target"] in SINGLE_TARGET: t = self.redirect(t, src)
                    self.damage(t, n, src, hurt)
            elif o == "strike":
                for t in self.select(op["target"], src, ctx): self.damage(t, src.atk, src, hurt)
            elif o == "heal":
                for t in self.select(op["target"], src, ctx):
                    if self.blighted(t): self.ev("blighted", tgt=t.uid); continue
                    new = min(t.maxhp, t.hp + op["n"])
                    if new > t.hp: self.ev("heal", src=src.uid, tgt=t.uid, n=new - t.hp, hp=new); t.hp = new
            elif o == "buff":
                for t in self.select(op["target"], src, ctx):
                    dh = 0 if self.blighted(t) else op["hp"]
                    t.atk += op["atk"]; t.hp += dh; t.maxhp += dh
                    self.ev("buff", src=src.uid, tgt=t.uid, atk=t.atk, hp=t.hp, da=op["atk"], dh=dh)
            elif o == "debuff_atk":
                for t in self.select(op["target"], src, ctx):
                    t.atk = max(0, t.atk - op["n"]); self.ev("debuff", src=src.uid, tgt=t.uid, atk=t.atk)
            elif o == "ward":
                if "if_dead_slot" in op and ctx.get("slot") != op["if_dead_slot"]: continue
                for t in self.select(op["target"], src, ctx):
                    t.ward = True; self.ev("ward", src=src.uid, tgt=t.uid)
            elif o == "grant":
                for t in self.select(op["target"], src, ctx):
                    t.passives = t.passives + [op["passive"]]; self.ev("grant", src=src.uid, tgt=t.uid, k=op["passive"]["k"])
            elif o == "silence":
                for t in self.select(op["target"], src, ctx):
                    if not t.silenced:
                        t.silenced = True; self.ev("silence", src=src.uid, tgt=t.uid)
            elif o == "summon":
                line = self.lines[src.side]
                if op["at"] == "self_slot":
                    at = self.idx(src) if src.alive else ctx["slot"]
                else:  # other_end
                    si = self.idx(src) if src.alive else ctx.get("slot", 0)
                    at = 0 if (len(line) > 1 and si == len(line) - 1) else len(line)
                self.summon(src.side, op["token"], op["count"], at, src)
            elif o == "swap_enemy_front_back":
                th = self.lines[self.other(src.side)]
                if len(th) >= 2:
                    if self.passives(th[0], "unmovable") or self.passives(th[-1], "unmovable"):
                        self.ev("swap_blocked", src=src.uid); continue
                    th[0], th[-1] = th[-1], th[0]
                    self.ev("swap", src=src.uid, a=th[0].uid, b=th[-1].uid)
            elif o == "attack_again":
                died = ctx.get("target") is not None and not ctx["target"].alive
                if op["cond"] == "target_died" and not died: continue
                if src.extra_this_turn >= op["per_turn"] or not self.lines[self.other(src.side)] or not src.alive: continue
                if op.get("gain_on_kill"):
                    src.atk += op["gain_on_kill"]
                    self.ev("buff", src=src.uid, tgt=src.uid, atk=src.atk, hp=src.hp, da=op["gain_on_kill"], dh=0)
                src.extra_this_turn += 1
                self.after_effect(hurt, depth); hurt.clear()
                self.do_attack(src, depth, True)
                return True
            elif o == "if_target_died":
                if ctx.get("target") is not None and not ctx["target"].alive:
                    if self.run_ops(src, i, op["then"], depth, ctx, hurt): return True
            elif o == "destroy_if_hp_le":
                for t in self.select(op["target"], src, ctx):
                    if 0 < t.hp <= op["n"]:
                        t.hp = 0; t.destroyed = True; self.ev("destroy", src=src.uid, tgt=t.uid)
            elif o == "devour_behind":
                for t in self.select("ally_behind", src, ctx):
                    ga, gh = t.atk * op["mult"], max(0, t.hp) * op["mult"]
                    t.hp = 0; t.destroyed = True; self.ev("destroy", src=src.uid, tgt=t.uid)
                    if self.blighted(src): gh = 0
                    src.atk += ga; src.hp += gh; src.maxhp += gh
                    self.ev("buff", src=src.uid, tgt=src.uid, atk=src.atk, hp=src.hp, da=ga, dh=gh)
            elif o == "relay_sof":
                for t in self.select("ally_behind", src, ctx):
                    if t.silenced or not t.abilities or t.abilities[0]["trigger"] != "start_of_fight": continue
                    if not self.would_act(t, t.abilities[0], {}): continue
                    self.resolve_ability(t, None, t.abilities[0], "start_of_fight", depth + 1, {}, True)
            elif o == "return_dead_ally":
                d = ctx.get("dead")
                if d is None or d.is_token or src.stitches[i] >= op["max_per_fight"]: continue
                if len(self.lines[src.side]) >= self.MAX_LINE: self.ev("summon_fizzle", src=src.uid, id=d.id, why="full"); continue
                src.stitches[i] += 1
                if self.blighted(src): self.ev("summon_fizzle", src=src.uid, id=d.id, why="blight"); continue
                u = self.new_unit(src.side, {"id": d.id, "copies": d.copies, "attack": d.base_atk, "health": 1}, None)
                if self.insert_unit(src.side, u, ctx["slot"], src, {"returned": d.uid}) and op.get("ward") and not u.silenced:
                    u.ward = True; self.ev("ward", src=src.uid, tgt=u.uid)
            elif o == "gain_dead_attack":
                d = ctx.get("dead")
                if d is not None and src.alive:
                    src.atk += d.base_atk
                    self.ev("buff", src=src.uid, tgt=src.uid, atk=src.atk, hp=src.hp, da=d.base_atk, dh=0)
            elif o == "echo_death":
                d = ctx.get("dead")
                if d is None or d.silenced: continue
                for k in range(len(d.abilities)):
                    if d.abilities[k]["trigger"] == "on_death" and depth + 1 <= self.MAX_DEPTH:
                        self.ev("echo", src=src.uid, of=d.uid)
                        self.resolve_ability(d, None, d.abilities[k], "on_death", depth + 1, {"slot": ctx["slot"]}, True)
            else:
                raise ValueError(o)
        return False

    # ---------- main ----------
    def winner_or_none(self):
        a, b = bool(self.lines["A"]), bool(self.lines["B"])
        if a and b: return None
        if not a and not b: return "draw"
        return "A" if a else "B"

    def snapshot(self):
        return {s: [{"uid": u.uid, "id": u.id, "copies": u.copies, "atk": u.atk, "hp": u.hp} for u in self.lines[s]] for s in ("A", "B")}

    def value(self, side):
        v = 0
        for u in self.lines[side]: v += u.tier * u.copies
        return v

    def pick_first(self):
        fm = self.rules["first_mover"]
        if fm != "seed":
            la, lb = len(self.lines["A"]), len(self.lines["B"])
            if la != lb: return ("A" if la < lb else "B"), "fewer_units"
            va, vb = self.value("A"), self.value("B")
            if va != vb: return ("A" if va < vb else "B"), "lower_value"
            if fm.endswith("lower_health_then_seed"):
                ha = sum(u.hp for u in self.lines["A"]); hb = sum(u.hp for u in self.lines["B"])
                if ha != hb: return ("A" if ha < hb else "B"), "lower_health"
        return ("A" if self.rng.below(2) == 0 else "B"), "seed"

    def run(self):
        self.first, why = self.pick_first()
        self.apply_traits()  # (rules.disable_traits: analysis-only switch used by the uplift test)
        sb = self.rules.get("second_mover_bonus")
        second = self.lines[self.other(self.first)]
        if sb and second:
            if sb["kind"] == "front_ward": second[0].ward = True
            elif sb["kind"] == "front_hp":
                second[0].hp += sb["n"]; second[0].maxhp += sb["n"]
                self.ev("brace", uid=second[0].uid, hp=second[0].hp)
            elif sb["kind"] == "all_hp":
                for u in second: u.hp += sb["n"]; u.maxhp += sb["n"]
        self.ev("start", first=self.first, why=why, lines=self.snapshot(),
                traits={"A": list(self.active["A"]), "B": list(self.active["B"])})
        sides = [self.first, self.other(self.first)]
        fa = self.side_has("A", "foresight") is not None; fb = self.side_has("B", "foresight") is not None
        order = []
        if fa != fb:
            fs = "A" if fa else "B"
            for s in (fs, self.other(fs)): order += list(self.lines[s])
            self.ev("foresight", side=fs)
        else:
            for k in range(self.MAX_LINE):
                for s in sides:
                    if k < len(self.lines[s]): order.append(self.lines[s][k])
        self.res_this_step = 0
        for u in order: self.enqueue_trigger(u, "start_of_fight", 1, {})
        self.run_queue()
        w = self.winner_or_none()
        turn = self.first; passes = 0; turns = 0
        while w is None and turns < self.TURN_CAP:
            turns += 1; self.res_this_step = 0
            line = self.lines[turn]
            cands = [u for u in line if not u.acted and u.atk > 0]
            if not cands:
                for u in line: u.acted = False
                cands = [u for u in line if u.atk > 0]
            if not cands:
                self.ev("pass", side=turn); passes += 1
                if passes >= 2: w = "draw"; break
            else:
                passes = 0
                att = cands[0]; att.acted = True; att.extra_this_turn = 0
                self.do_attack(att, 0, False)
                self.run_queue()
                w = self.winner_or_none()
            turn = self.other(turn)
        if w is None:
            w = "draw"; self.ev("turn_cap")
        hpA = sum(u.hp for u in self.lines["A"]); hpB = sum(u.hp for u in self.lines["B"])
        self.ev("end", winner=w, hpA=hpA, hpB=hpB, survivors=self.snapshot())
        deaths = sum(1 for e in self.log if e["t"] == "death")
        return {"winner": w, "log": self.log,
                "stats": {"first": self.first, "first_why": why, "hpA": hpA, "hpB": hpB, "deaths": deaths,
                          "attacks": self.attacks, "triggers": self.triggers, "turns": turns, "rng_draws": self.rng.draws,
                          "traitsA": list(self.active["A"]), "traitsB": list(self.active["B"]),
                          "survivorsA": [u.uid for u in self.lines["A"]], "survivorsB": [u.uid for u in self.lines["B"]]}}

def resolve(lineA, lineB, seed, units):
    return Fight(lineA, lineB, seed & M32, units).run()
