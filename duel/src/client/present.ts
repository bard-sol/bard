import { KEYWORDS } from './guide.js';
import type { GuideStep } from './guide.js';
import type { ClientPayload, GameAction, PlayerId, PlayerView, PublicEvent, TradePreview, UnitView } from '../types.js';

export interface CoachOpts {
  holes: string[];
  point: string;
  next: boolean;
  action?: string;
  drag?: [string, string];
}

const NOVICE = '.page[data-i="0"] .row.you [data-def="c_novice"]';
const FOE = '.page[data-i="0"] .row.rival .un';
const LEFT_SLOT = '.page[data-i="0"] .row.you .slot';
const RIGHT_SLOT = '.page[data-i="1"] .row.you .slot';

export function coachOpts(step: GuideStep, board: { foeLeft: boolean }): CoachOpts {
  switch (step.id) {
    case 1:
      return window.IS_PHONE()
        ? { holes: ['.pages'], point: '#turn', next: true }
        : { holes: ['.center'], point: '.pages', next: true };
    case 2:
      return { holes: ['#legend', '.r-av'], point: '#legend', next: true };
    case 3:
      return { holes: ['.pb'], point: '.page[data-i="0"] .pb', next: false, action: step.chip };
    case 4:
      return { holes: ['#yverse', '#rverse'], point: '#yverse', next: true };
    case 5:
      return { holes: ['#ink'], point: '#ink', next: true };
    case 6: {
      const keyword = window.IS_PHONE() ? '#lift [data-keyword="Kindle"]' : '.handrow [data-keyword="Kindle"]';
      return { holes: ['.handrow [data-def="c_novice"]', keyword], point: keyword, next: false, action: step.chip };
    }
    case 7:
      return { holes: ['.handrow [data-def="c_novice"]', LEFT_SLOT], point: '.handrow [data-def="c_novice"]', next: false, action: step.chip, drag: ['.handrow [data-def="c_novice"]', LEFT_SLOT] };
    case 8:
      return { holes: [NOVICE], point: NOVICE, next: true };
    case 9:
      return { holes: ['#endturn'], point: '#endturn', next: false, action: step.chip };
    case 10:
      return { holes: ['#logp', '#logbtn', '.logp'], point: '#logp', next: false, action: step.chip };
    case 11:
      return { holes: ['#yverse'], point: '#yverse', next: true };
    case 12:
      return { holes: ['.handrow [data-def="n_doodle"]', RIGHT_SLOT], point: '.handrow [data-def="n_doodle"]', next: false, action: step.chip, drag: ['.handrow [data-def="n_doodle"]', RIGHT_SLOT] };
    case 13:
      return { holes: ['#endturn'], point: '#endturn', next: false, action: step.chip };
    case 14:
      return { holes: [FOE], point: FOE, next: false, action: step.chip };
    case 15:
      return { holes: [NOVICE, FOE], point: NOVICE, next: false, action: step.chip, drag: [NOVICE, FOE] };
    case 16:
      return { holes: ['#trade', NOVICE, FOE], point: '#trade', next: false, action: 'See who lives' };
    case 17:
      return { holes: ['#endturn'], point: '#endturn', next: false, action: step.chip };
    case 18:
      return { holes: ['.note:not(.none)'], point: '.note:not(.none):not(.mine)', next: true };
    case 19:
      return { holes: ['#legend', '.page[data-i="1"] .row.you [data-def="n_doodle"]'], point: '#legend', next: false, action: step.chip };
    case 20:
      return { holes: ['.handrow [data-def="c_mend"]', NOVICE], point: '.handrow [data-def="c_mend"]', next: false, action: step.chip, drag: ['.handrow [data-def="c_mend"]', NOVICE] };
    case 21:
      return board.foeLeft
        ? { holes: [NOVICE, FOE], point: FOE, next: false, action: step.chip, drag: [NOVICE, FOE] }
        : { holes: ['#endturn'], point: '#endturn', next: false, action: 'Press End Turn' };
    case 22:
      return { holes: ['.handrow [data-def="champ_old_wick"]', '.slot'], point: '.handrow [data-def="champ_old_wick"]', next: false, action: step.chip, drag: ['.handrow [data-def="champ_old_wick"]', LEFT_SLOT] };
    case 23:
      return { holes: [NOVICE, '.page[data-i="1"]', '.cm-next'], point: NOVICE, next: true };
    case 24:
      return { holes: ['#turn'], point: '#turn', next: true };
    case 25:
      return { holes: ['.center', '#endturn'], point: '#endturn', next: false, action: 'Finish the match' };
    case 26:
      return { holes: ['.why', '.end-in'], point: '.why', next: true };
    case 27:
      return { holes: ['#play-real'], point: '#play-real', next: false, action: step.chip };
    default:
      return { holes: ['.center'], point: '.center', next: true };
  }
}

