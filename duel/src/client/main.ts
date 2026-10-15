import { Application, Container, Rectangle } from 'pixi.js';
import type { ClientPayload, GameAction, Stance, TradePreview, UnitView } from '../types.js';
import { createMatch, fetchMatch, previewAttack, sendAction, verifyReplay } from './api.js';
import { hitTest, localTrade, renderScene, type DragState, type FloatNote, type Hit } from './scene.js';
import { tokens } from './tokens.js';

const mount = document.querySelector('#app');
if (!mount) throw new Error('missing #app');

const pixi = new Application();
try {
  await pixi.init({
    resizeTo: window,
    background: tokens.color.bg,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: 'webgl',
  });
} catch {
  await pixi.init({
    resizeTo: window,
    background: tokens.color.bg,
    autoDensity: true,
    resolution: 1,
    preference: 'canvas',
  });
}

mount.replaceChildren(pixi.canvas);
pixi.canvas.style.touchAction = 'none';
pixi.canvas.style.width = '100%';
pixi.canvas.style.height = '100%';

const root = new Container();
pixi.stage.addChild(root);
pixi.stage.eventMode = 'static';

interface Pointer {
  id: string;
  x: number;
  y: number;
  moved: boolean;
  kind: 'card' | 'unit';
}

const ui = {
  screen: 'title' as 'title' | 'board',
  stance: 'balanced' as Stance,
  payload: null as ClientPayload | null,
  selectedId: null as string | null,
  targeting: false,
  mulligan: new Set<string>(),
  legendTarget: null as number | null,
  drag: null as DragState | null,
  pointer: null as Pointer | null,
  hoverId: null as string | null,
  preview: null as TradePreview | null,
  previewFor: '',
  floats: [] as FloatNote[],
  seenEvent: 0,
  message: '',
  verify: '',
  busy: false,
};

let hits: Hit[] = [];
let dirty = true;
let lastTick = -1;

function remaining(): number | null {
  const deadline = ui.payload?.turnDeadline;
  if (deadline == null) return null;
  return deadline - Date.now();
}

function redraw() {
  for (const child of root.removeChildren()) child.destroy({ children: true });
  pixi.stage.hitArea = new Rectangle(0, 0, pixi.screen.width, pixi.screen.height);
  const sceneHits = renderScene(root, {
    width: pixi.screen.width,
    height: pixi.screen.height,
    now: Date.now(),
    stance: ui.stance,
    screen: ui.screen,
    payload: ui.payload,
    selectedId: ui.selectedId,
    targeting: ui.targeting,
    mulligan: ui.mulligan,
    drag: ui.drag,
    hoverId: ui.hoverId,
    preview: ui.preview,
    floats: ui.floats,
    message: ui.message,
    verify: ui.verify,
    remainingMs: remaining(),
  });
  hits = sceneHits;
  const debug = window as unknown as { __duelHits?: Hit[]; __duel?: ClientPayload | null };
  debug.__duelHits = sceneHits;
  debug.__duel = ui.payload;
}

pixi.ticker.add(() => {
  const now = Date.now();
  const before = ui.floats.length;
  ui.floats = ui.floats.filter((note) => now - note.born < tokens.motion.verseMs);
  const tick = Math.floor(now / 250);
  if (ui.floats.length > 0 || before !== ui.floats.length || dirty || tick !== lastTick) {
    lastTick = tick;
    dirty = false;
    redraw();
  }
});

window.addEventListener('resize', () => {
  dirty = true;
});

function adopt(payload: ClientPayload) {
  const fresh = ui.payload?.matchId !== payload.matchId;
  if (!fresh) {
    for (const event of payload.view.events) {
      if (event.id <= ui.seenEvent) continue;
      if ((event.kind === 'hold' || event.kind === 'conquer') && event.player != null) {
        ui.floats.push({ text: event.text, born: Date.now(), player: event.player });
      }
    }
  }
  ui.seenEvent = payload.view.events.reduce((max, event) => Math.max(max, event.id), 0);
  ui.payload = payload;
  ui.screen = 'board';
  if (!payload.view.yourTurn) {
    ui.selectedId = null;
    ui.targeting = false;
    ui.legendTarget = null;
    ui.drag = null;
    ui.pointer = null;
    ui.preview = null;
  }
  dirty = true;
}

