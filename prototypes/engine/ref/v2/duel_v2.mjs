// Prototype B v2 duel resolver. Port of duel/duel_v2.py. Spec: card-duel-b-v2.md §6.
// Pure: duel(recA, recB, seed, data). Integer maths, one mulberry32 stream per use.
import { Mulberry32, deriveSeed } from "./resolver_v2.mjs";

const OTHER = { A: "B", B: "A" };

export class Duel {
  constructor(deckA, deckB, seed, data) {
    this.D = {};
    for (const c of data.cards) this.D[c.id] = c;
    this.T = data.tokens;
    this.R = data.rules;
    this.locsMeta = data.locations;
    this.seed = seed >>> 0;
    this.rng = new Mulberry32(deriveSeed(this.seed, 300));
    const lr = new Mulberry32(deriveSeed(this.seed, 301));
    const pool = data.locations.map((l) => l.id);
    this.locs = [];
    for (let i = 0; i < 3; i++) this.locs.push(pool.splice(lr.below(pool.length), 1)[0]);
    this.revealed = [false, false, false];
    this.turn = 0;
    this.log = [];
    this.uid = 0;
    this.order = 0;
    this.destroyed_total = 0;
    this.S = {};
    for (const [side, deck, k] of [
      ["A", deckA, 201],
      ["B", deckB, 202],
    ]) {
      const d = deck.slice();
      const r = new Mulberry32(deriveSeed(this.seed, k));
      for (let i = d.length - 1; i > 0; i--) {
        const j = r.below(i + 1);
        const tmp = d[i];
        d[i] = d[j];
        d[j] = tmp;
      }
      this.S[side] = {
        deck: d,
        hand: [],
        board: [[], [], []],
        destroyed: 0,
        discarded: 0,
        pending: [0, 0, 0],
        played: {},
        plan: [],
      };
      for (let n = 0; n < this.R.opening_hand; n++) this.draw(side);
    }
  }

  ev(t, kw) {
    const e = { i: this.log.length, t, turn: this.turn, ...kw };
    this.log.push(e);
  }
  loc(L) {
    return this.revealed[L] ? this.locs[L] : null;
  }
  slots(L) {
    return this.loc(L) === "torn_margin" ? 2 : this.R.lane_slots;
  }
  room(side, L) {
    return this.S[side].board[L].length < this.slots(L);
  }
  draw(side) {
    const s = this.S[side];
    if (s.deck.length && s.hand.length < this.R.max_hand) {
      const c = s.deck.shift();
      s.hand.push(c);
      return c;
    }
    return null;
  }
  new_card(side, cid, L, token = false) {
    this.uid += 1;
    this.order += 1;
    const base = token ? this.T[cid].power : this.D[cid].power;
    return {
      uid: this.uid,
      id: cid,
      side,
      lane: L,
      base,
      perm: 0,
      token,
      order: this.order,
      turn: this.turn,
      cost: token ? 0 : this.D[cid].cost,
    };
  }
  kind(c, k) {
    if (c.token) return null;
    const fx = this.D[c.id].fx;
    return fx && k in fx ? fx[k] : null;
  }
  active(c) {
    if (this.loc(c.lane) === "moot_rings") return false;
    for (const e of this.S[OTHER[c.side]].board[c.lane]) {
      if (this.kind(e, "ongoing") === "index" && this.loc(e.lane) !== "moot_rings") return false;
    }
    return true;
  }
  has_ongoing(c, name) {
    return this.kind(c, "ongoing") === name && this.active(c);
  }

