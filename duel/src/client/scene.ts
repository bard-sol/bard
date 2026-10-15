import { Container, Graphics, Text } from 'pixi.js';
import type { CardView, ClientPayload, GameAction, Stance, TradePreview, UnitView } from '../types.js';
import { contains, handRects, layoutBoard, slotRect, type BoardLayout, type Rect } from './layout.js';
import { houseTint, tokens } from './tokens.js';

export interface FloatNote {
  text: string;
  born: number;
  player: 0 | 1;
}

export interface DragState {
  kind: 'card' | 'unit';
  instanceId: string;
  x: number;
  y: number;
}

export interface SceneModel {
  width: number;
  height: number;
  now: number;
  stance: Stance;
  screen: 'title' | 'board';
  payload: ClientPayload | null;
  selectedId: string | null;
  targeting: boolean;
  mulligan: ReadonlySet<string>;
  drag: DragState | null;
  hoverId: string | null;
  preview: TradePreview | null;
  floats: FloatNote[];
  message: string;
  verify: string;
  remainingMs: number | null;
}

export interface Hit {
  id: string;
  rect: Rect;
}

export function renderScene(root: Container, model: SceneModel): Hit[] {
  const hits: Hit[] = [];
  if (model.screen === 'title' || !model.payload) {
    drawTitle(root, hits, model);
    return hits;
  }
  drawBoard(root, hits, model, model.payload);
  return hits;
}

export function hitTest(hits: Hit[], x: number, y: number): Hit | null {
  for (let i = hits.length - 1; i >= 0; i--) {
    const hit = hits[i];
    if (hit && contains(hit.rect, x, y)) return hit;
  }
  return null;
}

function drawTitle(root: Container, hits: Hit[], model: SceneModel) {
  const { width, height } = model;
  const phone = width < tokens.layout.phoneBreak;
  label(root, 'BARD', width / 2, phone ? 78 : 120, phone ? 18 : 22, tokens.color.gold, 0.5);
  label(root, 'Card Duel', width / 2, phone ? 118 : 168, phone ? 42 : 64, tokens.color.parchment, 0.5);
  label(root, 'Two pages. First to eight Verse.', width / 2, phone ? 168 : 230, 16, tokens.color.muted, 0.5);

  const stances: Stance[] = ['aggressive', 'balanced', 'patient'];
  const cardW = phone ? 104 : 160;
  const cardH = phone ? 132 : 168;
  const gap = phone ? 10 : 18;
  const total = cardW * 3 + gap * 2;
  const start = (width - total) / 2;
  const y = phone ? 230 : 300;
  stances.forEach((stance, index) => {
    const rect = { x: start + index * (cardW + gap), y, w: cardW, h: cardH };
    const selected = model.stance === stance;
    panel(root, rect, selected ? 0x3a2a18 : tokens.color.bgRaised, 14, selected ? tokens.color.gold : tokens.color.line);
    label(root, stance[0]!.toUpperCase() + stance.slice(1), rect.x + rect.w / 2, rect.y + (phone ? 48 : 64), phone ? 16 : 22, tokens.color.parchment, 0.5);
    label(root, stanceHint(stance), rect.x + rect.w / 2, rect.y + (phone ? 84 : 108), 13, tokens.color.muted, 0.5);
    hits.push({ id: `stance:${stance}`, rect });
  });

  const play = { x: (width - (phone ? 220 : 280)) / 2, y: y + cardH + (phone ? 36 : 48), w: phone ? 220 : 280, h: 52 };
  panel(root, play, tokens.color.buttonHot, 14, tokens.color.gold);
  label(root, 'Play', play.x + play.w / 2, play.y + 26, 22, tokens.color.white, 0.5);
  hits.push({ id: 'play', rect: play });
  if (model.message) label(root, model.message, width / 2, play.y + 80, 14, tokens.color.danger, 0.5);
}

