import { houseBarMode } from "../config";
import { houseById, houseName } from "../houses";
import { pickNarration } from "../narration";
import { ensureSession, newId, record } from "../metrics";
import { loadProfile, saveProfile } from "../profile";
import { CARDS, card, STARTERS, starter } from "./cards";
import { duel, type DuelResult, type LiveInput, type Play } from "./duel";
import { ghostById, pickGhost } from "./ghosts";
import { unitArt } from "../a/sheet";

const LANES = [12, 137, 262];
const COLS = [15, 88, 161, 234, 307];

type Phase = "cover" | "commit" | "reveal" | "result" | "deck";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

let stage: HTMLElement;
const live = (): LiveInput => ({
  deck: [...deck],
  plays: plays.map((p) => ({ ...p })),
  raises: [...raises],
  retreatTurn,
  retreatKind,
});

let practice = false;
let tutorial = false;
let beat = 0;
let phase: Phase = "cover";
let matchId = "";
let seed = 1;
let ghost = ghostById("cinder");
let deck: string[] = [];
let plays: Play[] = [];
let raises: number[] = [];
let retreatTurn: number | undefined;
let retreatKind: LiveInput["retreatKind"];
let view: DuelResult | null = null;
let selected: number | null = null;
let pending: Play[] = [];
let raised = false;
let narration = "Oh. A reader.";
let turn = 1;
let swapOut: string | null = null;

function fit() {
  const s = Math.min(window.innerWidth / 390, window.innerHeight / 844);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}

function seed32(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] ?? 1;
}

function currentDeck(): string[] {
  const p = loadProfile();
  return p.customDeck ? [...p.customDeck] : [...starter(p.deckId).cards];
}

function boot() {
  const app = document.querySelector("#app");
  if (!app) return;
  app.innerHTML = `<div class="stage" id="stage"></div>`;
  stage = document.getElementById("stage")!;
  fit();
  window.addEventListener("resize", fit);
  ensureSession("B");
  practice = new URLSearchParams(location.search).get("practice") === "1";
  const prof = loadProfile();
  if (!practice && !prof.tutB) {
    tutorial = true;
    phase = "cover";
    narration = "Oh. A reader.";
    render();
  } else start(practice);
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
  if (!asPractice) record({ type: "match_start", prototype: "B", matchId, practice: false });
  render();
}

function startTutorialPlay() {
  tutorial = true;
  practice = true;
  phase = "commit";
  beat = 1;
  matchId = newId();
  seed = 3;
  ghost = ghostById("cinder");
  deck = [...starter("ranks").cards];
  plays = [];
  raises = [];
  pending = [];
  raised = false;
  turn = 1;
  narration = "Drag a card. The lane will count it.";
  view = duel(live(), ghost, seed, { commitTurn: 1 });
  record({ type: "tutorial_beat", prototype: "B", beat: 1, phase: "start", practice: true, matchId });
  render();
}

function energyLeft(): number {
  const spent = pending.reduce((s, p) => s + card(p.cardId).cost, 0);
  return Math.max(0, turn - spent);
}

function handIds(): string[] {
  const ids = [...(view?.hands.A ?? [])];
  for (const p of pending) {
    const i = ids.indexOf(p.cardId);
    if (i >= 0) ids.splice(i, 1);
  }
  return ids;
}

