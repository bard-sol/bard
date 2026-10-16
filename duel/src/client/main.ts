import type { ClientPayload, GameAction, Stance, TradePreview, UnitView } from '../types.js';
import { createMatch, fetchMatch, previewAttack, sendAction } from './api.js';
import { GuideController, logMetric, markTip, noteRealMatch, setTutorialFlag, tipSeen, tipsEnabled, tutorialFlag } from './guide.js';
import { INFO_TOASTS, PLAY_STEP_OVER, TIP_COPY, attackToast, endTurnWarning, legendToast, moveToast, playToast, refused, toastCopy, type ToastCopy } from './illegal.js';
import { KEYWORDS } from './guide.js';
import { boardModel, cardSheet, championStub, coachOpts, endHtml, foeOnLeft, howtoHtml, logEntries, spareInHand, toastHtml, tradeHtml } from './present.js';

const app = document.querySelector('#app');
if (!app) throw new Error('missing #app');

window.IS_PHONE = () => window.innerWidth <= 600;

for (const row of Object.values(window.KW13)) {
  const spec = KEYWORDS[row.name];
  if (spec) row.long = spec;
}

for (const [id, card] of Object.entries(window.D13.cards)) card.art = `/art/${id}.png`;

document.addEventListener(
  'error',
  (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const slot = img.parentElement;
    if (!slot) return;
    const tall = slot.getBoundingClientRect().height;
    if (tall > 0 && tall < 60) {
      slot.classList.add('ph');
      img.remove();
      return;
    }
    if (img.dataset.fb === '1') return;
    img.dataset.fb = '1';
    img.src = '/art/_fallback.png';
  },
  true,
);

interface Piece {
  kind: 'card' | 'unit';
  uid: string;
  def: string;
}

interface Drag extends Piece {
  x: number;
  y: number;
  moved: boolean;
  pointer: number;
}

const ui = {
  screen: 'title' as 'title' | 'board' | 'end',
  stance: 'balanced' as Stance,
  payload: null as ClientPayload | null,
  guide: null as GuideController | null,
  openPage: null as number | null,
  sheet: null as string | null,
  preview: null as TradePreview | null,
  drag: null as Drag | null,
  armed: null as Piece | null,
  legendArmed: false,
  skipAsk: false,
  confirm: null as { text: string; action: GameAction } | null,
  toasts: [] as ToastCopy[],
  busy: false,
  holdTimer: 0,
  keywordReady: false,
  suppressClick: false,
  stepSeen: null as number | null,
  beat: '',
  step14Painted: false,
  swap: new Set<string>(),
  banner: null as { text: string; until: number } | null,
  badges: new Map<string, TradePreview>(),
  longPress: false,
  hoverTimer: 0,
};

const RIVAL_BEAT = '.page[data-i="0"] .row.rival .un';

function viewBeat(payload: ClientPayload): string {
  const view = payload.view;
  const units = view.pages.flatMap((page) => page.slots.flatMap((slot) => [slot.you, slot.foe].flatMap((unit) => (unit ? [`${unit.instanceId}:${unit.health}:${unit.attack}`] : []))));
  const notes = view.pages.flatMap((page) => page.marginalia.map((note) => `${note.owner}:${note.faceDown}:${note.defId ?? ''}`));
  const last = view.events.at(-1);
  return [payload.opponentThinking, view.yourTurn, view.turn.join(','), view.verse.join(','), view.ink, view.events.length, last ? `${last.id}:${last.kind}` : '', units.join('|'), notes.join('|'), view.winner ?? ''].join(';');
}

function acting(payload: ClientPayload): boolean {
  return payload.view.yourTurn && !payload.opponentThinking;
}

/** Step 14 names the rival's new unit. Leave it only after that unit has been painted and the turn has come back. */
function syncGuide(payload: ClientPayload, beatWasShown: boolean): void {
  const guide = ui.guide;
  if (!guide || guide.done) return;
  const settled = payload.view.yourTurn && !payload.opponentThinking;
  const holdStep14 = guide.step?.id === 14 && (!beatWasShown || !settled);
  if (payload.tutorial && !holdStep14) guide.sync(payload);
  if (payload.view.winner) guide.sync(payload);
}

function noteRivalBeat(): void {
  ui.step14Painted = ui.guide?.step?.id === 14 && Boolean(document.querySelector(RIVAL_BEAT));
}

function markArmed(): void {
  if (!ui.armed) return;
  const sel = `[data-uid="${CSS.escape(ui.armed.uid)}"]`;
  document.querySelectorAll(`.handrow ${sel}, .row.you ${sel}`).forEach((el) => el.classList.add('armed'));
}

/** The guide dim is an SVG. Its mask is visual only, so hit-test past it. */
function boardHit(x: number, y: number): Element | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!(el instanceof Element)) continue;
    if (el.closest('.ovl, #ghost, .toast-host, .sheet-host')) continue;
    return el;
  }
  return null;
}

function gestureTarget(event: PointerEvent): Element | null {
  const raw = event.target instanceof Element ? event.target : null;
  if (raw?.closest('.cm-bub, .cm-skip, .skip-box, .confirm-box, .sheet-host, button, a')) return raw;
  return boardHit(event.clientX, event.clientY) ?? raw;
}

function publish(): void {
  const step = ui.guide?.visible(Boolean(ui.preview)) ?? null;
  window.__duel = ui.payload;
  window.__duelGuide = { step: step?.id ?? null };
  if (step) document.documentElement.dataset.guideStep = String(step.id);
  else delete document.documentElement.dataset.guideStep;
}

function showToast(toast: ToastCopy): void {
  ui.toasts.push(toast);
  if (ui.toasts.length > 2) ui.toasts.shift();
  paint();
  window.setTimeout(() => {
    ui.toasts = ui.toasts.filter((entry) => entry !== toast);
    paint();
  }, 2600);
}

function restricting(): boolean {
  const step = ui.guide?.visible(Boolean(ui.preview));
  return Boolean(step && step.id !== 25 && !ui.guide?.done);
}

