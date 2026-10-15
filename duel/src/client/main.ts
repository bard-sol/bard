import type { ClientPayload, GameAction, Stance, TradePreview, UnitView } from '../types.js';
import { createMatch, fetchMatch, previewAttack, sendAction } from './api.js';
import { GuideController, logMetric, markTip, noteRealMatch, setTutorialFlag, tipSeen, tipsEnabled, tutorialFlag } from './guide.js';
import { INFO_TOASTS, PLAY_STEP_OVER, TIP_COPY, attackToast, endTurnWarning, legendToast, moveToast, playToast, toastCopy, type ToastCopy } from './illegal.js';
import { KEYWORDS } from './guide.js';
import { boardModel, cardSheet, coachOpts, endHtml, foeOnLeft, howtoHtml, keywordKeys, logEntries, openingCaption, toastHtml, tradeHtml } from './present.js';

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

interface Drag {
  kind: 'card' | 'unit';
  uid: string;
  def: string;
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
  legendArmed: false,
  skipAsk: false,
  confirm: null as { text: string; action: GameAction } | null,
  toasts: [] as ToastCopy[],
  busy: false,
  holdTimer: 0,
  keywordReady: false,
  suppressClick: false,
  stepSeen: null as number | null,
};

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
  const caption = openingCaption(payload);
  const html = window.boardScreen(model.state, {
    mode: payload.tutorial ? 'Card Duel · Guided first match' : 'Card Duel',
    log: logEntries(payload.view),
    inspect: step?.id === 6 ? 'c_novice' : ui.sheet && ui.sheet !== 'howto' ? ui.sheet : payload.view.hand[0]?.defId,
    lockText: payload.view.yourTurn ? 'Fighting has started.' : 'Their turn.',
    hint: caption || 'Tap a card to read it',
    drop: false,
    pageHl: model.pageHl,
    ticker: model.ticker,
  });
  root.innerHTML = html;
  if (caption) {
    document.querySelector('.hand-hd')?.insertAdjacentHTML('afterbegin', `<p class="opening" id="opening">${caption}</p>`);
  }
  const host = document.createElement('div');
  host.className = 'toast-host';
  host.innerHTML = ui.toasts.map((toast) => toastHtml(toast.title, toast.body)).join('');
  document.querySelector('.app')?.append(host);
  const hand = document.getElementById('hand');
  if (hand && hand.children.length > 6) hand.classList.add('many');
  if (step?.id === 6 && window.IS_PHONE()) {
    document.querySelector('.app')?.insertAdjacentHTML('beforeend', `<div class="lift" id="lift">${window.cardFace('c_novice', { size: 'inspect' })}</div>`);
  }
  paintCoach();
  mountSheets();
  publish();
  maybeTips();
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
  if (ui.stepSeen != null && id !== ui.stepSeen) ui.sheet = null;
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
  const pageName = attacker ? ui.payload?.view.pages[attacker.page]?.name : '';
  const footnote = pageName === 'Lanternfall' && !preview.attackerDies && !preview.defenderDies ? 'Lanternfall heals both 1 at end of turn' : undefined;
  return tradeHtml(preview, { attackerAtk: attacker?.attack ?? 0, defenderAtk: defender?.attack ?? 0, footnote });
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
  ui.payload = payload;
  if (payload.tutorial && ui.guide && !ui.guide.done) ui.guide.sync(payload);
  if (payload.view.winner && ui.guide && !ui.guide.done) ui.guide.sync(payload);
  const step = ui.guide?.visible(false);
  ui.screen = payload.view.winner && (!ui.guide || ui.guide.done || (step && step.id >= 26)) ? 'end' : 'board';
  paint();
}

