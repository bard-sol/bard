import "../v3/theme";
import { card, CARDS, locationName, starter } from "./cards";
import { duel, type DuelResult, type GhostRecord, type Play } from "./duel";
import { ghostById, pickGhost } from "./ghosts";
import { houseName } from "../houses";
import { pickNarration } from "../narration";
import { ensureSession, newId, record } from "../metrics";
import { loadProfile, saveProfile } from "../profile";
import { bardAvatar, duelCard, duelPopover, duelSheet, esc, houseBar, isMobile } from "../v3/markup";
import { artSrc, face } from "../v3/catalog";
import { icon } from "../v3/icons";

type Phase = "cover" | "commit" | "reveal" | "result" | "deck";

const shot = new URLSearchParams(location.search).get("shot");
let root: HTMLElement;
let phase: Phase = "cover";
let practice = false;
let tutorial = false;
let matchId = "";
let seed = 1;
let turn = 1;
let ghost: GhostRecord = ghostById("cinder");
let deck: string[] = [];
let plays: Play[] = [];
let raises: number[] = [];
let pending: Play[] = [];
let raised = false;
let selected: number | null = null;
let retreatTurn: number | undefined;
let retreatKind: "after_ghost" | "after_self" | "unprompted" | undefined;
let view: DuelResult | null = null;
let narration = "Three lanes. The ink is only for this match.";
let info: { id: string; pinned: boolean } | null = null;
let swapOut: string | null = null;
let hoverTimer = 0;

function seed32(): number {
  if (shot) return 7;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] || 1;
}

function live() {
  return { deck, plays, raises, retreatTurn, retreatKind };
}

function currentDeck(): string[] {
  const prof = loadProfile();
  return prof.customDeck ? [...prof.customDeck] : [...starter(prof.deckId).cards];
}

function boot() {
  const app = document.querySelector("#app");
  if (!app) return;
  app.classList.add("app");
  root = app as HTMLElement;
  ensureSession("B");
  window.addEventListener("resize", () => render());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && info) {
      info = null;
      render();
    }
  });
  const practiceQ = new URLSearchParams(location.search).get("practice") === "1";
  const prof = loadProfile();
  if (shot === "duel") {
    start(false);
    return;
  }
  if (!practiceQ && !prof.tutB && !shot) {
    tutorial = true;
    practice = true;
    phase = "cover";
    narration = "Drag a card into a lane. It stays face-down until the reveal.";
    matchId = newId();
    render();
    return;
  }
  start(practiceQ);
}

function start(asPractice: boolean) {
  practice = asPractice;
  tutorial = false;
  phase = "commit";
  matchId = newId();
  seed = seed32();
  const prof = loadProfile();
  ghost = asPractice ? ghostById("cinder") : pickGhost(prof.matchesPlayed, prof.renown, seed);
  deck = currentDeck();
  plays = [];
  raises = [];
  retreatTurn = undefined;
  retreatKind = undefined;
  pending = [];
  raised = false;
  selected = null;
  turn = 1;
  narration = pickNarration("shop", seed, { rivalHouse: houseName(ghost.house) });
  view = duel(live(), ghost, seed, { commitTurn: 1 });
  if (!asPractice && !shot) record({ type: "match_start", prototype: "B", matchId, practice: false });
  if (shot === "duel" && view) {
    for (let t = 1; t <= 2; t++) {
      const sim = duel(live(), ghost, seed, { commitTurn: t });
      let energy = t;
      let lane = 0;
      const affordable = sim.hands.A.map((id) => card(id))
        .filter((c) => c.cost > 0 && c.cost <= energy)
        .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
      for (const c of affordable) {
        if (c.cost > energy) continue;
        plays.push({ turn: t, cardId: c.id, lane: lane % 3 });
        energy -= c.cost;
        lane += 1;
        if (energy <= 0) break;
      }
    }
    view = duel(live(), ghost, seed, { commitTurn: 3 });
    turn = 3;
    phase = "commit";
  }
  render();
}