function paint(): void {
  trackStep();
  if (ui.drag) {
    paintCoach();
    return;
  }
  const root = app as HTMLElement;
  if (ui.screen === 'title') {
    root.innerHTML = titleHtml();
    publish();
    return;
  }
  const payload = ui.payload;
  if (!payload) {
    root.innerHTML = '<div class="title-screen"><p>Opening the book…</p></div>';
    return;
  }
  const step = ui.guide?.visible(Boolean(ui.preview)) ?? null;
  const ended = payload.view.winner != null && (step == null || step.id >= 26);
  if (ended || ui.screen === 'end') {
    ui.screen = 'end';
    root.innerHTML = endHtml(payload.view, payload.tutorial) + toastHost();
    paintCoach();
    mountSheets();
    publish();
    return;
  }
  ui.screen = 'board';
  const model = boardModel(payload, ui.openPage);
  const mulligan = payload.view.phase === 'mulligan' && payload.view.yourTurn;
  const second = payload.view.verse[0] > 0;
  const hint = mulligan
    ? `${second ? 'You go second: +1 card, Spare Ink, 2 Ink on turn 1, and you start on 1 Verse' : 'You go first'}. Tap cards to swap them. Spare Ink stays.`
    : 'Tap a card to read it';
  const html = window.boardScreen(model.state, {
    mode: payload.tutorial ? 'Card Duel · Guided first match' : 'Card Duel',
    log: logEntries(payload.view),
    lockText: payload.view.yourTurn ? 'Fighting has started.' : "Rival's turn.",
    hint,
    drop: false,
    pageHl: model.pageHl,
    ticker: model.ticker,
    cls: payload.tutorial ? 'guided' : '',
    endLabel: mulligan ? (ui.swap.size ? `Swap ${ui.swap.size}` : 'Keep all') : 'End turn',
    phaseLabel: payload.view.phase === 'fight' ? 'Fight' : payload.view.phase === 'main' ? 'Play' : '',
    endCls: nothingLeft(payload) ? 'pulse' : '',
    spareUid: spareInHand(payload.view)?.uid ?? '',
    championId: championStub(payload.view, payload.tutorial)?.id ?? '',
  });
  root.innerHTML = html;
  const host = document.createElement('div');
  host.className = 'toast-host';
  host.innerHTML = ui.toasts.map((toast) => toastHtml(toast.title, toast.body)).join('');
  document.querySelector('.app')?.append(host);
  const hand = document.getElementById('hand');
  const manyAt = payload.tutorial ? 5 : 4;
  if (hand && hand.children.length > manyAt) hand.classList.add('many');
  for (const uid of ui.swap) document.querySelector(`.handrow [data-uid="${CSS.escape(uid)}"]`)?.classList.add('sel');
  paintBanner();
  paintTray();
  markAim();
  if (step?.id === 6 && window.IS_PHONE()) {
    document.querySelector('.app')?.insertAdjacentHTML('beforeend', `<div class="lift" id="lift">${window.cardFace('c_novice', { size: 'inspect' })}</div>`);
  }
  paintCoach();
  mountSheets();
  if (ui.confirm && !payload.tutorial) {
    const ovl = document.getElementById('ovl');
    if (ovl) {
      ovl.innerHTML = `<div class="confirm-box"><p>${ui.confirm.text}</p><div class="row"><button class="btn secondary" id="confirm-no">Cancel</button><button class="btn primary" id="confirm-yes">End</button></div></div>`;
      ovl.classList.add('on');
    }
  }
  publish();
  maybeTips();
  noteRivalBeat();
  markArmed();
  if (ui.busy) holdControls();
  void aimPreviews();
}

function mountSheets(): void {
  document.querySelector('.sheet-host')?.remove();
  if (!ui.sheet) return;
  const host = document.createElement('div');
  host.className = 'sheet-host';
  host.innerHTML = ui.sheet === 'howto' ? howtoHtml() : cardSheet(ui.sheet);
  document.querySelector('.app')?.append(host);
}

function trackStep(): void {
  const id = ui.guide?.visible(Boolean(ui.preview))?.id ?? null;
  if (ui.stepSeen != null && id !== ui.stepSeen) {
    ui.sheet = null;
    ui.armed = null;
  }
  ui.stepSeen = id;
}

function toastHost(): string {
  return `<div class="toast-host">${ui.toasts.map((toast) => toastHtml(toast.title, toast.body)).join('')}</div>`;
}

function titleHtml(): string {
  return `<div class="title-screen"><div class="title-card"><h1>Bard</h1><p>Card Duel</p>
    <label>Stance <select id="stance"><option value="balanced">Balanced</option><option value="aggressive">Aggressive</option><option value="patient">Patient</option></select></label>
    <button class="btn primary" id="play-title">Play</button>
    <button class="btn secondary" id="replay-title">Replay tutorial</button></div></div>`;
}

function paintCoach(): void {
  const guide = ui.guide;
  const payload = ui.payload;
  const ovl = document.getElementById('ovl');
  if (!guide || !payload?.tutorial || guide.done || !ovl) {
    publish();
    return;
  }
  const step = guide.visible(Boolean(ui.preview));
  if (!step) return;
  if (ui.skipAsk) {
    ovl.innerHTML = `<div class="skip-box"><p>Leave the guided match?</p><div class="row"><button class="btn secondary skip-no">Stay</button><button class="btn primary skip-yes">Skip</button></div></div>`;
    ovl.classList.add('on');
    publish();
    return;
  }
  if (ui.confirm) {
    ovl.innerHTML = `<div class="confirm-box"><p>${ui.confirm.text}</p><div class="row"><button class="btn secondary" id="confirm-no">Cancel</button><button class="btn primary" id="confirm-yes">End</button></div></div>`;
    ovl.classList.add('on');
    publish();
    return;
  }
  const opts = coachOpts(step, { foeLeft: foeOnLeft(payload.view) });
  const holes = opts.holes.filter((sel) => document.querySelector(sel));
  const point = document.querySelector(opts.point) ? opts.point : holes[0];
  if (!point || holes.length === 0) {
    publish();
    return;
  }
  const drag = opts.drag && opts.drag.every((sel) => document.querySelector(sel)) ? opts.drag : undefined;
  let y: number | undefined;
  if ((step.id === 12 || step.id === 23) && window.IS_PHONE()) {
    const board = document.querySelector('.app');
    const bar = document.querySelector('.rbar');
    if (board && bar) y = bar.getBoundingClientRect().top - board.getBoundingClientRect().top;
  }
  placeCoach({
    holes,
    point,
    text: step.text,
    step: step.id,
    n: 27,
    next: opts.next ? 1 : 0,
    action: opts.action,
    drag,
    y,
  });
  if (ui.preview) document.getElementById('ovl')?.insertAdjacentHTML('beforeend', tradeMarkup(ui.preview));
  const bub = document.getElementById('bub');
  if (bub) bub.dataset.guideStep = String(step.id);
  document.querySelector('.cm-next')?.setAttribute('data-guide-next', '1');
  publish();
}

