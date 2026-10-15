import { resolve } from "../../engine/ref/resolver.mjs";
import type { FightLogEvent, FightResult } from "../../engine/ref/resolver.mjs";
import { SHEET } from "./sheet";
import {
  ROUND_COINS,
  SELL_VALUE,
  SHOP_SECONDS,
  benchSlots,
  carryMode,
  houseBarMode,
} from "../config";
import { houseById, houseName } from "../houses";
import { pickNarration } from "../narration";
import { ensureSession, newId, record } from "../metrics";
import { loadProfile, saveProfile } from "../profile";
import { createFx, type Fx } from "../fx";
import { pickRival, type StoredRun } from "./bots";
import { carryLine, fightSeed, firstOf, matchOver, resultCopy } from "./match";
import { buyPiece, moveWithin, Shop } from "./shop";
import { roundStats, unit, type Piece } from "./sheet";
import {
  COLX,
  FOOT_ENEMY,
  FOOT_YOU,
  bookShell,
  costSeal,
  cutSrc,
  pencilSlot,
  practiceRibbon,
  purse,
  roundSeal,
  staticRibbon,
  tierDiamonds,
  tools,
  unitFigure,
  washColor,
} from "../v2";
const TUT_A = [
  { id: "deckhand", copies: 3 },
  { id: "blotling", copies: 1 },
];
const TUT_B = [
  { id: "copyist", copies: 1 },
  { id: "copyist", copies: 1 },
];

type Phase = "cover" | "shop" | "fight" | "result";
type RoundMark = "A" | "B" | "draw";

interface Inspect {
  name: string;
  flavour: string;
  trigger: string;
  text: string;
  merge: string;
}

interface AppState {
  phase: Phase;
  practice: boolean;
  tutorial: boolean;
  beat: number;
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
  r3: [number, number] | null;
  flash: number[];
  timer: number;
  blotSkin: boolean;
  hand: boolean;
  paused: boolean;
}

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const state: AppState = {
  phase: "cover",
  practice: false,
  tutorial: false,
  beat: 1,
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
  speed: reduced ? 2 : 1,
  skipping: false,
  r3: null,
  flash: [],
  timer: SHOP_SECONDS,
  blotSkin: false,
  hand: false,
  paused: false,
};

let stage: HTMLElement;
let timerId = 0;
let fx: Fx | null = null;
let barFrame = 0;
let bar: { win: (a?: string, b?: string) => void; frame: (t: number) => void; canvas: HTMLCanvasElement } | null = null;

function fit() {
  const s = Math.min(window.innerWidth / 390, window.innerHeight / 844);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}

function seed32(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] ?? 1;
}

function profile() {
  return loadProfile();
}

function say(seed: number, moment: "shop" | "fight" | "win" | "loss" | "draw") {
  const house = state.rival ? houseName(state.rival.house) : "They";
  state.narration = pickNarration(moment, seed, { rivalHouse: house });
}

function boot() {
  const app = document.querySelector("#app");
  if (!app) return;
  app.innerHTML = `<div class="stage" id="stage"></div>`;
  stage = document.getElementById("stage")!;
  fit();
  window.addEventListener("resize", fit);
  ensureSession("A");
  const practice = new URLSearchParams(location.search).get("practice") === "1";
  const prof = profile();
  if (!practice && !prof.tutA) startTutorial();
  else startMatch(practice);
}

function startTutorial() {
  state.practice = true;
  state.tutorial = true;
  state.beat = 1;
  state.phase = "cover";
  state.narration = "Oh. A reader.";
  state.matchId = newId();
  state.winners = [];
  state.meta = [];
  state.rival = null;
  record({ type: "tutorial_beat", prototype: "A", beat: 1, phase: "start", practice: true, matchId: state.matchId });
  render();
}

function enterTutorialShop() {
  record({ type: "tutorial_beat", prototype: "A", beat: 1, phase: "done", practice: true, matchId: state.matchId });
  state.beat = 2;
  state.phase = "shop";
  state.round = 1;
  state.coins = 3;
  state.line = [{ id: "deckhand", copies: 1 }];
  state.bench = [];
  state.shop = ["deckhand", "deckhand", null, null, null];
  state.engine = null;
  state.freeReroll = false;
  state.narration = "Three of the same. They get ideas.";
  state.hand = true;
  record({ type: "tutorial_beat", prototype: "A", beat: 2, phase: "start", practice: true, matchId: state.matchId });
  render();
  window.setTimeout(() => {
    state.hand = true;
    placeHand();
  }, 1500);
}

function startMatch(practice: boolean, forceFerris = false) {
  window.clearInterval(timerId);
  const prof = profile();
  state.practice = practice;
  state.tutorial = false;
  state.blotSkin = false;
  state.beat = 10;
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
  state.flash = [];
  state.freeReroll = false;
  state.rival = pickRival(
    { renown: prof.renown, matchesPlayed: prof.matchesPlayed },
    state.matchSeed,
    forceFerris || prof.matchesPlayed === 0 ? "ferris" : undefined,
  );
  state.engine = new Shop(1, state.matchSeed);
  state.shop = state.engine.roll([]);
  state.timer = SHOP_SECONDS;
  say(state.matchSeed, "shop");
  if (!practice) {
    record({ type: "match_start", prototype: "A", matchId: state.matchId, practice: false });
    const prof2 = profile();
    if (!prof2.tutA) {
      prof2.tutA = true;
      saveProfile(prof2);
    }
  }
  mountBar();
  render();
  armTimer();
}

