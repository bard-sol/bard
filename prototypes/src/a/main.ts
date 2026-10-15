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
import { roundStats, triggerGlyph, unit, unitArt, type Piece } from "./sheet";

const COLS = [15, 88, 161, 234, 307];
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

function pieceHtml(p: Piece, zone: "line" | "bench", index: number): string {
  const st = roundStats(p.id, p.copies);
  const ghost = zone === "line" && state.flash.includes(index) ? " ghosting" : "";
  return `<div class="unit${ghost}" data-drag="unit" data-zone="${zone}" data-i="${index}">
    <div class="clip" style="height:${68}px"><img class="art" alt="" src="${unitArt(p.id, p.copies)}"></div>
    ${triggerGlyph(st.trigger) ? `<img class="glyph" alt="" src="${triggerGlyph(st.trigger)}">` : ""}
  </div>`;
}

function render() {
  if (state.phase === "fight") return;
  const bench = benchSlots();
  const rival = state.rival;
  const house = rival ? houseById(rival.house) : null;
  const pips = [0, 1, 2]
    .map((i) => `<i class="pip ${pipClass(i)}" style="left:${16 + i * 34}px"></i>`)
    .join("");
  const slots = (zone: "line" | "bench", y: number, list: Piece[], xs: number[], w: number) =>
    xs
      .map((x, i) => {
        const p = list[i];
        return `<div class="slot${p ? " live" : ""}" data-drop="${zone}" data-i="${i}" style="left:${x}px;top:${y}px;width:${w}px;height:${w}px">${p ? pieceHtml(p, zone, i) : ""}</div>`;
      })
      .join("");
  const stats = state.line
    .map((p, i) => {
      const st = roundStats(p.id, p.copies);
      const pip =
        p.copies >= 3
          ? ""
          : `<img class="pips-merge" alt="" style="left:${COLS[i]! + 6}px" src="/art/glyphs/merge-progress-${p.copies === 1 ? 0 : 1}.svg">`;
      return `<div class="stat" style="left:${COLS[i]}px">◇${st.atk} ○${st.hp}</div>${pip}`;
    })
    .join("");
  const shop = state.shop
    .map((id, i) => {
      if (!id) return `<div class="scard" style="left:${COLS[i]}px"></div>`;
      const def = unit(id);
      const afford = state.coins >= def.tier;
      return `<button class="scard${afford ? "" : " dear"}" style="left:${COLS[i]}px" data-drag="card" data-i="${i}">
        <img class="frame" alt="" src="/art/cards/shop-cost${def.tier}${afford ? "" : "-off"}.svg">
        <img class="face" alt="" src="${unitArt(id, 1)}">
        <span class="nm">${esc(def.name)}</span>
      </button>`;
    })
    .join("");
  const coins = Array.from({ length: 7 }, (_, i) => `<img alt="" src="/art/glyphs/coin${i < state.coins ? "" : "-empty"}.svg">`).join("");
  const c = 2 * Math.PI * 16;
  const dash = c * (1 - state.timer / SHOP_SECONDS);
  const showShop = state.phase === "shop";
  const mode = houseBarMode();
  const ribbon =
    state.practice
      ? `<div class="ribbon">practice — no House at stake</div>`
      : mode === "mock" && bar
        ? `<div class="house"></div>`
        : "";
  const result = state.phase === "result" ? resultHtml() : "";
  const skip =
    state.tutorial && state.line.some((p) => p.id === "deckhand" && p.copies >= 3)
      ? `<button class="skip-tut" data-act="skip">Skip</button>`
      : "";
  stage.innerHTML = `
    <button class="book" data-act="book">Book</button>
    ${skip}
    ${ribbon}
    <div class="pips">${pips}</div>
    ${
      rival
        ? `<div class="chip"><i class="crest" style="background:${house?.a ?? "#1b1712"}"></i><b>${esc(rival.name)}</b><span>${esc(houseName(rival.house))} · ${rival.renown}</span></div>`
        : `<div class="chip"><b>The Blot</b><span>practice</span></div>`
    }
    ${
      showShop && !state.tutorial
        ? `<svg class="timer" viewBox="0 0 44 44"><circle cx="22" cy="22" r="16" stroke="#8a8478"/><circle class="ink" cx="22" cy="22" r="16" stroke="#1b1712" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${dash.toFixed(2)}" transform="rotate(-90 22 22)"/></svg>`
        : ""
    }
    <div class="slots">${slots("line", 151, [], COLS, 68)}</div>
    <div class="clash"></div>
    <div class="front-tick"></div>
    <div class="slots">${showShop ? slots("line", 303, state.line, COLS, 68) : ""}</div>
    ${showShop ? stats : ""}
    <img class="bard" alt="" src="/art/bard-sticker.svg" data-drop="bard">
    <div class="speech">${esc(state.narration)}</div>
    <div class="torn"></div>
    ${bench && showShop ? slots("bench", 511, state.bench, [16, 84, 152], 60) : ""}
    ${showShop ? `<div class="purse" data-purse>${coins}</div>` : ""}
    ${showShop ? shop : ""}
    <div class="actions">
      ${
        showShop
          ? `<button class="btn-line reroll" data-act="reroll" ${state.coins < 1 && !state.freeReroll ? "disabled" : ""}>↻ ${state.freeReroll ? "free" : "1"}</button>
             <button class="btn-ink fight" data-act="fight" ${canFight() ? "" : "disabled"}>Fight</button>`
          : ""
      }
    </div>
    ${state.hand && showShop ? `<div class="hand" id="ghosthand">▼</div>` : ""}
    ${result}
  `;
  const host = stage.querySelector(".house");
  if (host && bar) host.appendChild(bar.canvas);
  bind();
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
      <div class="barrow"><div class="bar you" style="width:${(state.r3[0] / max) * 180}px"></div><b>${state.r3[0]}</b>${seed && copy.outcome === "win" ? "<span>the Book's seed</span>" : ""}</div>
      <div class="barrow"><div class="bar" style="width:${(state.r3[1] / max) * 180}px"></div><b>${state.r3[1]}</b>${seed && copy.outcome === "loss" ? "<span>the Book's seed</span>" : ""}</div>
    </div>`;
  }
  const renown = !state.practice && copy.outcome === "win" ? `<p>Renown +1 · ${prof.renown}</p>` : `<p>${state.practice ? "Practice." : "Renown stays."}</p>`;
  const ask = !state.practice && !prof.preferenceAsked;
  return `<div class="veil"></div><div class="panel">
    <h2>${copy.outcome === "win" ? "Won" : "Lost"}</h2>
    <p>${esc(copy.headline)}</p>
    ${tie}
    <p>${esc(state.narration)}</p>
    ${renown}
    ${state.rival ? `<p>${esc(state.rival.name)} · ${esc(houseName(state.rival.house))}</p>` : ""}
    ${
      ask
        ? `<p>Which page do you want more of?</p>
           <div class="actions" style="position:relative;top:0;height:auto">
             <button class="btn-line" style="position:relative;width:100px;height:44px;margin-right:6px" data-act="pref" data-choice="A">The line</button>
             <button class="btn-line" style="position:relative;width:100px;height:44px;margin-right:6px" data-act="pref" data-choice="B">The duel</button>
             <button class="btn-line" style="position:relative;width:80px;height:44px" data-act="pref" data-choice="either">Either</button>
           </div>`
        : ""
    }
  </div>
  <div class="actions"><button class="btn-ink again" data-act="again">Play again</button></div>`;
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
        t.style.position = "relative";
        t.style.zIndex = "7";
        t.style.transform = `translate(${e.clientX - startX}px, ${e.clientY - startY - 12}px) scale(1.08)`;
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
      t.style.position = "";
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
    else if (act === "skip") skipTutorial();
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
}