async function play() {
  if (ui.busy) return;
  ui.busy = true;
  ui.message = '';
  dirty = true;
  try {
    const payload = await createMatch(ui.stance);
    ui.mulligan = new Set();
    ui.verify = '';
    ui.seenEvent = 0;
    ui.selectedId = null;
    ui.targeting = false;
    adopt(payload);
  } catch {
    ui.message = 'The match service is not answering.';
    dirty = true;
  } finally {
    ui.busy = false;
  }
}

async function act(action: GameAction) {
  if (!ui.payload || ui.busy) return;
  ui.busy = true;
  ui.message = '';
  ui.drag = null;
  ui.pointer = null;
  ui.preview = null;
  try {
    const next = await sendAction(ui.payload.matchId, action);
    ui.selectedId = null;
    ui.targeting = false;
    ui.legendTarget = null;
    adopt(next);
  } catch (error) {
    ui.message = error instanceof Error ? friendly(error.message) : 'That action was refused.';
    dirty = true;
  } finally {
    ui.busy = false;
  }
}

function friendly(code: string): string {
  if (code === 'illegal_action') return 'That play is not legal.';
  if (code === 'opponent_turn') return 'The rival is still writing.';
  return 'The match refused that.';
}

setInterval(() => {
  const payload = ui.payload;
  if (!payload || ui.busy || payload.status === 'complete') return;
  void fetchMatch(payload.matchId)
    .then((next) => {
      if (ui.payload?.matchId === next.matchId) adopt(next);
    })
    .catch(() => undefined);
}, 400);

function onDown(x: number, y: number) {
  const hit = hitTest(hits, x, y);
  if (!hit) {
    ui.selectedId = null;
    ui.targeting = false;
    ui.message = '';
    dirty = true;
    return;
  }
  if (hit.id.startsWith('stance:')) {
    const stance = hit.id.slice('stance:'.length);
    if (stance === 'aggressive' || stance === 'balanced' || stance === 'patient') ui.stance = stance;
    dirty = true;
    return;
  }
  if (hit.id === 'play' || hit.id === 'again') {
    void play();
    return;
  }
  if (hit.id === 'verify' && ui.payload) {
    const matchId = ui.payload.matchId;
    void verifyReplay(matchId).then((report) => {
      ui.verify = report.ok ? 'Verified' : 'Mismatch';
      dirty = true;
    });
    return;
  }
  if (hit.id === 'mulligan' && ui.payload) {
    const idx = ui.payload.view.hand.flatMap((card, index) => (ui.mulligan.has(card.instanceId) ? [index] : []));
    void act({ type: 'mulligan', idx });
    return;
  }
  if (hit.id === 'fight') {
    void act({ type: 'fight' });
    return;
  }
  if (hit.id === 'end') {
    void act({ type: 'end' });
    return;
  }
  if (hit.id === 'power') {
    ui.targeting = !ui.targeting;
    ui.legendTarget = null;
    ui.selectedId = null;
    ui.message = ui.targeting ? ui.payload?.view.youLegend.powerText ?? 'Choose an ally.' : '';
    dirty = true;
    return;
  }
  if (!ui.payload?.view.yourTurn) return;

  if (hit.id.startsWith('card:')) {
    const id = hit.id.slice('card:'.length);
    const card = ui.payload.view.hand.find((entry) => entry.instanceId === id);
    if (ui.payload.view.phase === 'mulligan') {
      if (card?.defId === 'spare_ink') return;
      if (ui.mulligan.has(id)) ui.mulligan.delete(id);
      else ui.mulligan.add(id);
      dirty = true;
      return;
    }
    if (ui.selectedId === id) {
      const bare = barePlay(ui.payload, id);
      if (bare) {
        void act(bare);
        return;
      }
    }
    ui.pointer = { id, x, y, moved: false, kind: 'card' };
    ui.selectedId = id;
    ui.targeting = false;
    ui.legendTarget = null;
    ui.message = card?.text ?? '';
    dirty = true;
    return;
  }

  if (hit.id.startsWith('slot:')) {
    const action = characterPlay(ui.payload, ui.selectedId, hit.id);
    if (action) void act(action);
    return;
  }

  if (hit.id.startsWith('page:')) {
    const action = notePlay(ui.payload, ui.selectedId, hit.id);
    if (action) void act(action);
    return;
  }

  if (hit.id.startsWith('unit:')) {
    const id = hit.id.slice('unit:'.length);
    if (ui.targeting) {
      const action = legendAction(ui.payload, id, ui.legendTarget);
      if (action === 'need-second') {
        ui.legendTarget = Number(id);
        ui.message = 'Choose an enemy on the other page.';
        dirty = true;
        return;
      }
      if (action) void act(action);
      return;
    }
    const spell = playOnUnit(ui.payload, ui.selectedId, id);
    if (spell && ui.selectedId) {
      void act(spell);
      return;
    }
    const unit = findUnit(ui.payload, id);
    if (unit && unit.owner === ui.payload.view.you && !unit.exhausted) {
      ui.pointer = { id, x, y, moved: false, kind: 'unit' };
      ui.selectedId = id;
      ui.message = 'Drag onto an enemy to preview the trade.';
      dirty = true;
    }
  }
}

