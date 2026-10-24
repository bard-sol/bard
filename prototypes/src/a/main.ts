import "../v3/theme";
import { resolve } from "../../engine/ref/resolver.mjs";
import type { FightResult } from "../../engine/ref/resolver.mjs";
import { SHEET, unit } from "./sheet";
import { ROUND_COINS, SELL_VALUE, SHOP_SECONDS, benchSlots, carryMode, houseBarMode } from "../config";
import { houseName } from "../houses";
import { pickNarration } from "../narration";
import { ensureSession, newId, record } from "../metrics";
import { loadProfile, saveProfile } from "../profile";
import { createFx, type Fx } from "../fx";
import { pickRival, type StoredRun } from "./bots";
import { carryLine, fightSeed, firstOf, matchOver, resultCopy } from "./match";
import { buyPiece, moveWithin, Shop } from "./shop";
import type { Piece } from "./sheet";
import { project } from "./project";
import {
  bardAvatar,
  esc,
  houseBar,
  isMobile,
  popover,
  roundsHTML,
  sheet,
  shopCard,
  timerHTML,
  unitTile,
} from "../v3/markup";
import { artSrc, face } from "../v3/catalog";
import { icon } from "../v3/icons";

const TUT_B = [
  { id: "copyist", copies: 1 },
  { id: "copyist", copies: 1 },
];

type Phase = "cover" | "shop" | "fight" | "result";
type RoundMark = "A" | "B" | "draw";

interface Info {
  id: string;
  copies: number;
  pinned: boolean;
  buy: number | null;
  sell: { zone: "line" | "bench"; index: number } | null;
}

interface AppState {
  phase: Phase;
  practice: boolean;
  tutorial: boolean;
  matchId: string;
  matchSeed: number;
  round: number;
  coins: number;
  line: Piece[];
  bench: Piece[];
  shop: (string | null)[];
  engine: Shop | null;
  freeReroll: boolean;
  winners: RoundMark[];
  meta: { round: number; first: "A" | "B"; roundWinner: RoundMark }[];
  rival: StoredRun | null;
  narration: string;
  speed: number;
  skipping: boolean;
  paused: boolean;
  r3: [number, number] | null;
  timer: number;
  blotSkin: boolean;
  fight: FightResult | null;
  cursor: number;
  roundLines: Piece[][];
  info: Info | null;
  drawer: "left" | "right" | null;
  started: number;
}

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const shot = new URLSearchParams(location.search).get("shot");

const state: AppState = {
  phase: "cover",
  practice: false,
  tutorial: false,
  matchId: "",
  matchSeed: 1,
  round: 1,
  coins: 3,
  line: [],
  bench: [],
  shop: [],
  engine: null,
  freeReroll: false,
  winners: [],
  meta: [],
  rival: null,
  narration: "Oh. A reader.",
  speed: reduced ? 4 : 1,
  skipping: false,
  paused: false,
  r3: null,
  timer: SHOP_SECONDS,
  blotSkin: false,
  fight: null,
  cursor: 0,
  roundLines: [],
  info: null,
  drawer: null,
  started: Date.now(),
};

let root: HTMLElement;
let timerId = 0;
let fx: Fx | null = null;
let playToken = 0;
let hoverTimer = 0;
let barFrame = 0;
let bar: { win: (a?: string, b?: string) => void; frame: (t: number) => void; canvas: HTMLCanvasElement } | null = null;

function seed32(): number {
  if (shot) return 42;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] || 1;
}

function say(seed: number, moment: "shop" | "fight" | "win" | "loss" | "draw") {
  const house = state.rival ? houseName(state.rival.house) : "They";
  state.narration = pickNarration(moment, seed, { rivalHouse: house });
}

function boot() {
  const app = document.querySelector("#app");
  if (!app) return;
  app.classList.add("app");
  root = app as HTMLElement;
  ensureSession("A");
  window.addEventListener("resize", () => {
    fx?.resize();
    if (state.phase !== "fight") render();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      state.info = null;
      state.drawer = null;
      render();
    }
  });
  const practice = new URLSearchParams(location.search).get("practice") === "1";
  if (shot === "result") {
    showShotResult();
    return;
  }
  if (shot) {
    startMatch(false, true);
    if (shot === "info") {
      state.line = [{ id: "thorn", copies: 1 }, { id: "deckhand", copies: 2 }, { id: "wren", copies: 3 }];
      state.info = { id: "thorn", copies: 1, pinned: true, buy: null, sell: null };
      render();
    } else if (shot === "fight") {
      state.line = [
        { id: "sump_brawler", copies: 1 },
        { id: "grenna", copies: 1 },
        { id: "thorn", copies: 1 },
        { id: "hob", copies: 1 },
      ];
      void fight();
    }
    return;
  }
  const prof = loadProfile();
  if (!practice && !prof.tutA) startTutorial();
  else startMatch(practice);
}