function armTimer() {
  window.clearInterval(timerId);
  if (state.phase !== "shop" || state.tutorial) return;
  timerId = window.setInterval(() => {
    if (state.phase !== "shop") return;
    state.timer = Math.max(0, state.timer - 1);
    const ring = stage.querySelector<SVGCircleElement>(".timer .ink");
    if (ring) {
      const c = 2 * Math.PI * 16;
      ring.style.strokeDashoffset = String(c * (1 - state.timer / SHOP_SECONDS));
    }
  }, 1000);
}

function mountBar() {
  window.cancelAnimationFrame(barFrame);
  bar = null;
  if (houseBarMode() !== "mock" || state.practice || !state.rival || !window.HouseBar) return;
  bar = new window.HouseBar({ width: 366, height: 24, dpr: 2, you: "tidewrack", rival: state.rival.house });
  const loop = (t: number) => {
    bar?.frame(t);
    barFrame = requestAnimationFrame(loop);
  };
  barFrame = requestAnimationFrame(loop);
}

function pipClass(i: number): string {
  const w = state.winners[i];
  if (w === "A") return "win";
  if (w === "B") return "loss";
  if (w === "draw") return "draw";
  const done = state.phase === "result" || matchOver(state.winners);
  if (done && i >= state.winners.length) return "unplayed";
  if (i === state.winners.length) return "now";
  return "";
}

function sealKind(i: number): "won" | "lost" | "draw" | "now" | "wait" {
  const c = pipClass(i);
  if (c === "win") return "won";
  if (c === "loss") return "lost";
  if (c === "draw") return "draw";
  if (c === "now") return "now";
  return "wait";
}

function lineFigure(p: Piece, index: number, foot: number, zone: "line" | "bench"): string {
  const st = roundStats(p.id, p.copies);
  const ghost = zone === "line" && state.flash.includes(index);
  return unitFigure({
    id: p.id,
    cx: COLX(index),
    foot,
    atk: st.atk,
    hp: st.hp,
    max: st.hp,
    copies: p.copies,
    ghost,
    cls: ghost ? "ghosting" : "",
    attrs: `data-drag="unit" data-drop="${zone}" data-zone="${zone}" data-i="${index}"`,
  });
}