function placeCoach(opts: { holes: string[]; point: string; text: string; step: number; n: number; next: number; action?: string; drag?: [string, string]; y?: number }): void {
  window.coach(opts);
  if (window.IS_PHONE()) return;
  const appEl = document.querySelector('.app');
  const bub = document.getElementById('bub');
  if (!appEl || !bub) return;
  const origin = appEl.getBoundingClientRect();
  const box = (el: Element) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height };
  };
  const width = appEl.clientWidth;
  const height = appEl.clientHeight;
  const pad = 6;
  const bw = bub.offsetWidth;
  const bh = bub.offsetHeight;
  const holes = opts.holes.flatMap((sel) => Array.from(document.querySelectorAll(sel))).map(box).map((rect) => ({ x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 }));
  const avoid = [...holes];
  const header = document.querySelector('.dtop');
  const skip = document.querySelector('.cm-skip');
  if (header) avoid.push(box(header));
  if (skip) avoid.push(box(skip));
  const pointed = document.querySelector(opts.point);
  const target = pointed ? box(pointed) : holes[0];
  if (!target) return;
  const hits = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const spots = [
    { x: target.x + target.w / 2 - bw / 2, y: target.y - bh - 26 },
    { x: target.x + target.w / 2 - bw / 2, y: target.y + target.h + 26 },
    { x: target.x + target.w + 30, y: target.y + target.h / 2 - bh / 2 },
    { x: target.x - bw - 30, y: target.y + target.h / 2 - bh / 2 },
  ].map((spot) => ({ x: Math.max(12, Math.min(width - bw - 12, spot.x)), y: Math.max(12, Math.min(height - bh - 12, spot.y)), w: bw, h: bh }));
  const place = spots.findIndex((spot) => !avoid.some((block) => hits(spot, block)));
  if (place >= 0) window.coach({ ...opts, place });
}

function tradeMarkup(preview: TradePreview): string {
  const attacker = unitOf(preview.attackerId);
  const defender = unitOf(preview.defenderId);
  const notes = [preview.footnote, preview.noteMayFire ? 'A face-down note here may fire.' : '', preview.conquer ? 'Conquer' : ''].filter(Boolean);
  return tradeHtml(preview, { attackerAtk: attacker?.attack ?? 0, defenderAtk: defender?.attack ?? 0, footnote: notes.join(' ') || undefined });
}

function nothingLeft(payload: ClientPayload): boolean {
  if (!acting(payload) || ui.armed || ui.legendArmed) return false;
  if (payload.view.phase !== 'main' && payload.view.phase !== 'fight') return false;
  return !payload.legalActions.some((action) => action.type === 'play' || action.type === 'champion' || action.type === 'legend' || action.type === 'attack');
}

function paintBanner(): void {
  const banner = ui.banner;
  if (!banner || Date.now() > banner.until) return;
  document.querySelector('.app')?.insertAdjacentHTML('beforeend', `<div class="turn-banner" id="turn-banner">${banner.text}</div>`);
}

function paintTray(): void {
  const piece = ui.armed;
  const payload = ui.payload;
  if (!piece || !payload) return;
  const card = piece.kind === 'card' ? cardOf(piece.uid) : null;
  let line = 'Choose a target';
  if (piece.kind === 'unit') line = 'Choose an enemy to attack, or a Page to move to';
  else if (ui.legendArmed) line = 'Choose an ally';
  else if (card?.type === 'character' || card?.defId.startsWith('champ_')) line = 'Choose a Page';
  else if (card?.type === 'inkwork') line = 'Choose an ally';
  else if (card?.type === 'marginalia') line = 'Choose a Page';
  const sub = piece.kind === 'unit' ? 'Attacking ends your plays this turn' : card ? `${card.cost} Ink · arrives ${card.keywords.includes('Swift') ? 'ready (Swift)' : 'tired'}` : '';
  document.querySelector('.hand-wrap')?.insertAdjacentHTML('afterbegin', `<p class="tray" id="tray">${line}${sub ? `<small>${sub}</small>` : ''}</p>`);
}

function markAim(): void {
  const appEl = document.querySelector('.app');
  const payload = ui.payload;
  if (!appEl || !payload) return;
  if (payload.view.phase === 'fight' && payload.view.yourTurn) appEl.classList.add('fightlock');
  if (ui.armed || ui.legendArmed) appEl.classList.add('aiming');
  if (ui.armed) document.getElementById('endturn')?.setAttribute('disabled', 'true');
  const piece = ui.armed;
  for (const action of payload.legalActions) {
    if (ui.legendArmed && action.type === 'legend') {
      document.querySelector(`.row.you [data-uid="${action.target}"]`)?.classList.add('lit', 'lit-ally');
    }
    if (!piece) continue;
    if (piece.kind === 'card' && (piece.uid === 'champion' || piece.def.startsWith('champ_')) && action.type === 'champion' && action.page != null) lightPage(action.page);
    if (piece.kind === 'card' && action.type === 'play' && String(action.uid) === piece.uid) {
      if (action.target != null && action.page == null) document.querySelector(`.row.you [data-uid="${action.target}"]`)?.classList.add('lit', 'lit-ally');
      else if (action.page != null) lightPage(action.page);
    }
    if (piece.kind === 'unit' && action.type === 'attack' && String(action.uid) === piece.uid) {
      document.querySelector(`.row.rival [data-uid="${action.target}"]`)?.classList.add('lit', 'lit-enemy');
    }
    if (piece.kind === 'unit' && action.type === 'move' && String(action.uid) === piece.uid) {
      const mine = unitOf(piece.uid);
      if (mine) lightPage(mine.page === 0 ? 1 : 0);
    }
  }
  for (const [id, preview] of ui.badges) {
    const foe = document.querySelector(`.row.rival [data-uid="${CSS.escape(id)}"]`);
    if (!foe) continue;
    const damage = Math.max(0, preview.defenderHealthBefore - preview.defenderHealthAfter);
    foe.insertAdjacentHTML('beforeend', `<span class="un-float preview">−${damage}</span>`);
  }
}