function render() {
  const gHouse = houseById(ghost.house);
  const mode = houseBarMode();
  const ribbon = practice
    ? `<div class="ribbon">practice — no House at stake</div>`
    : mode === "off"
      ? ""
      : `<div class="ribbon">House bar stays out of the duel</div>`;
  if (phase === "deck") {
    stage.innerHTML = deckHtml();
    bind();
    return;
  }
  const powers = view?.powers ?? [
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  const lanes = LANES.map((x, lane) => {
    const mine = cells("A", lane, true);
    const theirs = cells("B", lane, false);
    const lead = powers[lane]![0] === powers[lane]![1] ? "" : powers[lane]![0] > powers[lane]![1] ? "right" : "left";
    const wash = lead === "left" ? "#1b1712" : lead === "right" ? "#6fb3dd" : "transparent";
    return `<div class="lane" style="left:${x}px;top:143px;height:108px"><div class="grid4">${theirs}</div></div>
      <div class="lane-mid" style="position:absolute;left:${x}px;top:259px;width:116px">${powers[lane]![1]}<div class="wash" style="background:${wash}"></div>${powers[lane]![0]}</div>
      <div class="lane" style="left:${x}px;top:345px;height:108px" data-drop="lane" data-i="${lane}"><div class="grid4">${mine}</div></div>`;
  }).join("");
  const hand = handIds()
    .map((id, i) => {
      const def = card(id);
      const left = COLS[Math.min(i, 4)]! - Math.max(0, i - 4) * 12;
      const dear = def.cost > energyLeft() ? " dear" : "";
      return `<button class="hcard${selected === i ? " on" : ""}${dear}" style="left:${left}px" data-hand="${i}" data-id="${id}">
        <img class="frame" alt="" src="/art/cards/lane-card.svg">
        <img class="face" alt="" src="${unitArt(id, 1)}">
        <span class="nm">${def.cost} · ${esc(def.name)}</span>
      </button>`;
    })
    .join("");
  const pips = Array.from({ length: 6 }, (_, i) => {
    const cls = i + 1 < turn ? "win" : i + 1 === turn ? "now" : "";
    return `<i class="pip ${cls}" style="left:${12 + i * 22}px;width:16px;height:16px"></i>`;
  }).join("");
  const coins = Array.from({ length: turn }, (_, i) => `<img alt="" src="/art/glyphs/coin${i < energyLeft() ? "" : "-empty"}.svg">`).join("");
  const peek = view?.peek.A ? `<div class="peek">Next: ${esc(card(view.peek.A).name)}</div>` : "";
  const backs = ghost.deck
    .map((id) => `<i class="back">${card(id).cost}</i>`)
    .join("");
  const stamp = view?.raised.B ? `<div class="raise-stamp">RAISE</div>` : "";
  const actions =
    phase === "commit"
      ? `<button class="btn-line" style="left:15px;width:150px" data-act="raise">Raise ×2</button>
         <button class="btn-ink" style="left:180px;width:195px" data-act="end">End turn</button>`
      : phase === "reveal" && view && !view.over && turn < 6
        ? `<button class="btn-line" style="left:15px;width:150px" data-act="retreat">Retreat</button>
           <button class="btn-ink" style="left:180px;width:195px" data-act="next">Continue</button>`
        : phase === "result"
          ? `<button class="btn-ink again" data-act="again">Play again</button>`
          : "";
  const result =
    phase === "result" && view
      ? `<div class="veil"></div><div class="panel">
          <h2>${view.winner === "A" ? "Won" : "Lost"}</h2>
          <p>${view.winner === "A" ? "+" : "−"}${view.stake} Ink</p>
          <p>Match points. Renown doesn't move.</p>
          <p>${esc(narration)}</p>
          <p>${esc(ghost.name)} · ${esc(ghost.profile)} · ${ghost.renown}</p>
          ${preferenceHtml()}
        </div>`
      : "";
  stage.innerHTML = `
    <button class="book" data-act="book">Book</button>
    ${tutorial ? `<button class="skip-tut" data-act="skip">Skip</button>` : ""}
    ${ribbon}
    <div class="pips">${pips}</div>
    <div class="chip"><i class="crest" style="background:${gHouse?.a ?? "#1b1712"}"></i><b>${esc(ghost.name)}</b><span>${esc(houseName(ghost.house))} · ${ghost.renown} · ${esc(ghost.profile)}</span></div>
    <div class="badge">${view ? `Ink ${view.stake}${raised ? " → ×2" : ""}` : "Ink 1"}</div>
    ${stamp}
    ${lanes}
    <img class="bard" alt="" src="/art/bard-sticker.svg" style="top:466px">
    <div class="speech" style="top:474px">${esc(narration)}${peek}<div class="deckbacks" title="their deck">${backs}</div></div>
    <div class="energy">${coins}<span style="font-size:13px;margin-left:4px">energy ${energyLeft()}</span></div>
    ${phase === "commit" ? `<div class="handrow">${hand}</div>` : ""}
    <div class="actions">${actions}</div>
    ${phase === "commit" ? `<button class="book" style="top:500px;width:70px" data-act="deck">Deck</button>` : ""}
    ${result}
  `;
  bind();
}

function cells(side: "A" | "B", lane: number, includePending: boolean): string {
  const placed = (view?.board ?? []).filter((u) => u.side === side && u.lane === lane);
  const extra =
    includePending && side === "A"
      ? pending
          .filter((p) => p.lane === lane)
          .map((p) => ({ id: p.cardId, revealed: false, token: false, uid: `p${p.cardId}` }))
      : [];
  const all = [...placed.map((u) => ({ id: u.id, revealed: u.revealed, token: u.token, uid: u.uid })), ...extra];
  const boxes = all.slice(0, 4).map((u) => {
    if (!u.revealed) return `<div class="cell down" data-pending="${u.id}" data-lane="${lane}">?</div>`;
    return `<div class="cell"><img alt="" src="${u.token ? "/art/units/blot-t1.svg" : unitArt(u.id, 1)}"></div>`;
  });
  while (boxes.length < 4) boxes.push(`<div class="cell"></div>`);
  return boxes.join("");
}

function preferenceHtml(): string {
  const prof = loadProfile();
  if (practice || prof.preferenceAsked) return "";
  return `<p>Which page do you want more of?</p>
    <button class="btn-line" style="height:44px;margin-right:6px" data-act="pref" data-choice="A">The line</button>
    <button class="btn-line" style="height:44px;margin-right:6px" data-act="pref" data-choice="B">The duel</button>
    <button class="btn-line" style="height:44px" data-act="pref" data-choice="either">Either</button>`;
}

function deckHtml(): string {
  const prof = loadProfile();
  const mine = new Set(currentDeck());
  const starters = STARTERS.map(
    (d) => `<button type="button" data-starter="${d.id}" class="${prof.deckId === d.id && !prof.customDeck ? "mine" : ""}">${esc(d.name)}</button>`,
  ).join("");
  const pool =
    prof.matchesPlayed >= 1
      ? `<p>Tap one of yours, then a card you don't own. That is the swap.</p>` +
        CARDS.map((c) => {
          const cls = c.id === swapOut ? "on" : mine.has(c.id) ? "mine" : "";
          return `<button type="button" data-card="${c.id}" class="${cls}">${c.cost}/${c.power} ${esc(c.name)}</button>`;
        }).join("")
      : `<p>After the first duel you can swap cards one for one. For now, pick a starter.</p>`;
  return `<button class="book" data-act="back">Back</button><div class="pool"><h2>Deck</h2><div>${starters}</div>${pool}</div>`;
}

function bind() {
  stage.onclick = (ev) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-act],[data-hand],[data-drop],[data-starter],[data-card],[data-pending]");
    if (phase === "cover" && t?.dataset.act !== "book" && t?.dataset.act !== "skip") {
      startTutorialPlay();
      return;
    }
    if (!t) return;
    if (t.dataset.act === "book") location.href = "./index.html";
    else if (t.dataset.act === "skip") finishTutorial();
    else if (t.dataset.act === "deck") {
      phase = "deck";
      render();
    } else if (t.dataset.act === "back") {
      phase = "commit";
      render();
    } else if (t.dataset.starter) {
      const prof = loadProfile();
      prof.deckId = t.dataset.starter;
      prof.customDeck = null;
      saveProfile(prof);
      if (!tutorial) deck = currentDeck();
      phase = "commit";
      if (view && plays.length === 0) view = duel(live(), ghost, seed, { commitTurn: turn });
      render();
    } else if (t.dataset.card) swapCard(t.dataset.card);
    else if (t.dataset.hand != null && phase === "commit") {
      selected = Number(t.dataset.hand);
      render();
    } else if (t.dataset.drop === "lane" && phase === "commit" && selected != null) {
      playTo(Number(t.dataset.i));
    } else if (t.dataset.pending && phase === "commit") {
      const id = t.dataset.pending;
      const lane = Number(t.dataset.lane);
      const i = pending.findIndex((p) => p.cardId === id && p.lane === lane);
      if (i >= 0) pending.splice(i, 1);
      selected = null;
      render();
    } else if (t.dataset.act === "raise") {
      raised = !raised;
      narration = raised ? "Ink doubles if they stay." : narration;
      render();
    } else if (t.dataset.act === "end") endTurn();
    else if (t.dataset.act === "retreat") retreat();
    else if (t.dataset.act === "next") nextTurn();
    else if (t.dataset.act === "again") start(practice);
    else if (t.dataset.act === "pref") prefer(t.dataset.choice as "A" | "B" | "either");
  };
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
  if (count >= 4) return;
  pending.push({ turn, cardId: id, lane });
  selected = null;
  if (tutorial && beat === 1) narration = "The total ticks when it flips.";
  render();
}