function render() {
  if (state.phase === "fight") return;
  const bench = benchSlots();
  const rival = state.rival;
  const house = rival ? houseById(rival.house) : null;
  const showShop = state.phase === "shop";
  const mode = houseBarMode();
  if (state.phase === "cover") {
    stage.innerHTML = `
      ${tools()}
      <button class="navbook" data-act="book">Book</button>
      ${practiceRibbon()}
      <img class="bard" alt="" src="/art/v2/bard.webp" style="left:150px;top:360px;width:92px;height:92px">
      <div class="speech" style="left:70px;top:470px;width:250px"><span class="who">BARD</span>${esc(state.narration)}</div>
      <div class="tap">TAP THE PAGE</div>
    `;
    bind();
    return;
  }
  const ribbon = state.practice
    ? practiceRibbon()
    : mode === "mock" && bar
      ? `<div class="ribbon live"></div>`
      : staticRibbon("tidewrack", rival?.house ?? "pit");
  const seals = [0, 1, 2].map((i) => roundSeal(sealKind(i), i, 16 + i * 33)).join("");
  const c = 2 * Math.PI * 16;
  const dash = c * (1 - state.timer / SHOP_SECONDS);
  const timer =
    showShop && !state.tutorial
      ? `<svg class="timer" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" stroke="rgba(230,205,165,.25)" stroke-width="3"/><circle class="ink" cx="20" cy="20" r="16" stroke="#efdcb5" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${dash.toFixed(1)}" transform="rotate(-90 20 20)"/><text x="20" y="25" text-anchor="middle" font-family="Cinzel,serif" font-size="13" font-weight="900" fill="#fff1d8">${state.timer}</text></svg>`
      : "";
  const who = state.blotSkin || state.tutorial || !rival
    ? { name: "The Blot", house: "practice", color: "#1B1712", av: "blotling", renown: "" }
    : { name: rival.name, house: houseName(rival.house), color: house?.a ?? "#1b1712", av: rival.snaps[0]?.[0]?.id ?? "grenna", renown: String(rival.renown) };
  const ghosts = state.tutorial
    ? [{ id: "token_inkdrop" }, { id: "token_inkdrop" }]
    : state.round > 1
      ? (rival?.snaps[state.round - 2] ?? [])
      : [];
  const enemy = Array.from({ length: 5 }, (_, i) => {
    const g = ghosts[i];
    if (!g) return pencilSlot(COLX(i), FOOT_ENEMY, true);
    return unitFigure({ id: g.id, cx: COLX(i), foot: FOOT_ENEMY, ghost: true });
  }).join("");
  const yours = showShop
    ? Array.from({ length: 5 }, (_, i) => {
        const p = state.line[i];
        return p ? lineFigure(p, i, FOOT_YOU, "line") : pencilSlot(COLX(i), FOOT_YOU, false, `data-drop="line" data-i="${i}"`);
      }).join("")
    : "";
  const shop = state.shop
    .map((id, i) => {
      const left = 14 + 73 * i;
      if (!id) return `<div class="card empty" style="left:${left}px"></div>`;
      const def = unit(id);
      const afford = state.coins >= def.tier;
      const owned = [...state.line, ...state.bench].find((p) => p.id === id);
      const hint = owned && owned.copies === 2 ? "★ MERGE" : owned && owned.copies === 1 ? "2ND COPY" : "";
      const glow = state.tutorial && i === 0 && hint ? " glow" : "";
      const band = washColor(id);
      const st = roundStats(id, 1);
      return `<button class="card${afford ? "" : " off"}${glow}" style="left:${left}px" data-drag="card" data-i="${i}">
        <div class="win"><img alt="" src="${cutSrc(id)}"></div>
        <div class="hb" style="background:${band}"></div>
        <div class="np">${esc(def.name)}</div>
        ${tierDiamonds(def.tier)}
        ${costSeal(def.tier, !afford)}
        <div class="badge atk"><img alt="" src="/art/v2/ui/badge-atk.webp"><span>${st.atk}</span></div>
        <div class="badge hp"><span>${st.hp}</span></div>
        ${hint ? `<div class="hint">${hint}</div>` : ""}
      </button>`;
    })
    .join("");
  const margin =
    bench && showShop
      ? `<div class="benchlbl">THE MARGIN</div>` +
        [0, 1, 2]
          .map((i) => {
            const p = state.bench[i];
            return `<div class="slot" style="left:${232 + 50 * i}px" data-drop="bench" data-i="${i}"><div class="dash"></div>${p ? `<img class="miniart" alt="" src="${cutSrc(p.id)}" data-drag="unit" data-zone="bench" data-i="${i}">` : ""}</div>`;
          })
          .join("")
      : "";
  const skip =
    state.tutorial && state.line.some((p) => p.id === "deckhand" && p.copies >= 3)
      ? `<button class="skip-tut" data-act="skip">Skip</button>`
      : "";
  const maxCoins = ROUND_COINS[state.round - 1] ?? state.coins;
  const result = state.phase === "result" ? resultHtml() : "";
  const capName = esc(who.name);
  stage.innerHTML = `
    ${tools()}
    <button class="navbook" data-act="book">Book</button>
    ${skip}
    ${ribbon}
    <div class="strip">
      ${seals}
      <div class="opp"><div class="av"><img alt="" src="${cutSrc(who.av)}"></div>
        <div class="nm">${capName}</div>
        <div class="hs"><i style="background:${who.color}"></i>${esc(who.house)}</div>
        ${who.renown ? `<div class="rn">${esc(who.renown)}</div>` : ""}
      </div>
      ${timer}
    </div>
    ${bookShell()}
    <div class="cap" style="left:22px;top:146px"><b>${capName}</b> · round ${["I", "II", "III"][state.round - 1] ?? "I"} line</div>
    <div class="cap" style="left:22px;top:500px"><b>Your line</b> · front ▸ back</div>
    ${showShop ? enemy : ""}
    ${showShop ? `<img class="lockseal" alt="" src="/art/v2/ui/seal-oxb-lock.webp"><div class="sealcap">Sealed until you Fight</div>` : ""}
    ${yours}
    <svg class="frontmark" width="10" height="44" viewBox="0 0 10 44"><path d="M2,2 L8,22 L2,42" fill="none" stroke="#3a2a17" stroke-width="2.4" stroke-linecap="round"/></svg>
    <img class="bard" alt="" src="/art/v2/bard.webp" data-drop="bard">
    <div class="speech${bench ? "" : " wide"}"><span class="who">BARD</span>${esc(state.narration)}</div>
    ${margin}
    ${showShop ? `<div class="drawer"><div class="lbl">THE DRAWER</div></div>${shop}` : ""}
    ${
      showShop
        ? `${purse(state.coins, Math.max(maxCoins, state.coins), "COINS")}
           <button class="act" data-act="reroll" style="left:20px;top:744px;width:64px;height:64px" ${state.coins < 1 && !state.freeReroll ? "disabled" : ""}>
             <img class="sealimg" alt="" src="/art/v2/ui/seal-ink-reroll.webp">
             ${state.freeReroll ? `<span class="free">FREE</span>` : `<img class="coinpip" alt="" src="/art/v2/ui/coin.webp">`}
             <span class="lbl">REROLL</span>
           </button>
           <button class="act" data-act="fight" style="left:262px;top:726px;width:104px;height:104px" ${canFight() ? "" : "disabled"}>
             <img class="sealimg" alt="" src="/art/v2/ui/seal-red-fight.webp">
             <span class="lbl">FIGHT</span>
           </button>`
        : ""
    }
    ${state.hand && showShop ? `<svg class="ghosthand" id="ghosthand" viewBox="0 0 64 76" width="40" height="48"><path d="M20,40 V10 a5,5 0 0 1 10,0 V32" fill="none" stroke="#f3e6c8" stroke-width="2.2" stroke-linecap="round"/><path d="M30,32 V26 a5,5 0 0 1 10,0 V36" fill="none" stroke="#f3e6c8" stroke-width="2.2"/><path d="M40,36 V30 a5,5 0 0 1 10,0 V40" fill="none" stroke="#f3e6c8" stroke-width="2.2"/><path d="M16,40 Q14,58 28,62 H40 Q54,58 50,40" fill="rgba(240,232,215,.2)" stroke="#f3e6c8" stroke-width="2"/></svg>` : ""}
    ${result}
  `;
  const host = stage.querySelector(".ribbon.live");
  if (host && bar) host.appendChild(bar.canvas);
  bind();
  if (state.hand) window.setTimeout(placeHand, 30);
  if (state.flash.length) {
    window.setTimeout(() => {
      state.flash = [];
      if (state.phase === "shop") render();
    }, 2000);
  }
}

