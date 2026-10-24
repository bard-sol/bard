import { artHouse } from "./a/sheet";
import { houseById } from "./houses";

/** Five shared columns. Centre x = 49 + 73·i. */
export const COLX = (i: number) => 49 + 73 * i;
export const FOOT_ENEMY = 286;
export const FOOT_YOU = 470;

const TOKEN_ART: Record<string, string> = {
  ink_drop: "token_inkdrop",
  ink_drop_2: "token_inkdrop",
  scribble: "token_scribble",
  scribble_2: "token_scribble",
};

export function cutSrc(id: string): string {
  return `/art/v2/units/${TOKEN_ART[id] ?? id}.webp`;
}

export function linesSrc(id: string): string {
  return `/art/v2/units/${TOKEN_ART[id] ?? id}-lines.webp`;
}

export function washColor(id: string): string {
  try {
    return houseById(artHouse(id))?.a ?? "#8A8478";
  } catch {
    return "#1B1712";
  }
}

const UI = "/art/v2/ui";

export function sealImg(name: string, px: number): string {
  return `<img class="sealimg" alt="" width="${px}" height="${px}" src="${UI}/${name}.webp">`;
}

export function tools(): string {
  return `<div class="tool t1"></div><div class="tool t2"></div><div class="vignette"></div><div class="grainov"></div><div class="home"></div>`;
}

export function practiceRibbon(): string {
  return `<div class="ribbon"><svg viewBox="0 0 374 44" width="374" height="44">
    <path d="M10,10 Q187,4 364,10 L364,30 Q187,36 10,30Z" fill="rgba(240,230,210,.06)" stroke="#bfb5a2" stroke-width="1.2" stroke-dasharray="5 3"/>
    <text x="187" y="24" text-anchor="middle" font-family="Cinzel,serif" font-weight="700" font-size="9.5" letter-spacing="2.2" fill="#d8cdb8">PRACTICE · NO HOUSE AT STAKE</text>
  </svg></div>`;
}

/** Static house ribbon. Live flow stays in house-bar.js when the mock flag is on. */
export function staticRibbon(you: string, rival: string): string {
  const houses = [
    ["pit", "#D9481C", "#4A4E54"],
    ["scriptorium", "#1E7F72", "#23262E"],
    ["gilt", "#D4B25A", "#F3ECDA"],
    ["tidewrack", "#6FB3DD", "#C9A97E"],
    ["candle", "#8E2F5E", "#8B8580"],
    ["standard", "#2B4F8C", "#A7A9A6"],
    ["tornmargin", "#C8862A", "#5E6B34"],
    ["fold", "#E4DCC8", "#5B5D63"],
  ] as const;
  const x0 = 16;
  const x1 = 358;
  const w = (x1 - x0) / houses.length;
  let rects = "";
  let marks = "";
  houses.forEach(([id, a, b], i) => {
    const x = x0 + i * w;
    rects += `<rect x="${x}" y="8" width="${w + 0.6}" height="24" fill="${a}"/>`;
    rects += `<rect x="${x}" y="22" width="${w + 0.6}" height="10" fill="${b}" opacity=".85"/>`;
    const cx = x + w / 2;
    if (id === you) marks += `<path d="M${cx - 5},40 L${cx},34 L${cx + 5},40Z" fill="#f4e7cc"/>`;
    if (id === rival) marks += `<path d="M${cx - 4},40 L${cx},34.5 L${cx + 4},40" fill="none" stroke="#f4e7cc" stroke-width="1.3"/>`;
  });
  return `<div class="ribbon"><svg viewBox="0 0 374 44" width="374" height="44">
    <path d="M14,12 L2,16 L8,22 L2,28 L14,32Z" fill="#3a1c10"/>
    <path d="M360,12 L372,16 L366,22 L372,28 L360,32Z" fill="#2a2c30"/>
    ${rects}
    <path d="M16,8 H358 V32 H16Z" fill="none" stroke="#0d0705" stroke-width="1.2"/>
    ${marks}
  </svg></div>`;
}

export function bookShell(): string {
  return `<div class="book"><div class="cover"></div><div class="page top"></div><div class="page bot"></div><div class="gutter"></div></div>`;
}

export function pips(max: number, hp: number, lost = 0): string {
  const n = Math.max(0, Math.min(max, 14));
  let html = "";
  for (let i = 0; i < n; i++) {
    const cls = i < hp ? "" : lost && i < hp + lost ? "lost" : "x";
    html += `<i class="${cls}"></i>`;
  }
  return `<div class="pips">${html}</div>`;
}

