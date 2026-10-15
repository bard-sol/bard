import type { GuideStep } from './guide.js';
import type { ClientPayload, PlayerView, TradePreview, UnitView } from '../types.js';

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
      return { holes: ['.center'], point: '.pages', next: true };
    case 2:
      return { holes: ['#legend', '.r-av'], point: '#legend', next: true };
    case 3:
      return { holes: ['.pb'], point: '.page[data-i="0"] .pb', next: false, action: step.chip };
    case 4:
      return { holes: ['#yverse', '#rverse'], point: '#yverse', next: true };
    case 5:
      return { holes: ['#ink'], point: '#ink', next: true };
    case 6: {
      const keyword = window.IS_PHONE() ? '#lift [data-keyword="Kindle"]' : '#inspect [data-keyword="Kindle"]';
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
      return { holes: ['.center'], point: '.pages', next: false, action: 'Finish the match' };
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

export function boardModel(payload: ClientPayload, open: number | null) {
  const view = payload.view;
  const you = view.you;
  return {
    open,
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
        hand: handEntries(view),
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
        you: page.slots.flatMap((slot) => (slot.you ? [token(slot.you, view.yourTurn)] : [])),
        rival: page.slots.flatMap((slot) => (slot.foe ? [token(slot.foe, false)] : [])),
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

function handEntries(view: PlayerView) {
  const cards = view.hand.map((card) => ({
    id: card.defId,
    uid: card.instanceId,
    cant: !view.yourTurn || view.phase === 'fight' || card.cost > view.ink,
  }));
  cards.sort((a, b) => Number(b.id.startsWith('champ_')) - Number(a.id.startsWith('champ_')));
  return cards;
}

function token(unit: UnitView, yourTurn: boolean) {
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
  };
}

export function logEntries(view: PlayerView) {
  const rows = view.events.slice(-12).map((event) => ({
    t: event.text,
    i: event.kind === 'attack' ? 'atk' : event.kind === 'trap' ? 't_marginalia' : event.kind === 'hold' || event.kind === 'conquer' ? 'verse' : event.kind === 'move' ? 'move' : event.kind === 'power' ? 'legend' : 'dot',
    who: event.player === view.you ? 'you' : '',
    done: true,
    cur: false,
  }));
  if (rows.length === 0) rows.push({ t: 'The page is open.', i: 'dot', who: 'you', done: true, cur: false });
  const last = rows[rows.length - 1];
  if (last) {
    last.cur = true;
    last.done = false;
  }
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

export function endHtml(view: PlayerView, tutorial: boolean): string {
  const win = view.winner === view.you;
  const foe = view.foeLegend.name;
  const why = win
    ? view.verse[0] >= view.verseGoal
      ? `You won because you reached <b>${view.verse[0]} Verses</b>.`
      : `You won because you had <b>more Verses after both 7th turns: ${view.verse[0]} to ${view.verse[1]}</b>.`
    : `You lost because <b>${foe} reached ${view.verse[1]} Verses</b>.`;
  const war = tutorial
    ? 'House war · this was a guided match, so no change'
    : 'Each win moves your House’s bar in the war.';
  return `<div class="app duel end ${win ? 'win' : 'loss'}" style="--mine:var(--h-${view.youLegend.house}-a);--rival:var(--h-${view.foeLegend.house}-a)">
    <div class="end-in">
      <div class="end-hd"><span class="eyebrow">${win ? 'Victory' : 'Defeat'}</span><h1>${win ? 'Won' : 'Lost'}</h1>
        <div class="score"><span class="sc you">You <b>${view.verse[0]}</b></span><span class="dash">–</span><span class="sc them"><b>${view.verse[1]}</b> ${foe}</span></div></div>
      <div class="panel why"><span class="eyebrow">${win ? 'You won because…' : 'You lost because…'}</span><p>${why}</p></div>
      <div class="panel"><span class="eyebrow">Key moments</span><ol class="mom">${moments(view)}</ol></div>
      <div class="panel war"><span class="eyebrow">${war}</span></div>
      <div class="end-acts"><button class="btn secondary" id="review-log">Review log</button><button class="btn secondary" id="rematch">Rematch</button><button class="btn primary" id="play-real">Play for real</button></div>
    </div>
    <div class="ovl" id="ovl"></div>
  </div>`;
}

function moments(view: PlayerView): string {
  return view.events
    .filter((event) => event.kind === 'hold' || event.kind === 'conquer' || event.kind === 'win')
    .slice(-6)
    .map((event) => `<li><span class="s">${event.text}</span></li>`)
    .join('');
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
  const face = window.cardFace(defId, { size: 'inspect' });
  return `<div class="scrim"></div><div class="sheet" id="card-sheet"><div class="grab"></div><div class="sh-hd"><h3>Card</h3><button class="sh-x" id="sheet-x" aria-label="Close">${window.icon('close')}</button></div><div class="sh-bd">${face}</div></div>`;
}

export function toastHtml(title: string, body: string): string {
  return `<div class="toast"><span class="t-i">${window.icon('alert')}</span><div><b>${title}</b><span>${body}</span></div></div>`;
}

export function foeOnLeft(view: PlayerView): boolean {
  return view.pages[0]?.slots.some((slot) => slot.foe) ?? false;
}