function swapCard(id: string) {
  const prof = loadProfile();
  if (prof.matchesPlayed < 1) return;
  const mine = prof.customDeck ? [...prof.customDeck] : [...starter(prof.deckId).cards];
  if (mine.includes(id)) {
    swapOut = id;
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
  if (view.raised.B) narration = tutorial ? "They were bluffing. Decks do that." : "They raised.";
  else if (tutorial && beat === 1) narration = "Rude.";
  if (view.over) finish(view);
  render();
}

function nextTurn() {
  if (!view || view.over) return;
  if (tutorial && turn >= 2) {
    finishTutorial();
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
  narration = pickNarration("loss", seed, { rivalHouse: houseName(ghost.house) });
  finish(view);
  render();
}

function finish(result: DuelResult) {
  narration =
    result.winner === "A"
      ? pickNarration("win", seed, { rivalHouse: houseName(ghost.house) })
      : pickNarration("loss", seed, { rivalHouse: houseName(ghost.house) });
  if (practice || tutorial) return;
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
  if (prof.matchesPlayed === 1) record({ type: "first_match_complete", prototype: "B", matchId });
}

function finishTutorial() {
  const prof = loadProfile();
  prof.tutB = true;
  saveProfile(prof);
  record({ type: "tutorial_beat", prototype: "B", beat: 6, phase: "done", practice: true, matchId });
  start(false);
}

function prefer(choice: "A" | "B" | "either") {
  const prof = loadProfile();
  prof.preferenceAsked = true;
  saveProfile(prof);
  record({ type: "preference", prototype: null, choice });
  render();
}

boot();
