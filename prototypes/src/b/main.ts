import { houseById, houseName } from "../houses";
import { pickNarration } from "../narration";
import { ensureSession, newId, record } from "../metrics";
import { loadProfile, saveProfile } from "../profile";
import { CARDS, card, STARTERS, starter } from "./cards";
import { duel, type DuelResult, type LiveInput, type Play } from "./duel";
import { ghostById, pickGhost } from "./ghosts";
import { unit } from "../a/sheet";
import { bookShell, costSeal, cutSrc, practiceRibbon, purse, staticRibbon, tierDiamonds, tools, washColor } from "../v2";

const LANES = [14, 137, 260];

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
  if (phase === "deck") {
    stage.innerHTML = `${tools()}<button class="navbook" data-act="back">Back</button>${deckHtml()}`;
    bind();
    return;
  }
  if (phase === "cover") {
    stage.innerHTML = `
      ${tools()}
      <button class="navbook" data-act="book">Book</button>
      ${tutorial ? `<button class="skip-tut" data-act="skip">Skip</button>` : ""}
      ${practiceRibbon()}
      <img class="bard" alt="" src="/art/v2/bard.webp" style="left:150px;top:360px;width:92px;height:92px">
      <div class="speech" style="left:70px;top:470px;width:250px"><span class="who">BARD</span>${esc(narration)}</div>
      <div class="tap">TAP THE PAGE</div>`;
    bind();
    return;
  }
  const gHouse = houseById(ghost.house);
  const ribbon = practice ? practiceRibbon() : staticRibbon("tidewrack", ghost.house);
  const powers = view?.powers ?? [
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  const lanes = LANES.map((x, lane) => {
    const theirs = minis("B", lane, false);
    const mine = minis("A", lane, true);
    const t = powers[lane]![1];
    const m = powers[lane]![0];
    return `${theirs}${mine}
      <div class="lanehit" data-drop="lane" data-i="${lane}" style="left:${x}px;top:360px;width:116px"></div>
      <div class="ltile" style="left:${x + 12}px"><span>${t}</span><span class="dot">·</span><span>${m}</span></div>
      <div class="lname" style="left:${x + 12}px">Lane ${["I", "II", "III"][lane]}</div>`;
  }).join("");
  const hand =
    phase === "commit"
      ? handIds()
          .map((id, i) => {
            const def = card(id);
            const left = 14 + 73 * Math.min(i, 4) - Math.max(0, i - 4) * 14;
            const off = def.cost > energyLeft();
            let tier = 1;
            try {
              tier = unit(id).tier;
            } catch {
              tier = 1;
            }
            return `<button class="card${off ? " off" : ""}${selected === i ? " glow" : ""}" style="left:${left}px" data-hand="${i}" data-id="${id}">
              <div class="win"><img alt="" src="${cutSrc(id)}"></div>
              <div class="hb" style="background:${washColor(id)}"></div>
              <div class="np">${esc(def.name)}</div>
              ${tierDiamonds(tier)}
              ${costSeal(def.cost, off)}
              <div class="pwseal"><img alt="" src="/art/v2/ui/seal-ink-cost-blank.webp"><span>${def.power}</span></div>
            </button>`;
          })
          .join("")
      : "";
  const pips = Array.from({ length: 6 }, (_, i) => {
    const cls = i + 1 < turn ? "on" : i + 1 === turn ? "now" : "";
    return `<i class="${cls}"></i>`;
  }).join("");
  const peek = view?.peek.A ? `<div>Next: ${esc(card(view.peek.A).name)}</div>` : "";
  const stamp = view?.raised.B || raised ? `<div class="raised">RAISED</div>` : "";
  const stake = view?.stake ?? 1;
  const actions =
    phase === "commit"
      ? `<button class="act" data-act="raise" style="left:20px;top:744px;width:64px;height:64px">
           <img class="sealimg" alt="" src="/art/v2/ui/seal-oxb-blank.webp"><span class="sealnum">×2</span><span class="lbl">RAISE</span>
         </button>
         <button class="act" data-act="end" style="left:262px;top:726px;width:104px;height:104px">
           <img class="sealimg" alt="" src="/art/v2/ui/seal-red-blank.webp"><span class="sealnum">END</span><span class="lbl">END TURN</span>
         </button>`
      : phase === "reveal" && view && !view.over && turn < 6
        ? `<button class="act" data-act="retreat" style="left:20px;top:744px;width:72px;height:72px">
             <img class="sealimg" alt="" src="/art/v2/ui/seal-ink-blank.webp"><span class="lbl">RETREAT</span>
           </button>
           <button class="act" data-act="next" style="left:262px;top:726px;width:104px;height:104px">
             <img class="sealimg" alt="" src="/art/v2/ui/seal-red-blank.webp"><span class="lbl">CONTINUE</span>
           </button>`
        : "";
  const result =
    phase === "result" && view
      ? `<div class="veil"></div><div class="panel">
          <h2>${view.winner === "A" ? "WON" : "LOST"}</h2>
          <div class="headline">${view.winner === "A" ? "+" : "−"}${view.stake} Ink</div>
          <p>Match points. Renown doesn't move.</p>
          <p>${esc(narration)}</p>
          <p>${esc(ghost.name)} · ${esc(ghost.profile)} · ${ghost.renown}</p>
          ${preferenceHtml()}
        </div>
        <button class="again" data-act="again">PLAY AGAIN</button>`
      : "";
  stage.innerHTML = `
    ${tools()}
    <button class="navbook" data-act="book">Book</button>
    ${tutorial ? `<button class="skip-tut" data-act="skip">Skip</button>` : ""}
    ${ribbon}
    <div class="strip">
      <div class="turnpips" style="top:8px;left:10px">${pips}</div>
      <div class="turnlab" style="top:26px;left:10px">TURN ${turn} OF 6</div>
      <div class="opp">
        <div class="av"><img alt="" src="${cutSrc(ghost.deck[0] ?? "silas")}"></div>
        <div class="nm">${esc(ghost.name)}</div>
        <div class="hs"><i style="background:${gHouse?.a ?? "#1b1712"}"></i>${esc(houseName(ghost.house))}</div>
        <div class="rn">${ghost.renown}</div>
      </div>
      <div class="stake" style="top:8px">INK ${stake}${raised ? " · ×2" : ""}</div>
    </div>
    ${bookShell()}
    <div class="dsep" style="left:132px"></div>
    <div class="dsep" style="left:255px"></div>
    <div class="cap" style="left:22px;top:146px"><b>${esc(ghost.name)}</b> · saved deck</div>
    <div class="cap" style="left:22px;top:500px"><b>Your cards</b></div>
    ${lanes}
    ${stamp}
    <img class="bard" alt="" src="/art/v2/bard.webp" style="top:508px">
    <div class="speech" style="top:520px;width:150px"><span class="who">BARD</span>${esc(narration)}${peek}</div>
    ${phase === "commit" ? purse(energyLeft(), turn, "ENERGY").replace('class="purse"', 'class="purse energy"') : ""}
    ${phase === "commit" ? `<div class="drawer"><div class="lbl">YOUR HAND</div></div>${hand}` : ""}
    ${phase === "commit" ? `<button class="deckbtn" data-act="deck">DECK</button>` : ""}
    ${actions}
    ${result}
  `;
  bind();
}