function resultHtml(): string {
  const copy = resultCopy(state.winners, state.r3, state.matchSeed);
  const prof = profile();
  let tie = "";
  if (copy.tiebreak && state.r3) {
    const max = Math.max(state.r3[0], state.r3[1], 1);
    const seed = copy.tiebreak === "seed";
    tie = `<div class="tie">
      <div class="barrow"><div class="bar you" style="width:${(state.r3[0] / max) * 160}px"></div><b>${state.r3[0]}</b>${seed && copy.outcome === "win" ? "<span>the Book's seed</span>" : ""}</div>
      <div class="barrow"><div class="bar" style="width:${(state.r3[1] / max) * 160}px"></div><b>${state.r3[1]}</b>${seed && copy.outcome === "loss" ? "<span>the Book's seed</span>" : ""}</div>
    </div>`;
  }
  const won = copy.outcome === "win";
  const renown = !state.practice && won ? `<p>Renown +1 · ${prof.renown}</p>` : `<p>${state.practice ? "Practice. No House at stake." : "Renown stays."}</p>`;
  const drink =
    !state.practice && houseBarMode() === "mock" && won
      ? `<p>Your House drinks. Theirs spends.</p>`
      : "";
  const ask = !state.practice && !prof.preferenceAsked;
  const rounds = [0, 1, 2]
    .map((i) => {
      const w = state.winners[i];
      const kind = w === "A" ? "won" : w === "B" ? "lost" : w === "draw" ? "draw" : "wait";
      return roundSeal(kind, i);
    })
    .join("");
  return `<div class="veil"></div><div class="panel">
    <h2>${won ? "WON" : "LOST"}</h2>
    <div class="headline">${esc(copy.headline)}</div>
    ${state.rival ? `<p>against ${esc(state.rival.name)} of ${esc(houseName(state.rival.house))}</p>` : ""}
    <div class="rounds">${rounds}</div>
    ${tie}
    ${drink}
    ${renown}
    <p>“${esc(state.narration)}”</p>
    ${
      ask
        ? `<p>Which page do you want more of?</p>
           <div class="pref">
             <button data-act="pref" data-choice="A">The line</button>
             <button data-act="pref" data-choice="B">The duel</button>
             <button data-act="pref" data-choice="either">Either</button>
           </div>`
        : ""
    }
  </div>
  <button class="again" data-act="again">PLAY AGAIN</button>`;
}

function placeHand() {
  const hand = stage.querySelector<HTMLElement>("#ghosthand");
  const card = stage.querySelector<HTMLElement>("[data-drag=card]");
  if (!hand || !card) return;
  hand.style.left = `${card.offsetLeft + 16}px`;
  hand.style.top = `${card.offsetTop + 40}px`;
}

function bind() {
  stage.onpointerdown = (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-drag]");
    if (!t || state.phase !== "shop") return;
    ev.preventDefault();
    const startX = ev.clientX;
    const startY = ev.clientY;
    let moved = false;
    let long = window.setTimeout(() => {
      long = 0;
      inspectFrom(t);
    }, 350);
    const move = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 6) {
        moved = true;
        if (long) window.clearTimeout(long);
        long = 0;
        t.style.zIndex = "40";
        const scale = stage.getBoundingClientRect().width / 390 || 1;
        t.style.transform = `translate(${(e.clientX - startX) / scale}px, ${(e.clientY - startY) / scale - 12}px) scale(1.08)`;
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        stage.querySelectorAll(".sellhot").forEach((n) => n.classList.remove("sellhot"));
        hit?.closest("[data-drop=bard]")?.classList.add("sellhot");
      }
    };
    const up = (e: PointerEvent) => {
      if (long) window.clearTimeout(long);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      t.style.transform = "";
      t.style.zIndex = "";
      if (!moved) {
        if (t.dataset.drag === "card") tryBuy(Number(t.dataset.i));
        return;
      }
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-drop]");
      if (t.dataset.drag === "card") {
        const i = Number(t.dataset.i);
        if (hit?.dataset.drop === "line" || hit?.dataset.drop === "bench") {
          tryBuy(i, { zone: hit.dataset.drop, index: Number(hit.dataset.i) });
        } else tryBuy(i);
      } else if (t.dataset.drag === "unit") {
        const zone = t.dataset.zone === "bench" ? "bench" : "line";
        const index = Number(t.dataset.i);
        if (hit?.dataset.drop === "bard") sell(zone, index);
        else if (hit?.dataset.drop === "line" || hit?.dataset.drop === "bench") {
          transfer(zone, index, hit.dataset.drop, Number(hit.dataset.i));
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  stage.onclick = (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!t) {
      if (state.phase === "cover") enterTutorialShop();
      return;
    }
    const act = t.dataset.act;
    if (act === "book") location.href = "./index.html";
    else if (act === "skip" && state.phase !== "fight") skipTutorial();
    else if (act === "reroll") reroll();
    else if (act === "fight") void fight();
    else if (act === "again") startMatch(state.practice);
    else if (act === "pref") prefer(t.dataset.choice as "A" | "B" | "either");
    else if (state.phase === "cover") enterTutorialShop();
  };
}