  powers() {
    const P = {};
    const neg = {};
    for (const side of ["A", "B"]) {
      for (let L = 0; L < 3; L++) {
        for (const c of this.S[side].board[L]) {
          P[c.uid] = c.base + c.perm;
          neg[c.uid] = 0;
        }
      }
    }
    for (const side of ["A", "B"]) {
      const o = OTHER[side];
      for (let L = 0; L < 3; L++) {
        for (const c of this.S[side].board[L]) {
          const og = this.kind(c, "ongoing");
          if (og == null || !this.active(c)) continue;
          if (og === "drummer") {
            for (const x of this.S[side].board[L]) if (x !== c) P[x.uid] += 1;
          } else if (og === "vey") {
            for (let LL = 0; LL < 3; LL++) {
              for (const x of this.S[side].board[LL]) if (!x.token && x.cost <= 2) P[x.uid] += 1;
            }
          } else if (og === "weeping") {
            for (const x of this.S[o].board[L]) neg[x.uid] -= 1;
          } else if (og === "reader") {
            for (const LL of [L - 1, L + 1]) {
              if (LL >= 0 && LL < 3) for (const x of this.S[side].board[LL]) P[x.uid] += 1;
            }
          } else if (og === "duellist") P[c.uid] += this.S[o].board[L].length;
          else if (og === "grenna") P[c.uid] += this.destroyed_total;
          else if (og === "marrow") P[c.uid] += Math.min(this.R.marrow_cap, 2 * (this.S[side].destroyed + this.S[side].discarded));
        }
      }
    }
    for (const side of ["A", "B"]) {
      for (let L = 0; L < 3; L++) {
        const wren = this.S[side].board[L].some((x) => this.has_ongoing(x, "wren"));
        for (const c of this.S[side].board[L]) {
          if (!(wren && this.kind(c, "ongoing") !== "wren")) P[c.uid] += neg[c.uid];
          const lc = this.loc(L);
          if (lc === "salon" && !c.token && c.cost <= 2) P[c.uid] += 2;
          if (lc === "gutter_fields" && this.turn === 6) P[c.uid] += 3;
        }
      }
    }
    const tot = { A: [0, 0, 0], B: [0, 0, 0] };
    for (const side of ["A", "B"]) {
      for (let L = 0; L < 3; L++) {
        if (this.loc(L) === "spine") continue;
        let s = 0;
        for (const c of this.S[side].board[L]) s += P[c.uid];
        tot[side][L] = Math.max(0, s);
      }
    }
    for (let L = 0; L < 3; L++) {
      if (this.loc(L) === "spine") {
        for (const side of ["A", "B"]) {
          let k = 0;
          for (let LL = 0; LL < 3; LL++) if (LL !== L && tot[side][LL] > tot[OTHER[side]][LL]) k += 1;
          for (const c of this.S[side].board[L]) P[c.uid] += k;
          let s = 0;
          for (const c of this.S[side].board[L]) s += P[c.uid];
          tot[side][L] = Math.max(0, s);
        }
      }
      if (this.loc(L) === "hither_yon") {
        const a = tot.A[L];
        const b = tot.B[L];
        const cap = this.R.hither_cap;
        tot.A[L] = Math.min(a, b + cap);
        tot.B[L] = Math.min(b, a + cap);
      }
    }
    return [P, tot];
  }

  lanes_won(tot, side) {
    let n = 0;
    for (let L = 0; L < 3; L++) if (tot[side][L] > tot[OTHER[side]][L]) n += 1;
    return n;
  }

  destroy(c, src) {
    const L = c.lane;
    const side = c.side;
    if (this.loc(L) === "fort_crease" || this.has_ongoing(c, "grub")) {
      this.ev("destroy_blocked", { uid: c.uid, src });
      return false;
    }
    for (const x of this.S[side].board[L]) {
      if (x !== c && this.has_ongoing(x, "wren")) {
        this.ev("destroy_blocked", { uid: c.uid, src, by: "wren" });
        return false;
      }
    }
    const was_active = this.active(c);
    const board = this.S[side].board[L];
    const ix = board.indexOf(c);
    if (ix >= 0) board.splice(ix, 1);
    this.destroyed_total += 1;
    this.S[side].destroyed += 1;
    this.ev("destroy", { uid: c.uid, id: c.id, side, lane: L, src });
    if (this.loc(L) === "pit") {
      for (const x of this.S[side].board[L]) {
        x.perm += 2;
        this.ev("buff", { uid: x.uid, n: 2, why: "pit" });
      }
    }
    const al = this.kind(c, "afterlife");
    if (al && was_active) {
      if (al === "buff_here_2") {
        for (const x of this.S[side].board[L]) {
          x.perm += 2;
          this.ev("buff", { uid: x.uid, n: 2, why: "afterlife" });
        }
      } else if (al === "scribble" && this.room(side, L)) {
        const t = this.new_card(side, "scribble", L, true);
        this.S[side].board[L].push(t);
        this.ev("summon", { uid: t.uid, id: "scribble", lane: L });
      }
    }
    if (!c.token) {
      for (const h of this.S[side].board[L]) {
        if (this.has_ongoing(h, "hob") && !h.hob_used && h !== c && this.room(side, L)) {
          h.hob_used = true;
          const n = this.new_card(side, c.id, L);
          this.S[side].board[L].push(n);
          this.ev("return", { uid: n.uid, id: c.id, lane: L, by: h.uid });
          break;
        }
      }
    }
    return true;
  }