function startTutorial() {
  state.practice = true;
  state.tutorial = true;
  state.phase = "cover";
  state.narration = "Oh. A reader.";
  state.matchId = newId();
  record({ type: "tutorial_beat", prototype: "A", beat: 1, phase: "start", practice: true, matchId: state.matchId });
  render();
}

function enterTutorialShop() {
  record({ type: "tutorial_beat", prototype: "A", beat: 1, phase: "done", practice: true, matchId: state.matchId });
  state.phase = "shop";
  state.round = 1;
  state.coins = 3;
  state.line = [{ id: "deckhand", copies: 1 }];
  state.bench = [];
  state.shop = ["deckhand", "deckhand", null, null, null];
  state.engine = null;
  state.narration = "Three of the same. They get ideas.";
  record({ type: "tutorial_beat", prototype: "A", beat: 2, phase: "start", practice: true, matchId: state.matchId });
  render();
}

function startMatch(practice: boolean, forceFerris = false) {
  window.clearInterval(timerId);
  playToken++;
  const prof = loadProfile();
  state.practice = practice;
  state.tutorial = false;
  state.blotSkin = false;
  state.phase = "shop";
  state.matchId = newId();
  state.matchSeed = seed32();
  state.round = 1;
  state.coins = ROUND_COINS[0];
  state.line = [];
  state.bench = [];
  state.winners = [];
  state.meta = [];
  state.r3 = null;
  state.roundLines = [];
  state.freeReroll = practice && !shot;
  state.rival = pickRival(
    { renown: prof.renown, matchesPlayed: prof.matchesPlayed },
    state.matchSeed,
    forceFerris || prof.matchesPlayed === 0 ? "ferris" : undefined,
  );
  state.engine = new Shop(1, state.matchSeed);
  state.shop = state.engine.roll([]);
  state.timer = SHOP_SECONDS;
  state.started = Date.now();
  say(state.matchSeed, "shop");
  if (!practice && !shot) {
    record({ type: "match_start", prototype: "A", matchId: state.matchId, practice: false });
    const prof2 = loadProfile();
    if (!prof2.tutA) {
      prof2.tutA = true;
      saveProfile(prof2);
    }
  }
  if (shot === "shop" || shot === "info") {
    state.line = [
      { id: "sump_brawler", copies: 3 },
      { id: "grub", copies: 2 },
      { id: "deckhand", copies: 1 },
      { id: "juniper", copies: 1 },
    ];
    state.bench = benchSlots() ? [{ id: "pip", copies: 1 }] : [];
    state.shop = ["deckhand", "kesh", "thorn", "index", "marrow"];
    state.coins = 3;
  }
  mountBar();
  render();
  armTimer();
}

function showShotResult() {
  state.practice = false;
  state.tutorial = false;
  state.phase = "result";
  state.matchSeed = 42;
  state.rival = pickRival({ renown: 4, matchesPlayed: 2 }, 42, "ferris");
  state.winners = ["A", "B", "A"];
  state.r3 = [9, 4];
  state.roundLines = [
    [{ id: "deckhand", copies: 1 }, { id: "wren", copies: 1 }],
    [{ id: "thorn", copies: 2 }, { id: "grub", copies: 1 }],
    [{ id: "sump_brawler", copies: 3 }, { id: "kesh", copies: 1 }],
  ];
  state.line = state.roundLines[2]!;
  state.narration = "The page turned their way.";
  state.started = Date.now() - 150000;
  render();
}

function armTimer() {
  window.clearInterval(timerId);
  if (state.phase !== "shop" || state.tutorial || shot) return;
  timerId = window.setInterval(() => {
    if (state.phase !== "shop") return;
    state.timer = Math.max(0, state.timer - 1);
    const node = root.querySelector(".timer");
    if (node) node.outerHTML = timerHTML(state.timer, state.timer / SHOP_SECONDS);
    if (state.timer === 0) void fight();
  }, 1000);
}

function mountBar() {
  window.cancelAnimationFrame(barFrame);
  bar = null;
  if (houseBarMode() !== "mock" || state.practice || !state.rival || !window.HouseBar) return;
  bar = new window.HouseBar({ width: 640, height: 18, dpr: 2, you: "tidewrack", rival: state.rival.house });
  const loop = (t: number) => {
    bar?.frame(t);
    barFrame = requestAnimationFrame(loop);
  };
  barFrame = requestAnimationFrame(loop);
}

