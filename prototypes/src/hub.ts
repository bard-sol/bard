import "./v3/theme";
import { benchSlots, carryMode, houseBarMode, setBenchSlots, setCarryMode, setHouseBarMode } from "./config";
import { downloadSummary, resetMetrics } from "./metrics";
import { loadProfile, saveProfile } from "./profile";

const app = document.querySelector("#app");
if (app) {
  app.classList.add("app");
  const draw = () => {
    const p = loadProfile();
    const bar = houseBarMode();
    const bench = benchSlots();
    const carry = carryMode();
    app.innerHTML = `<div class="hub">
      <h1>Bard</h1>
      <p class="note">Two ways to read a page. Renown ${p.renown}. No wallet, no token.</p>
      <a class="choice" href="./a.html"><b>The line</b><span>Buy a line. Watch the abilities fight. Best of three.</span></a>
      <a class="choice" href="./b.html"><b>The duel</b><span>Three lanes, six turns, raise the ink. Match points only.</span></a>
      <p class="row">
        <a class="tiny" href="./a.html?practice=1">Practice the line</a>
        <a class="tiny" href="./b.html?practice=1">Practice the duel</a>
      </p>
      <p class="note">House bar is ${bar}. Bench is ${bench === 0 ? "off" : "3 slots"}. Carry is ${carry === "line" ? "the whole line" : "survivors only"}. Lane rules are always on.</p>
      <p class="row">
        <button type="button" data-act="bar">${bar === "mock" ? "Hide House bar" : "Show mock House bar"}</button>
        <button type="button" data-act="bench">${bench === 0 ? "Open the Margin" : "Close the Margin"}</button>
        <button type="button" data-act="carry">${carry === "line" ? "Try survivors" : "Whole line returns"}</button>
      </p>
      <p class="row">
        <button type="button" data-act="export">Download metrics</button>
        <button type="button" data-act="reset">Reset this book</button>
      </p>
      <p class="note">A line win is +1 Renown. A duel’s stake is Ink for that match. It never adds Renown, and a loss never spends it.</p>
    </div>`;
    app.querySelector("[data-act=bar]")?.addEventListener("click", () => {
      setHouseBarMode(houseBarMode() === "mock" ? "off" : "mock");
      draw();
    });
    app.querySelector("[data-act=bench]")?.addEventListener("click", () => {
      setBenchSlots(benchSlots() === 0 ? 3 : 0);
      draw();
    });
    app.querySelector("[data-act=carry]")?.addEventListener("click", () => {
      setCarryMode(carryMode() === "line" ? "survivors" : "line");
      draw();
    });
    app.querySelector("[data-act=export]")?.addEventListener("click", () => downloadSummary());
    app.querySelector("[data-act=reset]")?.addEventListener("click", () => {
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