function energyLeft(): number {
  return Math.max(0, turn - pending.reduce((s, p) => s + card(p.cardId).cost, 0));
}

function handIds(): string[] {
  const ids = [...(view?.hands.A ?? [])];
  for (const p of pending) {
    const i = ids.indexOf(p.cardId);
    if (i >= 0) ids.splice(i, 1);
  }
  return ids;
}

function cap(lane: number): number {
  const rule = view?.lanes[lane];
  return rule?.revealed && rule.id === "torn_margin" ? 2 : 4;
}

function render() {
  const mobile = isMobile();
  if (phase === "deck") {
    root.innerHTML = `<div class="hub"><button class="btn ghost" data-act="back">Back</button><h1>Deck</h1><p class="note">Swap one card for one card. Twelve, no duplicates.</p>
      <div class="cards" style="display:flex;flex-wrap:wrap;gap:8px">${CARDS.map((c) => {
        const mine = currentDeck().includes(c.id);
        return `<button class="btn ${mine ? "primary" : "secondary"}" data-card="${c.id}">${esc(c.name)}</button>`;
      }).join("")}</div></div>`;
    bind();
    return;
  }
  if (phase === "cover") {
    root.innerHTML = `<div class="res"><div class="panel res-main" style="width:min(440px,92vw)">
      <div class="bardline">${bardAvatar()}<div class="says"><span class="who">Bard</span>${esc(narration)}</div></div>
      <button class="btn primary xl" data-act="open">Deal</button>
      <a class="btn ghost" href="./index.html">Book</a></div></div>`;
    bind();
    return;
  }
  if (!view) return;
  const powers = view.powers;
  const lanes = [0, 1, 2]
    .map((lane) => {
      const rule = view!.lanes[lane];
      const theirs = slots("B", lane, mobile);
      const mine = slots("A", lane, mobile);
      const t = powers[lane]?.[1] ?? 0;
      const m = powers[lane]?.[0] ?? 0;
      const lead = m > t ? "you" : t > m ? "them" : "";
      const title = rule?.revealed ? rule.name : `Lane ${["I", "II", "III"][lane]}`;
      return `<div class="lane"><div class="grid">${theirs}</div>
        <div class="lhd"><span class="tot ${lead === "them" ? "lead" : ""}"><b>${t}</b><span>Them</span></span>
          <span class="nm"><b>${esc(title)}</b><span>${rule?.revealed ? esc(rule.text) : "Hidden"}</span></span>
          <span class="tot ${lead === "you" ? "lead" : ""}"><b>${m}</b><span>You</span></span></div>
        <div class="grid">${mine}${phase === "commit" ? `<div class="slot drop" data-drop="lane" data-i="${lane}"></div>` : ""}</div></div>`;
    })
    .join("");
  const hand = handIds()
    .map((id, i) =>
      duelCard({
        id,
        small: mobile,
        cant: card(id).cost > energyLeft(),
        selected: selected === i,
        attrs: `data-hand="${i}" data-id="${id}"`,
      }),
    )
    .join("");
  const stake = view.stake;
  const ladder = [1, 2, 4, 8]
    .map((n) => `<i class="${n === stake ? "on" : n < stake ? "past" : ""}">${n}</i>`)
    .join("");
  const log = view.log
    .slice(-8)
    .map((e) => `<div class="li"><span class="t">T${e.turn ?? ""}</span><span>${logHTML(e)}</span></div>`)
    .join("");
  const profile =
    ghost.profile === "Cautious"
      ? "Folds from turn 3 if losing two lanes by 4."
      : ghost.profile === "Steady"
        ? "Folds from turn 4 if losing two lanes by 8."
        : "Does not fold to one raise.";
  root.innerHTML = `<div class="screen duelboard">
    <header class="topbar d-only"><div class="brand"><span class="word">Bard</span><span class="mode">Prototype B · Margin Duel</span></div>
      <div class="tb-center"><div class="lbl"><span>Houses</span><span>Ink is match points</span></div>${houseBar("tidewrack", ghost.house)}</div>
      <div class="tb-right"><span class="chip">${icon("clock")}Turn ${turn}/6</span><a class="btn icon secondary" href="./index.html">${icon("close")}</a></div></header>
    <div class="m-head m-only"><div class="who"><b>${esc(ghost.name)}</b><span>${esc(ghost.profile)} · stake ${stake}</span></div></div>
    <aside class="side left">
      <div class="panel"><div class="opp"><span class="avatar"><img src="${artSrc(ghost.deck[0] ?? "grenna")}" alt=""></span>
        <div><h3>${esc(ghost.name)}</h3><div class="meta">${esc(houseName(ghost.house))}</div></div>
        <div class="renown"><b>${ghost.renown}</b><span>Renown</span></div></div>
        <div class="pb"><div class="prof"><span class="eyebrow">Bluff profile</span><span class="chip">${icon("eye")}${esc(ghost.profile)}</span></div>
        <p style="color:var(--text-3);font-size:12px">${esc(profile)}</p></div></div>
      <div class="panel narr">${bardAvatar()}<div class="says"><span class="who">Bard</span>${esc(narration)}</div></div>
    </aside>
    <aside class="side right">
      <div class="panel"><div class="ph"><span class="eyebrow">Stake · Ink</span><span class="eyebrow">Max 8</span></div>
        <div class="pb"><div class="ladder">${ladder}</div>
        <p style="color:var(--text-2);font-size:12px">Raise doubles the stake. It buys nothing. Retreat pays the stake from before this raise.</p>
        ${phase !== "result" ? `<div style="display:flex;gap:8px;margin-top:8px"><button class="btn secondary" data-act="raise">${icon("raise")}Raise</button><button class="btn ghost" data-act="retreat">Retreat · −${stake}</button></div>` : ""}</div></div>
      <div class="panel" style="flex:1;overflow:auto"><div class="ph"><span class="eyebrow">Reveals</span></div><div class="pb"><div class="log">${log}</div></div></div>
    </aside>
    <main class="board"><div class="board-well">
      <div class="turns"><span class="pips">${[1, 2, 3, 4, 5, 6].map((i) => `<i class="${i < turn ? "done" : i === turn ? "now" : ""}"></i>`).join("")}</span>
        <span class="t">Turn ${turn} <span style="color:var(--text-3)">/ 6</span></span><span class="s">Win 2 of 3 lanes</span></div>
      <div class="lanes">${lanes}</div>
    </div></main>
    <section class="dock">
      <div class="d-only panel" style="padding:14px"><div class="eyebrow">Energy</div><div class="n" style="font:800 30px/1 var(--font-ui)">${energyLeft()}<small style="color:var(--text-3);font-size:13px">/ ${turn}</small></div></div>
      <div class="shop"><div class="dock-h"><span><b>${phase === "commit" ? "Your hand" : phase === "result" ? "Result" : "Revealed"}</b></span><span class="d-only">Every card has a rule. Lane rules are on.</span></div>
        <div class="cards">${phase === "commit" ? hand : ""}</div></div>
      <div class="actions">
        ${phase === "commit" ? `<button class="btn secondary" data-act="deck">Deck</button><button class="btn primary xl fight-btn" data-act="end">End turn</button>` : ""}
        ${phase === "reveal" ? `<button class="btn primary xl" data-act="next">Next turn</button>` : ""}
        ${phase === "result" ? `<button class="btn primary xl" data-act="again">${view.winner === "A" ? "Won" : "Lost"} ${view.stake} Ink · again</button>` : ""}
      </div>
    </section>
  </div>${info ? (mobile ? `<div class="scrim show" data-act="close-info"></div>${duelSheet(info.id)}` : `<div class="pop-wrap" style="position:fixed;z-index:40;right:24px;top:80px;width:320px">${duelPopover(info.id, info.pinned)}</div>`) : ""}`;
  bind();
}