function inspectFrom(el: HTMLElement) {
  if (el.dataset.drag === "card") {
    const id = state.shop[Number(el.dataset.i)];
    if (id) openInspect(inspectPiece({ id, copies: 1 }));
  } else {
    const list = el.dataset.zone === "bench" ? state.bench : state.line;
    const p = list[Number(el.dataset.i)];
    if (p) openInspect(inspectPiece(p));
  }
}

function inspectPiece(p: Piece): Inspect {
  const d = unit(p.id);
  const st = roundStats(p.id, p.copies);
  const merged = roundStats(p.id, 3);
  return {
    name: d.name,
    flavour: d.flavour,
    trigger: st.trigger.replaceAll("_", " "),
    text: st.text,
    merge: p.copies >= 3 ? "Level 2 is as far as this season goes." : `Level 2: ${merged.atk}/${merged.hp}. ${merged.text}`,
  };
}

function openInspect(info: Inspect) {
  stage.querySelector(".sheet")?.remove();
  const node = document.createElement("div");
  node.className = "sheet";
  node.innerHTML = `<h3>${esc(info.name)}</h3><p>${esc(info.flavour)}</p><p class="muted">${esc(info.trigger)}</p><p>${esc(info.text)}</p><p>${esc(info.merge)}</p><button class="btn-ink" style="height:44px;padding:0 16px;border-radius:8px" type="button">Close</button>`;
  node.querySelector("button")!.onclick = () => node.remove();
  stage.appendChild(node);
}

function canFight(): boolean {
  if (!state.line.length || state.phase !== "shop") return false;
  if (!state.tutorial) return true;
  return state.line.some((p) => p.id === "deckhand" && p.copies >= 3);
}

function shake(sel: string) {
  const n = stage.querySelector(sel);
  n?.classList.add("shake");
  window.setTimeout(() => n?.classList.remove("shake"), 220);
}

function tryBuy(index: number, at?: { zone: "line" | "bench"; index: number }) {
  const id = state.shop[index];
  if (!id || state.phase !== "shop") return;
  state.flash = [];
  state.hand = false;
  const cost = unit(id).tier;
  if (state.coins < cost) {
    shake("[data-purse]");
    return;
  }
  const owned = [...state.line, ...state.bench].find((p) => p.id === id);
  if (owned && owned.copies >= 3) {
    shake(`[data-drag=unit][data-i="${state.line.indexOf(owned)}"]`);
    return;
  }
  const result = buyPiece(state.line, state.bench, id, benchSlots(), at);
  if (result !== "ok") {
    shake(".purse");
    return;
  }
  state.coins -= cost;
  state.shop[index] = null;
  onBought();
  render();
}

function onBought() {
  if (!state.tutorial) return;
  const deck = state.line.find((p) => p.id === "deckhand");
  if (deck && deck.copies === 2 && state.beat < 3) {
    state.beat = 3;
    state.narration = "One more copy. Then they get an idea.";
    record({ type: "tutorial_beat", prototype: "A", beat: 2, phase: "done", practice: true, matchId: state.matchId });
    record({ type: "tutorial_beat", prototype: "A", beat: 3, phase: "start", practice: true, matchId: state.matchId });
  }
  if (deck && deck.copies >= 3 && state.beat < 4) {
    state.beat = 4;
    state.narration = "See? Ideas.";
    state.coins = 0;
    state.shop = ["footnote", null, null, null, null];
    state.freeReroll = true;
    record({ type: "tutorial_beat", prototype: "A", beat: 3, phase: "done", practice: true, matchId: state.matchId });
    window.setTimeout(() => {
      if (state.tutorial && state.beat === 4) {
        state.beat = 5;
        state.narration = "The front goes first. Pick someone brave.";
        state.hand = true;
        render();
        window.setTimeout(placeHand, 1500);
      }
    }, 900);
  }
}

function reroll() {
  if (state.phase !== "shop") return;
  if (state.freeReroll) {
    state.freeReroll = false;
    state.engine = new Shop(1, 7);
    state.shop = state.engine.roll(state.line);
    state.narration = "The front goes first. Pick someone brave.";
    render();
    return;
  }
  if (state.coins < 1 || !state.engine) {
    shake(".reroll");
    return;
  }
  state.coins -= 1;
  state.shop = state.engine.roll(state.line);
  render();
}

function sell(zone: "line" | "bench", index: number) {
  if (state.tutorial && state.beat < 5) return;
  const list = zone === "bench" ? state.bench : state.line;
  if (!list[index]) return;
  list.splice(index, 1);
  state.coins += SELL_VALUE;
  render();
}

function transfer(from: "line" | "bench", index: number, to: "line" | "bench", at: number) {
  if (from === to) {
    moveWithin(from === "line" ? state.line : state.bench, index, at);
    if (state.tutorial) state.narration = "The front goes first. Pick someone brave.";
    render();
    return;
  }
  const src = from === "line" ? state.line : state.bench;
  const dst = to === "line" ? state.line : state.bench;
  const cap = to === "line" ? 5 : benchSlots();
  const [item] = src.splice(index, 1);
  if (!item) return;
  if (dst.length >= cap) {
    const swapped = dst[Math.min(at, dst.length - 1)];
    if (swapped) {
      dst[Math.min(at, dst.length - 1)] = item;
      src.splice(index, 0, swapped);
    } else src.splice(index, 0, item);
  } else dst.splice(Math.min(at, dst.length), 0, item);
  render();
}