function lightPage(page: number): void {
  document.querySelectorAll(`.page[data-i="${page}"] .row.you .slot`).forEach((slot) => slot.classList.add('lit'));
  document.querySelector(`.page[data-i="${page}"]`)?.classList.add('lit-lane');
}

async function aimPreviews(): Promise<void> {
  const payload = ui.payload;
  const piece = ui.armed;
  if (!payload || !piece || piece.kind !== 'unit') return;
  const attacks = payload.legalActions.filter((action) => action.type === 'attack' && String(action.uid) === piece.uid);
  const next = new Map<string, TradePreview>();
  await Promise.all(attacks.map(async (action) => {
    if (action.type !== 'attack') return;
    try {
      const result = await previewAttack(payload.matchId, action);
      next.set(String(action.target), result.preview);
    } catch {
      /* The badge stays off when the server refuses the preview. */
    }
  }));
  if (ui.armed?.uid !== piece.uid) return;
  ui.badges = next;
  document.querySelectorAll('.un-float.preview').forEach((node) => node.remove());
  for (const [id, preview] of next) {
    const foe = document.querySelector(`.row.rival [data-uid="${CSS.escape(id)}"]`);
    const damage = Math.max(0, preview.defenderHealthBefore - preview.defenderHealthAfter);
    foe?.insertAdjacentHTML('beforeend', `<span class="un-float preview">−${damage}</span>`);
  }
}

function holeHit(target: EventTarget | null): boolean {
  const step = ui.guide?.visible(Boolean(ui.preview));
  if (!step || step.id === 25 || ui.guide?.done) return true;
  if (!(target instanceof Element)) return false;
  if (target.closest('.cm-next, .cm-skip, .skip-yes, .skip-no, #confirm-yes, #confirm-no, #play-real, .sh-x, #sheet-x, #help, #help-d, #howto-close')) return true;
  const opts = coachOpts(step, { foeLeft: ui.payload ? foeOnLeft(ui.payload.view) : false });
  return opts.holes.some((sel) => target.closest(sel));
}

function adopt(payload: ClientPayload): void {
  const beatWasShown = ui.step14Painted;
  const before = ui.guide?.step?.id;
  const previous = ui.payload;
  if (!previous || previous.matchId !== payload.matchId || previous.view.yourTurn !== payload.view.yourTurn) {
    const name = payload.view.foeLegend.name;
    ui.banner = { text: payload.view.yourTurn ? 'Your turn' : `${name}'s turn`, until: Date.now() + 900 };
  }
  ui.swap.clear();
  ui.badges.clear();
  ui.payload = payload;
  ui.beat = viewBeat(payload);
  if (before === 14) paint();
  syncGuide(payload, beatWasShown);
  const step = ui.guide?.visible(false);
  ui.screen = payload.view.winner && (!ui.guide || ui.guide.done || (step && step.id >= 26)) ? 'end' : 'board';
  if (ui.guide?.step?.id !== before || before !== 14) paint();
}

async function refresh(): Promise<void> {
  const id = ui.payload?.matchId;
  if (!id || ui.drag || ui.busy) return;
  try {
    const next = await fetchMatch(id);
    if (viewBeat(next) !== ui.beat) {
      adopt(next);
      return;
    }
    ui.payload = next;
    pumpGuide();
  } catch {
    /* keep the board */
  }
}

function pumpGuide(): void {
  if (!ui.guide || !ui.payload?.tutorial || ui.guide.done || ui.drag) return;
  const before = ui.guide.step?.id;
  syncGuide(ui.payload, ui.step14Painted);
  if (ui.guide.step?.id !== before) paint();
  else publish();
}

async function start(tutorial: boolean): Promise<void> {
  ui.busy = true;
  ui.screen = 'board';
  ui.sheet = null;
  ui.preview = null;
  ui.skipAsk = false;
  ui.confirm = null;
  paint();
  try {
    if (tutorial) {
      setTutorialFlag('due');
      ui.guide = new GuideController();
    } else {
      ui.guide = null;
      noteRealMatch();
    }
    const payload = await createMatch(tutorial ? 'patient' : ui.stance, tutorial);
    ui.busy = false;
    adopt(payload);
  } catch (error) {
    ui.screen = 'title';
    showToast({ title: 'Could not start', body: error instanceof Error ? error.message : 'Try again.' });
    paint();
  } finally {
    ui.busy = false;
  }
}

function boot(): void {
  if (tutorialFlag() === 'due') void start(true);
  else {
    ui.screen = 'title';
    paint();
  }
}

function offerPlayStepTip(): void {
  const payload = ui.payload;
  if (!payload) return;
  if (!payload.tutorial && tipsEnabled() && !tipSeen('after-attack')) {
    markTip('after-attack');
    logMetric({ kind: 'tip', tip: 'after-attack', action: 'shown' });
    showToast({ title: 'Play step', body: TIP_COPY.afterAttack });
    return;
  }
  showToast(toastCopy('Play step is over', PLAY_STEP_OVER));
}