async function playback(result: FightResult, _enemy: Piece[]) {
  const speed = () => (state.skipping ? 4 : state.speed);
  stage.innerHTML = `
    <button class="book" data-act="book">Book</button>
    ${state.practice ? `<div class="ribbon">practice — no House at stake</div>` : ""}
    <div class="pips">${[0, 1, 2].map((i) => `<i class="pip ${pipClass(i)}" style="left:${16 + i * 34}px"></i>`).join("")}</div>
    <div class="chip"><b>${state.blotSkin ? "The Blot" : esc(state.rival?.name ?? "")}</b></div>
    <div class="fx" id="fx"></div>
    <div id="enemy"></div>
    <div id="you"></div>
    <div class="front-tick"></div>
    <div class="speech">${esc(state.narration)}</div>
    <img class="bard" alt="" src="/art/bard-sticker.svg">
    <div class="chain" id="chain"></div>
    <div class="clash" style="top:219px;height:84px;position:absolute;width:390px"></div>
    <div class="actions">
      <button class="btn-line speed" data-act="speed">${state.speed === 2 ? "2×" : "1×"}</button>
      <button class="btn-line skip" data-act="skip">Skip</button>
    </div>`;
  stage.querySelector("[data-act=book]")?.addEventListener("click", () => {
    location.href = "./index.html";
  });
  stage.querySelector("[data-act=speed]")?.addEventListener("click", (ev) => {
    state.speed = state.speed === 2 ? 1 : 2;
    (ev.currentTarget as HTMLButtonElement).textContent = state.speed === 2 ? "2×" : "1×";
  });
  stage.querySelector("[data-act=skip]")?.addEventListener("click", () => {
    state.skipping = true;
  });
  const host = stage.querySelector<HTMLElement>("#fx")!;
  fx = await createFx(host);
  const vis: Record<"A" | "B", Vis[]> = { A: [], B: [] };
  const by = new Map<string, Vis>();
  let saidDeath = false;
  const paint = () => {
    for (const side of ["A", "B"] as const) {
      const root = stage.querySelector(side === "A" ? "#you" : "#enemy")!;
      root.innerHTML = vis[side]
        .map((u, i) => {
          const y = side === "A" ? 303 : 151;
          const pct = Math.max(0, Math.min(1, u.max ? u.hp / u.max : 0));
          const art =
            state.blotSkin && side === "B" ? `/art/units/blot-t${Math.min(5, i + 1)}.svg` : unitArt(u.id, u.copies);
          return `<div class="slot live" data-uid="${u.uid}" style="left:${COLS[i] ?? 15}px;top:${y}px"><div class="unit"><div class="clip" style="height:${Math.round(pct * 68)}px"><img class="art" alt="" src="${art}"></div></div></div>`;
        })
        .join("");
    }
  };
  const add = (side: "A" | "B", uid: string, id: string, copies: number, hp: number, at: number) => {
    const v: Vis = { uid, id, side, copies, hp, max: Math.max(1, hp) };
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
      if (!fast) await wait(200 / speed());
    } else if (ev.t === "attack") {
      const src = stage.querySelector(`[data-uid="${ev.src}"]`);
      src?.classList.add("lunge");
      const tgt = by.get(String(ev.tgt));
      if (tgt && fx) {
        const i = vis[tgt.side].indexOf(tgt);
        const x = (COLS[i] ?? 15) + 34;
        const y = tgt.side === "A" ? 186 : 34;
        fx.splat(x, y, Number(ev.n ?? 1));
      }
      if (!fast) await wait(420 / speed());
      src?.classList.remove("lunge");
    } else if (ev.t === "damage" || ev.t === "heal" || ev.t === "buff") {
      const v = by.get(String(ev.tgt));
      if (v && typeof ev.hp === "number") {
        v.hp = ev.hp;
        if (ev.t === "buff") v.max += Number(ev.dh ?? 0);
        paint();
      }
      const node = stage.querySelector(`[data-uid="${ev.tgt}"]`);
      if (ev.t === "damage") node?.classList.add("hit");
      if (!fast) await wait(ev.t === "damage" ? 180 / speed() : 80 / speed());
      node?.classList.remove("hit");
    } else if (ev.t === "death") {
      const v = by.get(String(ev.uid));
      if (v) {
        v.hp = 0;
        const side = v.side;
        vis[side] = vis[side].filter((u) => u !== v);
        by.delete(v.uid);
        paint();
        if (state.tutorial && !saidDeath) {
          saidDeath = true;
          const speech = stage.querySelector(".speech");
          if (speech) speech.textContent = "Ink doesn't bleed. It just stops.";
        }
      }
      await wait(900 / (state.skipping ? 4 : speed()));
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
      const chain = stage.querySelector("#chain");
      if (chain) chain.textContent = `${chain.textContent ?? ""} ${String(ev.trig ?? "").replaceAll("_", " ")}`.trim();
      const src = by.get(String(ev.src));
      if (src && fx) {
        const i = vis[src.side].indexOf(src);
        const x = (COLS[i] ?? 15) + 34;
        const y1 = src.side === "A" ? 186 : 34;
        fx.thread(x, y1, x, src.side === "A" ? 34 : 186);
      }
      if (!fast) await wait(280 / speed());
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