function drawBoard(root: Container, hits: Hit[], model: SceneModel, payload: ClientPayload) {
  const layout = layoutBoard(model.width, model.height);
  const view = payload.view;
  panel(root, { x: 8, y: 8, w: model.width - 16, h: model.height - 16 }, tokens.color.bg, 0, tokens.color.bg);

  drawVerse(root, layout, model, view.verse, view.verseGoal);
  drawLegend(root, hits, layout.foeLegend, layout.foePower, layout.foeInk, view.foeLegend.name, view.foeLegend.house, view.foeLegend.powerName, view.foeLegend.powerCost, view.foePowerUsed, view.foeInk, view.foeMaxInk, view.foeHandCount, view.foeDeckCount, false, false, layout.mode);
  drawLegend(root, hits, layout.youLegend, layout.youPower, layout.ink, view.youLegend.name, view.youLegend.house, view.youLegend.powerName, view.youLegend.powerCost, view.youLegend.powerUsed, view.ink, view.maxInk, view.hand.length, view.yourDeckCount, true, powerEnabled(payload), layout.mode);

  const drop = dropTargets(payload, model);
  view.pages.forEach((page, index) => {
    const box = layout.pages[index]!;
    const hot = drop.pages.has(index);
    panel(root, box.frame, index === 0 ? 0x2a1c12 : 0x24160f, 16, hot ? tokens.color.gold : tokens.color.line);
    label(root, page.name, box.frame.x + 12, box.frame.y + (layout.mode === 'phone' ? 6 : 8), layout.mode === 'phone' ? 13 : 16, tokens.color.parchment, 0);
    label(root, fit(page.rule, layout.mode === 'phone' ? 46 : 34), box.frame.x + 12, box.frame.y + box.frame.h - (layout.mode === 'phone' ? 16 : 22), layout.mode === 'phone' ? 11 : 13, tokens.color.inkSoft, 0);
    page.slots.forEach((slot, slotIndex) => {
      drawUnitSlot(root, hits, slotRect(box.foeSlots, slotIndex, page.slots.length), slot.foe, drop, model, false, index, slotIndex);
      drawUnitSlot(root, hits, slotRect(box.youSlots, slotIndex, page.slots.length), slot.you, drop, model, true, index, slotIndex);
    });
    drawNotes(root, box.noteLane, page.marginalia);
    if (drop.frames.has(index)) hits.push({ id: `page:${index}`, rect: box.frame });
  });

  drawHand(root, hits, layout, payload, model);
  drawActions(root, hits, layout, payload, model);
  drawStatus(root, layout, payload, model);
  if (model.drag?.kind === 'card') drawCardGhost(root, model.drag, payload);
  if (model.drag?.kind === 'unit') drawUnitGhost(root, model.drag, payload);
  if (model.preview && model.drag?.kind === 'unit') drawPreview(root, model);
  drawFloats(root, layout, model);
  if (view.winner != null) drawResult(root, hits, model, payload);
}

function drawVerse(root: Container, layout: BoardLayout, model: SceneModel, verse: [number, number], goal: number) {
  panel(root, layout.verse, tokens.color.rail, 14, tokens.color.line);
  const phone = layout.mode === 'phone';
  if (!phone) label(root, 'VERSE', layout.verse.x + layout.verse.w / 2, layout.verse.y + 8, 12, tokens.color.gold, 0.5);
  drawPipRow(root, layout, 0, verse[0], goal, model, phone);
  drawPipRow(root, layout, 1, verse[1], goal, model, phone);
}