function holdControls(): void {
  document.querySelector('.app')?.classList.add('busy');
  for (const id of ['endturn', 'legend']) {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLButtonElement)) continue;
    el.disabled = true;
    if (id === 'endturn') el.classList.add('wait');
  }
}

async function act(action: GameAction): Promise<void> {
  const payload = ui.payload;
  if (!payload || ui.busy || !acting(payload)) return;
  ui.armed = null;
  if ((action.type === 'play' || action.type === 'champion' || action.type === 'legend') && payload.view.phase === 'fight') {
    offerPlayStepTip();
    return;
  }
  ui.busy = true;
  ui.preview = null;
  ui.legendArmed = false;
  holdControls();
  try {
    const next = await sendAction(payload.matchId, action);
    ui.busy = false;
    adopt(next);
  } catch (error) {
    ui.busy = false;
    const message = error instanceof Error ? error.message : '';
    showToast(refused(payload, action, message));
  }
}

function cardOf(uid: string) {
  return ui.payload?.view.hand.find((card) => card.instanceId === uid) ?? null;
}

function unitOf(uid: string): UnitView | null {
  for (const page of ui.payload?.view.pages ?? []) {
    for (const slot of page.slots) {
      if (slot.you?.instanceId === uid) return slot.you;
      if (slot.foe?.instanceId === uid) return slot.foe;
    }
  }
  return null;
}

function beginDrag(event: PointerEvent): void {
  if (ui.legendArmed || ui.busy) return;
  if (!ui.payload || !acting(ui.payload) || ui.payload.view.phase === 'mulligan') return;
  const raw = event.target instanceof Element ? event.target : null;
  if (raw?.closest('.cm-bub, .cm-skip, .skip-box, .confirm-box, .sheet-host, .dc-q, button, a')) return;
  const target = raw && !raw.closest('.ovl') ? raw : boardHit(event.clientX, event.clientY);
  if (!target) return;
  if (!holeHit(target)) return;
  const card = target.closest('.handrow .dc, .champ-stub');
  const unit = target.closest('.row.you .un');
  if (!card && !unit) return;
  const uid = (card ?? unit)?.getAttribute('data-uid') ?? '';
  const def = (card ?? unit)?.getAttribute('data-def') ?? '';
  ui.drag = { kind: card ? 'card' : 'unit', uid, def, x: event.clientX, y: event.clientY, moved: false, pointer: event.pointerId };
  if (app instanceof Element) {
    try {
      app.setPointerCapture(event.pointerId);
    } catch {
      /* The pointer can already be gone on a cancelled touch. */
    }
  }
}

function moveDrag(event: PointerEvent): void {
  const drag = ui.drag;
  if (!drag || drag.pointer !== event.pointerId) return;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 8) drag.moved = true;
  if (!drag.moved) return;
  if (event.cancelable) event.preventDefault();
  let ghost = document.getElementById('ghost');
  if (!ghost) {
    ghost = document.createElement('div');
    ghost.id = 'ghost';
    ghost.className = 'ghost';
    ghost.innerHTML = drag.kind === 'card' ? window.cardFace(drag.def, { size: 'hand' }) : '';
    document.body.append(ghost);
  }
  ghost.style.left = `${event.clientX}px`;
  ghost.style.top = `${event.clientY}px`;
  const under = boardHit(event.clientX, event.clientY);
  const foe = under?.closest('.row.rival .un');
  if (drag.kind === 'unit' && foe) {
    const target = foe.getAttribute('data-uid');
    if (target) void loadPreview(Number(drag.uid), Number(target));
  }
}

async function loadPreview(uid: number, target: number): Promise<void> {
  const id = ui.payload?.matchId;
  if (!id) return;
  try {
    const result = await previewAttack(id, { type: 'attack', uid, target });
    if (!ui.drag) return;
    ui.preview = result.preview;
    paintCoach();
  } catch {
    ui.preview = null;
  }
}

async function endDrag(event: PointerEvent, held = false): Promise<void> {
  const drag = ui.drag;
  ui.drag = null;
  document.getElementById('ghost')?.remove();
  if (!drag?.moved || !ui.payload) {
    ui.preview = null;
    const target = boardHit(event.clientX, event.clientY);
    if (drag && !drag.moved && !held && finishTap(target)) return;
    if (drag && !drag.moved && !held && drag.def && target && holeHit(target)) {
      ui.sheet = drag.def;
      armSuppress();
    }
    paint();
    return;
  }
  armSuppress();
  ui.armed = null;
  const under = boardHit(event.clientX, event.clientY);
  const action = dropAction(drag, under);
  ui.preview = null;
  const blocked = action ? blockedToast(drag, action) : null;
  if (blocked) {
    showToast(blocked);
    return;
  }
  if (!action) {
    explain(drag, under);
    return;
  }
  await act(action);
}

function blockedToast(drag: Piece, action: GameAction): ToastCopy | null {
  const payload = ui.payload;
  if (!payload) return null;
  if (action.type === 'attack') {
    return attackToast(payload, unitOf(String(action.uid)), unitOf(String(action.target)));
  }
  if (action.type === 'play' || action.type === 'champion') {
    const card = cardOf(drag.uid);
    if (!card) return null;
    const page = action.page === 0 || action.page === 1 ? action.page : null;
    const pageView = page == null ? null : payload.view.pages[page];
    const yours = pageView?.slots.filter((slot) => slot.you).length ?? 0;
    const cap = pageView?.name === 'The Torn Margin' ? 2 : 4;
    const pageFull = card.type === 'character' && pageView && yours >= cap ? cap : null;
    const noteTaken = card.type === 'marginalia' && (pageView?.marginalia.some((note) => note.owner === payload.view.you) ?? false);
    return playToast(payload, card.name, card.cost, pageView?.name ?? null, pageFull, noteTaken);
  }
  if (action.type === 'move') {
    const unit = unitOf(String(action.uid));
    if (unit?.exhausted) return attackToast(payload, unit, null);
    const dest = unit ? payload.view.pages[unit.page === 0 ? 1 : 0] : null;
    const full = (dest?.slots.filter((slot) => slot.you).length ?? 0) >= (dest?.name === 'The Torn Margin' ? 2 : 4);
    return moveToast(unit, full, dest?.name ?? 'that Page');
  }
  return null;
}