function roundStates(): string[] {
  return [0, 1, 2].map((i) => {
    const w = state.winners[i];
    if (w === "A") return "won";
    if (w === "B") return "lost";
    if (w === "draw") return "draw";
    if (i === state.winners.length && state.phase !== "result") return "now";
    return "";
  });
}

function rivalSnap(): Piece[] {
  if (state.tutorial) return [{ id: "copyist", copies: 1 }, { id: "copyist", copies: 1 }];
  if (!state.rival) return [];
  const idx = state.phase === "fight" ? state.round - 1 : Math.max(0, state.round - 2);
  if (state.phase === "shop" && state.round === 1) return state.rival.snaps[0] ?? [];
  return state.rival.snaps[idx] ?? state.rival.snaps[0] ?? [];
}

function render() {
  const mobile = isMobile();
  if (state.phase === "cover") {
    root.innerHTML = `<div class="res"><div class="panel res-main" style="width:min(420px,92vw)">
      <div class="bardline">${bardAvatar()}<div class="says"><span class="who">Bard</span>${esc(state.narration)}</div></div>
      <button class="btn primary xl" data-act="open">Open the book</button>
      <button class="btn ghost" data-act="book">Back</button>
    </div></div>`;
    bind();
    return;
  }
  if (state.phase === "fight" && state.fight) {
    renderFight(mobile);
    return;
  }
  if (state.phase === "result") {
    renderResult(mobile);
    return;
  }
  renderShop(mobile);
}

function renderShop(mobile: boolean) {
  const rival = state.rival;
  const who = state.tutorial || !rival ? "The Blot" : rival.name;
  const house = state.tutorial || !rival ? "Neutral" : houseName(rival.house);
  const houseId = state.tutorial || !rival ? "fold" : rival.house;
  const hero = rivalSnap()[0]?.id ?? "grenna";
  const bench = benchSlots();
  const maxCoins = ROUND_COINS[state.round - 1] ?? 7;
  const owned = (id: string) => [...state.line, ...state.bench].find((p) => p.id === id);
  const enemy = rivalSnap()
    .map((p) => unitTile({ id: p.id, copies: p.copies, small: mobile, ghost: true }))
    .join("");
  const yours = state.line
    .map((p, i) =>
      unitTile({
        id: p.id,
        copies: p.copies,
        small: mobile,
        attrs: `data-drag="unit" data-zone="line" data-i="${i}"`,
      }),
    )
    .join("");
  const slots = Array.from({ length: Math.max(0, 5 - state.line.length) }, (_, i) => `<div class="slot-empty" data-drop="line" data-i="${state.line.length + i}" style="width:${mobile ? 68 : 140}px"></div>`).join("");
  const cards = state.shop
    .map((id, i) => {
      if (!id) return `<div class="card c-shop ${mobile ? "s" : ""}" style="opacity:.35"></div>`;
      const def = unit(id);
      const have = owned(id);
      const hint = have && have.copies === 2 ? "star" : have && have.copies === 1 ? "pair" : "";
      return shopCard({
        id,
        small: mobile,
        cant: state.coins < def.tier,
        hint: hint as "star" | "pair" | "",
        attrs: `data-drag="card" data-i="${i}"`,
      });
    })
    .join("");
  const margin = bench
    ? state.bench
        .map((p, i) => unitTile({ id: p.id, copies: p.copies, small: true, attrs: `data-drag="unit" data-zone="bench" data-i="${i}"` }))
        .join("") + `<div class="empty slot-empty" data-drop="bench" data-i="${state.bench.length}"></div>`.repeat(Math.max(0, bench - state.bench.length))
    : "";
  const live = houseBarMode() === "mock" && !state.practice;
  root.innerHTML = `${chrome(who, house, houseId, hero, mobile, live)}
  <main class="board"><div class="board-well">
    <div class="lane-h"><span><b>${esc(who)}</b> · round ${["I", "II", "III"][state.round - 1]} line</span><span class="d-only">Front ← · → back</span></div>
    <div class="line enemy">${enemy}<div class="seal">${icon("lock")}<div>Sealed until you fight<small>Their line, ghosted</small></div></div></div>
    <div class="mid"><div class="rlabel">${state.tutorial ? "" : timerHTML(state.timer, state.timer / SHOP_SECONDS)}<div><div class="t">Round ${["I", "II", "III"][state.round - 1]}</div><div class="s">Shop · build your line</div></div></div></div>
    <div class="line you">${yours}${slots}</div>
    <div class="lane-h"><span><b>Your line</b> · drag to reorder</span><span class="d-only">Front ← · → back</span></div>
  </div></main>
  <section class="dock">
    <div class="bench">${bench ? `<div class="dock-h lbl"><span><b>The Margin</b> · bench</span><span>${state.bench.length} / ${bench}</span></div><div class="slots">${margin}</div>` : `<div class="m-margin m-only">${bardAvatar()}<div class="says"><span class="who">Bard</span>${esc(state.narration)}</div></div>`}</div>
    <div class="shop"><div class="dock-h"><span><b>Shop</b></span><span class="d-only">Hover a card · drag to buy</span><span class="m-only">Tap ? for details</span></div>
      <div class="cards">${cards}</div></div>
    <div class="actions">
      <div class="panel purse"><div><div class="eyebrow d-only">Coins this round</div><div class="n">${state.coins}<small>/ ${maxCoins}</small></div></div></div>
      <div class="row2"><button class="btn secondary ${mobile ? "" : "lg"}" data-act="reroll" ${state.coins < 1 && !state.freeReroll ? "disabled" : ""}>${icon("reroll")}Reroll${state.freeReroll ? " · free" : " · 1"}</button></div>
      <button class="btn primary xl fight-btn" data-act="fight" ${state.line.length ? "" : "disabled"}>${icon("swords")}Fight</button>
    </div>
  </section></div>${infoLayer()}`;
  placeBar();
  bind();
}