function onMove(x: number, y: number) {
  const pointer = ui.pointer;
  if (!pointer || !ui.payload) return;
  const dx = x - pointer.x;
  const dy = y - pointer.y;
  if (!pointer.moved && dx * dx + dy * dy < 36) return;
  pointer.moved = true;
  ui.drag = { kind: pointer.kind, instanceId: pointer.id, x, y };
  const hit = hitTest(hits, x, y);
  const hover = hit?.id ?? null;
  if (hover !== ui.hoverId) {
    ui.hoverId = hover;
    void refreshPreview(hover);
  }
  dirty = true;
}

async function refreshPreview(hover: string | null) {
  const payload = ui.payload;
  const drag = ui.drag;
  if (!payload || !drag || drag.kind !== 'unit' || !hover?.startsWith('unit:')) {
    ui.preview = null;
    dirty = true;
    return;
  }
  const defenderId = hover.slice('unit:'.length);
  const action = payload.legalActions.find((candidate) => candidate.type === 'attack' && String(candidate.uid) === drag.instanceId && String(candidate.target) === defenderId);
  if (!action || action.type !== 'attack') {
    ui.preview = null;
    dirty = true;
    return;
  }
    const attacker = findUnit(payload, String(action.uid));
    const defender = findUnit(payload, String(action.target));
  if (attacker && defender) {
    const page = payload.view.pages[attacker.page];
    const note = page?.marginalia.some((entry) => entry.owner !== payload.view.you && entry.faceDown) ?? false;
    const friends = page?.slots.filter((slot) => slot.you).length ?? 1;
    const foes = page?.slots.filter((slot) => slot.foe).length ?? 1;
    ui.preview = localTrade(attacker, defender, note, friends, foes, page?.name === 'The Spine');
    dirty = true;
  }
  const key = `${action.uid}:${action.target}`;
  ui.previewFor = key;
  try {
    const result = await previewAttack(payload.matchId, action);
    if (ui.previewFor === key && ui.drag?.instanceId === String(action.uid)) {
      ui.preview = result.preview;
      dirty = true;
    }
  } catch {
    dirty = true;
  }
}

