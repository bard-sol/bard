import { tokens } from './tokens.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageLayout {
  index: 0 | 1;
  frame: Rect;
  foeSlots: Rect[];
  youSlots: Rect[];
  noteLane: Rect;
}

export interface BoardLayout {
  mode: 'phone' | 'desktop';
  width: number;
  height: number;
  status: Rect;
  verse: Rect;
  foeLegend: Rect;
  youLegend: Rect;
  youPower: Rect;
  foePower: Rect;
  ink: Rect;
  foeInk: Rect;
  pages: [PageLayout, PageLayout];
  hand: Rect;
  endTurn: Rect;
  fight: Rect;
  log: Rect;
}

export function layoutBoard(width: number, height: number): BoardLayout {
  return width < tokens.layout.phoneBreak ? phone(width, height) : desktop(width, height);
}

function phone(width: number, height: number): BoardLayout {
  const pad = 10;
  const gap = 6;
  const inner = width - pad * 2;
  const buttonH = 46;
  const handH = 116;
  const legendH = 68;
  const verseH = 56;
  const statusH = 18;
  const buttonsY = height - pad - buttonH;
  const handY = buttonsY - gap - handH;
  const youY = handY - gap - legendH;
  const statusY = pad;
  const verseY = statusY + statusH + 4;
  const foeY = verseY + verseH + gap;
  const pagesTop = foeY + legendH + gap;
  const pagesBottom = youY - gap;
  const pageH = Math.max(120, (pagesBottom - pagesTop - gap) / 2);
  const status: Rect = { x: pad, y: statusY, w: inner, h: statusH };
  const verse: Rect = { x: pad, y: verseY, w: inner, h: verseH };
  const foeLegend: Rect = { x: pad, y: foeY, w: inner, h: legendH };
  const youLegend: Rect = { x: pad, y: youY, w: inner, h: legendH };
  const pages: [PageLayout, PageLayout] = [
    pageBox(0, pad, pagesTop, inner, pageH, 'phone'),
    pageBox(1, pad, pagesTop + pageH + gap, inner, pageH, 'phone'),
  ];
  const hand: Rect = { x: pad, y: handY, w: inner, h: handH };
  const fight: Rect = { x: pad, y: buttonsY, w: Math.floor(inner * 0.48), h: buttonH };
  const endTurn: Rect = { x: pad + Math.floor(inner * 0.52), y: buttonsY, w: Math.ceil(inner * 0.48), h: buttonH };
  return {
    mode: 'phone',
    width,
    height,
    status,
    verse,
    foeLegend,
    youLegend,
    foePower: powerRect(foeLegend, 'phone'),
    youPower: powerRect(youLegend, 'phone'),
    foeInk: { x: foeLegend.x + 168, y: foeLegend.y + 34, w: 120, h: 18 },
    ink: { x: youLegend.x + 168, y: youLegend.y + 34, w: 120, h: 18 },
    pages,
    hand,
    endTurn,
    fight,
    log: { x: pad, y: status.y, w: inner * 0.62, h: 22 },
  };
}