function slots(side: "A" | "B", lane: number, mobile: boolean): string {
  const cards = (view?.board ?? []).filter((u) => u.side === side && u.lane === lane);
  const pendingHere = side === "A" ? pending.filter((p) => p.lane === lane) : [];
  const shown = [
    ...cards.map((u) => duelCard({ id: u.id, power: u.power, lane: true, small: mobile, buff: u.power > u.base, attrs: `data-id="${u.id}"` })),
    ...pendingHere.map((p) => duelCard({ id: p.cardId, lane: true, small: mobile, down: true, house: "tidewrack" })),
  ];
  return shown.join("");
}

function logHTML(e: { t: string; [k: string]: unknown }): string {
  const nm = (id: unknown) => {
    try {
      return esc(card(String(id)).name);
    } catch {
      return esc(face(String(id)).short);
    }
  };
  if (e.t === "location") return `<b>${esc(locationName(String(e.id)))}</b> is revealed`;
  if (e.t === "reveal_order") return `${e.first === "A" ? "You" : "They"} reveal first · ${esc(String(e.why))}`;
  if (e.t === "play") return `<b>${nm(e.id)}</b> plays in lane ${Number(e.lane) + 1}`;
  if (e.t === "reveal_fx") return `<b>${nm(e.id)}</b> · on reveal`;
  if (e.t === "buff") return `<b>${nm(e.id) === "undefined" ? "A card" : "Buff"}</b> <span class="bf">+${e.n}</span> · ${esc(String(e.why ?? ""))}`;
  if (e.t === "destroy") return `<b>${nm(e.id)}</b> is destroyed`;
  if (e.t === "destroy_blocked") return `Destroy blocked${e.by ? ` · ${esc(String(e.by))}` : ""}`;
  if (e.t === "summon") return `Summon <b>${nm(e.id)}</b>`;
  if (e.t === "move") return `Moved to lane ${Number(e.to) + 1}`;
  if (e.t === "discard") return `Discard <b>${nm(e.id)}</b>`;
  if (e.t === "coin") return `Crown Coin · ${e.heads ? "heads" : "tails"}`;
  if (e.t === "raise") return `<b>${e.side === "A" ? "You" : ghost.name}</b> raise · stake ${e.stake}`;
  if (e.t === "retreat") return `Retreat · ${e.stake} Ink`;
  if (e.t === "peek") return `You see their hand`;
  if (e.t === "end") return `<b>${e.winner === "A" ? "You" : "They"}</b> win · ${esc(String(e.why ?? ""))}`;
  if (e.t === "turn_end") return `Turn ends · ${JSON.stringify(e.totA)} / ${JSON.stringify(e.totB)}`;
  return esc(e.t);
}

