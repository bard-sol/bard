"""Prototype B v2 deterministic duel resolver (reference). Spec: ../../../card-duel-b-v2.md §6.
Pure: duel(recA, recB, seed, data) -> {"winner","lanes","log"}; rec = {"deck":[12 ids], "plays":[[ [card_id, lane], ...] per turn]}.
Step API (Duel) is what the client and the sim drive turn by turn. Integer maths, seeded mulberry32 only."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from resolver_v2 import Mulberry32, derive_seed

OTHER = {"A": "B", "B": "A"}

class Duel:
    def __init__(self, deckA, deckB, seed, data):
        self.D = {c["id"]: c for c in data["cards"]}; self.T = data["tokens"]; self.R = data["rules"]
        self.seed = seed & 0xFFFFFFFF
        self.rng = Mulberry32(derive_seed(self.seed, 300))          # reveal coin + Pip, in reveal order
        lr = Mulberry32(derive_seed(self.seed, 301))                 # location draw
        pool = [l["id"] for l in data["locations"]]; self.locs = []
        for _ in range(3): self.locs.append(pool.pop(lr.below(len(pool))))
        self.revealed = [False, False, False]
        self.turn = 0; self.log = []; self.uid = 0; self.order = 0
        self.destroyed_total = 0
        self.S = {}
        for side, deck, k in (("A", deckA, 201), ("B", deckB, 202)):
            d = list(deck); r = Mulberry32(derive_seed(self.seed, k))
            for i in range(len(d) - 1, 0, -1):                       # Fisher-Yates
                j = r.below(i + 1); d[i], d[j] = d[j], d[i]
            self.S[side] = {"deck": d, "hand": [], "board": [[], [], []], "destroyed": 0, "discarded": 0,
                            "pending": [0, 0, 0], "played": {}, "plan": []}
            for _ in range(self.R["opening_hand"]): self.draw(side)

    # ---------- helpers ----------
    def ev(self, t, **kw): e = {"i": len(self.log), "t": t, "turn": self.turn}; e.update(kw); self.log.append(e)
    def loc(self, L): return self.locs[L] if self.revealed[L] else None
    def slots(self, L): return 2 if self.loc(L) == "torn_margin" else self.R["lane_slots"]
    def room(self, side, L): return len(self.S[side]["board"][L]) < self.slots(L)
    def draw(self, side):
        s = self.S[side]
        if s["deck"] and len(s["hand"]) < self.R["max_hand"]:
            c = s["deck"].pop(0); s["hand"].append(c); return c
        return None
    def new_card(self, side, cid, L, token=False):
        self.uid += 1; self.order += 1
        base = self.T[cid]["power"] if token else self.D[cid]["power"]
        return {"uid": self.uid, "id": cid, "side": side, "lane": L, "base": base, "perm": 0, "token": token,
                "order": self.order, "turn": self.turn, "cost": 0 if token else self.D[cid]["cost"]}
    def kind(self, c, k):
        if c["token"]: return None
        return self.D[c["id"]]["fx"].get(k)
    def active(self, c):
        """Ongoing/afterlife/arrive work unless the lane is the Moot-Rings or an enemy Index sits here."""
        if self.loc(c["lane"]) == "moot_rings": return False
        for e in self.S[OTHER[c["side"]]]["board"][c["lane"]]:
            if self.kind(e, "ongoing") == "index" and self.loc(e["lane"]) != "moot_rings": return False
        return True
    def has_ongoing(self, c, name): return self.kind(c, "ongoing") == name and self.active(c)

    # ---------- power ----------
    def powers(self):
        P = {}; neg = {}
        for side in "AB":
            for L in range(3):
                for c in self.S[side]["board"][L]: P[c["uid"]] = c["base"] + c["perm"]; neg[c["uid"]] = 0
        for side in "AB":
            o = OTHER[side]
            for L in range(3):
                for c in self.S[side]["board"][L]:
                    og = self.kind(c, "ongoing")
                    if og is None or not self.active(c): continue
                    if og == "drummer":
                        for x in self.S[side]["board"][L]:
                            if x is not c: P[x["uid"]] += 1
                    elif og == "vey":
                        for LL in range(3):
                            for x in self.S[side]["board"][LL]:
                                if not x["token"] and x["cost"] <= 2: P[x["uid"]] += 1
                    elif og == "weeping":
                        for x in self.S[o]["board"][L]: neg[x["uid"]] -= 1
                    elif og == "reader":
                        for LL in (L - 1, L + 1):
                            if 0 <= LL < 3:
                                for x in self.S[side]["board"][LL]: P[x["uid"]] += 1
                    elif og == "duellist": P[c["uid"]] += len(self.S[o]["board"][L])
                    elif og == "grenna": P[c["uid"]] += self.destroyed_total
                    elif og == "marrow": P[c["uid"]] += min(self.R["marrow_cap"], 2 * (self.S[side]["destroyed"] + self.S[side]["discarded"]))
        for side in "AB":
            for L in range(3):
                wren = any(self.has_ongoing(x, "wren") for x in self.S[side]["board"][L])
                for c in self.S[side]["board"][L]:
                    if not (wren and self.kind(c, "ongoing") != "wren"): P[c["uid"]] += neg[c["uid"]]
                    lc = self.loc(L)
                    if lc == "salon" and not c["token"] and c["cost"] <= 2: P[c["uid"]] += 2
                    if lc == "gutter_fields" and self.turn == 6: P[c["uid"]] += 3
        tot = {"A": [0, 0, 0], "B": [0, 0, 0]}
        for side in "AB":
            for L in range(3):
                if self.loc(L) == "spine": continue
                tot[side][L] = max(0, sum(P[c["uid"]] for c in self.S[side]["board"][L]))
        for L in range(3):
            if self.loc(L) == "spine":
                for side in "AB":
                    k = sum(1 for LL in range(3) if LL != L and tot[side][LL] > tot[OTHER[side]][LL])
                    for c in self.S[side]["board"][L]: P[c["uid"]] += k
                    tot[side][L] = max(0, sum(P[c["uid"]] for c in self.S[side]["board"][L]))
            if self.loc(L) == "hither_yon":
                a, b = tot["A"][L], tot["B"][L]; cap = self.R["hither_cap"]
                tot["A"][L] = min(a, b + cap); tot["B"][L] = min(b, a + cap)
        return P, tot

    def lanes_won(self, tot, side): return sum(1 for L in range(3) if tot[side][L] > tot[OTHER[side]][L])

    # ---------- primitives ----------
    def destroy(self, c, src):
        L = c["lane"]; side = c["side"]
        if self.loc(L) == "fort_crease" or self.has_ongoing(c, "grub"):
            self.ev("destroy_blocked", uid=c["uid"], src=src); return False
        for x in self.S[side]["board"][L]:
            if x is not c and self.has_ongoing(x, "wren"):
                self.ev("destroy_blocked", uid=c["uid"], src=src, by="wren"); return False
        was_active = self.active(c)
        self.S[side]["board"][L].remove(c); self.destroyed_total += 1; self.S[side]["destroyed"] += 1
        self.ev("destroy", uid=c["uid"], id=c["id"], side=side, lane=L, src=src)
        if self.loc(L) == "pit":
            for x in self.S[side]["board"][L]: x["perm"] += 2; self.ev("buff", uid=x["uid"], n=2, why="pit")
        al = self.kind(c, "afterlife")
        if al and was_active:
            if al == "buff_here_2":
                for x in self.S[side]["board"][L]: x["perm"] += 2; self.ev("buff", uid=x["uid"], n=2, why="afterlife")
            elif al == "scribble" and self.room(side, L):
                t = self.new_card(side, "scribble", L, True); self.S[side]["board"][L].append(t); self.ev("summon", uid=t["uid"], id="scribble", lane=L)
        if not c["token"]:
            for h in self.S[side]["board"][L]:
                if self.has_ongoing(h, "hob") and not h.get("hob_used") and h is not c and self.room(side, L):
                    h["hob_used"] = True
                    n = self.new_card(side, c["id"], L); self.S[side]["board"][L].append(n)
                    self.ev("return", uid=n["uid"], id=c["id"], lane=L, by=h["uid"]); break
        return True

    def discard_costliest(self, side, src):
        h = self.S[side]["hand"]
        if not h: return None
        best = 0
        for i in range(1, len(h)):
            if self.D[h[i]]["cost"] > self.D[h[best]]["cost"]: best = i
        cid = h.pop(best); self.S[side]["discarded"] += 1
        self.ev("discard", side=side, id=cid, src=src)
        if self.D[cid]["fx"].get("afterlife") == "scribble":
            for L in range(3):
                if self.room(side, L) and self.loc(L) != "moot_rings":
                    t = self.new_card(side, "scribble", L, True); self.S[side]["board"][L].append(t); self.ev("summon", uid=t["uid"], id="scribble", lane=L); break
        return cid

    def move(self, c, to, src):
        frm = c["lane"]; side = c["side"]
        if to == frm or not (0 <= to < 3) or not self.room(side, to): return False
        if self.loc(frm) == "fort_crease" or self.loc(to) == "fort_crease" or self.has_ongoing(c, "grub"):
            self.ev("move_blocked", uid=c["uid"], src=src); return False
        self.S[side]["board"][frm].remove(c); c["lane"] = to; self.S[side]["board"][to].append(c)
        self.ev("move", uid=c["uid"], frm=frm, to=to, src=src)
        if self.loc(to) == "port_foxing": c["perm"] += 2; self.ev("buff", uid=c["uid"], n=2, why="port_foxing")
        ar = self.kind(c, "arrive")
        if ar and self.active(c): c["perm"] += ar; self.ev("buff", uid=c["uid"], n=ar, why="arrive")
        return True

    def weakest(self, cards, P):
        best = None
        for c in cards:
            if best is None or P[c["uid"]] < P[best["uid"]]: best = c
        return best
    def strongest(self, cards, P):
        best = None
        for c in cards:
            if best is None or P[c["uid"]] > P[best["uid"]]: best = c
        return best

    # ---------- on reveal ----------
    def on_reveal(self, c):
        rv = self.kind(c, "reveal"); L = c["lane"]
        if rv is None or self.loc(L) == "moot_rings": return
        times = 2 if self.loc(L) == "scriptorium" else 1
        for _ in range(times):
            if c not in self.S[c["side"]]["board"][c["lane"]]: return
            self.ev("reveal_fx", uid=c["uid"], id=c["id"])
            self.do_reveal(c, rv)

    def do_reveal(self, c, rv):
        side = c["side"]; o = OTHER[side]; L = c["lane"]
        mine = self.S[side]["board"][L]; theirs = self.S[o]["board"][L]
        P, tot = self.powers()
        def gain(n, why):
            if n: c["perm"] += n; self.ev("buff", uid=c["uid"], n=n, why=why)
        if rv == "kesh":
            w = self.weakest([x for x in mine if x is not c], P)
            if w is not None:
                pw = P[w["uid"]]
                if self.destroy(w, c["uid"]): gain(2 * max(0, pw), "kesh")
        elif rv == "copyist":
            cid = self.discard_costliest(side, c["uid"])
            if cid: gain(self.D[cid]["cost"], "copyist")
        elif rv == "silas":
            s = self.strongest(theirs, P)
            if s is not None:
                for to in range(3):
                    if to != L and self.move(s, to, c["uid"]): break
        elif rv == "portrait":
            gain(2 * sum(1 for x in mine if x is not c and x["order"] < c["order"]), "portrait")
        elif rv == "croak":
            best = None; gap = 0
            for LL in range(3):
                if LL != L and self.room(side, LL) and tot[o][LL] - tot[side][LL] > gap: best = LL; gap = tot[o][LL] - tot[side][LL]
            if best is not None: self.move(c, best, c["uid"])
            gain(2, "croak")
        elif rv == "juniper":
            gain(sum(1 for h in self.S[o]["hand"] if self.D[h]["cost"] >= 4), "juniper")
            self.ev("peek", side=side, hand=list(self.S[o]["hand"]))
        elif rv == "pip":
            r = self.rng.below(2); self.ev("coin", uid=c["uid"], heads=r == 0); gain(self.D["pip"]["fx"].get("n", 5) if r == 0 else 0, "pip")
        elif rv == "novice":
            self.S[side]["pending"][L] += self.D["novice"]["fx"].get("n", 2)
        elif rv == "wick":
            gain(4 if (self.turn - 1, L) in self.S[side]["played"] else 0, "wick")
        elif rv == "footnote":
            gain(3 if any(P[x["uid"]] > P[c["uid"]] for x in theirs) else 0, "footnote")
        elif rv == "hunter":
            gain(2 if theirs else 0, "hunter")
        elif rv == "thorn":
            gain(4 if len(mine) == 1 else 0, "thorn")
        elif rv == "corvin":
            self.draw(side); self.ev("draw", side=side)
            w = self.weakest([x for x in mine if x is not c], P)
            if w is not None and L + 1 < 3: self.move(w, L + 1, c["uid"])
        elif rv == "ash_ember":
            for LL in range(3):
                if LL != L and self.room(side, LL):
                    t = self.new_card(side, "ember", LL, True); self.S[side]["board"][LL].append(t); self.ev("summon", uid=t["uid"], id="ember", lane=LL); break
        elif rv == "blotling":
            for LL in range(3):
                if LL != L and self.room(side, LL):
                    t = self.new_card(side, "ink_drop", LL, True); self.S[side]["board"][LL].append(t); self.ev("summon", uid=t["uid"], id="ink_drop", lane=LL)
        elif rv == "wolf":
            gain(3 if tot[o][L] > tot[side][L] else 0, "wolf")
        elif rv == "errata":
            w = self.weakest(theirs, P)
            if w is not None: self.destroy(w, c["uid"])
            self.discard_costliest(o, c["uid"])
        elif rv == "colophon":
            for x in [x for x in mine if x is not c]: self.destroy(x, c["uid"])

    # ---------- turn flow ----------
    def start_turn(self):
        self.turn += 1
        if self.turn in self.R["reveal_locations_on_turns"]:
            L = self.R["reveal_locations_on_turns"].index(self.turn); self.revealed[L] = True
            self.ev("location", lane=L, id=self.locs[L])
        for side in "AB": self.draw(side)

    def legal_plays(self, side, plays):
        """Commit check: from hand, total cost <= turn, own room per lane (counting this turn's plays)."""
        h = list(self.S[side]["hand"]); e = self.turn; used = [len(self.S[side]["board"][L]) for L in range(3)]; ok = []
        for cid, L in plays:
            if cid in h and self.D[cid]["cost"] <= e and used[L] < self.slots(L):
                h.remove(cid); e -= self.D[cid]["cost"]; used[L] += 1; ok.append((cid, L))
        return ok

    def commit(self, side, plays):
        plays = self.legal_plays(side, plays)
        for cid, L in plays: self.S[side]["hand"].remove(cid)
        self.S[side]["plan"] = plays
        return plays

    def reveal(self):
        P, tot = self.powers()
        a, b = self.lanes_won(tot, "A"), self.lanes_won(tot, "B")
        if a != b: first = "A" if a > b else "B"; why = "winning"
        else: first = "A" if self.rng.below(2) == 0 else "B"; why = "coin"
        self.ev("reveal_order", first=first, why=why)
        for side in (first, OTHER[first]):
            for cid, L in self.S[side]["plan"]:
                LL = None
                for k in range(3):
                    cand = (L + k) % 3
                    if self.room(side, cand): LL = cand; break
                if LL is None: self.S[side]["hand"].append(cid); self.ev("bounce", side=side, id=cid); continue
                c = self.new_card(side, cid, LL); self.S[side]["board"][LL].append(c)
                self.S[side]["played"][(self.turn, LL)] = True
                if self.S[side]["pending"][LL] and not c["token"]:
                    c["perm"] += self.S[side]["pending"][LL]; self.ev("buff", uid=c["uid"], n=self.S[side]["pending"][LL], why="novice"); self.S[side]["pending"][LL] = 0
                self.ev("play", side=side, uid=c["uid"], id=cid, lane=LL)
                self.on_reveal(c)
            self.S[side]["plan"] = []

    def end_turn(self):
        for L in range(3):
            if self.loc(L) == "lanternfall":
                for side in "AB":
                    for c in self.S[side]["board"][L]: c["perm"] += 1
        P, tot = self.powers()
        self.ev("turn_end", totA=list(tot["A"]), totB=list(tot["B"]))
        return tot

    def result(self):
        P, tot = self.powers()
        a, b = self.lanes_won(tot, "A"), self.lanes_won(tot, "B")
        if a != b: w = "A" if a > b else "B"; why = "lanes"
        else:
            ta, tb = sum(tot["A"]), sum(tot["B"])
            if ta != tb: w = "A" if ta > tb else "B"; why = "total"
            else: w = "A" if derive_seed(self.seed, 999) % 2 == 0 else "B"; why = "seed"
        self.ev("end", winner=w, why=why, totA=list(tot["A"]), totB=list(tot["B"]), locs=list(self.locs))
        return {"winner": w, "why": why, "totA": tot["A"], "totB": tot["B"], "locs": list(self.locs)}

def duel(recA, recB, seed, data):
    """Pure replay: both sides' plays are fixed inputs (a live player's moves or a saved ghost run)."""
    d = Duel(recA["deck"], recB["deck"], seed, data)
    for t in range(data["rules"]["turns"]):
        d.start_turn()
        d.commit("A", [tuple(p) for p in (recA["plays"][t] if t < len(recA["plays"]) else [])])
        d.commit("B", [tuple(p) for p in (recB["plays"][t] if t < len(recB["plays"]) else [])])
        d.reveal(); d.end_turn()
    r = d.result(); r["log"] = d.log
    return r