export function pageKey(name: string): string {
  return window.D13.pages.find((page) => page.name === name)?.id ?? 'lanternfall';
}

export function boardFocus(view: PlayerView): PublicEvent | null {
  for (let index = view.events.length - 1; index >= 0; index--) {
    const event = view.events[index];
    if (!event || event.player == null || event.player === view.you) continue;
    if (event.focusPage == null && !event.focusDef) continue;
    if (event.kind !== 'play' && event.kind !== 'attack' && event.kind !== 'move' && event.kind !== 'trap') continue;
    return event;
  }
  return null;
}

export function keywordKeys(defId: string): string[] {
  const raw = window.D13.cards[defId]?.kw;
  if (Array.isArray(raw)) return raw.filter((key) => typeof key === 'string');
  if (typeof raw === 'string' && raw.length > 0) return [raw];
  return [];
}

export function keywordText(name: string): string {
  return KEYWORDS[name] ?? '';
}

export function boardModel(payload: ClientPayload, open: number | null) {
  const view = payload.view;
  const you = view.you;
  const focus = boardFocus(view);
  return {
    open,
    focus,
    pageHl: view.pages.map((_, index) => (focus?.focusPage === index ? 'hl' : '')),
    ticker: focus?.text ?? '',
    state: {
      turn: view.yourTurn ? Math.max(1, view.turn[0]) : Math.max(1, view.turn[1] || view.turn[0]),
      active: view.yourTurn ? 'you' : 'rival',
      step: view.phase === 'fight' ? 'Fight' : view.phase === 'mulligan' ? 'Mulligan' : view.phase === 'game_over' ? 'Ended' : 'Play step',
      you: {
        house: view.youLegend.house,
        verse: view.verse[0],
        ink: view.ink,
        maxInk: view.maxInk,
        legend: legendState(view),
        hand: handEntries(view, payload.legalActions, payload.tutorial),
        deck: view.yourDeckCount,
      },
      rival: {
        name: view.foeLegend.name,
        house: view.foeLegend.house,
        verse: view.verse[1],
        hand: view.foeHandCount,
        deck: view.foeDeckCount,
      },
      pages: view.pages.map((page) => ({
        id: pageKey(page.name),
        you: page.slots.flatMap((slot) => (slot.you ? [token(slot.you, view.yourTurn, highlight(slot.you, page.index, focus))] : [])),
        rival: page.slots.flatMap((slot) => (slot.foe ? [token(slot.foe, false, highlight(slot.foe, page.index, focus))] : [])),
        youNote: page.marginalia.find((note) => note.owner === you && note.known)?.defId ?? null,
        rivalNote: page.marginalia.some((note) => note.owner !== you),
      })),
    },
  };
}

function legendState(view: PlayerView): 'ready' | 'used' | 'locked' | 'noink' {
  if (!view.yourTurn || view.phase === 'fight') return 'locked';
  if (view.youLegend.powerUsed) return 'used';
  if (view.ink < view.youLegend.powerCost) return 'noink';
  return 'ready';
}

function handEntries(view: PlayerView, legal: GameAction[], tutorial: boolean) {
  const cards = view.hand.flatMap((card) => {
    const spare = card.defId === 'spare_ink';
    const champion = card.defId.startsWith('champ_') || card.instanceId === 'champion';
    if (spare && view.phase !== 'mulligan') return [];
    if (champion && !tutorial) return [];
    const cant = !view.yourTurn || view.phase === 'fight' || card.cost > view.ink;
    return [{
      id: card.defId,
      uid: card.instanceId,
      cant,
      playable: !cant && canPlay(card.instanceId, card.defId, legal),
    }];
  });
  cards.sort((a, b) => Number(b.id.startsWith('champ_')) - Number(a.id.startsWith('champ_')));
  return cards;
}

function canPlay(uid: string, defId: string, legal: GameAction[]): boolean {
  if (defId.startsWith('champ_') || uid === 'champion') return legal.some((action) => action.type === 'champion');
  return legal.some((action) => action.type === 'play' && String(action.uid) === uid);
}