function bind() {
  root.querySelectorAll(".card").forEach((el) => {
    el.addEventListener("pointerenter", () => {
      if (isMobile() || info?.pinned) return;
      const id = (el as HTMLElement).dataset.id;
      if (!id) return;
      window.clearTimeout(hoverTimer);
      hoverTimer = window.setTimeout(() => {
        info = { id, pinned: false };
        render();
      }, 250);
    });
  });
  root.onclick = (ev) => {
    const infoBtn = (ev.target as HTMLElement).closest<HTMLElement>("[data-info]");
    if (infoBtn?.dataset.info) {
      info = { id: infoBtn.dataset.info, pinned: true };
      render();
      return;
    }
    const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-act], [data-hand], [data-drop], [data-card]");
    if (!t) return;
    if (t.dataset.act === "open") {
      practice = true;
      tutorial = true;
      phase = "commit";
      seed = 3;
      ghost = ghostById("cinder");
      deck = [...starter("ranks").cards];
      plays = [];
      raises = [];
      pending = [];
      turn = 1;
      view = duel(live(), ghost, seed, { commitTurn: 1 });
      record({ type: "tutorial_beat", prototype: "B", beat: 1, phase: "start", practice: true, matchId });
      render();
    } else if (t.dataset.act === "end") endTurn();
    else if (t.dataset.act === "next") nextTurn();
    else if (t.dataset.act === "raise") {
      raised = !raised;
      narration = raised ? "The stake doubles if they stay." : narration;
      render();
    } else if (t.dataset.act === "retreat") retreat();
    else if (t.dataset.act === "again") start(practice);
    else if (t.dataset.act === "deck") {
      if (loadProfile().matchesPlayed < 1 && !shot) {
        narration = "Win a match, then the deck opens.";
        render();
        return;
      }
      phase = "deck";
      render();
    } else if (t.dataset.act === "back") {
      phase = "commit";
      render();
    } else if (t.dataset.act === "close-info") {
      info = null;
      render();
    } else if (t.dataset.hand != null && phase === "commit") {
      selected = Number(t.dataset.hand);
      render();
    } else if (t.dataset.drop === "lane" && phase === "commit") playTo(Number(t.dataset.i));
    else if (t.dataset.card) swapCard(t.dataset.card);
  };
  if (shot) root.dataset.ready = view && phase !== "cover" ? "1" : "0";
}

