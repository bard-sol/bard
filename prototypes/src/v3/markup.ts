import { card as duelDef } from "../b/cards";
import { artSrc, BARD_ART, face, houseKey, kwDef, kwName, linesSrc, type CardFace } from "./catalog";
import { icon } from "./icons";

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const hv = (h: string) => `--house:var(--h-${h}-a);--house-b:var(--h-${h}-b)`;

export function abilityHTML(text: string): string {
  return esc(text)
    .replace(/^([^:]+):/, "<b>$1:</b>")
    .replace(/\b(Ward|Summon|Silence|summon)\b/g, (m) => `<b>${m}</b>`);
}

function tierHTML(t: number): string {
  return `<span class="tier" title="Tier ${t}">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= t ? "" : "off"}"></i>`).join("")}</span>`;
}

function typeLine(u: CardFace, opts: { kind?: boolean; tier?: boolean } = {}): string {
  const kind = opts.kind === false ? "" : `${u.kind} · `;
  const tier = opts.tier === false ? "" : tierHTML(u.tier);
  return `<div class="c-type">${icon("house_" + u.house, "hg")}<span class="hname">${kind}${esc(u.houseName.replace(/^The /, ""))}</span>${tier}</div>`;
}

function mergeHTML(m?: "star" | "pip" | ""): string {
  if (m === "star") return `<span class="c-merge star">${icon("star")}<em>LV 2</em></span>`;
  if (m === "pip") return `<span class="c-merge"><i class="pip"></i><i class="pip off"></i></span>`;
  return "";
}

function stats(atk: number, hp: number, mid = ""): string {
  return `<span class="stat atk">${icon("atk")}${atk}</span>${mid}<span class="stat hp">${icon("hp")}${hp}</span>`;
}

function artHTML(u: CardFace, dead = false): string {
  return `<div class="c-art"><img class="col" src="${artSrc(u.id)}" alt="" style="${dead ? "opacity:0" : ""}"><img class="lines" src="${linesSrc(u.id)}" alt="" style="background:var(--paper);${dead ? "opacity:1" : ""}">`;
}

export function mergeMark(copies: number): "star" | "pip" | "" {
  if (copies >= 3) return "star";
  if (copies === 2) return "pip";
  return "";
}

export interface UnitOpts {
  id: string;
  copies?: number;
  atk?: number;
  hp?: number;
  maxHp?: number;
  small?: boolean;
  dead?: boolean;
  ghost?: boolean;
  ward?: boolean;
  silence?: boolean;
  debuff?: boolean;
  braced?: boolean;
  cls?: string;
  attrs?: string;
}

export function unitTile(o: UnitOpts): string {
  const copies = o.copies ?? 1;
  const u = face(o.id, copies);
  const maxHp = o.maxHp ?? u.hp;
  const atk = o.atk ?? u.atk;
  const hp = o.hp ?? maxHp;
  const life = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  const merge = mergeMark(copies);
  const marks = [
    o.braced ? `<i class="mk brace" title="Braced">Braced</i>` : "",
    o.ward ? `<i class="mk" title="Ward">${icon("ward")}</i>` : "",
    o.silence ? `<i class="mk" title="Silence">${icon("silence")}</i>` : "",
    o.debuff ? `<i class="mk" title="Attack down">${icon("atk")}</i>` : "",
  ].join("");
  const cls = ["card", "c-unit", o.small ? "s" : "", o.dead ? "dead" : "", o.ghost ? "ghosted" : "", o.cls ?? ""].filter(Boolean).join(" ");
  return `<div class="${cls}" style="${hv(u.house)};--life:${o.dead ? 0 : life}" data-id="${esc(o.id)}" ${o.attrs ?? ""}>
    ${artHTML(u, !!o.dead)}</div>
    <span class="c-kwchip" title="${esc(kwName(u.kw[0] ?? "ongoing"))}">${icon(u.kw[0] ?? "ongoing")}</span>
    <button class="c-info" type="button" aria-label="About ${esc(u.name)}" data-info="${esc(o.id)}">${icon("info")}</button>
    ${mergeHTML(merge)}
    ${marks ? `<span class="c-marks">${marks}</span>` : ""}
    <div class="c-foot"><div class="c-name">${esc(u.short)}</div>
      <div class="c-abline">${abilityHTML(u.text || "No ability.")}</div>
      <div class="c-row">${stats(atk, Math.max(0, hp))}</div></div>
    <div class="hpbar"><i style="width:${life * 100}%"></i></div>
  </div>`;
}

export interface ShopOpts {
  id: string;
  copies?: number;
  small?: boolean;
  cant?: boolean;
  hint?: "pair" | "star" | "";
  selected?: boolean;
  attrs?: string;
}

export function shopCard(o: ShopOpts): string {
  const copies = o.copies ?? 1;
  const u = face(o.id, copies >= 3 ? 3 : 1);
  const show = copies >= 3 ? u : face(o.id, 1);
  const text = copies >= 3 ? u.text : show.text;
  const kw = copies >= 3 ? u.kw : show.kw;
  const cls = ["card", "c-shop", o.small ? "s" : "", o.cant ? "cant" : "", o.selected ? "sel" : ""].filter(Boolean).join(" ");
  const extra = kw.slice(1);
  const mid = o.small || !extra.length ? "" : `<span class="c-kws">${extra.map((k) => `<span class="kw" title="${esc(kwName(k))}">${icon(k)}</span>`).join("")}</span>`;
  return `<div class="${cls}" style="${hv(show.house)}" data-id="${esc(o.id)}" ${o.attrs ?? ""}>
    ${o.hint ? `<span class="c-hint">${o.hint === "star" ? icon("star") + "Merge ★" : "Pair"}</span>` : ""}
    ${artHTML(show)}</div>
    <span class="c-cost">${show.cost}</span>
    <button class="c-info" type="button" aria-label="About ${esc(show.name)}" data-info="${esc(o.id)}">${icon("info")}</button>
    ${o.small ? `<span class="c-kwart">${icon(kw[0] ?? "ongoing")}</span>` : mergeHTML(copies >= 3 ? "star" : copies === 2 ? "pip" : "")}
    <div class="c-body">
      <div class="c-name">${o.small ? `<span class="nt">${esc(show.mini)}</span>` : esc(show.name.length > 17 ? show.short : show.name)}</div>
      ${typeLine(show, { kind: false })}
      <div class="c-ability inl"><p><span class="kwi">${icon(kw[0] ?? "ongoing")}</span>${abilityHTML(text)}</p></div>
    </div>
    <div class="c-stats">${stats(copies >= 3 ? u.atk : show.atk, copies >= 3 ? u.hp : show.hp, mid)}</div>
  </div>`;
}

function glossary(u: CardFace): string {
  const keys = u.kw.length ? u.kw : ["ongoing"];
  return keys
    .map((k) => `<div class="gl"><span class="kw">${icon(k)}</span><div><b>${esc(kwName(k))}</b>${esc(kwDef(k))}</div></div>`)
    .join("");
}

export function popover(id: string, copies = 1, pinned = false): string {
  const u = face(id, 1);
  const merged = face(id, 3);
  const glue = u.glue.length ? `<div class="pop-lv"><span class="tag">Glue</span><span>Counts for ${esc(u.glue.join(" and "))}</span></div>` : "";
  return `<div class="pop" role="dialog" aria-label="${esc(u.name)}" style="${hv(u.house)}">
    <div class="pop-hd"><div class="thumb"><img src="${artSrc(u.id)}" alt=""></div>
      <div style="min-width:0;flex:1"><h4>${esc(u.name)}</h4>${typeLine(u)}</div>
      <div class="acts">${pinned ? `<button class="on" type="button" data-act="pin" title="Pinned">${icon("pin")}</button><button type="button" data-act="close-info" title="Close">${icon("close")}</button>` : `<button type="button" data-act="pin" title="Pin">${icon("pin")}</button>`}</div></div>
    <div class="pop-stats">${stats(copies >= 3 ? merged.atk : copies === 2 ? u.atk + 1 : u.atk, copies >= 3 ? merged.hp : copies === 2 ? u.hp + 1 : u.hp)}<span class="cost"><i></i>${u.cost} coin${u.cost === 1 ? "" : "s"} · Tier ${u.tier}</span></div>
    <div class="pop-sec"><div class="pop-ab"><span class="kw">${icon(u.kw[0] ?? "ongoing")}</span><div>${abilityHTML(copies >= 3 ? merged.text : u.text)}</div></div>
      <div class="pop-lv"><span class="tag">2nd copy</span><span>+1 / +1</span></div>
      <div class="pop-lv"><span class="tag">${icon("star")} LV 2</span><span>${merged.mAtk} / ${merged.mHp} · ${esc(merged.mText)}</span></div>
      ${glue}</div>
    <div class="pop-sec"><div class="gl-h">Keywords</div>${glossary(u)}</div>
    <div class="pop-sec pop-fl">“${esc(u.flavour)}”</div>
    <div class="pop-ft"><span>Season 0</span>${pinned ? "<span>Esc to close</span>" : "<span>Click to pin</span>"}</div>
  </div>`;
}

export function sheet(id: string, opts: { buy?: number; sell?: boolean; copies?: number } = {}): string {
  const u = face(id, 1);
  const merged = face(id, 3);
  const action = opts.buy != null
    ? `<button class="btn primary lg" type="button" data-act="sheet-buy">Buy · ${opts.buy}</button>`
    : opts.sell
      ? `<button class="btn ghost lg" type="button" data-act="sheet-sell">Sell · +1</button>`
      : "";
  return `<div class="sheet" role="dialog" aria-label="${esc(u.name)}" style="${hv(u.house)}"><div class="grab"></div>
    <div class="sh-top"><div class="sh-art"><img src="${artSrc(u.id)}" alt=""><span class="c-cost">${u.cost}</span></div>
      <div class="sh-meta"><h4>${esc(u.name)}</h4>${typeLine(u)}<div class="sh-stats">${stats(u.atk, u.hp)}</div></div>
      <button class="sh-x" type="button" data-act="close-info">${icon("close")}</button></div>
    <div class="pop-sec"><div class="pop-ab"><span class="kw">${icon(u.kw[0] ?? "ongoing")}</span><div>${abilityHTML((opts.copies ?? 1) >= 3 ? merged.text : u.text)}</div></div>
      <div class="pop-lv"><span class="tag">2nd copy</span><span>+1 / +1</span></div>
      <div class="pop-lv"><span class="tag">${icon("star")} LV 2</span><span>${merged.mAtk} / ${merged.mHp} · ${esc(merged.mText)}</span></div></div>
    <div class="pop-sec"><div class="gl-h">Keywords</div>${glossary(u)}</div>
    <div class="pop-sec pop-fl">“${esc(u.flavour)}”</div>
    ${action ? `<div class="sh-acts">${action}</div>` : ""}
    <div class="pop-ft" style="background:none;padding-top:0"><span>Season 0</span><span>Swipe down to close</span></div>
  </div>`;
}

const DUEL_KW: Record<string, { icon: string; name: string; def: string }> = {
  Afterlife: { icon: "on_death", name: "Afterlife", def: "Happens when this card is destroyed." },
  Arrive: { icon: "ongoing", name: "Arrive", def: "Happens as this card enters a lane." },
  Coin: { icon: "power", name: "Coin", def: "Flips the Crown Coin. Heads and tails are both on the card." },
  Counter: { icon: "silence", name: "Counter", def: "Turns off an enemy ability while this card stays." },
  Destroy: { icon: "atk", name: "Destroy", def: "Removes a card from its lane." },
  Discard: { icon: "close", name: "Discard", def: "Removes a card from hand." },
  Draw: { icon: "info", name: "Draw", def: "Adds the next card of the deck to hand." },
  Info: { icon: "eye", name: "Info", def: "Looks at cards that are still hidden." },
  Move: { icon: "on_attack", name: "Move", def: "Sends a card to another lane." },
  "On reveal": { icon: "on_reveal", name: "On reveal", def: "Happens when this card turns face up." },
  Ongoing: { icon: "ongoing", name: "Ongoing", def: "While this card stays in a lane." },
  Protect: { icon: "ward", name: "Protect", def: "Stops a destroy, or stops power from falling." },
  Summon: { icon: "summon", name: "Summon", def: "Adds a token card to a lane, if there is room." },
};

function duelIcon(id: string): string {
  const c = duelDef(id);
  const tagged = c.keywords.map((k) => DUEL_KW[k]?.icon).find(Boolean);
  if (tagged) return tagged;
  if (c.kind === "afterlife") return "on_death";
  if (c.kind === "reveal") return "on_reveal";
  if (c.kind === "ongoing" || c.kind === "arrive") return "ongoing";
  return "";
}

function duelType(house: string): string {
  const h = houseKey(house);
  return `<div class="c-type">${icon("house_" + h, "hg")}<span class="hname">${esc(house.replace(/^The /, ""))}</span></div>`;
}

function duelGlossary(id: string): string {
  const keys = duelDef(id).keywords;
  const rows = (keys.length ? keys : ["Ongoing"]).map((k) => {
    const row = DUEL_KW[k] ?? { icon: "ongoing", name: k, def: "" };
    return `<div class="gl"><span class="kw">${icon(row.icon)}</span><div><b>${esc(row.name)}</b>${esc(row.def)}</div></div>`;
  });
  return rows.join("");
}

export function duelPopover(id: string, pinned = false): string {
  const c = duelDef(id);
  const h = houseKey(c.house);
  const kw = duelIcon(id) || "ongoing";
  return `<div class="pop" role="dialog" aria-label="${esc(c.name)}" style="${hv(h)}">
    <div class="pop-hd"><div class="thumb"><img src="${artSrc(id)}" alt=""></div>
      <div style="min-width:0;flex:1"><h4>${esc(c.name)}</h4>${duelType(c.house)}</div>
      <div class="acts">${pinned ? `<button class="on" type="button" data-act="pin" title="Pinned">${icon("pin")}</button><button type="button" data-act="close-info" title="Close">${icon("close")}</button>` : `<button type="button" data-act="pin" title="Pin">${icon("pin")}</button>`}</div></div>
    <div class="pop-stats"><span class="stat pw">${icon("power")}${c.power}</span><span class="cost"><i></i>${c.cost} energy</span></div>
    <div class="pop-sec"><div class="pop-ab"><span class="kw">${icon(kw)}</span><div>${abilityHTML(c.text || "No ability.")}</div></div></div>
    <div class="pop-sec"><div class="gl-h">Keywords</div>${duelGlossary(id)}</div>
    <div class="pop-ft"><span>Ink is match points</span>${pinned ? "<span>Esc to close</span>" : "<span>Click to pin</span>"}</div>
  </div>`;
}

export function duelSheet(id: string): string {
  const c = duelDef(id);
  const h = houseKey(c.house);
  const kw = duelIcon(id) || "ongoing";
  return `<div class="sheet" role="dialog" aria-label="${esc(c.name)}" style="${hv(h)}"><div class="grab"></div>
    <div class="sh-top"><div class="sh-art"><img src="${artSrc(id)}" alt=""><span class="c-cost">${c.cost}</span></div>
      <div class="sh-meta"><h4>${esc(c.name)}</h4>${duelType(c.house)}<div class="sh-stats"><span class="stat pw">${icon("power")}${c.power}</span></div></div>
      <button class="sh-x" type="button" data-act="close-info">${icon("close")}</button></div>
    <div class="pop-sec"><div class="pop-ab"><span class="kw">${icon(kw)}</span><div>${abilityHTML(c.text || "No ability.")}</div></div></div>
    <div class="pop-sec"><div class="gl-h">Keywords</div>${duelGlossary(id)}</div>
    <div class="pop-ft" style="background:none;padding-top:0"><span>Ink is match points</span><span>Swipe down to close</span></div>
  </div>`;
}

export function duelCard(o: {
  id: string;
  power?: number;
  lane?: boolean;
  small?: boolean;
  down?: boolean;
  house?: string;
  cant?: boolean;
  selected?: boolean;
  buff?: boolean;
  attrs?: string;
}): string {
  if (o.down) {
    const h = houseKey(o.house ?? "neutral");
    return `<div class="card c-lane down ${o.small ? "s" : ""}" ${o.attrs ?? ""}><span class="back">${icon("house_" + h)}</span></div>`;
  }
  const c = duelDef(o.id);
  const h = houseKey(c.house);
  const pw = o.power ?? c.power;
  const kw = duelIcon(o.id);
  const known = face(o.id);
  const mini = known.kind === "Token" ? c.name : known.mini;
  const label = c.name.length > 17 ? c.name.split(",")[0]! : c.name;
  if (o.lane) {
    const cls = ["card", "c-lane", o.small ? "s" : "", o.buff ? "buffed" : ""].filter(Boolean).join(" ");
    return `<div class="${cls}" style="${hv(h)}" data-id="${esc(o.id)}" title="${esc(c.text)}" ${o.attrs ?? ""}><div class="c-art"><img class="col" src="${artSrc(o.id)}" alt=""></div>
      <span class="c-cost">${c.cost || ""}</span><span class="c-pow ${pw > c.power ? "up" : ""}">${pw}</span>
      <button class="c-info" type="button" data-info="${esc(o.id)}" aria-label="About ${esc(c.name)}">${icon("info")}</button>
      ${kw ? `<span class="c-kwchip">${icon(kw)}</span>` : ""}</div>`;
  }
  const cls = ["card", "c-shop", "c-duel", o.small ? "s" : "", o.cant ? "cant" : "", o.selected ? "sel" : ""].filter(Boolean).join(" ");
  return `<div class="${cls}" style="${hv(h)}" data-id="${esc(o.id)}" ${o.attrs ?? ""}>
    ${artHTML(known.kind === "Token" ? { ...known, id: o.id, house: h } : { ...known, house: h })}</div><span class="c-cost">${c.cost}</span>
    <button class="c-info" type="button" data-info="${esc(o.id)}" aria-label="About ${esc(c.name)}">${icon("info")}</button>
    ${o.small && kw ? `<span class="c-kwart">${icon(kw)}</span>` : ""}
    <div class="c-body"><div class="c-name">${o.small ? `<span class="nt">${esc(mini)}</span>` : esc(label)}</div>
      ${duelType(c.house)}
      <div class="c-ability inl"><p>${kw ? `<span class="kwi">${icon(kw)}</span>` : ""}${abilityHTML(c.text || "No ability.")}</p></div></div>
    <div class="c-stats"><span class="stat pw">${icon("power")}${pw}</span></div>
  </div>`;
}

const HOUSES = [
  ["pit", "The Pit"],
  ["scriptorium", "The Scriptorium"],
  ["gilt", "The Gilt"],
  ["tidewrack", "The Tidewrack"],
  ["candle", "The Candle"],
  ["standard", "The Standard"],
  ["torn", "The Torn Margin"],
  ["fold", "The Fold"],
] as const;

export function houseBar(you = "tidewrack", rival = "pit"): string {
  const youK = houseKey(you);
  const rivalK = houseKey(rival);
  return `<div class="hbar"><div class="hb-track">${HOUSES.map(
    ([k, n]) =>
      `<div class="hb-seg ${k === youK ? "you" : ""} ${k === rivalK ? "rival" : ""}" style="flex:1;--c:var(--h-${k}-a);--c2:var(--h-${k}-b)" title="${n}"><span class="hb-g">${icon("house_" + k)}</span></div>`,
  ).join("")}</div></div>`;
}

export function bardAvatar(): string {
  return `<div class="bard"><img src="${BARD_ART}" alt="Bard"></div>`;
}

export function timerHTML(s: number, frac: number): string {
  const dash = (2 * Math.PI * 19 * frac).toFixed(1);
  return `<span class="timer"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" fill="none" stroke="rgba(241,235,223,.12)" stroke-width="3"/><circle cx="22" cy="22" r="19" fill="none" stroke="var(--text-1)" stroke-width="3" stroke-linecap="round" stroke-dasharray="${dash} 200"/></svg>${s}</span>`;
}

export function roundsHTML(st: string[]): string {
  const label: Record<string, string> = { won: "Won", lost: "Lost", now: "Now", draw: "Draw" };
  return `<div class="rounds">${["I", "II", "III"].map((n, i) => `<div class="rd ${st[i] ?? ""}"><span class="n">${n}</span><span class="r">${label[st[i] ?? ""] ?? "—"}</span></div>`).join("")}</div>`;
}

export function isMobile(): boolean {
  return matchMedia("(max-width: 600px)").matches;
}