function dropAction(drag: Piece, under: Element | null): GameAction | null {
  const payload = ui.payload;
  if (!payload || !under) return null;
  const slot = under.closest('.slot');
  const unit = under.closest('.un');
  const pageAttr = slot?.getAttribute('data-page') ?? unit?.closest('.page')?.getAttribute('data-i') ?? under.closest('.page')?.getAttribute('data-i');
  const page = pageAttr === '0' || pageAttr === '1' ? Number(pageAttr) as 0 | 1 : null;
  if (drag.kind === 'card') {
    const card = cardOf(drag.uid);
    if (!card) return null;
    if (card.instanceId === 'champion' || card.defId.startsWith('champ_')) {
      if (page == null) return null;
      return { type: 'champion', page };
    }
    const uid = Number(card.instanceId);
    if (card.type === 'inkwork') {
      const ally = unit?.closest('.row.you .un');
      const target = ally?.getAttribute('data-uid');
      const def = ally?.getAttribute('data-def');
      if (!target) return null;
      if (ui.guide?.visible(false)?.id === 20 && def !== 'c_novice') return null;
      return { type: 'play', uid, target: Number(target) };
    }
    if (card.type === 'character' || card.type === 'marginalia') {
      if (page == null) return null;
      return { type: 'play', uid, page };
    }
  }
  const mine = unitOf(drag.uid);
  if (!mine || mine.owner !== payload.view.you) return null;
  const foe = under.closest('.row.rival .un');
  if (foe) {
    const target = foe.getAttribute('data-uid');
    if (!target) return null;
    return { type: 'attack', uid: Number(mine.instanceId), target: Number(target) };
  }
  if (page != null && page !== mine.page) return { type: 'move', uid: Number(mine.instanceId) };
  return null;
}

function explain(drag: Piece, under: Element | null): void {
  const payload = ui.payload;
  if (!payload) return;
  if (drag.kind === 'card') {
    const card = cardOf(drag.uid);
    if (!card) return;
    const toast = playToast(payload, card.name, card.cost, null, null, false);
    if (toast) showToast(toast);
    return;
  }
  const unit = unitOf(drag.uid);
  const foe = under?.closest('.row.rival .un');
  const defender = foe ? unitOf(foe.getAttribute('data-uid') ?? '') : null;
  const toast = attackToast(payload, unit, defender) ?? (unit ? moveToast(unit, false, 'that Page') : null);
  if (toast) showToast(toast);
  else paint();
}

/** Steps that ask for a drag also accept tap, then tap the target. Reading steps still open the sheet. */
function hasPlay(uid: string, def: string): boolean {
  const legal = ui.payload?.legalActions ?? [];
  if (def.startsWith('champ_') || uid === 'champion') return legal.some((action) => action.type === 'champion');
  return legal.some((action) => action.type === 'play' && String(action.uid) === uid);
}

function tapPlays(): boolean {
  if (!ui.payload || !acting(ui.payload)) return false;
  const guide = ui.guide;
  if (!guide || guide.done) return true;
  const id = guide.step?.id;
  return id === 7 || id === 12 || id === 15 || id === 20 || id === 21 || id === 22;
}

function finishTap(target: Element | null): boolean {
  if (!target || !ui.payload || ui.busy || !acting(ui.payload)) return false;
  if (ui.payload.view.phase === 'mulligan') return false;
  if (target.closest('.dc-q')) {
    const def = target.closest('[data-def]')?.getAttribute('data-def');
    if (!def) return false;
    ui.sheet = def;
    ui.armed = null;
    paint();
    armSuppress();
    return true;
  }
  if (target.closest('.cm-bub, .cm-skip, .skip-box, .confirm-box, button, a')) return false;
  if (restricting() && !holeHit(target)) return false;
  const card = target.closest('.handrow .dc, .champ-stub, #spare');
  const mine = target.closest('.row.you .un');
  const source = card ?? mine;
  if (ui.armed && (source || target.closest('.page, .slot, .un'))) {
    const piece = ui.armed;
    if (source && source.getAttribute('data-uid') === piece.uid) {
      ui.sheet = piece.def;
      ui.armed = null;
      paint();
      armSuppress();
      return true;
    }
    const action = dropAction(piece, target);
    ui.armed = null;
    armSuppress();
    if (action) {
      const blocked = blockedToast(piece, action);
      if (blocked) showToast(blocked);
      else void act(action);
      return true;
    }
    if (restricting()) showToast({ title: 'Follow the highlight', body: 'The bubble names the one action that moves the guide on.' });
    else explain(piece, target);
    return true;
  }
  if (!tapPlays() || !source) return false;
  const uid = source.getAttribute('data-uid') ?? '';
  const def = source.getAttribute('data-def') ?? '';
  if (card && !hasPlay(uid, def)) {
    const held = cardOf(uid);
    if (held) {
      const toast = playToast(ui.payload, held.name, held.cost, null, null, false);
      showToast(toast ?? { title: 'No target', body: 'Nothing can take this card.' });
      armSuppress();
      return true;
    }
  }
  ui.armed = {
    kind: card ? 'card' : 'unit',
    uid: source.getAttribute('data-uid') ?? '',
    def: source.getAttribute('data-def') ?? '',
  };
  ui.sheet = null;
  paint();
  armSuppress();
  return true;
}

function armSuppress(): void {
  ui.suppressClick = true;
  window.setTimeout(() => {
    ui.suppressClick = false;
  }, 0);
}