function desktop(width: number, height: number): BoardLayout {
  const pad = 20;
  const gap = 16;
  const verse: Rect = { x: pad, y: pad, w: width - pad * 2, h: 64 };
  const legendW = 220;
  const top = verse.y + verse.h + gap;
  const handH = 168;
  const hand: Rect = { x: pad + legendW + gap, y: height - pad - handH, w: width - pad * 2 - legendW * 2 - gap * 2, h: handH };
  const pageTop = top;
  const pageH = hand.y - gap - pageTop;
  const centerX = pad + legendW + gap;
  const centerW = width - centerX - legendW - pad - gap;
  const pageW = (centerW - gap) / 2;
  const pages: [PageLayout, PageLayout] = [
    pageBox(0, centerX, pageTop, pageW, pageH, 'desktop'),
    pageBox(1, centerX + pageW + gap, pageTop, pageW, pageH, 'desktop'),
  ];
  const foeLegend: Rect = { x: width - pad - legendW, y: top, w: legendW, h: 250 };
  const youLegend: Rect = { x: pad, y: top, w: legendW, h: 250 };
  const fight: Rect = { x: youLegend.x, y: youLegend.y + youLegend.h + 16, w: legendW, h: 44 };
  const endTurn: Rect = { x: youLegend.x, y: youLegend.y + youLegend.h + 68, w: legendW, h: 44 };
  return {
    mode: 'desktop',
    width,
    height,
    status: { x: verse.x + 16, y: verse.y + 8, w: 280, h: 22 },
    verse,
    foeLegend,
    youLegend,
    foePower: powerRect(foeLegend, 'desktop'),
    youPower: powerRect(youLegend, 'desktop'),
    foeInk: { x: foeLegend.x + 16, y: foeLegend.y + 168, w: legendW - 32, h: 22 },
    ink: { x: youLegend.x + 16, y: youLegend.y + 168, w: legendW - 32, h: 22 },
    pages,
    hand,
    endTurn,
    fight,
    log: { x: verse.x + verse.w - 460, y: verse.y + 36, w: 440, h: 20 },
  };
}

function pageBox(index: 0 | 1, x: number, y: number, w: number, h: number, mode: 'phone' | 'desktop'): PageLayout {
  const pad = 10;
  const titleH = mode === 'phone' ? 28 : 32;
  const ruleH = mode === 'phone' ? 18 : 24;
  const laneH = mode === 'phone' ? 22 : 36;
  const slotH = Math.max(36, (h - titleH - ruleH - laneH - pad * 2) / 2);
  const rowW = w - pad * 2;
  return {
    index,
    frame: { x, y, w, h },
    foeSlots: row(x + pad, y + titleH + 4, rowW, slotH, 6),
    youSlots: row(x + pad, y + titleH + 4 + slotH + laneH, rowW, slotH, 6),
    noteLane: { x: x + pad, y: y + titleH + 4 + slotH, w: rowW, h: laneH },
  };
}

function row(x: number, y: number, w: number, h: number, gap: number): Rect[] {
  const slotW = (w - gap * 3) / 4;
  return [0, 1, 2, 3].map((index) => ({
    x: x + index * (slotW + gap),
    y,
    w: slotW,
    h,
  }));
}

function powerRect(legend: Rect, mode: 'phone' | 'desktop'): Rect {
  if (mode === 'phone') return { x: legend.x + legend.w - 78, y: legend.y + 16, w: 66, h: 30 };
  return { x: legend.x + 16, y: legend.y + 112, w: legend.w - 32, h: 36 };
}

/** Spread `count` slots across the row the layout reserved for four. */
export function slotRect(slots: Rect[], index: number, count: number): Rect {
  const first = slots[0];
  if (!first || count === slots.length) return slots[index] ?? first ?? { x: 0, y: 0, w: 0, h: 0 };
  const last = slots[slots.length - 1] ?? first;
  const span = last.x + last.w - first.x;
  const gap = 6;
  const w = (span - gap * (count - 1)) / count;
  return { x: first.x + index * (w + gap), y: first.y, w, h: first.h };
}

export function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x <= rect.x + rect.w && y <= rect.y + rect.h;
}

export function handRects(area: Rect, count: number, mode: 'phone' | 'desktop'): Rect[] {
  if (count <= 0) return [];
  const cardW = mode === 'phone' ? 72 : 96;
  const cardH = mode === 'phone' ? 108 : 142;
  const gap = 8;
  const natural = cardW * count + gap * (count - 1);
  const step = natural > area.w ? (area.w - cardW) / Math.max(1, count - 1) : cardW + gap;
  const total = cardW + step * (count - 1);
  const start = area.x + Math.max(0, (area.w - total) / 2);
  const y = area.y + Math.max(0, (area.h - cardH) / 2);
  return Array.from({ length: count }, (_, index) => ({
    x: start + index * step,
    y,
    w: cardW,
    h: cardH,
  }));
}