function skipTutorial() {
  const prof = profile();
  prof.tutA = true;
  saveProfile(prof);
  record({ type: "tutorial_beat", prototype: "A", beat: state.beat, phase: "done", practice: true, matchId: state.matchId });
  startMatch(false, true);
}

async function fight() {
  if (!canFight()) return;
  window.clearInterval(timerId);
  state.hand = false;
  let lineA = state.line.map((p) => ({ id: p.id, copies: p.copies }));
  let lineB: Piece[];
  let seed: number;
  if (state.tutorial) {
    lineA = TUT_A;
    lineB = TUT_B;
    seed = 1;
    state.blotSkin = true;
    state.speed = 0.75;
    record({ type: "tutorial_beat", prototype: "A", beat: 6, phase: "start", practice: true, matchId: state.matchId });
  } else {
    lineB = state.rival!.snaps[state.round - 1]!;
    seed = fightSeed(state.matchSeed, state.round);
    state.blotSkin = false;
    if (!state.practice) say(state.matchSeed + state.round, "fight");
  }
  const result = resolve(lineA, lineB, seed, SHEET);
  const first = firstOf(result.log);
  if (!state.tutorial) {
    state.meta.push({ round: state.round, first, roundWinner: result.winner });
    record({
      type: "round_end",
      prototype: "A",
      matchId: state.matchId,
      practice: state.practice,
      round: state.round,
      first,
      roundWinner: result.winner,
    });
  }
  state.phase = "fight";
  state.skipping = false;
  await playback(result, lineB);
  state.blotSkin = false;
  if (state.tutorial) {
    state.narration = "Survivors stay. Coins don't.";
    record({ type: "tutorial_beat", prototype: "A", beat: 6, phase: "done", practice: true, matchId: state.matchId });
    await stamp(result.winner);
    await afterTutorial();
    return;
  }
  const died = state.line.map((_, i) => i).filter((i) => !result.stats.survivorsA.includes(`A${i}`));
  state.line = carryLine(state.line, result, carryMode());
  state.flash = carryMode() === "line" ? died : [];
  state.winners.push(result.winner);
  if (state.round === 3) state.r3 = [result.stats.hpA, result.stats.hpB];
  await stamp(result.winner);
  if (matchOver(state.winners)) finishMatch();
  else nextRound();
}

async function afterTutorial() {
  const mode = houseBarMode();
  if (mode === "mock") {
    state.narration = "Win for real and your House drinks.";
    state.phase = "shop";
    render();
    await wait(1600);
  }
  state.narration = "Ferris left their team behind. Rude to keep them waiting.";
  state.phase = "shop";
  state.rival = pickRival({ renown: 0, matchesPlayed: 0 }, 1, "ferris");
  render();
  await wait(1600);
  const prof = profile();
  prof.tutA = true;
  saveProfile(prof);
  startMatch(false, true);
}

function nextRound() {
  state.round += 1;
  state.coins = ROUND_COINS[state.round - 1] ?? 7;
  state.engine = new Shop(state.round, state.matchSeed);
  state.shop = state.engine.roll(state.line);
  state.phase = "shop";
  state.timer = SHOP_SECONDS;
  say(state.matchSeed + state.round * 17, "shop");
  render();
  armTimer();
}

function finishMatch() {
  const copy = resultCopy(state.winners, state.r3, state.matchSeed);
  say(state.matchSeed + 99, copy.outcome === "win" ? "win" : "loss");
  state.phase = "result";
  if (!state.practice) {
    const prof = profile();
    prof.matchesPlayed += 1;
    if (copy.outcome === "win") prof.renown += 1;
    if (!prof.tutA) prof.tutA = true;
    saveProfile(prof);
    record({
      type: "match_end",
      prototype: "A",
      matchId: state.matchId,
      practice: false,
      result: copy.outcome,
    });
    if (prof.matchesPlayed === 1) record({ type: "first_match_complete", prototype: "A", matchId: state.matchId });
    if (bar && copy.outcome === "win") bar.win("tidewrack", state.rival?.house);
  }
  render();
}

function prefer(choice: "A" | "B" | "either") {
  const prof = profile();
  prof.preferenceAsked = true;
  saveProfile(prof);
  record({ type: "preference", prototype: null, choice });
  render();
}

async function stamp(winner: RoundMark) {
  const clash = stage.querySelector(".clash");
  if (!clash) return;
  const glyph = winner === "A" ? "WON" : winner === "B" ? "LOST" : "—";
  const node = document.createElement("div");
  node.className = "stamp";
  node.textContent = glyph;
  clash.appendChild(node);
  await wait(state.skipping ? 200 : 900);
}

interface Vis {
  uid: string;
  id: string;
  side: "A" | "B";
  copies: number;
  hp: number;
  max: number;
  atk: number;
  dying: boolean;
  lost: number;
}

async function beatWait(ms: number) {
  const step = 40;
  let left = ms;
  while (left > 0) {
    if (state.paused && !state.skipping) {
      await wait(step);
      continue;
    }
    await wait(Math.min(step, left));
    left -= step;
  }
}