export function spareInHand(view: PlayerView): { uid: string } | null {
  if (view.phase === 'mulligan') return null;
  const card = view.hand.find((entry) => entry.defId === 'spare_ink');
  return card ? { uid: card.instanceId } : null;
}

export function championStub(view: PlayerView, tutorial: boolean): { id: string } | null {
  if (tutorial || view.phase === 'mulligan') return null;
  const card = view.hand.find((entry) => entry.defId.startsWith('champ_') || entry.instanceId === 'champion');
  return card ? { id: card.defId } : null;
}

function highlight(unit: UnitView, page: 0 | 1, focus: PublicEvent | null): string {
  if (!focus || focus.focusPage !== page) return '';
  if (focus.focusDef && focus.focusDef === unit.defId) return 'hl-new';
  if (focus.kind === 'attack') return 'hl-atk';
  return '';
}

function token(unit: UnitView, yourTurn: boolean, hl: string) {
  return {
    id: unit.defId,
    uid: unit.instanceId,
    atk: unit.attack,
    hp: unit.health,
    maxHp: unit.maxHealth,
    tired: unit.exhausted,
    ready: yourTurn && unit.owner === 0 && !unit.exhausted,
    ward: unit.warded,
    hidden: unit.keywords.includes('Hidden'),
    hl,
  };
}

export function logEntries(view: PlayerView) {
  const recent = view.events.slice(-12);
  const focus = boardFocus(view);
  let current = recent.length - 1;
  if (focus) {
    for (let index = recent.length - 1; index >= 0; index--) {
      if (recent[index]?.id === focus.id) {
        current = index;
        break;
      }
    }
  }
  const rows = recent.map((event, index) => ({
    t: event.text,
    i: event.kind === 'attack' ? 'atk' : event.kind === 'trap' ? 't_marginalia' : event.kind === 'hold' || event.kind === 'conquer' ? 'verse' : event.kind === 'move' ? 'move' : event.kind === 'power' ? 'legend' : 'dot',
    who: event.player === view.you ? 'you' : '',
    done: index !== current,
    cur: index === current,
  }));
  if (rows.length === 0) rows.push({ t: 'The page is open.', i: 'dot', who: 'you', done: false, cur: true });
  return rows;
}

export function openingCaption(payload: ClientPayload): string {
  const view = payload.view;
  if (view.phase !== 'mulligan') return '';
  if (view.verse[0] > 0) return `You start on ${view.verse[0]} Verse`;
  if (view.verse[1] > 0) return `Rival starts on ${view.verse[1]} Verse`;
  return '';
}

export function tradeHtml(preview: TradePreview, stats?: { attackerAtk: number; defenderAtk: number; footnote?: string }): string {
  const side = (name: string, atk: number, before: number, after: number, dies: boolean) =>
    `<div class="tv"><small>${name}</small><span>${atk}/${before} → ${dies ? '<span class="ko">falls</span>' : `<span class="ok">${atk}/${after} lives</span>`}</span></div>`;
  const foot = stats?.footnote ? `<div class="tr-ft">${stats.footnote}</div>` : '';
  return `<div class="trade" id="trade"><div class="tr-row">${side(preview.attackerName, stats?.attackerAtk ?? 0, preview.attackerHealthBefore, preview.attackerHealthAfter, preview.attackerDies)}<span class="vs">vs</span>${side(preview.defenderName, stats?.defenderAtk ?? 0, preview.defenderHealthBefore, preview.defenderHealthAfter, preview.defenderDies)}</div>${foot}</div>`;
}