  discard_costliest(side, src) {
    const h = this.S[side].hand;
    if (!h.length) return null;
    let best = 0;
    for (let i = 1; i < h.length; i++) if (this.D[h[i]].cost > this.D[h[best]].cost) best = i;
    const cid = h.splice(best, 1)[0];
    this.S[side].discarded += 1;
    this.ev("discard", { side, id: cid, src });
    if (this.D[cid].fx && this.D[cid].fx.afterlife === "scribble") {
      for (let L = 0; L < 3; L++) {
        if (this.room(side, L) && this.loc(L) !== "moot_rings") {
          const t = this.new_card(side, "scribble", L, true);
          this.S[side].board[L].push(t);
          this.ev("summon", { uid: t.uid, id: "scribble", lane: L });
          break;
        }
      }
    }
    return cid;
  }

  move(c, to, src) {
    const frm = c.lane;
    const side = c.side;
    if (to === frm || to < 0 || to >= 3 || !this.room(side, to)) return false;
    if (this.loc(frm) === "fort_crease" || this.loc(to) === "fort_crease" || this.has_ongoing(c, "grub")) {
      this.ev("move_blocked", { uid: c.uid, src });
      return false;
    }
    const fromBoard = this.S[side].board[frm];
    const ix = fromBoard.indexOf(c);
    if (ix >= 0) fromBoard.splice(ix, 1);
    c.lane = to;
    this.S[side].board[to].push(c);
    this.ev("move", { uid: c.uid, frm, to, src });
    if (this.loc(to) === "port_foxing") {
      c.perm += 2;
      this.ev("buff", { uid: c.uid, n: 2, why: "port_foxing" });
    }
    const ar = this.kind(c, "arrive");
    if (ar && this.active(c)) {
      c.perm += ar;
      this.ev("buff", { uid: c.uid, n: ar, why: "arrive" });
    }
    return true;
  }

  weakest(cards, P) {
    let best = null;
    for (const c of cards) if (best == null || P[c.uid] < P[best.uid]) best = c;
    return best;
  }
  strongest(cards, P) {
    let best = null;
    for (const c of cards) if (best == null || P[c.uid] > P[best.uid]) best = c;
    return best;
  }

  on_reveal(c) {
    const rv = this.kind(c, "reveal");
    const L = c.lane;
    if (rv == null || this.loc(L) === "moot_rings") return;
    const times = this.loc(L) === "scriptorium" ? 2 : 1;
    for (let n = 0; n < times; n++) {
      if (!this.S[c.side].board[c.lane].includes(c)) return;
      this.ev("reveal_fx", { uid: c.uid, id: c.id });
      this.do_reveal(c, rv);
    }
  }