function drawPipRow(root: Container, layout: BoardLayout, player: 0 | 1, filled: number, goal: number, model: SceneModel, phone: boolean) {
  const pip = phone ? 6 : 8;
  const gap = phone ? 5 : 8;
  const step = pip * 2 + gap;
  const rowW = goal * step - gap;
  const y = phone ? layout.verse.y + (player === 0 ? 36 : 16) : layout.verse.y + 38;
  const x0 = phone
    ? layout.verse.x + 52
    : player === 0
      ? layout.verse.x + 72
      : layout.verse.x + layout.verse.w - 72 - rowW;
  label(
    root,
    player === 0 ? 'You' : 'Foe',
    phone ? layout.verse.x + 8 : player === 0 ? layout.verse.x + 16 : layout.verse.x + layout.verse.w - 16,
    y,
    13,
    player === 0 ? tokens.color.allyEdge : tokens.color.foeEdge,
    phone || player === 0 ? 0 : 1,
    0.5,
  );
  for (let i = 0; i < goal; i++) {
    const cx = x0 + i * step + pip;
    const on = i < filled;
    dot(root, cx, y, pip, on ? tokens.color.gold : tokens.color.pipEmpty);
    const pulse = model.floats.find((note) => note.player === player);
    if (on && i === filled - 1 && pulse) {
      const age = (model.now - pulse.born) / tokens.motion.verseMs;
      if (age >= 0 && age < 1) ring(root, cx, y, pip + 4 + age * 12, tokens.color.gold, 1 - age);
    }
  }
  const scoreOnLeft = !phone && player === 1;
  label(root, String(filled), scoreOnLeft ? x0 - 10 : x0 + rowW + 14, y, 13, tokens.color.gold, scoreOnLeft ? 1 : 0, 0.5);
}

function drawLegend(
  root: Container,
  hits: Hit[],
  rect: Rect,
  power: Rect,
  _inkRect: Rect,
  name: string,
  house: string,
  powerName: string,
  powerCost: number,
  powerUsed: boolean,
  ink: number,
  maxInk: number,
  handCount: number,
  deckCount: number,
  yours: boolean,
  powerOn: boolean,
  mode: 'phone' | 'desktop',
) {
  panel(root, rect, tokens.color.bgRaised, 14, yours ? tokens.color.allyEdge : tokens.color.foeEdge);
  const portrait = mode === 'phone' ? 16 : 28;
  const portraitX = mode === 'phone' ? rect.x + 24 : rect.x + rect.w / 2;
  const portraitY = mode === 'phone' ? rect.y + rect.h / 2 : rect.y + 48;
  dot(root, portraitX, portraitY, portrait, houseTint(house));
  label(root, name.slice(0, 1), portraitX, portraitY, mode === 'phone' ? 14 : 20, tokens.color.ink, 0.5, 0.5);
  const textX = mode === 'phone' ? rect.x + 48 : rect.x + rect.w / 2;
  const textAnchor = mode === 'phone' ? 0 : 0.5;
  label(root, fit(name, mode === 'phone' ? 16 : 18), textX, mode === 'phone' ? rect.y + 8 : rect.y + 78, mode === 'phone' ? 15 : 18, tokens.color.parchment, textAnchor);
  label(root, houseName(house), textX, mode === 'phone' ? rect.y + 26 : rect.y + 100, 12, tokens.color.muted, textAnchor);
  inkRow(root, mode === 'phone' ? rect.x + 48 : rect.x + 16, mode === 'phone' ? rect.y + 48 : rect.y + 188, ink, maxInk);
  const meta = `${handCount} hand · ${deckCount} left`;
  label(root, meta, mode === 'phone' ? rect.x + 148 : rect.x + 16, mode === 'phone' ? rect.y + 42 : rect.y + 214, 12, tokens.color.muted, 0);

  const enabled = yours && powerOn && !powerUsed;
  panel(root, power, enabled ? tokens.color.buttonHot : 0x2a2118, 8, enabled ? tokens.color.gold : tokens.color.line);
  label(root, powerUsed ? 'Spent' : `${powerName} ${powerCost}`, power.x + power.w / 2, power.y + power.h / 2, 13, enabled ? tokens.color.white : tokens.color.inkSoft, 0.5, 0.5);
  if (yours && enabled) hits.push({ id: 'power', rect: power });
}