function onClick(event: MouseEvent): void {
  if (ui.suppressClick) {
    ui.suppressClick = false;
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('#play-title')) {
    const stance = document.querySelector('#stance');
    if (stance instanceof HTMLSelectElement && (stance.value === 'aggressive' || stance.value === 'balanced' || stance.value === 'patient')) ui.stance = stance.value;
    void start(false);
    return;
  }
  if (target.closest('#replay-title, #replay-tutorial')) {
    setTutorialFlag('due');
    void start(true);
    return;
  }
  if (target.closest('.cm-skip')) {
    ui.skipAsk = true;
    paintCoach();
    return;
  }
  if (target.closest('.skip-no')) {
    ui.skipAsk = false;
    paint();
    return;
  }
  if (target.closest('.skip-yes')) {
    ui.guide?.skip();
    ui.payload = null;
    ui.screen = 'title';
    ui.skipAsk = false;
    paint();
    return;
  }
  if (target.closest('.cm-next')) {
    ui.guide?.next(ui.payload);
    paint();
    return;
  }
  if (target.closest('#play-real')) {
    ui.guide?.complete();
    void start(false);
    return;
  }
  if (target.closest('#rematch')) {
    void start(Boolean(ui.payload?.tutorial && tutorialFlag() !== 'done'));
    return;
  }
  if (target.closest('#confirm-no')) {
    ui.confirm = null;
    paint();
    return;
  }
  if (target.closest('#confirm-yes') && ui.confirm) {
    const action = ui.confirm.action;
    ui.confirm = null;
    markTip('ink-end');
    markTip('ready-end');
    void act(action);
    return;
  }
  if (target.closest('#help, #help-d')) {
    ui.sheet = 'howto';
    paint();
    return;
  }
  if (target.closest('#sheet-x, #howto-close, .scrim')) {
    ui.sheet = null;
    paint();
    return;
  }
  if (target.closest('#settings')) {
    ui.sheet = 'howto';
    paint();
    return;
  }
  if (!holeHit(target)) {
    if (restricting()) showToast({ title: 'Follow the highlight', body: 'The bubble names the one action that moves the guide on.' });
    return;
  }
  const keyword = target.closest('[data-keyword]');
  if (keyword instanceof HTMLElement) return;
  const banner = target.closest('.pb');
  if (banner && ui.payload) {
    const page = banner.closest('.page')?.getAttribute('data-i');
    ui.openPage = ui.openPage === Number(page) ? null : Number(page);
    if (ui.guide) {
      ui.guide.pageRead = true;
      ui.guide.sync(ui.payload);
    }
    paint();
    return;
  }
  if (finishTap(target)) return;
  const card = target.closest('.handrow .dc');
  if (target.closest('#spare')) {
    const uid = Number(target.closest('#spare')?.getAttribute('data-uid'));
    if (uid) void act({ type: 'play', uid });
    return;
  }
  const stub = target.closest('.champ-stub');
  if (stub) {
    ui.armed = { kind: 'card', uid: 'champion', def: stub.getAttribute('data-def') ?? '' };
    ui.sheet = null;
    paint();
    return;
  }
  if (card && ui.payload?.view.phase === 'mulligan') {
    const def = card.getAttribute('data-def');
    if (def === 'spare_ink') {
      showToast({ title: 'Spare Ink stays', body: 'Spare Ink can\'t be swapped in the mulligan.' });
      return;
    }
    const uid = card.getAttribute('data-uid') ?? '';
    if (ui.swap.has(uid)) ui.swap.delete(uid);
    else ui.swap.add(uid);
    paint();
    return;
  }
  if (card && !ui.drag) {
    const def = card.getAttribute('data-def');
    if (def) {
      ui.sheet = def;
      paint();
    }
    return;
  }
  if (target.closest('#endturn')) {
    void endTurn();
    return;
  }
  if (target.closest('#legend')) {
    if (ui.busy || (ui.payload && !acting(ui.payload))) return;
    const toast = ui.payload ? legendToast(ui.payload) : null;
    if (toast) {
      showToast(toast);
      return;
    }
    ui.legendArmed = true;
    showToast({ title: 'Legend power', body: 'Tap an ally for Old Wick to heal.' });
    return;
  }
  const ally = target.closest('.row.you .un');
  if (ally && ui.legendArmed) {
    const uid = ally.getAttribute('data-uid');
    const def = ally.getAttribute('data-def');
    if (ui.guide?.visible(false)?.id === 19 && def !== 'n_doodle') {
      showToast({ title: 'Follow the highlight', body: 'Heal your hurt Deckle Doodle.' });
      return;
    }
    if (uid) void act({ type: 'legend', target: Number(uid) });
    return;
  }
  const boardCard = target.closest('.un');
  if (boardCard && !ui.legendArmed) {
    const def = boardCard.getAttribute('data-def');
    if (def) {
      ui.sheet = def;
      paint();
    }
    return;
  }
}

async function endTurn(): Promise<void> {
  const payload = ui.payload;
  if (!payload || ui.busy || !acting(payload) || ui.armed) return;
  if (ui.confirm) {
    const action = ui.confirm.action;
    ui.confirm = null;
    await act(action);
    return;
  }
  if (payload.view.phase === 'mulligan') {
    const idx = payload.view.hand.flatMap((card, index) => (ui.swap.has(card.instanceId) ? [index] : []));
    ui.swap.clear();
    await act({ type: 'mulligan', idx });
    return;
  }
  const quiet = nothingLeft(payload);
  if (!payload.tutorial && tipsEnabled() && !quiet) {
    const warn = endTurnWarning(payload);
    if (warn.ink && !tipSeen('ink-end')) {
      ui.confirm = { text: warn.ink, action: { type: 'end' } };
      logMetric({ kind: 'tip', tip: 'ink-end', action: 'shown' });
      paint();
      return;
    }
    if (warn.ready && !tipSeen('ready-end')) {
      ui.confirm = { text: warn.ready, action: { type: 'end' } };
      logMetric({ kind: 'tip', tip: 'ready-end', action: 'shown' });
      paint();
      return;
    }
  }
  if (!payload.tutorial && payload.view.hand.length >= 10 && !tipSeen('hand-end')) {
    ui.confirm = { text: 'Your hand is full (10). A draw will burn.', action: { type: 'end' } };
    markTip('hand-end');
    paint();
    return;
  }
  await act({ type: 'end' });
}