function playTo(lane: number) {
  const ids = handIds();
  const id = selected == null ? null : ids[selected];
  if (!id) return;
  if (card(id).cost > energyLeft()) {
    narration = "Not enough energy this turn.";
    render();
    return;
  }
  const count = (view?.board ?? []).filter((u) => u.side === "A" && u.lane === lane).length + pending.filter((p) => p.lane === lane).length;
  if (count >= cap(lane)) return;
  pending.push({ turn, cardId: id, lane });
  selected = null;
  render();
}

function swapCard(id: string) {
  const prof = loadProfile();
  const mine = prof.customDeck ? [...prof.customDeck] : [...starter(prof.deckId).cards];
  if (mine.includes(id)) {
    swapOut = id;
    narration = `${card(id).name} will leave. Pick the card that replaces it.`;
    render();
    return;
  }
  const slot = swapOut && mine.includes(swapOut) ? mine.indexOf(swapOut) : 0;
  mine[slot] = id;
  if (new Set(mine).size !== 12) return;
  prof.customDeck = mine;
  swapOut = null;
  saveProfile(prof);
  deck = mine;
  narration = "The deck is rewritten.";
  render();
}

function endTurn() {
  if (phase !== "commit" || !view) return;
  for (const p of pending) plays.push(p);
  if (raised) raises.push(turn);
  pending = [];
  selected = null;
  view = duel(live(), ghost, seed, { throughTurn: turn });
  phase = view.over ? "result" : "reveal";
  if (view.over) finish(view);
  render();
}

function nextTurn() {
  if (!view || view.over) return;
  if (tutorial && turn >= 2) {
    const prof = loadProfile();
    prof.tutB = true;
    saveProfile(prof);
    record({ type: "tutorial_beat", prototype: "B", beat: 6, phase: "done", practice: true, matchId });
    start(false);
    return;
  }
  turn += 1;
  raised = false;
  pending = [];
  view = duel(live(), ghost, seed, { commitTurn: turn });
  phase = "commit";
  narration = pickNarration("fight", seed + turn, { rivalHouse: houseName(ghost.house) });
  render();
}

function retreat() {
  if (!view || view.over || turn >= 6) return;
  retreatTurn = turn;
  retreatKind = view.raised.B ? "after_ghost" : raised ? "after_self" : "unprompted";
  view = duel(live(), ghost, seed, { throughTurn: turn });
  phase = "result";
  finish(view);
  render();
}

function finish(result: DuelResult) {
  narration =
    result.winner === "A"
      ? pickNarration("win", seed, { rivalHouse: houseName(ghost.house) })
      : pickNarration("loss", seed, { rivalHouse: houseName(ghost.house) });
  if (practice || tutorial || shot) return;
  const prof = loadProfile();
  prof.matchesPlayed += 1;
  prof.tutB = true;
  saveProfile(prof);
  record({
    type: "match_end",
    prototype: "B",
    matchId,
    practice: false,
    result: result.retreated?.side === "A" ? "fold" : result.winner === "A" ? "win" : "loss",
    stake: result.stake,
    bluff: result.bluff,
    retreatKind: result.retreated?.side === "A" ? retreatKind : undefined,
    raiseTurns: result.playerRaises,
  });
}

boot();