export function endHtml(view: PlayerView, tutorial: boolean, friend = false): string {
  const win = view.winner === view.you;
  const foe = view.foeLegend.name;
  const why = friend ? friendWhy(view, win, foe) : win
    ? view.verse[0] >= view.verseGoal
      ? `You won because you reached <b>${view.verse[0]} Verses</b>.`
      : `You won because you had <b>more Verses after both 7th turns: ${view.verse[0]} to ${view.verse[1]}</b>.`
    : `You lost because <b>${foe} reached ${view.verse[1]} Verses</b>.`;
  const war = tutorial
    ? 'House war · this was a guided match, so no change'
    : friend
      ? 'Friend match'
      : 'Each win moves your House’s bar in the war.';
  const warBody = friend
    ? `<p>${win ? 'You beat' : 'You lost to'} ${escapeHtml(foe)}, ${view.verse[0]}–${view.verse[1]}.</p>`
    : '';
  const again = friend
    ? '<button class="btn secondary" id="rematch">Rematch</button><a class="btn primary" id="lobby" href="/">Lobby</a>'
    : '<button class="btn secondary" id="rematch">Rematch</button><button class="btn primary" id="play-real">Play for real</button>';
  return `<div class="app duel end ${win ? 'win' : 'loss'}" style="--mine:var(--h-${view.youLegend.house}-a);--rival:var(--h-${view.foeLegend.house}-a)">
    <div class="end-in">
      <div class="end-hd"><span class="eyebrow">${win ? 'Victory' : 'Defeat'}</span><h1>${win ? 'Won' : 'Lost'}</h1>
        <div class="score"><span class="sc you">You <b>${view.verse[0]}</b></span><span class="dash">–</span><span class="sc them"><b>${view.verse[1]}</b> ${foe}</span></div></div>
      <div class="panel why"><span class="eyebrow">${win ? 'You won because…' : 'You lost because…'}</span><p>${why}</p>${swingLine(view)}</div>
      <div class="panel"><span class="eyebrow">Verses by Page</span>${scoreTable(view)}</div>
      <div class="panel war"><span class="eyebrow">${war}</span>${warBody}</div>
      <div class="end-acts"><button class="btn secondary" id="review-log">Review log</button>${again}</div>
    </div>
    <div class="ovl" id="ovl"></div>
  </div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'));
}

function friendWhy(view: PlayerView, win: boolean, foe: string): string {
  if (view.winReason === 'forfeit') {
    return win ? 'You won because your friend missed three turns in a row.' : 'You lost because you missed three turns in a row.';
  }
  if (view.winReason === 'health') {
    return win ? 'You won because you had more health on the board.' : `You lost because ${foe} had more health on the board.`;
  }
  if (view.winReason === 'tiebreak') {
    return win ? 'You won on the final tiebreak.' : 'You lost on the final tiebreak.';
  }
  if (win && view.verse[0] >= view.verseGoal) return `You won because you reached <b>${view.verse[0]} Verses</b>.`;
  if (win) return `You won because you had <b>more Verses: ${view.verse[0]} to ${view.verse[1]}</b>.`;
  return `You lost because <b>${foe} reached ${view.verse[1]} Verses</b>.`;
}

function scoreTable(view: PlayerView): string {
  const rows = view.events.filter((event) => (event.kind === 'hold' || event.kind === 'conquer') && event.pageName);
  if (rows.length === 0) {
    return `<ol class="mom">${view.events
      .filter((event) => event.kind === 'hold' || event.kind === 'conquer' || event.kind === 'win')
      .slice(-6)
      .map((event) => `<li><span class="s">${event.text}</span></li>`)
      .join('')}</ol>`;
  }
  const pages: string[] = [];
  for (const event of rows) {
    if (event.pageName && !pages.includes(event.pageName)) pages.push(event.pageName);
  }
  const body = pages
    .map((page) => {
      const bits = rows
        .filter((event) => event.pageName === page)
        .map((event) => `${sideName(view, event.player)} ${event.kind === 'hold' ? 'hold' : 'conquer'} +${event.amount ?? ''} (turn ${event.turn ?? ''})`);
      return `<tr><td>${page}</td><td>${bits.join(' · ')}</td></tr>`;
    })
    .join('');
  return `<table class="score-table">${body}</table>${openingLine(view)}`;
}

function sideName(view: PlayerView, player: PlayerId | null): string {
  if (player === view.you) return 'You';
  return view.foeLegend.name;
}

function scored(view: PlayerView, player: PlayerId): number {
  return view.events
    .filter((event) => (event.kind === 'hold' || event.kind === 'conquer') && event.player === player)
    .reduce((sum, event) => sum + (event.amount ?? 0), 0);
}

function openingLine(view: PlayerView): string {
  const foe: PlayerId = view.you === 0 ? 1 : 0;
  const parts: string[] = [];
  const yours = view.verse[0] - scored(view, view.you);
  const theirs = view.verse[1] - scored(view, foe);
  if (yours > 0) parts.push(`You started on +${yours} Verse for going second.`);
  if (theirs > 0) parts.push(`${view.foeLegend.name} started on +${theirs} Verse for going second.`);
  return parts.length ? `<p class="swing">${parts.join(' ')}</p>` : '';
}

function swingLine(view: PlayerView): string {
  const winner = view.winner;
  if (winner == null) return '';
  const gains = new Map<number, number>();
  for (const event of view.events) {
    if (event.player !== winner || event.turn == null) continue;
    if (event.kind !== 'hold' && event.kind !== 'conquer') continue;
    gains.set(event.turn, (gains.get(event.turn) ?? 0) + (event.amount ?? 0));
  }
  let turn = 0;
  let best = 0;
  for (const [index, gain] of gains) {
    if (gain > best || (gain === best && index > turn)) {
      best = gain;
      turn = index;
    }
  }
  if (best === 0) return '';
  const who = winner === view.you ? 'you' : view.foeLegend.name;
  const label = best === 1 ? 'Verse' : 'Verses';
  return `<p class="swing">Swing: turn ${turn}, ${who} gained ${best} ${label}.</p>`;
}

export function howtoHtml(): string {
  return `<div class="scrim"></div><div class="sheet" id="howto"><div class="grab"></div><div class="sh-hd"><h3>How to play</h3><button class="sh-x" id="sheet-x" aria-label="Close">${window.icon('close')}</button></div>
    <div class="sh-bd"><div class="ht"><div>
      <div class="sec"><span class="eyebrow">Goal</span><p class="ht-p"><b>First to 8 Verses wins.</b> After 7 turns each, the most Verses wins. Still tied: most total health on the board.</p></div>
      <div class="sec"><span class="eyebrow">Your turn, in order</span><ol class="ht-ol"><li><b>Gain Ink.</b> 1 on turn 1, +1 each turn, up to 7.</li><li><b>Score holds.</b> +1 Verse for each Page where only you have units.</li><li><b>Draw</b> a card.</li><li><b>Play</b> cards, your champion and your Legend power.</li><li><b>Fight.</b> Each ready unit attacks an enemy on its Page, or moves to the other Page. Your first attack or move ends the play step.</li><li><b>End turn.</b> Conquer: +2 Verses for each Page you cleared and still stand on.</li></ol></div>
      <div class="sec"><span class="eyebrow">Scoring</span><p class="ht-p"><b>Hold</b> · start your turn alone on a Page: +1 Verse. <b>Conquer</b> · clear a Page that had enemies, keep a unit there: +2 Verses.</p></div>
    </div><div>
      <div class="sec"><span class="eyebrow">Card types</span><p class="ht-p"><b>Character</b> · a unit on a Page. Arrives tired; attacks next turn. <b>Inkwork</b> · a one-off spell. <b>Marginalia</b> · a face-down trap, one per Page. Fires on their turn.</p></div>
      <div class="sec"><span class="eyebrow">Legend</span><p class="ht-p"><b>Power</b> · 2 Ink, once per turn, during your play step. <b>Champion card</b> · waits beside your hand. Play it once per match.</p></div>
      <div class="sec"><span class="eyebrow">Going second</span><p class="ht-p">You get 5 cards, a Spare Ink, 2 Ink on turn 1, and start on 1 Verse.</p></div>
    </div></div></div>
    <div class="sh-acts"><button class="btn secondary" id="replay-tutorial">Replay tutorial</button><button class="btn primary" id="howto-close">Got it</button></div></div>`;
}

export function cardSheet(defId: string): string {
  const card = window.D13.cards[defId];
  const face = window.cardFace(defId, { size: 'inspect' });
  const defs = keywordKeys(defId)
    .map((key) => {
      const row = window.KW13[key];
      const name = row?.name ?? key;
      const text = keywordText(name) || row?.long || '';
      if (!text) return '';
      return `<div class="kwdef"><b>${name}</b><p>${text}</p></div>`;
    })
    .join('');
  const title = card?.name ?? 'Card';
  return `<div class="scrim"></div><div class="sheet" id="card-sheet"><div class="grab"></div><div class="sh-hd"><h3>${title}</h3><button class="sh-x" id="sheet-x" aria-label="Close">${window.icon('close')}</button></div><div class="sh-bd">${face}<div class="kwdefs">${defs}</div></div></div>`;
}

export function toastHtml(title: string, body: string): string {
  return `<div class="toast"><span class="t-i">${window.icon('alert')}</span><div><b>${title}</b><span>${body}</span></div></div>`;
}

export function foeOnLeft(view: PlayerView): boolean {
  return view.pages[0]?.slots.some((slot) => slot.foe) ?? false;
}