function minis(side: "A" | "B", lane: number, includePending: boolean): string {
  const placed = (view?.board ?? []).filter((u) => u.side === side && u.lane === lane);
  const extra =
    includePending && side === "A"
      ? pending.filter((p) => p.lane === lane).map((p) => ({ id: p.cardId, revealed: false, token: false, base: card(p.cardId).power }))
      : [];
  const all = [
    ...placed.map((u) => ({ id: u.id, revealed: u.revealed, token: u.token, base: u.base })),
    ...extra,
  ];
  const y0 = side === "B" ? 166 : 372;
  const html = all.slice(0, 4).map((u, i) => {
    const x = LANES[lane]! + 6 + (i % 2) * 58;
    const y = y0 + Math.floor(i / 2) * 66;
    if (!u.revealed) {
      return `<button class="mini fd" style="left:${x}px;top:${y}px" data-pending="${u.id}" data-lane="${lane}"><b>?</b></button>`;
    }
    return `<div class="mini" style="left:${x}px;top:${y}px"><img class="face" alt="" src="${cutSrc(u.id)}"><div class="hb" style="background:${washColor(u.id)}"></div><div class="pw">${u.base}</div></div>`;
  });
  for (let i = html.length; i < 4; i++) {
    const x = LANES[lane]! + 6 + (i % 2) * 58;
    const y = y0 + Math.floor(i / 2) * 66;
    html.push(`<div class="emptymini" style="left:${x}px;top:${y}px"></div>`);
  }
  return html.join("");
}

function preferenceHtml(): string {
  const prof = loadProfile();
  if (practice || prof.preferenceAsked) return "";
  return `<p>Which page do you want more of?</p><div class="pref">
    <button data-act="pref" data-choice="A">The line</button>
    <button data-act="pref" data-choice="B">The duel</button>
    <button data-act="pref" data-choice="either">Either</button></div>`;
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
  return `<div class="pool"><h2>Deck</h2><div>${starters}</div>${pool}</div>`;
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