function drawUnitSlot(
  root: Container,
  hits: Hit[],
  rect: Rect,
  unit: UnitView | null,
  drop: DropTargets,
  model: SceneModel,
  yours: boolean,
  pageIndex: number,
  slotIndex: number,
) {
  if (!unit) {
    const hot = yours && drop.slots.has(`${pageIndex}:${slotIndex}`);
    panel(root, rect, 0x1a120d, tokens.radius.slot, hot ? tokens.color.gold : 0x4a3828);
    if (hot) hits.push({ id: `slot:${pageIndex}:${slotIndex}`, rect });
    return;
  }
  const attackHot = !yours && drop.units.has(unit.instanceId);
  const selected = model.selectedId === unit.instanceId || model.drag?.instanceId === unit.instanceId;
  panel(root, rect, yours ? tokens.color.ally : tokens.color.foe, tokens.radius.slot, attackHot || selected ? tokens.color.gold : yours ? tokens.color.allyEdge : tokens.color.foeEdge);
  if (unit.exhausted) shade(root, rect, 0.28);
  const nameSize = rect.w < 90 ? 11 : 13;
  label(root, fit(unit.name, rect.w < 90 ? 11 : 16), rect.x + rect.w / 2, rect.y + 8, nameSize, tokens.color.white, 0.5);
  glyphMark(root, unit.glyph, rect.x + rect.w / 2, rect.y + rect.h / 2 + 2, Math.min(18, rect.h * 0.22), tokens.color.parchment);
  badge(root, rect.x + 6, rect.y + rect.h - 18, `${unit.attack}`, tokens.color.goldDeep);
  badge(root, rect.x + rect.w - 28, rect.y + rect.h - 18, `${unit.health}`, 0x6e2430);
  if (unit.warded) dot(root, rect.x + rect.w - 10, rect.y + 10, 4, tokens.color.white);
  if (yours && canMoveOrAttack(unit, model)) hits.push({ id: `unit:${unit.instanceId}`, rect });
  if (attackHot || drop.spells.has(unit.instanceId) || (model.targeting && drop.units.has(unit.instanceId))) {
    hits.push({ id: `unit:${unit.instanceId}`, rect });
  }
}

function drawNotes(root: Container, lane: Rect, notes: { known: boolean; name: string | null; faceDown: boolean; owner: 0 | 1 }[]) {
  notes.forEach((note, index) => {
    const x = lane.x + index * 28;
    const y = lane.y + Math.max(0, (lane.h - 26) / 2);
    const g = new Graphics();
    g.roundRect(x, y, 24, 26, 3).fill({ color: tokens.color.note }).stroke({ width: 1, color: tokens.color.noteEdge });
    g.moveTo(x + 16, y).lineTo(x + 24, y + 8).lineTo(x + 16, y + 8).fill({ color: 0xe7d7b0 });
    if (!note.known) {
      g.moveTo(x + 4, y + 14).lineTo(x + 14, y + 14).stroke({ width: 1, color: tokens.color.noteEdge });
      g.moveTo(x + 4, y + 18).lineTo(x + 12, y + 18).stroke({ width: 1, color: tokens.color.noteEdge });
    }
    root.addChild(g);
    if (note.known && note.name) label(root, fit(note.name, 8), x + 12, y + 16, 8, tokens.color.ink, 0.5);
  });
}

function drawHand(root: Container, hits: Hit[], layout: BoardLayout, payload: ClientPayload, model: SceneModel) {
  const hand = payload.view.hand;
  const rects = handRects(layout.hand, hand.length, layout.mode);
  hand.forEach((card, index) => {
    const rect = rects[index];
    if (!rect) return;
    const lifted = model.selectedId === card.instanceId || model.mulligan.has(card.instanceId);
    const drawn = { ...rect, y: rect.y - (lifted ? 16 : 0) };
    if (model.drag?.instanceId === card.instanceId) {
      panel(root, drawn, 0x2a2118, tokens.radius.card, tokens.color.line);
      return;
    }
    drawCardFace(root, drawn, card, model.mulligan.has(card.instanceId));
    if (payload.view.yourTurn) hits.push({ id: `card:${card.instanceId}`, rect: drawn });
  });
}