function chrome(who: string, house: string, houseId: string, hero: string, mobile: boolean, live: boolean): string {
  const rs = roundStates();
  const bar = houseBar("tidewrack", houseId);
  return `<div class="screen">
  <header class="topbar d-only">
    <div class="brand"><span class="word">Bard</span><span class="mode">${state.practice ? "Practice" : "Prototype A · The line"}</span></div>
    <div class="tb-center"><div class="lbl"><span class="${live ? "live" : ""}">${live ? "House war · live" : "Houses"}</span><span>You · <b>the Tidewrack</b></span></div><div class="barhost">${bar}</div></div>
    <div class="tb-right"><span class="chip">${icon("swords")}Best of 3</span>
      <button class="btn icon secondary drawer-btn" type="button" data-act="drawer" data-which="left" aria-label="Opponent">${icon("eye")}</button>
      <button class="btn icon secondary drawer-btn" type="button" data-act="drawer" data-which="right" aria-label="Log">${icon("log")}</button>
      <a class="btn icon secondary" href="./index.html" aria-label="Book">${icon("close")}</a></div>
  </header>
  <div class="m-head m-only"><span class="avatar" style="--c:var(--h-${houseId === "tornmargin" ? "torn" : houseId}-a)"><img src="${artSrc(hero)}" alt=""></span>
    <div class="who"><b>${esc(who)}</b><span>${esc(house)}</span></div>
    <div class="m-rounds">${["I", "II", "III"].map((n, i) => `<i class="${rs[i] ?? ""}">${n}</i>`).join("")}</div></div>
  <div class="m-hbar m-only">${bar}</div>
  <aside class="side left edge ${state.drawer === "left" ? "open" : ""}">
    <div class="panel"><div class="opp"><span class="avatar"><img src="${artSrc(hero)}" alt=""></span>
      <div><h3>${esc(who)}</h3><div class="meta">${esc(house)}</div></div>
      <div class="renown"><b>${state.rival && !state.tutorial ? state.rival.renown : "—"}</b><span>Renown</span></div></div>
      <div class="pb" style="padding-top:0">${roundsHTML(rs)}</div></div>
    <div class="panel narr">${bardAvatar()}<div class="says"><span class="who">Bard</span>${esc(state.narration)}</div></div>
  </aside>
  <aside class="side right edge ${state.drawer === "right" ? "open" : ""}">
    <div class="panel"><div class="ph"><span class="eyebrow">Order of battle</span></div>
      <div class="pb"><div class="mini">${state.line
        .map((p, i) => {
          const u = face(p.id, p.copies);
          return `<div class="mrow"><span class="idx">${i + 1}</span><span class="th"><img src="${artSrc(p.id)}" alt=""></span><span class="nm">${esc(u.short)}<small>${esc(u.text)}</small></span></div>`;
        })
        .join("")}</div>
      <p style="margin:12px 2px 0;color:var(--text-3);font-size:12px">The whole line returns next round. Coins do not.</p></div></div>
  </aside>`;
}