async function refresh(): Promise<void> {
  const id = ui.payload?.matchId;
  if (!id || ui.drag || ui.busy) return;
  try {
    const next = await fetchMatch(id);
    if (next.view.winner !== ui.payload?.view.winner || next.view.turn[0] !== ui.payload?.view.turn[0] || next.view.yourTurn !== ui.payload?.view.yourTurn || next.opponentThinking !== ui.payload?.opponentThinking) {
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
  ui.guide.sync(ui.payload);
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

async function act(action: GameAction): Promise<void> {
  const payload = ui.payload;
  if (!payload || ui.busy) return;
  if ((action.type === 'play' || action.type === 'champion' || action.type === 'legend') && payload.view.phase === 'fight') {
    offerPlayStepTip();
    return;
  }
  ui.busy = true;
  ui.preview = null;
  ui.legendArmed = false;
  try {
    const next = await sendAction(payload.matchId, action);
    adopt(next);
  } catch (error) {
    showToast({ title: 'That play is not legal', body: error instanceof Error ? error.message : 'Try a different action.' });
  } finally {
    ui.busy = false;
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
  if (ui.legendArmed) return;
  if (!ui.payload?.view.yourTurn || ui.payload.view.phase === 'mulligan') return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!holeHit(target)) return;
  const card = target.closest('.handrow .dc');
  const unit = target.closest('.row.you .un');
  if (!card && !unit) return;
  const uid = (card ?? unit)?.getAttribute('data-uid') ?? '';
  const def = (card ?? unit)?.getAttribute('data-def') ?? '';
  ui.drag = { kind: card ? 'card' : 'unit', uid, def, x: event.clientX, y: event.clientY, moved: false, pointer: event.pointerId };
}

function moveDrag(event: PointerEvent): void {
  const drag = ui.drag;
  if (!drag || drag.pointer !== event.pointerId) return;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 8) drag.moved = true;
  if (!drag.moved) return;
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
  const under = document.elementFromPoint(event.clientX, event.clientY);
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
    const target = event.target;
    if (drag && !drag.moved && !held && drag.def && target instanceof Element && holeHit(target)) ui.sheet = drag.def;
    paint();
    return;
  }
  armSuppress();
  const under = document.elementFromPoint(event.clientX, event.clientY);
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

function blockedToast(drag: Drag, action: GameAction): ToastCopy | null {
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

function dropAction(drag: Drag, under: Element | null): GameAction | null {
  const payload = ui.payload;
  if (!payload || !under) return null;
  const slot = under.closest('.slot');
  const unit = under.closest('.un');
  const pageAttr = slot?.getAttribute('data-page') ?? unit?.closest('.page')?.getAttribute('data-i');
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

function explain(drag: Drag, under: Element | null): void {
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
  const card = target.closest('.handrow .dc');
  if (card && ui.payload?.view.phase === 'mulligan') {
    const def = card.getAttribute('data-def');
    if (def === 'spare_ink') {
      showToast({ title: 'Spare Ink stays', body: 'Spare Ink can\'t be swapped in the mulligan.' });
      return;
    }
    card.classList.toggle('sel');
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
  if (ui.payload?.view.phase === 'mulligan') {
    const handCard = target.closest('.handrow .dc');
    if (handCard) handCard.classList.toggle('sel');
    if (target.closest('#endturn')) void act({ type: 'mulligan', idx: [] });
  }
}

async function endTurn(): Promise<void> {
  const payload = ui.payload;
  if (!payload) return;
  if (payload.view.phase === 'mulligan') {
    const idx = Array.from(document.querySelectorAll('.handrow .dc.sel')).flatMap((card) => {
      const uid = card.getAttribute('data-uid');
      const index = payload.view.hand.findIndex((entry) => entry.instanceId === uid);
      return index >= 0 ? [index] : [];
    });
    await act({ type: 'mulligan', idx });
    return;
  }
  if (!payload.tutorial && tipsEnabled()) {
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
  await act({ type: 'end' });
}

function onPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (target instanceof Element) {
    const keyword = target.closest('[data-keyword]');
    if (keyword) {
      window.clearTimeout(ui.holdTimer);
      ui.keywordReady = false;
      ui.holdTimer = window.setTimeout(() => {
        ui.keywordReady = true;
      }, 500);
    }
  }
  beginDrag(event);
}

function onPointerUp(event: PointerEvent): void {
  window.clearTimeout(ui.holdTimer);
  const held = ui.keywordReady;
  ui.keywordReady = false;
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
  if (ui.drag) void endDrag(event, held);
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
  if (view.events.some((event) => event.text.includes('burned'))) once('hand-full', INFO_TOASTS.handFull.title, INFO_TOASTS.handFull.body);
}

app.addEventListener('pointerdown', (event) => onPointerDown(event as PointerEvent));
app.addEventListener('pointermove', (event) => moveDrag(event as PointerEvent));
app.addEventListener('pointerover', (event) => onHover(event as PointerEvent));
app.addEventListener('pointerup', (event) => onPointerUp(event as PointerEvent));
app.addEventListener('click', (event) => onClick(event as MouseEvent));

function onHover(event: PointerEvent): void {
  if (window.IS_PHONE() || ui.drag) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const card = target.closest('[data-def]');
  const def = card?.getAttribute('data-def');
  if (!def || !window.D13.cards[def]) return;
  const panel = document.getElementById('inspect');
  if (!panel || panel.dataset.def === def) return;
  const face = panel.querySelector('.insp-c');
  const keywords = panel.querySelector('.insp-kw');
  if (!face || !keywords) return;
  panel.dataset.def = def;
  face.innerHTML = window.cardFace(def, { size: 'inspect' });
  keywords.innerHTML = keywordKeys(def).map((key) => window.kwRow(key, { long: true })).join('');
}

window.setInterval(() => {
  pumpGuide();
  const payload = ui.payload;
  if (!payload || ui.drag) return;
  if (!payload.view.yourTurn || payload.opponentThinking || payload.view.winner) void refresh();
}, 450);

boot();