function drawCardFace(root: Container, rect: Rect, card: CardView, marked: boolean) {
  panel(root, rect, tokens.color.parchment, tokens.radius.card, marked ? tokens.color.danger : tokens.color.goldDeep);
  dot(root, rect.x + 14, rect.y + 14, 9, tokens.color.goldDeep);
  label(root, String(card.cost), rect.x + 14, rect.y + 8, 12, tokens.color.white, 0.5);
  label(root, fit(card.name, rect.w > 80 ? 14 : 10), rect.x + rect.w / 2, rect.y + 28, rect.w > 80 ? 13 : 11, tokens.color.ink, 0.5);
  glyphMark(root, card.glyph, rect.x + rect.w / 2, rect.y + rect.h * 0.55, rect.w > 80 ? 16 : 12, houseTint(card.house));
  const kind = card.type === 'character' ? `${card.attack}/${card.health}` : card.type === 'marginalia' ? 'Note' : 'Ink';
  label(root, kind, rect.x + rect.w / 2, rect.y + rect.h - 22, 12, tokens.color.inkSoft, 0.5);
  if (card.keywords.length) label(root, card.keywords[0] ?? '', rect.x + rect.w / 2, rect.y + rect.h - 38, 10, tokens.color.goldDeep, 0.5);
}

function drawActions(root: Container, hits: Hit[], layout: BoardLayout, payload: ClientPayload, model: SceneModel) {
  const view = payload.view;
  if (view.winner != null) return;
  if (view.phase === 'mulligan' && view.yourTurn) {
    const rect = union(layout.fight, layout.endTurn);
    const count = model.mulligan.size;
    button(root, hits, 'mulligan', rect, count === 0 ? 'Keep hand' : `Replace ${count}`, true);
    return;
  }
  const fight = payload.legalActions.some((action) => action.type === 'fight');
  const end = payload.legalActions.some((action) => action.type === 'end');
  if (fight) button(root, hits, 'fight', layout.fight, 'To battle', true);
  if (end) button(root, hits, 'end', layout.endTurn, 'End turn', true);
  if (!view.yourTurn && view.winner == null) {
    label(root, payload.opponentThinking ? 'Rival is writing…' : 'Waiting', layout.endTurn.x + layout.endTurn.w / 2, layout.endTurn.y + 14, 14, tokens.color.muted, 0.5);
  }
}

function drawStatus(root: Container, layout: BoardLayout, payload: ClientPayload, model: SceneModel) {
  const view = payload.view;
  const seconds = model.remainingMs == null ? '' : `${Math.max(0, Math.ceil(model.remainingMs / 1000))}s`;
  const phase = view.phase === 'game_over' ? 'Complete' : view.phase === 'mulligan' ? 'Mulligan' : view.phase === 'fight' ? 'Fight' : 'Main';
  const who = view.yourTurn ? 'Your turn' : 'Rival turn';
  const turnNo = Math.max(view.turn[0], view.turn[1], 1);
  label(root, `${who} · ${phase} · ${turnNo}/${view.maxTurns} ${seconds}`, layout.status.x, layout.status.y, 13, tokens.color.parchment, 0);
  const latest = view.events[view.events.length - 1];
  if (latest && layout.mode === 'desktop') label(root, fit(latest.text, 52), layout.log.x, layout.log.y, 13, tokens.color.muted, 0);
  if (model.message && view.winner == null) {
    label(root, fit(model.message, layout.mode === 'phone' ? 42 : 70), layout.hand.x, layout.hand.y - 16, 12, tokens.color.gold, 0);
  }
}

function drawResult(root: Container, hits: Hit[], model: SceneModel, payload: ClientPayload) {
  const view = payload.view;
  const won = view.winner === view.you;
  const rect = { x: model.width / 2 - 150, y: model.height / 2 - 70, w: 300, h: 150 };
  panel(root, rect, 0x1a120d, 16, won ? tokens.color.gold : tokens.color.foeEdge);
  label(root, won ? 'Verse victory' : 'The rival holds', rect.x + rect.w / 2, rect.y + 18, 22, tokens.color.parchment, 0.5);
  label(root, view.winReason === 'health' ? 'Won on board health' : view.winReason === 'tiebreak' ? 'Won on the final tiebreak' : 'First to 8 Verse', rect.x + rect.w / 2, rect.y + 48, 14, tokens.color.muted, 0.5);
  const verify = { x: rect.x + 16, y: rect.y + 84, w: 128, h: 40 };
  const again = { x: rect.x + 156, y: rect.y + 84, w: 128, h: 40 };
  button(root, hits, 'verify', verify, model.verify || 'Verify', true);
  button(root, hits, 'again', again, 'Again', true);
}