function renderFight(mobile: boolean) {
  const view = project(state.fight!.log, state.cursor);
  const rival = state.rival;
  const who = rival?.name ?? "The Blot";
  const rs = roundStates();
  root.innerHTML = `<div class="screen fight">
  <header class="topbar d-only"><div class="brand"><span class="word">Bard</span><span class="mode">Fight</span></div>
    <div class="tb-center"><div class="lbl"><span>Line health</span><span>${view.hpA} – ${view.hpB}</span></div>${houseBar("tidewrack", rival?.house ?? "pit")}</div>
    <div class="tb-right"><span class="chip">${icon("swords")}Round ${["I", "II", "III"][state.round - 1]}</span></div></header>
  <div class="m-head m-only"><div class="who"><b>${esc(who)}</b><span>Fight</span></div>
    <div class="m-rounds">${["I", "II", "III"].map((n, i) => `<i class="${rs[i] ?? ""}">${n}</i>`).join("")}</div></div>
  <aside class="side left"><div class="panel narr">${bardAvatar()}<div class="says"><span class="who">Bard</span>${esc(state.narration)}</div></div>
    <div class="panel"><div class="ph"><span class="eyebrow">Line health · tiebreak</span></div><div class="pb"><b>${view.hpA}</b> you · <b>${view.hpB}</b> them</div></div></aside>
  <aside class="side right"><div class="panel" style="flex:1;overflow:auto"><div class="ph"><span class="eyebrow">Fight log</span></div>
    <div class="pb"><div class="log">${view.lines.map((l) => `<div class="li"><span class="t">${l.t}</span><span>${l.html}</span></div>`).join("")}</div></div></div></aside>
  <main class="board"><div class="board-well">
    <div class="lane-h"><span><b>${esc(who)}</b></span><span class="d-only">Front ←</span></div>
    <div class="line enemy">${view.B.map((u) => unitTile({ ...u, small: mobile, copies: u.copies, attrs: `data-uid="${u.uid}"` })).join("")}</div>
    <div class="mid"><div class="rlabel"><div><div class="t">${view.banner ? esc(view.banner) : "Trading blows"}</div><div class="s">${state.paused ? "Paused" : "Watch"}</div></div></div>
      ${view.banner ? `<div class="banner tag">${esc(view.banner)}</div>` : ""}</div>
    <div class="line you">${view.A.map((u) => unitTile({ ...u, small: mobile, copies: u.copies, attrs: `data-uid="${u.uid}"` })).join("")}</div>
    <div class="lane-h"><span><b>Your line</b></span></div>
  </div></main>
  <section class="dock fightdock">
    <div class="fd-l panel" style="padding:12px"><div class="eyebrow">Line health</div><div class="score">${view.hpA}<span>–</span>${view.hpB}</div></div>
    <div class="fd-c"><div class="queue">${view.queue
      .map((q) => `<div class="qi ${q.side === "A" ? "q-you" : "q-opp"} ${q.now ? "now" : ""}"><img src="${artSrc(q.id)}" alt=""><i></i></div>`)
      .join("")}</div></div>
    <div class="fd-r">
      <div class="seg">${[1, 2, 4].map((s) => `<button type="button" data-act="speed" data-n="${s}" class="${state.speed === s ? "on" : ""}">${s}×</button>`).join("")}</div>
      <button class="btn secondary" data-act="pause">${icon(state.paused ? "play" : "pause")}${state.paused ? "Play" : "Pause"}</button>
      <button class="btn ghost" data-act="skip">${icon("skip")}Skip</button>
    </div>
  </section></div>${infoLayer()}`;
  bind();
  fx?.resize();
}