function popHit(el: HTMLElement | null, n: number) {
  if (!el) return;
  const img = document.createElement("img");
  img.className = "splat";
  img.alt = "";
  img.src = `/art/v2/splat-${(Math.abs(Math.round(n)) % 3) + 1}.webp`;
  img.style.left = `${el.offsetLeft - 18}px`;
  img.style.top = `${el.offsetTop + 8}px`;
  const d = document.createElement("div");
  d.className = "dmg";
  d.textContent = String(n);
  d.style.left = `${el.offsetLeft + 8}px`;
  d.style.top = `${el.offsetTop + 18}px`;
  stage.appendChild(img);
  stage.appendChild(d);
  window.setTimeout(() => {
    img.remove();
    d.remove();
  }, 640);
}

async function playback(result: FightResult, _enemy: Piece[]) {
  const speed = () => (state.skipping ? 4 : state.speed);
  const first = firstOf(result.log);
  const rival = state.rival;
  const who = state.blotSkin ? "The Blot" : (rival?.name ?? "");
  state.paused = false;
  stage.innerHTML = `
    ${tools()}
    <button class="navbook" data-act="book">Book</button>
    ${state.practice ? practiceRibbon() : staticRibbon("tidewrack", rival?.house ?? "pit")}
    <div class="strip">
      ${[0, 1, 2].map((i) => roundSeal(sealKind(i), i, 16 + i * 33)).join("")}
      <div class="opp"><div class="av"><img alt="" src="${cutSrc(state.blotSkin ? "blotling" : (rival?.snaps[0]?.[0]?.id ?? "grenna"))}"></div>
        <div class="nm">${esc(who)}</div>
        <div class="hs">${state.blotSkin ? "practice" : esc(houseName(rival?.house ?? ""))}</div>
      </div>
    </div>
    ${bookShell()}
    <div class="cap" style="left:22px;top:146px"><b>${esc(who)}</b></div>
    <div class="cap" style="left:22px;top:500px"><b>Your line</b></div>
    <div id="field"></div>
    <div class="fx" id="fx"></div>
    <img class="bard" alt="" src="/art/v2/bard.webp">
    <div class="speech"><span class="who">BARD</span><span id="line">${esc(state.narration)}</span></div>
    <div class="queue" id="queue"></div>
    <div class="clash"></div>
    <button class="act" data-act="speed" style="left:26px;top:706px;width:72px;height:72px">
      <img class="sealimg" alt="" src="/art/v2/ui/seal-red-blank.webp"><span class="lbl" id="speedlbl">${state.speed === 2 ? "2×" : "1×"}</span>
    </button>
    <button class="act" data-act="pause" style="left:150px;top:696px;width:90px;height:90px">
      <img class="sealimg" alt="" src="/art/v2/ui/seal-ink-blank.webp"><span class="lbl" id="pauselbl">PAUSE</span>
    </button>
    <button class="act" data-act="skip" style="left:292px;top:706px;width:72px;height:72px">
      <img class="sealimg" alt="" src="/art/v2/ui/seal-ink-blank.webp"><span class="lbl">SKIP</span>
    </button>`;
  stage.querySelector("[data-act=book]")?.addEventListener("click", () => {
    location.href = "./index.html";
  });
  stage.querySelector("[data-act=speed]")?.addEventListener("click", () => {
    state.speed = state.speed === 2 ? 1 : 2;
    const lbl = stage.querySelector("#speedlbl");
    if (lbl) lbl.textContent = state.speed === 2 ? "2×" : "1×";
  });
  stage.querySelector("[data-act=pause]")?.addEventListener("click", () => {
    state.paused = !state.paused;
    const lbl = stage.querySelector("#pauselbl");
    if (lbl) lbl.textContent = state.paused ? "PLAY" : "PAUSE";
  });
  stage.querySelector("[data-act=skip]")?.addEventListener("click", () => {
    state.skipping = true;
    state.paused = false;
  });
  const host = stage.querySelector<HTMLElement>("#fx")!;
  fx = await createFx(host);
  const vis: Record<"A" | "B", Vis[]> = { A: [], B: [] };
  const by = new Map<string, Vis>();
  let saidDeath = false;
  let acting = "";
  const paint = () => {
    const field = stage.querySelector("#field");
    if (!field) return;
    const draw = (side: "A" | "B") =>
      vis[side]
        .map((u, i) => {
          const artId = state.blotSkin && side === "B" ? "blotling" : u.id;
          return unitFigure({
            id: u.id,
            artId,
            cx: COLX(i),
            foot: side === "A" ? FOOT_YOU : FOOT_ENEMY,
            atk: u.atk,
            hp: Math.max(0, u.hp),
            max: u.max,
            copies: u.copies,
            dying: u.dying,
            lost: u.lost,
            cls: `side-${side === "A" ? "a" : "b"}`,
            attrs: `data-uid="${u.uid}"`,
          });
        })
        .join("");
    field.innerHTML = draw("B") + draw("A");
    const queue = stage.querySelector("#queue");
    if (queue) {
      const alive = (side: "A" | "B") => vis[side].filter((u) => u.hp > 0 && !u.dying);
      const a = alive("A");
      const b = alive("B");
      const order: Vis[] = [];
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) {
        const pair = first === "A" ? [a[i], b[i]] : [b[i], a[i]];
        for (const u of pair) if (u) order.push(u);
      }
      queue.innerHTML =
        `<div class="lbl">ORDER OF BATTLE</div><div class="qnote">front acts first</div>` +
        order
          .slice(0, 6)
          .map((u, i) => {
            const artId = state.blotSkin && u.side === "B" ? "blotling" : u.id;
            return `<div class="qf${u.uid === acting ? " now" : ""}" style="left:${12 + i * 60}px"><img alt="" src="${cutSrc(artId)}"><div class="sd" style="background:${washColor(artId)}"></div></div>`;
          })
          .join("");
    }
  };
  const add = (side: "A" | "B", uid: string, id: string, copies: number, hp: number, at: number) => {
    let atk = 1;
    try {
      atk = roundStats(id, copies).atk;
    } catch {
      atk = 1;
    }
    const v: Vis = { uid, id, side, copies, hp, max: Math.max(1, hp), atk, dying: false, lost: 0 };
    vis[side].splice(Math.max(0, Math.min(at, vis[side].length)), 0, v);
    by.set(uid, v);
  };
  for (const ev of result.log) {
    const fast = state.skipping && ev.t !== "death";
    if (ev.t === "start") {
      const lines = ev.lines as { A: { uid: string; id: string; copies: number; hp: number }[]; B: { uid: string; id: string; copies: number; hp: number }[] };
      lines.A.forEach((u, i) => add("A", u.uid, u.id, u.copies, u.hp, i));
      lines.B.forEach((u, i) => add("B", u.uid, u.id, u.copies, u.hp, i));
      paint();
      if (!fast) await beatWait(200 / speed());
    } else if (ev.t === "attack") {
      acting = String(ev.src ?? "");
      paint();
      const src = stage.querySelector(`[data-uid="${ev.src}"]`);
      src?.classList.add("lunge");
      const tgt = by.get(String(ev.tgt));
      if (tgt && fx) {
        const i = vis[tgt.side].indexOf(tgt);
        fx.splat(COLX(i), tgt.side === "A" ? FOOT_YOU - 40 : FOOT_ENEMY - 40, Number(ev.n ?? 1));
      }
      if (!fast) await beatWait(420 / speed());
      src?.classList.remove("lunge");
    } else if (ev.t === "damage" || ev.t === "heal" || ev.t === "buff") {
      const v = by.get(String(ev.tgt));
      if (v && typeof ev.hp === "number") {
        if (ev.t === "damage") v.lost = Math.max(0, v.hp - ev.hp);
        v.hp = ev.hp;
        if (ev.t === "buff") v.max += Number(ev.dh ?? 0);
        paint();
      }
      const node = stage.querySelector<HTMLElement>(`[data-uid="${ev.tgt}"]`);
      if (ev.t === "damage") {
        node?.classList.add("hit");
        popHit(node, Number(ev.n ?? v?.lost ?? 1));
      }
      if (!fast) await beatWait(ev.t === "damage" ? 180 / speed() : 80 / speed());
      node?.classList.remove("hit");
      if (v) v.lost = 0;
    } else if (ev.t === "death") {
      const v = by.get(String(ev.uid));
      if (v) {
        v.hp = 0;
        v.dying = true;
        paint();
        if (state.tutorial && !saidDeath) {
          saidDeath = true;
          const speech = stage.querySelector("#line");
          if (speech) speech.textContent = "Ink doesn't bleed. It just stops.";
        }
        await beatWait(420 / (state.skipping ? 4 : speed()));
        vis[v.side] = vis[v.side].filter((u) => u !== v);
        by.delete(v.uid);
        paint();
      }
      await beatWait(480 / (state.skipping ? 4 : speed()));
    } else if (ev.t === "summon") {
      const uid = String(ev.uid);
      const side: "A" | "B" = uid.startsWith("B") ? "B" : "A";
      add(side, uid, String(ev.id), 1, Number(ev.hp ?? 1), Number(ev.slot ?? vis[side].length));
      paint();
    } else if (ev.t === "swap") {
      const uid = String(ev.a ?? "");
      const side: "A" | "B" = uid.startsWith("B") ? "B" : "A";
      const line = vis[side];
      if (line.length >= 2) {
        const back = line[line.length - 1]!;
        line[line.length - 1] = line[0]!;
        line[0] = back;
        paint();
      }
    } else if (ev.t === "trigger") {
      const src = by.get(String(ev.src));
      if (src) {
        const tag = document.createElement("div");
        tag.className = "tag";
        tag.textContent = String(ev.trig ?? "").replaceAll("_", " ");
        const i = vis[src.side].indexOf(src);
        tag.style.left = `${COLX(i) - 40}px`;
        tag.style.top = `${(src.side === "A" ? FOOT_YOU : FOOT_ENEMY) - 120}px`;
        stage.appendChild(tag);
        window.setTimeout(() => tag.remove(), 700);
        if (fx) fx.thread(COLX(i), src.side === "A" ? FOOT_YOU : FOOT_ENEMY, COLX(i), src.side === "A" ? FOOT_ENEMY : FOOT_YOU);
      }
      if (!fast) await beatWait(280 / speed());
    } else if (ev.t === "destroy") {
      const v = by.get(String(ev.tgt));
      if (v) v.hp = 0;
    }
  }
  fx?.destroy();
  fx = null;
  void (result.log satisfies FightLogEvent[]);
}

boot();
