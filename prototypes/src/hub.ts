import { benchSlots, carryMode, houseBarMode, setBenchSlots, setCarryMode, setHouseBarMode } from "./config";
import { downloadSummary, resetMetrics } from "./metrics";
import { loadProfile, saveProfile } from "./profile";

const app = document.querySelector("#app");
if (app) {
  const stage = document.createElement("div");
  stage.className = "stage";
  app.appendChild(stage);
  const fit = () => {
    const s = Math.min(window.innerWidth / 390, window.innerHeight / 844);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  };
  fit();
  window.addEventListener("resize", fit);

  const draw = () => {
    const p = loadProfile();
    const bar = houseBarMode();
    const bench = benchSlots();
    const carry = carryMode();
    stage.innerHTML = `<div class="hub">
      <h1>Bard</h1>
      <p class="sub">Two ways to read a page. Renown ${p.renown}. No coins, no wallet.</p>
      <a class="choice" href="./a.html">The line<span>Buy a line. Watch it fight. Best of three.</span></a>
      <a class="choice" href="./b.html">The duel<span>Three lanes, six turns, raise the ink. Match points only.</span></a>
      <p class="row">
        <a class="tiny" href="./a.html?practice=1">Practice the line</a>
        <a class="tiny" href="./b.html?practice=1">Practice the duel</a>
      </p>
      <p class="note">House bar is ${bar}. Bench is ${bench === 0 ? "off" : "3 slots"}. Carry is ${carry === "line" ? "the whole line" : "survivors only"}.</p>
      <p class="row">
        <button type="button" data-act="bar">${bar === "mock" ? "Hide House bar" : "Show mock House bar"}</button>
        <button type="button" data-act="bench">${bench === 0 ? "Open the Margin" : "Close the Margin"}</button>
        <button type="button" data-act="carry">${carry === "line" ? "Try survivors" : "Whole line returns"}</button>
      </p>
      <p class="row">
        <button type="button" data-act="export">Download metrics</button>
        <button type="button" data-act="reset">Reset this book</button>
      </p>
      <p class="note">A win on the line is +1 Renown. A duel’s stake is Ink for that match. It never adds Renown and a loss never spends it. Round 1’s first move is logged with the metrics.</p>
    </div>`;
    stage.querySelector("[data-act=bar]")?.addEventListener("click", () => {
      setHouseBarMode(houseBarMode() === "mock" ? "off" : "mock");
      draw();
    });
    stage.querySelector("[data-act=bench]")?.addEventListener("click", () => {
      setBenchSlots(benchSlots() === 0 ? 3 : 0);
      draw();
    });
    stage.querySelector("[data-act=carry]")?.addEventListener("click", () => {
      setCarryMode(carryMode() === "line" ? "survivors" : "line");
      draw();
    });
    stage.querySelector("[data-act=export]")?.addEventListener("click", () => downloadSummary());
    stage.querySelector("[data-act=reset]")?.addEventListener("click", () => {
      resetMetrics();
      saveProfile({
        renown: 0,
        matchesPlayed: 0,
        tutA: false,
        tutB: false,
        preferenceAsked: false,
        deckId: "ranks",
        customDeck: null,
      });
      draw();
    });
  };
  draw();
}