function renderResult(mobile: boolean) {
  const copy = resultCopy(state.winners, state.r3, state.matchSeed);
  const won = copy.outcome === "win";
  const prof = loadProfile();
  const faces = (i: number) =>
    (state.roundLines[i] ?? [])
      .map((p) => `<span><img src="${artSrc(p.id)}" alt=""></span>`)
      .join("");
  const ask = !state.practice && !shot && !prof.preferenceAsked;
  root.innerHTML = `<div class="res"><div class="res-in">
    <div class="panel res-main">
      <div class="res-hd"><div class="eyebrow">${state.practice ? "Practice" : "Ranked"}</div>
        <h1>${won ? "Won" : "Lost"}<small>${esc(copy.headline.replace(/^(Won|Lost)\s/, ""))}</small></h1>
        <p>${state.rival ? `against ${esc(state.rival.name)} of ${esc(houseName(state.rival.house))}` : ""}</p></div>
      <div class="rcards">${[0, 1, 2]
        .map((i) => {
          const w = state.winners[i];
          const cls = w === "A" ? "won" : w === "B" ? "lost" : "";
          const word = w === "A" ? "Won" : w === "B" ? "Lost" : w === "draw" ? "Draw" : "—";
          return `<div class="rc ${cls}"><div class="top"><span class="n">${["I", "II", "III"][i]}</span><span class="r">${word}</span></div><div class="faces">${faces(i)}</div></div>`;
        })
        .join("")}</div>
      ${state.r3 ? `<p>Surviving ink ${state.r3[0]} – ${state.r3[1]}${copy.tiebreak === "seed" ? " · the Book’s seed" : ""}</p>` : ""}
      <div class="rew"><div class="rw">${icon("trophy")}<div><b>${!state.practice && won ? "+1" : "0"}</b><span>Renown ${prof.renown}</span></div></div>
        <div class="rw">${icon("clock")}<div><b>${Math.max(1, Math.round((Date.now() - state.started) / 1000))}s</b><span>Match</span></div></div></div>
      <div class="bardline">${bardAvatar()}<div class="says"><span class="who">Bard</span>${esc(state.narration)}</div></div>
      ${ask ? `<div class="pref"><span>Which page do you want more of?</span>
        <button class="btn secondary" data-act="pref" data-choice="A">The line</button>
        <button class="btn secondary" data-act="pref" data-choice="B">The duel</button>
        <button class="btn ghost" data-act="pref" data-choice="either">Either</button></div>` : ""}
      <div class="acts"><button class="btn primary xl" data-act="again">Play again</button><a class="btn ghost lg" href="./index.html">Book</a></div>
    </div>
    <div class="panel mvp d-only" style="padding:16px">${state.line[0] ? shopCard({ id: state.line[0].id, copies: state.line[0].copies }) : ""}</div>
  </div></div>`;
  if (!state.practice && won && bar) bar.win("tidewrack", state.rival?.house);
  bind();
}

function infoLayer(): string {
  const info = state.info;
  if (!info) return state.drawer ? `<div class="scrim show" data-act="close-info"></div>` : "";
  if (isMobile()) {
    return `<div class="scrim show" data-act="close-info"></div>${sheet(info.id, {
      copies: info.copies,
      buy: info.buy ?? undefined,
      sell: Boolean(info.sell),
    })}`;
  }
  return `<div class="pop-wrap" style="position:fixed;z-index:40;top:92px;right:28px;width:320px">${popover(info.id, info.copies, info.pinned)}</div>`;
}

function placeBar() {
  if (!bar) return;
  const host = root.querySelector(".barhost .hbar");
  if (host) {
    host.innerHTML = "";
    bar.canvas.style.width = "100%";
    bar.canvas.style.height = "18px";
    host.appendChild(bar.canvas);
  }
}

function bind() {
  if (shot) root.dataset.ready = shot !== "fight" || (state.phase === "fight" && state.paused) ? "1" : "0";
  root.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("pointerenter", () => {
      if (isMobile() || state.info?.pinned) return;
      window.clearTimeout(hoverTimer);
      hoverTimer = window.setTimeout(() => openInfo(card as HTMLElement, false), 250);
    });
    card.addEventListener("pointerleave", () => {
      window.clearTimeout(hoverTimer);
      if (!state.info?.pinned && state.phase !== "fight") {
        /* transient popover closes when the pointer leaves, unless pinned */
      }
    });
  });
  root.onpointerdown = (ev) => {
    const infoBtn = (ev.target as HTMLElement).closest<HTMLElement>("[data-info]");
    if (infoBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      openInfo(infoBtn, true);
      return;
    }
    const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-drag]");
    if (!t || state.phase !== "shop") return;
    const startX = ev.clientX;
    const startY = ev.clientY;
    let moved = false;
    const move = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) {
        moved = true;
        t.style.position = "relative";
        t.style.zIndex = "30";
        t.style.transform = `translate(${e.clientX - startX}px, ${e.clientY - startY}px)`;
      }
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      t.style.transform = "";
      t.style.zIndex = "";
      if (!moved) {
        if (isMobile()) openInfo(t, true);
        else openInfo(t, true);
        return;
      }
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-drop], .bard");
      if (t.dataset.drag === "card") {
        const i = Number(t.dataset.i);
        if (hit?.dataset.drop === "line" || hit?.dataset.drop === "bench") tryBuy(i, { zone: hit.dataset.drop, index: Number(hit.dataset.i) });
        else tryBuy(i);
      } else if (t.dataset.drag === "unit") {
        const zone = t.dataset.zone === "bench" ? "bench" : "line";
        const index = Number(t.dataset.i);
        if (hit?.classList.contains("bard")) sell(zone, index);
        else if (hit?.dataset.drop === "line" || hit?.dataset.drop === "bench") transfer(zone, index, hit.dataset.drop, Number(hit.dataset.i));
        else if (hit?.dataset.zone === "line" || hit?.dataset.zone === "bench") transfer(zone, index, hit.dataset.zone, Number(hit.dataset.i));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  root.onclick = (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!t) return;
    const act = t.dataset.act;
    if (act === "open") enterTutorialShop();
    else if (act === "book") location.href = "./index.html";
    else if (act === "reroll") reroll();
    else if (act === "fight") void fight();
    else if (act === "again") startMatch(state.practice);
    else if (act === "pref") prefer(t.dataset.choice as "A" | "B" | "either");
    else if (act === "pause") {
      state.paused = !state.paused;
      render();
    } else if (act === "skip") {
      state.skipping = true;
      state.paused = false;
    } else if (act === "speed") {
      state.speed = Number(t.dataset.n) || 1;
      render();
    } else if (act === "drawer") {
      const which = t.dataset.which === "right" ? "right" : "left";
      state.drawer = state.drawer === which ? null : which;
      render();
    } else if (act === "close-info") {
      state.info = null;
      state.drawer = null;
      if (state.phase === "fight") state.paused = false;
      render();
    } else if (act === "pin") {
      if (state.info) state.info.pinned = true;
      if (state.phase === "fight") state.paused = true;
      render();
    } else if (act === "sheet-buy" && state.info?.buy != null) tryBuy(state.info.buy);
    else if (act === "sheet-sell" && state.info?.sell) sell(state.info.sell.zone, state.info.sell.index);
  };
}