function drawCardGhost(root: Container, drag: DragState, payload: ClientPayload) {
  const card = payload.view.hand.find((candidate) => candidate.instanceId === drag.instanceId);
  if (!card) return;
  const rect = { x: drag.x - 36, y: drag.y - 54, w: 72, h: 108 };
  drawCardFace(root, rect, card, false);
}

function drawUnitGhost(root: Container, drag: DragState, payload: ClientPayload) {
  const unit = findUnit(payload, drag.instanceId);
  if (!unit) return;
  const rect = { x: drag.x - 36, y: drag.y - 28, w: 72, h: 56 };
  panel(root, rect, tokens.color.ally, 8, tokens.color.gold);
  label(root, fit(unit.name, 10), rect.x + rect.w / 2, rect.y + 8, 12, tokens.color.white, 0.5);
  label(root, `${unit.attack}/${unit.health}`, rect.x + rect.w / 2, rect.y + 28, 12, tokens.color.gold, 0.5);
}

function drawPreview(root: Container, model: SceneModel) {
  const preview = model.preview;
  const drag = model.drag;
  if (!preview || !drag) return;
  const w = 214;
  const h = preview.marginNoteStrikes || preview.verseGain > 0 ? 132 : 112;
  let x = drag.x + 18;
  let y = drag.y - h - 12;
  if (x + w > model.width - 8) x = drag.x - w - 12;
  if (y < 8) y = drag.y + 24;
  const rect = { x, y, w, h };
  panel(root, rect, 0x1c140f, 12, tokens.color.gold);
  label(root, 'Trade', rect.x + 12, rect.y + 8, 13, tokens.color.gold, 0);
  const a = `${fit(preview.attackerName, 12)}  ${preview.attackerHealthBefore}→${preview.attackerDies ? 'falls' : preview.attackerHealthAfter}`;
  const d = `${fit(preview.defenderName, 12)}  ${preview.defenderHealthBefore}→${preview.defenderDies ? 'falls' : preview.defenderHealthAfter}`;
  label(root, a, rect.x + 12, rect.y + 32, 13, tokens.color.allyEdge, 0);
  label(root, d, rect.x + 12, rect.y + 52, 13, tokens.color.foeEdge, 0);
  let line = 72;
  if (preview.marginNoteStrikes) {
    label(root, 'A margin note strikes first', rect.x + 12, rect.y + line, 12, tokens.color.note, 0);
    line += 18;
  }
  if (preview.verseGain > 0) {
    label(root, `Conquer +${preview.verseGain}`, rect.x + 12, rect.y + line, 13, tokens.color.gold, 0);
    line += 18;
  }
  label(root, 'Release to attack', rect.x + 12, rect.y + h - 22, 12, tokens.color.muted, 0);
}

function drawFloats(root: Container, layout: BoardLayout, model: SceneModel) {
  for (const note of model.floats) {
    const age = (model.now - note.born) / tokens.motion.verseMs;
    if (age < 0 || age >= 1) continue;
    const y = layout.verse.y + layout.verse.h / 2 - age * 28;
    const x = note.player === 0 ? layout.verse.x + 18 : layout.verse.x + layout.verse.w - 120;
    const text = new Text({
      text: note.text,
      style: { fill: tokens.color.gold, fontFamily: tokens.font.display, fontSize: 22 },
    });
    text.position.set(x, y);
    text.alpha = 1 - age;
    root.addChild(text);
  }
}

interface DropTargets {
  pages: Set<number>;
  frames: Set<number>;
  slots: Set<string>;
  slotId: string | null;
  units: Set<string>;
  spells: Set<string>;
}