function onPointerDown(event: PointerEvent): void {
  const target = event.target;
  ui.longPress = false;
  if (target instanceof Element) {
    const keyword = target.closest('[data-keyword]');
    const step = ui.guide?.visible(false)?.id;
    if (keyword) {
      window.clearTimeout(ui.holdTimer);
      ui.keywordReady = false;
      ui.holdTimer = window.setTimeout(() => {
        ui.keywordReady = true;
      }, 500);
    } else if (step !== 6) {
      window.clearTimeout(ui.holdTimer);
      ui.holdTimer = window.setTimeout(() => {
        ui.longPress = true;
      }, 300);
    }
  }
  beginDrag(event);
}

function onPointerUp(event: PointerEvent): void {
  window.clearTimeout(ui.holdTimer);
  const held = ui.keywordReady;
  const inspect = ui.longPress && !held;
  ui.keywordReady = false;
  ui.longPress = false;
  if (inspect && event.target instanceof Element) {
    const def = event.target.closest('[data-def]')?.getAttribute('data-def');
    if (def && window.D13.cards[def] && ui.guide?.visible(false)?.id !== 6) {
      ui.sheet = def;
      ui.armed = null;
      ui.drag = null;
      document.getElementById('ghost')?.remove();
      paint();
      armSuppress();
      return;
    }
  }
  if (held && ui.guide && ui.payload) {
    armSuppress();
    const keyword = event.target instanceof Element ? event.target.closest('[data-keyword]') : null;
    const name = keyword?.getAttribute('data-keyword') ?? 'Kindle';
    ui.guide.keywordHeld = true;
    ui.guide.sync(ui.payload);
    window.requestAnimationFrame(() => {
      showToast({ title: name, body: KEYWORDS[name] ?? name });
    });
  }
  if (ui.drag) {
    void endDrag(event, held);
    return;
  }
  if (!held) finishTap(gestureTarget(event));
}

function onPointerCancel(event: PointerEvent): void {
  if (!ui.drag || ui.drag.pointer !== event.pointerId) return;
  ui.drag = null;
  ui.preview = null;
  document.getElementById('ghost')?.remove();
  paint();
}

function maybeTips(): void {
  const payload = ui.payload;
  if (!payload || payload.tutorial || !tipsEnabled()) return;
  const view = payload.view;
  const once = (id: string, title: string, body: string) => {
    if (tipSeen(id)) return;
    markTip(id);
    logMetric({ kind: 'tip', tip: id, action: 'shown' });
    showToast({ title, body });
  };
  if (view.phase === 'mulligan') once('mulligan', 'Mulligan', TIP_COPY.mulligan);
  if (view.hand.some((card) => card.defId === 'spare_ink')) {
    once('second', 'Going second', TIP_COPY.second);
    once('spare', 'Spare Ink', TIP_COPY.spare);
  }
  if (view.pages.some((page) => page.slots.some((slot) => slot.foe?.keywords.includes('Bound')))) once('bound', 'Bound', TIP_COPY.bound);
  if (view.pages.some((page) => page.slots.some((slot) => slot.foe?.keywords.includes('Ward') || slot.foe?.warded))) once('ward', 'Ward', TIP_COPY.ward);
  if (view.events.some((event) => event.kind === 'trap' && event.text.includes('strikes'))) once('trap', 'Marginalia', TIP_COPY.trap);
  if (view.events.some((event) => event.text.includes('Page rule') || event.text.includes('Port Foxing'))) once('page-rule', view.pages[0]?.name ?? 'Page', view.pages[0]?.rule ?? '');
  if (view.events.some((event) => event.text === 'Opening Line.')) once('opening', 'Opening Line', 'Happens when you play it.');
  if (view.events.some((event) => event.text === 'Last Word.')) once('last-word', 'Last Word', 'Happens when it dies.');
  if (view.verse[1] >= 6) once('match-point', 'Match point', TIP_COPY.matchPoint);
  if (view.yourTurn && view.phase !== 'mulligan' && view.hand.length >= 10) once('hand-cap', 'Hand full', 'Your hand is full (10). A draw will burn.');
  if (view.events.some((event) => event.text.includes('burned'))) once('hand-full', INFO_TOASTS.handFull.title, INFO_TOASTS.handFull.body);
}

app.addEventListener('pointerdown', (event) => onPointerDown(event as PointerEvent));
app.addEventListener('pointermove', (event) => moveDrag(event as PointerEvent), { passive: false });
app.addEventListener('pointerover', (event) => onHover(event as PointerEvent));
app.addEventListener('pointerup', (event) => onPointerUp(event as PointerEvent));
app.addEventListener('pointercancel', (event) => onPointerCancel(event as PointerEvent));
app.addEventListener('click', (event) => onClick(event as MouseEvent));
document.addEventListener(
  'touchmove',
  (event) => {
    if (!ui.drag || !event.cancelable) return;
    event.preventDefault();
  },
  { passive: false, capture: true },
);

function onHover(event: PointerEvent): void {
  if (window.IS_PHONE() || ui.drag || ui.guide?.visible(false)?.id === 6) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const card = target.closest('.handrow .dc, .un');
  const def = card?.getAttribute('data-def');
  if (!def || !window.D13.cards[def]) return;
  window.clearTimeout(ui.hoverTimer);
  ui.hoverTimer = window.setTimeout(() => {
    let pop = document.getElementById('hovercard');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'hovercard';
      document.body.append(pop);
    }
    pop.innerHTML = window.cardFace(def, { size: 'inspect' });
  }, 250);
}

window.setInterval(() => {
  pumpGuide();
  const payload = ui.payload;
  const end = document.getElementById('endturn');
  if (end && payload?.turnDeadline && payload.view.yourTurn && !payload.tutorial) {
    const left = payload.turnDeadline - Date.now();
    end.classList.toggle('urgent', left <= 10_000 && left > 0);
  }
  if (ui.banner && Date.now() > ui.banner.until) document.getElementById('turn-banner')?.remove();
  if (!payload || ui.drag) return;
  if (!payload.view.yourTurn || payload.opponentThinking || payload.view.winner) void refresh();
}, 450);

boot();