function openInfo(el: HTMLElement, pin: boolean) {
  const id = el.dataset.info || el.dataset.id;
  if (!id) return;
  const card = el.closest<HTMLElement>("[data-i], [data-id]");
  let copies = 1;
  let buy: number | null = null;
  let sell: Info["sell"] = null;
  if (card?.dataset.drag === "card") {
    buy = Number(card.dataset.i);
    copies = 1;
  } else if (card?.dataset.zone === "line" || card?.dataset.zone === "bench") {
    const zone = card.dataset.zone;
    const index = Number(card.dataset.i);
    const p = (zone === "bench" ? state.bench : state.line)[index];
    if (p) {
      copies = p.copies;
      sell = { zone, index };
    }
  } else {
    const onLine = state.line.find((p) => p.id === id);
    if (onLine) copies = onLine.copies;
  }
  state.info = { id, copies, pinned: pin || isMobile(), buy, sell };
  if (state.phase === "fight" && pin) state.paused = true;
  render();
}

function tryBuy(i: number, at?: { zone: "line" | "bench"; index: number }) {
  const id = state.shop[i];
  if (!id) return;
  const def = unit(id);
  if (state.coins < def.tier) return;
  const result = buyPiece(state.line, state.bench, id, benchSlots(), at);
  if (result !== "ok") return;
  state.coins -= def.tier;
  state.shop[i] = null;
  state.info = null;
  if (state.tutorial && state.line.some((p) => p.id === "deckhand" && p.copies >= 3)) {
    record({ type: "tutorial_beat", prototype: "A", beat: 2, phase: "done", practice: true, matchId: state.matchId });
    const prof = loadProfile();
    prof.tutA = true;
    saveProfile(prof);
    state.tutorial = false;
    void fight();
    return;
  }
  render();
}

function sell(zone: "line" | "bench", index: number) {
  const list = zone === "bench" ? state.bench : state.line;
  if (!list[index]) return;
  list.splice(index, 1);
  state.coins += SELL_VALUE;
  state.info = null;
  render();
}

function transfer(from: "line" | "bench", index: number, to: "line" | "bench", dest: number) {
  if (from === to) {
    moveWithin(from === "line" ? state.line : state.bench, index, dest);
  } else {
    const src = from === "line" ? state.line : state.bench;
    const dst = to === "line" ? state.line : state.bench;
    const cap = to === "line" ? 5 : benchSlots();
    const [item] = src.splice(index, 1);
    if (!item) return;
    if (dst.length >= cap) {
      src.splice(index, 0, item);
      return;
    }
    dst.splice(Math.max(0, Math.min(dest, dst.length)), 0, item);
  }
  render();
}

function reroll() {
  if (!state.engine) {
    state.shop = ["novice", "hunter", "pip", "footnote", "wolf"];
    render();
    return;
  }
  if (!state.freeReroll) {
    if (state.coins < 1) return;
    state.coins -= 1;
  }
  state.freeReroll = false;
  state.shop = state.engine.roll(state.line);
  render();
}

function prefer(choice: "A" | "B" | "either") {
  const prof = loadProfile();
  prof.preferenceAsked = true;
  saveProfile(prof);
  record({ type: "preference", prototype: null, choice });
  render();
}