export function badges(atk: number, hp: number): string {
  return `<div class="badge atk">${sealImg("badge-atk", 23).replace('class="sealimg"', "")}<span>${atk}</span></div>
    <div class="badge hp"><span>${hp}</span></div>`;
}

export function mergeMark(copies: number): string {
  if (copies >= 3) return `<img class="merge" alt="" src="${UI}/merge-star.webp">`;
  if (copies === 2) return `<img class="mbead" alt="" src="${UI}/merge-pip.webp">`;
  return "";
}

export function pencilSlot(cx: number, foot: number, mark: boolean, attrs = ""): string {
  const q = mark ? `<text x="34" y="18" text-anchor="middle" font-family="Cinzel,serif" font-size="16" fill="#8A8478" opacity=".75">?</text>` : "";
  return `<div class="pslot" style="left:${cx - 34}px;top:${foot - 36}px" ${attrs}>
    <svg width="68" height="56" viewBox="0 0 68 56">
      <ellipse cx="34" cy="34" rx="28" ry="12" fill="none" stroke="#8A8478" stroke-width="1.2" stroke-dasharray="3 3" opacity=".8"/>
      ${q}
    </svg></div>`;
}

export interface FigureOpts {
  id: string;
  cx: number;
  foot: number;
  atk?: number;
  hp?: number;
  max?: number;
  copies?: number;
  ghost?: boolean;
  dying?: boolean;
  lost?: number;
  cls?: string;
  attrs?: string;
  artId?: string;
}

export function unitFigure(o: FigureOpts): string {
  const art = o.artId ?? o.id;
  const color = washColor(art);
  const show = o.atk != null && o.hp != null && o.max != null && !o.ghost;
  const left = o.cx - 43;
  const top = o.foot - 91;
  const lines = o.dying ? `<img class="lines" alt="" src="${linesSrc(art)}">` : "";
  return `<div class="unit${o.ghost ? " ghosted" : ""}${o.dying ? " dying" : ""}${o.cls ? ` ${o.cls}` : ""}" style="left:${left}px;top:${top}px" ${o.attrs ?? ""}>
    <div class="wash" style="background:radial-gradient(closest-side,${color}cc,${color}55 60%,transparent)"></div>
    <img class="disc" alt="" src="/art/v2/disc.webp">
    ${lines}
    <img class="art" alt="" src="${cutSrc(art)}">
    ${show ? badges(o.atk!, o.hp!) + pips(o.max!, o.hp!, o.lost ?? 0) + mergeMark(o.copies ?? 1) : ""}
  </div>`;
}

export function costSeal(n: number, off: boolean): string {
  const src = off ? "seal-ink-cost-blank" : "seal-red-cost-blank";
  return `<div class="cost">${sealImg(src, 30)}<span>${n}</span></div>`;
}

export function tierDiamonds(tier: number): string {
  let html = "";
  for (let i = 0; i < 5; i++) html += `<i class="${i < tier ? "" : "o"}"></i>`;
  return `<div class="tier">${html}</div>`;
}

export function purse(n: number, max: number, label: string): string {
  let coins = "";
  for (let i = 0; i < max; i++) coins += `<img alt="" src="${UI}/coin${i < n ? "" : "-empty"}.webp">`;
  return `<div class="purse" data-purse>
    <div class="bignum">${n}</div>
    <div class="pursecap">${label}</div>
    <div class="coinrow">${coins}</div>
  </div>`;
}

const ROMAN = ["I", "II", "III"];

export function roundSeal(state: "won" | "lost" | "draw" | "now" | "wait", i: number, left?: number): string {
  const r = ROMAN[i] ?? "";
  const style = left == null ? "" : ` style="left:${left}px"`;
  if (state === "won") return `<div class="rp"${style}><img alt="" src="${UI}/seal-red-blank.webp"><b>${r}</b></div>`;
  if (state === "lost") return `<div class="rp lost"${style}><img alt="" src="${UI}/seal-ink-blank.webp"><b>${r}</b><i></i></div>`;
  if (state === "draw") return `<div class="rp wait"${style}><b>${r}</b></div>`;
  if (state === "now") return `<div class="rp now"${style}><b>${r}</b></div>`;
  return `<div class="rp wait"${style}><b>${r}</b></div>`;
}