function dropTargets(payload: ClientPayload, model: SceneModel): DropTargets {
  const pages = new Set<number>();
  const frames = new Set<number>();
  const slots = new Set<string>();
  const units = new Set<string>();
  const spells = new Set<string>();
  let slotId: string | null = null;
  const dragId = model.drag?.instanceId ?? model.selectedId;
  if (!dragId || !payload.view.yourTurn) return { pages, frames, slots, slotId, units, spells };
  const card = payload.view.hand.find((entry) => entry.instanceId === dragId);
  for (const action of payload.legalActions) {
    const played = (action.type === 'play' && String(action.uid) === dragId) || (action.type === 'champion' && dragId === 'champion');
    if (action.type === 'play' || action.type === 'champion') {
      if (!played) continue;
      const page = action.page;
      const target = action.target;
      if (page != null && target == null && (card?.type === 'character' || dragId === 'champion')) {
        const battlefield = payload.view.pages[page];
        battlefield?.slots.forEach((slot) => {
          if (!slot.you) slots.add(`${page}:${slot.index}`);
        });
        slotId = `slot:${page}:0`;
      }
      if (page != null && target == null && (card?.type === 'marginalia' || card?.type === 'inkwork')) frames.add(page);
      if (target != null && card?.type === 'character') units.add(String(target));
      if (target != null && card && card.type !== 'character') spells.add(String(target));
      if (target != null && dragId === 'champion') units.add(String(target));
    }
    if (model.drag?.kind === 'unit' && action.type === 'attack' && String(action.uid) === dragId) units.add(String(action.target));
    if (model.drag?.kind === 'unit' && action.type === 'move' && String(action.uid) === dragId) {
      const unit = findUnit(payload, dragId);
      if (unit) {
        const dest = unit.page === 0 ? 1 : 0;
        for (const slot of payload.view.pages[dest].slots) {
          if (!slot.you) slots.add(`${dest}:${slot.index}`);
        }
      }
    }
    if (model.targeting && action.type === 'legend') {
      units.add(String(action.target));
      if (action.target2 != null) units.add(String(action.target2));
    }
  }
  return { pages, frames, slots, slotId, units, spells };
}

function canMoveOrAttack(unit: UnitView, model: SceneModel): boolean {
  if (!model.payload || unit.exhausted) return false;
  return model.payload.legalActions.some((action) => {
    if (action.type === 'attack' && String(action.uid) === unit.instanceId) return true;
    if (action.type === 'move' && String(action.uid) === unit.instanceId) return true;
    if (action.type === 'legend' && model.targeting) {
      return String(action.target) === unit.instanceId || (action.target2 != null && String(action.target2) === unit.instanceId);
    }
    return false;
  });
}

function powerEnabled(payload: ClientPayload): boolean {
  return payload.legalActions.some((action) => action.type === 'legend');
}

function findUnit(payload: ClientPayload, id: string): UnitView | null {
  for (const page of payload.view.pages) {
    for (const slot of page.slots) {
      if (slot.you?.instanceId === id) return slot.you;
      if (slot.foe?.instanceId === id) return slot.foe;
    }
  }
  return null;
}

function panel(root: Container, rect: Rect, fill: number, radius: number, stroke: number) {
  const g = new Graphics();
  g.roundRect(rect.x, rect.y, rect.w, rect.h, radius).fill({ color: fill }).stroke({ width: 1.5, color: stroke, alpha: 0.95 });
  root.addChild(g);
}

function shade(root: Container, rect: Rect, alpha: number) {
  const g = new Graphics();
  g.roundRect(rect.x, rect.y, rect.w, rect.h, tokens.radius.slot).fill({ color: 0x000000, alpha });
  root.addChild(g);
}

function dot(root: Container, x: number, y: number, r: number, color: number) {
  const g = new Graphics();
  g.circle(x, y, r).fill({ color });
  root.addChild(g);
}

function ring(root: Container, x: number, y: number, r: number, color: number, alpha: number) {
  const g = new Graphics();
  g.circle(x, y, r).stroke({ width: 2, color, alpha });
  root.addChild(g);
}