async function fight() {
  if (!state.line.length || state.phase === "fight") return;
  window.clearInterval(timerId);
  const token = ++playToken;
  const enemy = state.tutorial
    ? TUT_B
    : (state.rival?.snaps[state.round - 1] ?? state.rival?.snaps[0] ?? [{ id: "novice", copies: 1 }]);
  const seed = state.tutorial ? 1 : fightSeed(state.matchSeed, state.round);
  const result = resolve(state.line.map((p) => ({ id: p.id, copies: p.copies })), enemy, seed, SHEET);
  state.fight = result;
  state.cursor = 0;
  state.phase = "fight";
  state.skipping = false;
  state.paused = false;
  state.info = null;
  say(seed, "fight");
  if (!fx) fx = await createFx(root);
  while (state.cursor < result.log.length) {
    if (token !== playToken) return;
    while (state.paused && !state.skipping) {
      await wait(40);
      if (token !== playToken) return;
    }
    state.cursor += 1;
    const ev = result.log[state.cursor - 1]!;
    render();
    await paintFx(ev);
    if (shot === "fight" && (ev.t === "trigger" || ev.t === "ward_break" || ev.t === "summon_fizzle")) {
      state.paused = true;
      render();
      return;
    }
    const slow = new Set(["attack", "damage", "trigger", "death", "ward_break", "summon", "summon_fizzle", "buff", "silence", "heal", "brace", "debuff"]);
    const ms = state.skipping ? (ev.t === "death" ? 90 : 0) : ((slow.has(ev.t) ? 380 : 30) / state.speed);
    if (ms) await wait(ms);
  }
  if (token !== playToken) return;
  finishRound(result);
}

async function paintFx(ev: { t: string; n?: unknown; src?: unknown; tgt?: unknown }) {
  if (!fx || state.skipping) return;
  const center = (uid: unknown) => {
    const hit = root.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
    const box = hit?.getBoundingClientRect();
    const host = root.getBoundingClientRect();
    if (!box) return null;
    return { x: box.left - host.left + box.width * 0.55, y: box.top - host.top + box.height * 0.45 };
  };
  if (ev.t === "damage" || ev.t === "ward_break") {
    const p = center(ev.tgt);
    if (p) fx.splat(p.x, p.y, Number(ev.n ?? 2));
  }
  if (ev.t === "trigger") {
    const a = center(ev.src);
    const b = center(ev.tgt ?? ev.src);
    if (a && b) fx.thread(a.x, a.y, b.x, b.y);
  }
}

function finishRound(result: FightResult) {
  const winner = result.winner;
  state.winners.push(winner);
  state.meta.push({ round: state.round, first: firstOf(result.log), roundWinner: winner });
  state.roundLines[state.round - 1] = state.line.map((p) => ({ ...p }));
  if (state.round === 3) state.r3 = [result.stats.hpA, result.stats.hpB];
  if (!state.practice && !shot) {
    record({
      type: "round_end",
      prototype: "A",
      matchId: state.matchId,
      round: state.round,
      first: firstOf(result.log),
      roundWinner: winner,
      practice: false,
    });
  }
  state.line = carryLine(state.line, result, carryMode());
  if (state.tutorial) {
    state.phase = "result";
    state.narration = "That was a practice. The real book charges a coin to look again.";
    record({ type: "tutorial_beat", prototype: "A", beat: 3, phase: "done", practice: true, matchId: state.matchId });
    const prof = loadProfile();
    prof.tutA = true;
    saveProfile(prof);
    render();
    return;
  }
  if (!matchOver(state.winners) && state.round < 3) {
    state.round += 1;
    state.coins = ROUND_COINS[state.round - 1] ?? 7;
    state.phase = "shop";
    state.engine = new Shop(state.round, state.matchSeed);
    state.shop = state.engine.roll(state.line);
    state.timer = SHOP_SECONDS;
    say(state.matchSeed + state.round, "shop");
    render();
    armTimer();
    return;
  }
  const copy = resultCopy(state.winners, state.r3, state.matchSeed);
  say(state.matchSeed, copy.outcome === "win" ? "win" : "loss");
  state.phase = "result";
  if (!state.practice && !shot) {
    const prof = loadProfile();
    if (copy.outcome === "win") {
      prof.renown += 1;
      prof.matchesPlayed += 1;
    } else prof.matchesPlayed += 1;
    saveProfile(prof);
    record({
      type: "match_end",
      prototype: "A",
      matchId: state.matchId,
      result: copy.outcome,
      practice: false,
    });
  }
  render();
}

boot();