function onUp(x: number, y: number) {
  const pointer = ui.pointer;
  const drag = ui.drag;
  ui.pointer = null;
  if (!pointer?.moved || !drag || !ui.payload) {
    ui.drag = null;
    ui.preview = null;
    dirty = true;
    return;
  }
  const hit = hitTest(hits, x, y);
  ui.drag = null;
  ui.preview = null;
  ui.hoverId = null;
  if (!hit) {
    dirty = true;
    return;
  }
  if (drag.kind === 'card' && hit.id.startsWith('slot:')) {
    const action = characterPlay(ui.payload, drag.instanceId, hit.id);
    if (action) void act(action);
    else dirty = true;
    return;
  }
  if (drag.kind === 'card' && hit.id.startsWith('page:')) {
    const action = notePlay(ui.payload, drag.instanceId, hit.id);
    if (action) void act(action);
    else dirty = true;
    return;
  }
  if (drag.kind === 'card' && hit.id.startsWith('unit:')) {
    const unitId = hit.id.slice('unit:'.length);
    const action = playOnUnit(ui.payload, drag.instanceId, unitId);
    if (action) void act(action);
    else dirty = true;
    return;
  }
  if (drag.kind === 'unit' && hit.id.startsWith('unit:')) {
    const defenderId = hit.id.slice('unit:'.length);
    const action = ui.payload.legalActions.find((candidate) => candidate.type === 'attack' && String(candidate.uid) === drag.instanceId && String(candidate.target) === defenderId);
    if (action) void act(action);
    else dirty = true;
    return;
  }
  if (drag.kind === 'unit' && hit.id.startsWith('slot:')) {
    const action = ui.payload.legalActions.find((candidate) => candidate.type === 'move' && String(candidate.uid) === drag.instanceId);
    if (action) void act(action);
    else dirty = true;
    return;
  }
  dirty = true;
}

function characterPlay(payload: ClientPayload, instanceId: string | null, hitId: string): GameAction | null {
  if (!instanceId) return null;
  const page = Number(hitId.split(':')[1]);
  if (instanceId === 'champion') {
    return payload.legalActions.find((candidate) => candidate.type === 'champion' && candidate.page === page && candidate.target == null) ?? null;
  }
  const uid = Number(instanceId);
  return payload.legalActions.find((candidate) => candidate.type === 'play' && candidate.uid === uid && candidate.page === page && candidate.target == null) ?? null;
}

function notePlay(payload: ClientPayload, instanceId: string | null, hitId: string): GameAction | null {
  if (!instanceId) return null;
  const page = Number(hitId.slice('page:'.length));
  const uid = Number(instanceId);
  return payload.legalActions.find((candidate) => candidate.type === 'play' && candidate.uid === uid && candidate.page === page && candidate.target == null) ?? null;
}

function playOnUnit(payload: ClientPayload, instanceId: string | null, unitId: string): GameAction | null {
  if (!instanceId) return null;
  const target = Number(unitId);
  if (instanceId === 'champion') {
    return payload.legalActions.find((candidate) => candidate.type === 'champion' && candidate.target === target) ?? null;
  }
  const uid = Number(instanceId);
  return payload.legalActions.find((candidate) => candidate.type === 'play' && candidate.uid === uid && candidate.target === target) ?? null;
}

function barePlay(payload: ClientPayload, instanceId: string): GameAction | null {
  if (instanceId === 'champion') return null;
  const uid = Number(instanceId);
  return payload.legalActions.find((candidate) => candidate.type === 'play' && candidate.uid === uid && candidate.page == null && candidate.target == null) ?? null;
}

function legendAction(payload: ClientPayload, unitId: string, pending: number | null): GameAction | 'need-second' | null {
  const uid = Number(unitId);
  if (pending != null) {
    return payload.legalActions.find((candidate) => candidate.type === 'legend' && candidate.target === pending && candidate.target2 === uid) ?? null;
  }
  const direct = payload.legalActions.find((candidate) => candidate.type === 'legend' && candidate.target === uid && candidate.target2 == null);
  if (direct) return direct;
  const paired = payload.legalActions.some((candidate) => candidate.type === 'legend' && candidate.target === uid && candidate.target2 != null);
  return paired ? 'need-second' : null;
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

pixi.stage.on('pointerdown', (event) => onDown(event.global.x, event.global.y));
pixi.stage.on('pointermove', (event) => onMove(event.global.x, event.global.y));
pixi.stage.on('pointerup', (event) => onUp(event.global.x, event.global.y));
pixi.stage.on('pointerupoutside', (event) => onUp(event.global.x, event.global.y));