function badge(root: Container, x: number, y: number, text: string, color: number) {
  const g = new Graphics();
  g.roundRect(x, y, 22, 16, 4).fill({ color });
  root.addChild(g);
  label(root, text, x + 11, y + 1, 11, tokens.color.white, 0.5);
}

function inkRow(root: Container, x: number, y: number, ink: number, maxInk: number) {
  const total = Math.max(maxInk, ink, 1);
  for (let i = 0; i < total && i < 8; i++) {
    dot(root, x + 6 + i * 12, y, 4.5, i < ink ? tokens.color.inkDrop : tokens.color.pipEmpty);
  }
}

function button(root: Container, hits: Hit[], id: string, rect: Rect, text: string, enabled: boolean) {
  panel(root, rect, enabled ? tokens.color.buttonHot : 0x2a2118, 10, enabled ? tokens.color.gold : tokens.color.line);
  label(root, text, rect.x + rect.w / 2, rect.y + rect.h / 2, 15, enabled ? tokens.color.white : tokens.color.inkSoft, 0.5, 0.5);
  if (enabled) hits.push({ id, rect });
}

function label(root: Container, text: string, x: number, y: number, size: number, fill: number, anchorX: number, anchorY = 0) {
  const node = new Text({
    text,
    style: { fill, fontFamily: tokens.font.display, fontSize: size },
  });
  node.anchor.set(anchorX, anchorY);
  node.position.set(x, y);
  root.addChild(node);
}

function glyphMark(root: Container, glyph: string, x: number, y: number, size: number, color: number) {
  const g = new Graphics();
  if (glyph === 'flame' || glyph === 'spark') {
    g.moveTo(x, y - size).lineTo(x + size * 0.7, y + size * 0.8).lineTo(x - size * 0.7, y + size * 0.8).fill({ color });
  } else if (glyph === 'blade' || glyph === 'fox') {
    g.moveTo(x, y - size).lineTo(x + size * 0.45, y + size).lineTo(x - size * 0.45, y + size).fill({ color });
  } else if (glyph === 'note') {
    g.roundRect(x - size * 0.55, y - size * 0.7, size * 1.1, size * 1.4, 2).fill({ color });
  } else if (glyph === 'lamp') {
    g.circle(x, y, size * 0.55).fill({ color });
  } else {
    g.roundRect(x - size * 0.6, y - size * 0.7, size * 1.2, size * 1.3, 3).fill({ color });
  }
  root.addChild(g);
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function houseName(house: string): string {
  if (house === 'candle') return 'The Candle';
  if (house === 'fold') return 'The Fold';
  if (house === 'tidewrack') return 'Tidewrack';
  return house;
}

function stanceHint(stance: Stance): string {
  if (stance === 'aggressive') return 'Press the page';
  if (stance === 'patient') return 'Wait and answer';
  return 'Trade evenly';
}

export function localTrade(attacker: UnitView, defender: UnitView, noteStrikes: boolean, friends: number, foes: number): TradePreview {
  let attackerHealth = attacker.health;
  let defenderHealth = defender.health;
  let attackerWard = attacker.warded;
  let defenderWard = defender.warded;
  if (noteStrikes) {
    if (attackerWard) attackerWard = false;
    else attackerHealth -= 2;
  }
  if (attackerHealth > 0) {
    if (defenderWard) defenderWard = false;
    else defenderHealth -= attacker.attack;
    if (attackerWard) attackerWard = false;
    else attackerHealth -= defender.attack;
  }
  const attackerDies = attackerHealth <= 0;
  const defenderDies = defenderHealth <= 0;
  const verseGain = defenderDies && foes === 1 && !attackerDies && friends >= 1 ? 1 : 0;
  return {
    attackerId: attacker.instanceId,
    defenderId: defender.instanceId,
    attackerName: attacker.name,
    defenderName: defender.name,
    attackerHealthBefore: attacker.health,
    defenderHealthBefore: defender.health,
    attackerHealthAfter: Math.max(0, attackerHealth),
    defenderHealthAfter: Math.max(0, defenderHealth),
    attackerDies,
    defenderDies,
    verseGain,
    marginNoteStrikes: noteStrikes,
  };
}

export type { GameAction };
