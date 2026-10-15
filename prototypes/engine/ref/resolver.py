"""Bard S0 deterministic fight resolver (reference). Spec: ../resolver-spec.md.
resolve(lineA, lineB, seed, units) -> {"winner": "A"|"B"|"draw", "log": [...], "stats": {...}}
A line is a list (front first, max 5) of {"id": unitId, "copies": 1|2|3} or a dict with explicit attack/health.
level 1 = one copy, 2 = two copies (+1/+1), 3 = merged.
Pure: no globals mutated, no floats, no dict-order dependence beyond insertion order.
"""
M32 = 0xFFFFFFFF
MAX_LINE = 5
MAX_DEPTH = 8          # chain depth cap
MAX_RES_PER_STEP = 64  # trigger resolutions per step cap
TURN_CAP = 80          # side-turns (attacks + passes) before draw

def imul(a, b):
    return ((a & M32) * (b & M32)) & M32

class Mulberry32:
    def __init__(self, seed):
        self.a = seed & M32
        self.draws = 0
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

class Unit:
    __slots__ = ("uid","side","id","copies","atk","hp","maxhp","ward","silenced","acted","alive",
                 "extra_this_turn","uses","stitches","ability","tier","is_token","base_atk","base_hp")

def make_unit(defs, tokens, side, n, spec, token_id=None):
    u = Unit()
    u.uid = f"{side}{n}"; u.side = side; u.ward = False; u.silenced = False
    u.acted = False; u.alive = True; u.extra_this_turn = 0; u.uses = 0; u.stitches = 0
    if token_id is not None:
        t = tokens[token_id]
        if t.get("as_unit"):
            d = defs[t["as_unit"]]
            u.id = d["id"]; u.copies = 1; u.ability = d["ability"]; u.tier = d["tier"]; u.is_token = False
            u.atk, u.hp = t["attack"], t["health"]
        else:
            u.id = token_id; u.copies = 1; u.ability = None; u.tier = 0; u.is_token = True
            u.atk, u.hp = t["attack"], t["health"]
    else:
        d = defs[spec["id"]]; lvl = spec.get("copies", 1)
        u.id = d["id"]; u.copies = lvl; u.tier = d["tier"]; u.is_token = False
        if lvl >= 3:
            u.atk, u.hp, u.ability = d["merged"]["attack"], d["merged"]["health"], d["merged"]["ability"]
        else:
            u.atk, u.hp, u.ability = d["attack"] + (lvl - 1), d["health"] + (lvl - 1), d["ability"]
        if "attack" in spec: u.atk = spec["attack"]
        if "health" in spec: u.hp = spec["health"]
    u.maxhp = u.hp; u.base_atk = u.atk; u.base_hp = u.hp
    return u