  do_reveal(c, rv) {
    const side = c.side;
    const o = OTHER[side];
    const L = c.lane;
    const mine = this.S[side].board[L];
    const theirs = this.S[o].board[L];
    const [P, tot] = this.powers();
    const gain = (n, why) => {
      if (n) {
        c.perm += n;
        this.ev("buff", { uid: c.uid, n, why });
      }
    };
    if (rv === "kesh") {
      const w = this.weakest(mine.filter((x) => x !== c), P);
      if (w != null) {
        const pw = P[w.uid];
        if (this.destroy(w, c.uid)) gain(2 * Math.max(0, pw), "kesh");
      }
    } else if (rv === "copyist") {
      const cid = this.discard_costliest(side, c.uid);
      if (cid) gain(this.D[cid].cost, "copyist");
    } else if (rv === "silas") {
      const s = this.strongest(theirs, P);
      if (s != null) {
        for (let to = 0; to < 3; to++) if (to !== L && this.move(s, to, c.uid)) break;
      }
    } else if (rv === "portrait") {
      gain(2 * mine.filter((x) => x !== c && x.order < c.order).length, "portrait");
    } else if (rv === "croak") {
      let best = null;
      let gap = 0;
      for (let LL = 0; LL < 3; LL++) {
        const g = tot[o][LL] - tot[side][LL];
        if (LL !== L && this.room(side, LL) && g > gap) {
          best = LL;
          gap = g;
        }
      }
      if (best != null) this.move(c, best, c.uid);
      gain(2, "croak");
    } else if (rv === "juniper") {
      gain(this.S[o].hand.filter((h) => this.D[h].cost >= 4).length, "juniper");
      this.ev("peek", { side, hand: this.S[o].hand.slice() });
    } else if (rv === "pip") {
      const r = this.rng.below(2);
      this.ev("coin", { uid: c.uid, heads: r === 0 });
      const n = this.D.pip.fx && this.D.pip.fx.n != null ? this.D.pip.fx.n : 5;
      gain(r === 0 ? n : 0, "pip");
    } else if (rv === "novice") {
      const n = this.D.novice.fx && this.D.novice.fx.n != null ? this.D.novice.fx.n : 2;
      this.S[side].pending[L] += n;
    } else if (rv === "wick") {
      gain(this.S[side].played[`${this.turn - 1}:${L}`] ? 4 : 0, "wick");
    } else if (rv === "footnote") {
      gain(theirs.some((x) => P[x.uid] > P[c.uid]) ? 3 : 0, "footnote");
    } else if (rv === "hunter") {
      gain(theirs.length ? 2 : 0, "hunter");
    } else if (rv === "thorn") {
      gain(mine.length === 1 ? 4 : 0, "thorn");
    } else if (rv === "corvin") {
      this.draw(side);
      this.ev("draw", { side });
      const w = this.weakest(mine.filter((x) => x !== c), P);
      if (w != null && L + 1 < 3) this.move(w, L + 1, c.uid);
    } else if (rv === "ash_ember") {
      for (let LL = 0; LL < 3; LL++) {
        if (LL !== L && this.room(side, LL)) {
          const t = this.new_card(side, "ember", LL, true);
          this.S[side].board[LL].push(t);
          this.ev("summon", { uid: t.uid, id: "ember", lane: LL });
          break;
        }
      }
    } else if (rv === "blotling") {
      for (let LL = 0; LL < 3; LL++) {
        if (LL !== L && this.room(side, LL)) {
          const t = this.new_card(side, "ink_drop", LL, true);
          this.S[side].board[LL].push(t);
          this.ev("summon", { uid: t.uid, id: "ink_drop", lane: LL });
        }
      }
    } else if (rv === "wolf") {
      gain(tot[o][L] > tot[side][L] ? 3 : 0, "wolf");
    } else if (rv === "errata") {
      const w = this.weakest(theirs, P);
      if (w != null) this.destroy(w, c.uid);
      this.discard_costliest(o, c.uid);
    } else if (rv === "colophon") {
      for (const x of mine.filter((x) => x !== c)) this.destroy(x, c.uid);
    }
  }

  start_turn() {
    this.turn += 1;
    const turns = this.R.reveal_locations_on_turns;
    const at = turns.indexOf(this.turn);
    if (at >= 0) {
      this.revealed[at] = true;
      this.ev("location", { lane: at, id: this.locs[at] });
    }
    for (const side of ["A", "B"]) this.draw(side);
  }

  legal_plays(side, plays) {
    const h = this.S[side].hand.slice();
    let e = this.turn;
    const used = this.S[side].board.map((lane) => lane.length);
    const ok = [];
    for (const [cid, L] of plays) {
      const ix = h.indexOf(cid);
      if (ix >= 0 && this.D[cid].cost <= e && used[L] < this.slots(L)) {
        h.splice(ix, 1);
        e -= this.D[cid].cost;
        used[L] += 1;
        ok.push([cid, L]);
      }
    }
    return ok;
  }

  commit(side, plays) {
    const ok = this.legal_plays(side, plays);
    for (const [cid] of ok) {
      const ix = this.S[side].hand.indexOf(cid);
      if (ix >= 0) this.S[side].hand.splice(ix, 1);
    }
    this.S[side].plan = ok;
    return ok;
  }

  reveal() {
    const [, tot] = this.powers();
    const a = this.lanes_won(tot, "A");
    const b = this.lanes_won(tot, "B");
    let first;
    let why;
    if (a !== b) {
      first = a > b ? "A" : "B";
      why = "winning";
    } else {
      first = this.rng.below(2) === 0 ? "A" : "B";
      why = "coin";
    }
    this.ev("reveal_order", { first, why });
    for (const side of [first, OTHER[first]]) {
      for (const [cid, L] of this.S[side].plan) {
        let LL = null;
        for (let k = 0; k < 3; k++) {
          const cand = (L + k) % 3;
          if (this.room(side, cand)) {
            LL = cand;
            break;
          }
        }
        if (LL == null) {
          this.S[side].hand.push(cid);
          this.ev("bounce", { side, id: cid });
          continue;
        }
        const c = this.new_card(side, cid, LL);
        this.S[side].board[LL].push(c);
        this.S[side].played[`${this.turn}:${LL}`] = true;
        if (this.S[side].pending[LL] && !c.token) {
          c.perm += this.S[side].pending[LL];
          this.ev("buff", { uid: c.uid, n: this.S[side].pending[LL], why: "novice" });
          this.S[side].pending[LL] = 0;
        }
        this.ev("play", { side, uid: c.uid, id: cid, lane: LL });
        this.on_reveal(c);
      }
      this.S[side].plan = [];
    }
  }

  end_turn() {
    for (let L = 0; L < 3; L++) {
      if (this.loc(L) === "lanternfall") {
        for (const side of ["A", "B"]) {
          for (const c of this.S[side].board[L]) c.perm += 1;
        }
      }
    }
    const [, tot] = this.powers();
    this.ev("turn_end", { totA: tot.A.slice(), totB: tot.B.slice() });
    return tot;
  }

  result() {
    const [, tot] = this.powers();
    const a = this.lanes_won(tot, "A");
    const b = this.lanes_won(tot, "B");
    let w;
    let why;
    if (a !== b) {
      w = a > b ? "A" : "B";
      why = "lanes";
    } else {
      const ta = tot.A.reduce((s, n) => s + n, 0);
      const tb = tot.B.reduce((s, n) => s + n, 0);
      if (ta !== tb) {
        w = ta > tb ? "A" : "B";
        why = "total";
      } else {
        w = deriveSeed(this.seed, 999) % 2 === 0 ? "A" : "B";
        why = "seed";
      }
    }
    this.ev("end", { winner: w, why, totA: tot.A.slice(), totB: tot.B.slice(), locs: this.locs.slice() });
    return { winner: w, why, totA: tot.A, totB: tot.B, locs: this.locs.slice() };
  }
}

export function duel(recA, recB, seed, data) {
  const d = new Duel(recA.deck, recB.deck, seed, data);
  const turns = data.rules.turns;
  for (let t = 0; t < turns; t++) {
    d.start_turn();
    const pa = t < recA.plays.length ? recA.plays[t] : [];
    const pb = t < recB.plays.length ? recB.plays[t] : [];
    d.commit("A", pa.map((p) => [p[0], p[1]]));
    d.commit("B", pb.map((p) => [p[0], p[1]]));
    d.reveal();
    d.end_turn();
  }
  const r = d.result();
  r.log = d.log;
  return r;
}