class Fight:
    def __init__(self, lineA, lineB, seed, units):
        self.defs = {d["id"]: d for d in units["units"]}
        self.tokens = units["tokens"]
        self.rng = Mulberry32(seed)
        self.log = []
        self.counter = {"A": 0, "B": 0}
        self.lines = {"A": [], "B": []}
        for side, line in (("A", lineA), ("B", lineB)):
            for spec in line[:MAX_LINE]:
                self.lines[side].append(self._new(side, spec))
        self.queue = []
        self.attacks = 0; self.triggers = 0; self.res_this_step = 0
        self.first = None

    def _new(self, side, spec=None, token_id=None):
        u = make_unit(self.defs, self.tokens, side, self.counter[side], spec, token_id)
        self.counter[side] += 1
        return u

    def ev(self, t, **kw):
        e = {"i": len(self.log), "t": t}; e.update(kw); self.log.append(e)

    @staticmethod
    def other(side): return "B" if side == "A" else "A"
    def living(self, side): return [u for u in self.lines[side] if u.alive]
    def idx(self, u): return self.lines[u.side].index(u)

    # ---------- selectors ----------
    def select(self, sel, src, ctx):
        mine = self.lines[src.side]; theirs = self.lines[self.other(src.side)]
        if sel == "self": return [src] if src.alive else []
        if sel == "front_ally": return mine[:1]
        if sel == "front_two_allies": return mine[:2]
        if sel == "all_allies": return list(mine)
        if sel == "other_allies": return [u for u in mine if u is not src]
        if sel == "ally_behind":
            if not src.alive: return []
            i = self.idx(src); return mine[i+1:i+2]
        if sel == "random_other_ally":
            c = [u for u in mine if u is not src]
            if not c: return []
            r = self.rng.below(len(c)); self.ev("rng", purpose="random_other_ally", n=len(c), pick=r)
            return [c[r]]
        if sel == "enemy_front": return theirs[:1]
        if sel == "enemy_back": return theirs[-1:]
        if sel == "all_enemies": return list(theirs)
        if sel in ("enemy_behind_target", "two_behind_target"):
            k = 1 if sel == "enemy_behind_target" else 2
            tgt = ctx.get("target")
            if tgt is not None and tgt.alive and tgt in theirs:
                s = theirs.index(tgt) + 1
            else:
                s = ctx.get("target_slot", 0)  # target removed: the unit that slid into its slot
            return theirs[s:s+k]
        if sel == "target":
            tgt = ctx.get("target"); return [tgt] if tgt is not None and tgt.alive else []
        if sel == "enemy_two_highest_tier":
            order = sorted(range(len(theirs)), key=lambda i: (-theirs[i].tier, i))
            return [theirs[i] for i in sorted(order[:2])]
        raise ValueError(sel)

    # ---------- primitives ----------
    def damage(self, tgt, n, src, hurt):
        if n <= 0 or not tgt.alive: return
        if tgt.ward:
            tgt.ward = False; self.ev("ward_break", src=src.uid, tgt=tgt.uid); return
        tgt.hp -= n
        self.ev("damage", src=src.uid, tgt=tgt.uid, n=n, hp=tgt.hp)
        hurt.append(tgt)

    def summon(self, side, token_id, count, at_index, src):
        made = []
        for k in range(count):
            line = self.lines[side]
            if len(line) >= MAX_LINE:
                self.ev("summon_fizzle", src=src.uid, token=token_id); continue
            u = self._new(side, token_id=token_id)
            pos = min(at_index + k, len(line))
            line.insert(pos, u)
            self.ev("summon", src=src.uid, uid=u.uid, id=u.id, slot=pos, atk=u.atk, hp=u.hp)
            made.append(u)
        return made

    # ---------- attacks ----------
    def do_attack(self, att, depth, extra):
        enemy = self.lines[self.other(att.side)]
        if not enemy or not att.alive: return
        tgt = enemy[0]
        self.attacks += 1
        self.ev("attack", src=att.uid, tgt=tgt.uid, n=att.atk, extra=extra)
        hurt = []
        self.damage(tgt, att.atk, att, hurt)
        if att.ability and att.ability["trigger"] == "on_attack":
            self.enqueue(att, "on_attack", depth + 1, {"target": tgt, "target_slot": 0})
        self.after_effect(hurt, depth)

    # ---------- queue ----------
    def enqueue(self, src, trig, depth, ctx):
        if depth > MAX_DEPTH:
            self.ev("chain_cap", src=src.uid, trig=trig); return
        self.queue.append((src, trig, depth, ctx))

    def after_effect(self, hurt, depth):
        for u in hurt:
            if u.alive and u.hp > 0 and u.ability and u.ability["trigger"] == "on_hurt":
                self.enqueue(u, "on_hurt", depth + 1, {})
        self.death_sweep(depth)

    def death_sweep(self, depth):
        order = [self.first, self.other(self.first)]
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
            if u.ability and u.ability["trigger"] == "on_death" and not u.silenced:
                self.enqueue(u, "on_death", depth + 1, {"slot": slot})
            for a in self.lines[u.side]:
                if a.ability and a.ability["trigger"] == "on_ally_death":
                    self.enqueue(a, "on_ally_death", depth + 1, {"dead": u, "slot": slot})

    def run_queue(self):
        while self.queue:
            src, trig, depth, ctx = self.queue.pop(0)
            if self.res_this_step >= MAX_RES_PER_STEP:
                self.ev("step_cap", src=src.uid, trig=trig); continue
            if trig != "on_death" and (not src.alive or src.silenced):
                self.ev("fizzle", src=src.uid, trig=trig); continue
            ab = src.ability
            lim = ab.get("limit_per_fight")
            if lim is not None and src.uses >= lim:
                continue
            self.res_this_step += 1
            self.resolve_ability(src, ab, trig, depth, ctx)

    def resolve_ability(self, src, ab, trig, depth, ctx, relayed=False):
        # pre-check conditional ops so that a no-op trigger is not counted/logged as an action
        ops = ab["ops"]
        if len(ops) == 1 and ops[0]["op"] == "attack_again":
            op = ops[0]
            if op["cond"] == "target_died" and not (ctx.get("target") is not None and not ctx["target"].alive): return
            if src.extra_this_turn >= op["per_turn"] or not self.lines[self.other(src.side)]: return
        src.uses += 1
        self.triggers += 1
        self.ev("trigger", src=src.uid, trig=trig, relayed=relayed)
        hurt = []
        for op in ops:
            o = op["op"]
            if o == "damage":
                n = src.atk if op["n"] == "self_atk" else op["n"]
                for t in self.select(op["target"], src, ctx): self.damage(t, n, src, hurt)
            elif o == "heal":
                for t in self.select(op["target"], src, ctx):
                    new = min(t.maxhp, t.hp + op["n"])
                    self.ev("heal", src=src.uid, tgt=t.uid, n=new - t.hp, hp=new); t.hp = new
            elif o == "buff":
                for t in self.select(op["target"], src, ctx):
                    t.atk += op["atk"]; t.hp += op["hp"]; t.maxhp += op["hp"]
                    self.ev("buff", src=src.uid, tgt=t.uid, atk=t.atk, hp=t.hp, da=op["atk"], dh=op["hp"])
            elif o == "debuff_atk":
                for t in self.select(op["target"], src, ctx):
                    t.atk = max(0, t.atk - op["n"]); self.ev("debuff", src=src.uid, tgt=t.uid, atk=t.atk)
            elif o == "ward":
                for t in self.select(op["target"], src, ctx):
                    t.ward = True; self.ev("ward", src=src.uid, tgt=t.uid)
            elif o == "silence":
                for t in self.select(op["target"], src, ctx):
                    t.silenced = True; self.ev("silence", src=src.uid, tgt=t.uid)
            elif o == "summon":
                if op["at"] == "self_slot": at = ctx["slot"] if not src.alive else self.idx(src)
                else: at = self.idx(src) + 1 if src.alive else ctx.get("slot", 0)
                self.summon(src.side, op["token"], op["count"], at, src)
            elif o == "swap_enemy_front_back":
                th = self.lines[self.other(src.side)]
                if len(th) >= 2:
                    th[0], th[-1] = th[-1], th[0]
                    self.ev("swap", src=src.uid, a=th[0].uid, b=th[-1].uid)
            elif o == "attack_again":
                src.extra_this_turn += 1
                self.do_attack(src, depth, True)
                return  # do_attack runs its own after_effect
            elif o == "destroy_if_hp_le":
                for t in self.select(op["target"], src, ctx):
                    if t.hp <= op["n"]:
                        t.hp = 0; self.ev("destroy", src=src.uid, tgt=t.uid)
            elif o == "devour_behind":
                for t in self.select("ally_behind", src, ctx):
                    ga, gh = t.atk * op["mult"], t.hp * op["mult"]
                    t.hp = 0; self.ev("destroy", src=src.uid, tgt=t.uid)
                    src.atk += ga; src.hp += gh; src.maxhp += gh
                    self.ev("buff", src=src.uid, tgt=src.uid, atk=src.atk, hp=src.hp, da=ga, dh=gh)
            elif o == "relay_sof":
                for t in self.select("ally_behind", src, ctx):
                    if t.ability and t.ability["trigger"] == "start_of_fight" and not t.silenced:
                        self.resolve_ability(t, t.ability, "start_of_fight", depth + 1, {}, relayed=True)
            elif o == "return_dead_ally":
                d = ctx.get("dead")
                if d is None or d.is_token or src.stitches >= op.get("max_per_fight", 1): continue
                src.stitches += 1
                line = self.lines[src.side]
                if len(line) >= MAX_LINE: self.ev("summon_fizzle", src=src.uid, token=d.id); continue
                u = self._new(src.side, spec={"id": d.id, "copies": d.copies, "attack": d.base_atk, "health": 1})
                pos = min(ctx["slot"], len(line)); line.insert(pos, u)
                self.ev("summon", src=src.uid, uid=u.uid, id=u.id, slot=pos, atk=u.atk, hp=u.hp, returned=d.uid)
            else:
                raise ValueError(o)
        self.after_effect(hurt, depth)

    # ---------- main ----------
    def winner_or_none(self):
        a, b = bool(self.lines["A"]), bool(self.lines["B"])
        if a and b: return None
        if not a and not b: return "draw"
        return "A" if a else "B"

    def snapshot(self):
        return {s: [{"uid": u.uid, "id": u.id, "copies": u.copies, "atk": u.atk, "hp": u.hp} for u in self.lines[s]] for s in ("A","B")}

    def run(self):
        self.first = "A" if self.rng.below(2) == 0 else "B"
        self.ev("start", first=self.first, lines=self.snapshot())
        # start of fight: alternate sides, front to back, starting with first
        order = []
        sides = [self.first, self.other(self.first)]
        for i in range(MAX_LINE):
            for s in sides:
                if i < len(self.lines[s]): order.append(self.lines[s][i])
        self.res_this_step = 0
        for u in order:
            if u.ability and u.ability["trigger"] == "start_of_fight":
                self.enqueue(u, "start_of_fight", 1, {})
        self.run_queue()
        w = self.winner_or_none()
        turn = self.first; passes = 0; turns = 0
        while w is None and turns < TURN_CAP:
            turns += 1
            self.res_this_step = 0
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
                "stats": {"hpA": hpA, "hpB": hpB, "deaths": deaths, "attacks": self.attacks, "triggers": self.triggers, "turns": turns, "rng_draws": self.rng.draws,
                          "survivorsA": [u.uid for u in self.lines["A"]], "survivorsB": [u.uid for u in self.lines["B"]]}}

def resolve(lineA, lineB, seed, units):
    return Fight(lineA, lineB, seed & M32, units).run()
