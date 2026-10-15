import type { ClientPayload, PlayerView } from '../types.js';

export type GuideAdvance =
  | 'next'
  | 'page'
  | 'keyword'
  | 'novice'
  | 'end'
  | 'rival'
  | 'two-cost'
  | 'attack'
  | 'legend'
  | 'conquer'
  | 'hold'
  | 'inkwork'
  | 'champion'
  | 'over'
  | 'play';

export interface GuideStep {
  id: number;
  target: string;
  text: string;
  advance: GuideAdvance;
  /** Action chip. Info steps use Next instead. */
  chip?: string;
}

/** bubble-guide v1.2, word for word, in turn order. Step 16 is the trade preview shown during step 15. */
export const GUIDE_STEPS: GuideStep[] = [
  { id: 1, target: 'board', text: 'Welcome to the Book! Beat a rival House\'s deck. First to <b>8 Verses</b> wins.', advance: 'next' },
  { id: 2, target: 'legends', text: 'This is your Legend, <b>Old Wick</b>. Across the page is your rival\'s: <b>Juniper</b> of the Tidewrack.', advance: 'next' },
  { id: 3, target: 'page', text: 'These are <b>Pages</b>, the two battlefields. Each has its own rule; tap one to read it.', advance: 'page', chip: 'Tap a Page' },
  { id: 4, target: 'verse', text: 'Score Verses by holding Pages. At your turn start, +1 for each Page only you hold.', advance: 'next' },
  { id: 5, target: 'ink', text: '<b>Ink</b> pays for cards. You get 1 more each turn, up to 7. You have 1 now.', advance: 'next' },
  { id: 6, target: 'card:c_novice', text: 'Tap a card to read it. Press and hold any keyword to learn it.', advance: 'keyword', chip: 'Hold “Kindle”' },
  { id: 7, target: 'card:c_novice', text: 'Drag <b>Lanternfall Novice</b> onto the left Page to play it.', advance: 'novice', chip: 'Drag to the left Page' },
  { id: 8, target: 'unit:c_novice', text: 'New characters are <b>tired</b> for a turn: they can\'t attack the turn they\'re played.', advance: 'next' },
  { id: 9, target: 'end', text: 'You\'re out of Ink. Press <b>End Turn</b>.', advance: 'end', chip: 'Press End Turn' },
  { id: 10, target: 'log', text: 'Your rival is playing. Their moves appear in the log here.', advance: 'rival', chip: 'Wait for their turn' },
  { id: 11, target: 'verse', text: 'You held a Page alone, so +1 Verse!', advance: 'hold' },
  { id: 12, target: 'card:n_doodle', text: '2 Ink now. Play <b>Deckle Doodle</b> onto the Page your rival is on.', advance: 'two-cost', chip: 'Play Deckle Doodle' },
  { id: 13, target: 'end', text: 'Your new character is tired, so end your turn.', advance: 'end', chip: 'Press End Turn' },
  { id: 14, target: 'unit:foe-left', text: 'Your rival played a unit on your Novice\'s Page. Time to fight back.', advance: 'rival', chip: 'Wait for their turn' },
  { id: 15, target: 'unit:c_novice', text: 'Your Novice is ready. Drag it onto an enemy to <b>attack</b>. Both deal damage.', advance: 'attack', chip: 'Drag onto an enemy' },
  { id: 16, target: 'preview', text: 'Before you let go, this preview shows who survives the trade.', advance: 'attack' },
  { id: 17, target: 'end', text: 'Attacking ends your plays for this turn. End your turn.', advance: 'end', chip: 'Press End Turn' },
  { id: 18, target: 'note', text: 'A face-down card is a <b>Marginalia</b>, a trap that fires on your turn. Play around it!', advance: 'next' },
  { id: 19, target: 'power', text: 'Your <b>Legend power</b> costs 2 Ink, once per turn. Old Wick heals an ally 3. Heal your hurt Deckle Doodle.', advance: 'legend', chip: 'Tap Old Wick, then Doodle' },
  { id: 20, target: 'card:c_mend', text: '<b>Inkwork</b> cards are one-off spells. Play it on your Novice now: once you attack, you can\'t play cards this turn.', advance: 'inkwork', chip: 'Drag onto the Novice' },
  { id: 21, target: 'unit:foe-left', text: 'Clear every enemy from a Page and keep a unit there to <b>Conquer</b>: +2 Verses! It scores when you end the turn.', advance: 'conquer', chip: 'Attack the Deckhand' },
  { id: 22, target: 'card:champ_old_wick', text: 'Your <b>champion</b> waits here. Play it once per match, before you attack.', advance: 'champion', chip: 'Play your champion' },
  { id: 23, target: 'unit:c_novice', text: 'Instead of attacking, a unit can <b>move</b> to the other Page to contest it. Moving onto Port Foxing gives +1 attack.', advance: 'next' },
  { id: 24, target: 'log', text: 'Matches last 7 turns each. If nobody reaches 8, the most Verses wins.', advance: 'next' },
  { id: 25, target: 'board', text: 'You\'ve got it. Finish the match!', advance: 'over' },
  { id: 26, target: 'result', text: 'Here\'s <em>why</em>: the key moments. Each win moves your House\'s bar in the war.', advance: 'next' },
  { id: 27, target: 'play', text: 'Ready? <b>Play</b> for real against a rival House.', advance: 'play', chip: 'Play' },
];

/** rules-spec v1.3 §3, one sentence per keyword. Keys match the names on the card. */
export const KEYWORDS: Record<string, string> = {
  Bound: 'When you attack on a Page where the rival has a targetable Bound unit, the target must be a Bound unit. Inkwork and abilities can still choose any target.',
  Ward: 'The next damage of 1 or more is reduced to 0, and then Ward is spent. A 0-damage event leaves it in place. Ward can be granted again.',
  Swift: 'Enters ready, so it can attack or move the turn it is played.',
  Hidden: 'Cannot be chosen as a target until it declares an attack. Effects that hit every unit on a Page still hit it. Hidden ends when it declares an attack, before traps.',
  'Opening Line': 'Resolves when the card is played, after it enters the Page and after Fort Crease. With no legal target, the card can still be played and the effect does nothing. It does not happen on The Moot-Rings.',
  'Last Word': 'Resolves when the unit dies, on the Page it died on.',
  Silence: 'The unit loses keywords, abilities, Ward, Kindle, Hidden, and temporary Riposte. Its attack and health stay. It cannot gain keywords afterwards.',
  Cleave: 'When this unit attacks, it also deals its attack to the units in the slots beside the defender. Cleave does not apply when this unit is attacked.',
  Kindle: 'At the end of its owner\'s turn, heal N to the most-damaged allied unit on its Page, which can be itself.',
  Riposte: 'When this unit is attacked, it deals its damage first. If the attacker dies, the attacker deals nothing.',
  Board: 'Moving does not exhaust this unit, and it can still attack after the move. It is still limited to one move per turn.',
};

export const HOW_TO_PLAY = [
  { title: 'Goal', body: 'First House to 8 Verses wins. After 7 turns each, the higher Verse total wins. A tie breaks on board health.' },
  { title: 'A turn', body: 'Gain Ink, score Pages you hold alone, draw a card, then play, use your Legend, and fight. End the turn when you are done.' },
  { title: 'Scoring', body: 'At the start of your turn, +1 Verse for each Page where you have a unit and your rival has none. Clear a Page you were contesting and still hold it to Conquer for +2. The Spine adds 1 more to a Conquer.' },
  { title: 'Cards', body: 'Characters stay and fight. Inkwork is a one-shot spell. Marginalia is a face-down trap that fires on your rival\'s turn. Your champion is played once, from beside your Legend.' },
  { title: 'Opening', body: 'The first player starts at 1 Ink and four cards. The second player starts at 1 Verse, with Spare Ink, five cards, and 2 Ink on their first turn.' },
];

const STORAGE = {
  tutorial: 'bard-duel-tutorial',
  matches: 'bard-duel-real-matches',
  tips: 'bard-duel-tips',
  metrics: 'bard-duel-metrics',
};

export type TutorialFlag = 'due' | 'done' | 'skipped';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function tutorialFlag(): TutorialFlag {
  const value = storage()?.getItem(STORAGE.tutorial);
  if (value === 'done' || value === 'skipped') return value;
  return 'due';
}

export function setTutorialFlag(flag: TutorialFlag): void {
  storage()?.setItem(STORAGE.tutorial, flag);
}

export function realMatchCount(): number {
  return Number(storage()?.getItem(STORAGE.matches) ?? '0') || 0;
}

export function noteRealMatch(): number {
  const next = realMatchCount() + 1;
  storage()?.setItem(STORAGE.matches, String(next));
  return next;
}

export function tipsEnabled(): boolean {
  return realMatchCount() > 0 && realMatchCount() <= 5;
}

export function tipSeen(id: string): boolean {
  return readTips().includes(id);
}

export function markTip(id: string): void {
  const tips = readTips();
  if (!tips.includes(id)) {
    tips.push(id);
    storage()?.setItem(STORAGE.tips, JSON.stringify(tips));
  }
}

function readTips(): string[] {
  try {
    const parsed = JSON.parse(storage()?.getItem(STORAGE.tips) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export interface MetricEvent {
  kind: 'step' | 'skip' | 'complete' | 'tip';
  step?: number;
  ms?: number;
  tip?: string;
  action: 'start' | 'done' | 'skip' | 'shown' | 'dismissed';
}

export function logMetric(event: MetricEvent): void {
  const prior = readMetrics();
  prior.push({ ...event, at: Date.now() });
  storage()?.setItem(STORAGE.metrics, JSON.stringify(prior.slice(-200)));
  if (typeof fetch !== 'function') return;
  void fetch('/api/metrics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  }).catch(() => undefined);
}

function readMetrics(): Array<MetricEvent & { at: number }> {
  try {
    const parsed = JSON.parse(storage()?.getItem(STORAGE.metrics) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as Array<MetricEvent & { at: number }>) : [];
  } catch {
    return [];
  }
}

export function stepResultText(view: PlayerView): string {
  const yours = view.verse[0];
  const theirs = view.verse[1];
  const outcome = view.winner === view.you ? 'You win.' : 'You lose.';
  const why = view.winReason === 'health' ? 'Board health broke the tie.' : view.winReason === 'tiebreak' ? 'The final tiebreak decided it.' : `${yours} Verses to ${theirs}.`;
  const conquer = view.events.some((event) => event.kind === 'conquer' && event.player === view.you);
  const hold = view.events.some((event) => event.kind === 'hold' && event.player === view.you);
  const moments = [conquer ? 'A Conquer scored 2.' : '', hold ? 'A lone Page scored a hold.' : ''].filter(Boolean).join(' ');
  return `${outcome} ${why} ${moments} Each win moves your House's bar in the war.`.replace(/\s+/g, ' ').trim();
}

export function hasEvent(view: PlayerView, kind: string, player?: 0 | 1): boolean {
  return view.events.some((event) => event.kind === kind && (player == null || event.player === player));
}

export function unitOnBoard(view: PlayerView, defId: string, owner: 'you' | 'foe'): boolean {
  return view.pages.some((page) => page.slots.some((slot) => (owner === 'you' ? slot.you?.defId === defId : slot.foe?.defId === defId)));
}

function yourUnit(view: PlayerView, defId: string) {
  for (const page of view.pages) {
    for (const slot of page.slots) {
      if (slot.you?.defId === defId) return slot.you;
    }
  }
  return undefined;
}

function foeOnLeft(view: PlayerView): boolean {
  return view.pages[0]?.slots.some((slot) => slot.foe) ?? false;
}

export function guideReady(step: GuideStep, payload: ClientPayload, local: { pageRead: boolean; keywordHeld: boolean }): boolean {
  const view = payload.view;
  switch (step.advance) {
    case 'next':
      return step.id !== 18 || view.pages.some((page) => page.marginalia.some((note) => note.faceDown && note.owner !== view.you));
    case 'page':
      return local.pageRead;
    case 'keyword':
      return local.keywordHeld;
    case 'novice':
      return unitOnBoard(view, 'c_novice', 'you');
    case 'end': {
      const after = step.id === 9 ? 1 : step.id === 13 ? 2 : 3;
      return view.turn[0] > after || !view.yourTurn;
    }
    case 'rival':
      if (step.id === 14) return view.yourTurn && view.turn[0] >= 3 && foeOnLeft(view);
      return view.yourTurn && view.turn[0] >= 2;
    case 'two-cost':
      return unitOnBoard(view, 'n_doodle', 'you');
    case 'attack':
      return view.events.some((event) => event.kind === 'attack');
    case 'legend': {
      const doodle = yourUnit(view, 'n_doodle');
      return view.youLegend.powerUsed && doodle != null && doodle.health >= doodle.maxHealth;
    }
    case 'conquer':
      return hasEvent(view, 'conquer', view.you);
    case 'hold':
      return hasEvent(view, 'hold', view.you);
    case 'inkwork': {
      const novice = yourUnit(view, 'c_novice');
      return novice != null && novice.attack >= 2;
    }
    case 'champion':
      return unitOnBoard(view, 'champ_old_wick', 'you');
    case 'over':
      return view.winner != null;
    case 'play':
      return false;
    default:
      return false;
  }
}

export function allowsHit(step: GuideStep, hitId: string, previewOpen: boolean, board?: { foeLeft: boolean }): boolean {
  if (step.id === 25) return true;
  if (step.id === 16 || (step.id === 15 && previewOpen)) return true;
  if (hitId === 'guide:next' && (step.advance === 'next' || step.advance === 'hold')) return true;
  if (hitId === 'guide:skip' || hitId === 'guide:skip-yes' || hitId === 'guide:skip-no') return true;
  if (step.advance === 'page') return hitId.startsWith('page');
  if (step.advance === 'keyword') return hitId.startsWith('card:') || hitId.startsWith('keyword:');
  if (step.advance === 'novice') return hitId.startsWith('card:c_novice') || hitId.startsWith('slot:0');
  if (step.advance === 'two-cost') return hitId.startsWith('card:n_doodle') || hitId.startsWith('slot:1');
  if (step.advance === 'attack') return hitId.startsWith('unit:') || previewOpen;
  if (step.advance === 'end') return hitId === 'end';
  if (step.advance === 'legend') return hitId === 'power' || hitId.includes('n_doodle');
  if (step.advance === 'conquer') return board?.foeLeft === false ? hitId === 'end' : hitId.startsWith('unit:') || hitId.startsWith('card:');
  if (step.advance === 'inkwork') return hitId.startsWith('card:c_mend') || hitId.includes('c_novice');
  if (step.advance === 'champion') return hitId.startsWith('card:champ_old_wick') || hitId === 'card:champion' || hitId.startsWith('slot:');
  if (step.advance === 'play') return hitId === 'play';
  if (step.advance === 'over') return true;
  return false;
}

export class GuideController {
  private index = 0;
  private started = Date.now();
  private holdPaint = false;
  private previewLogged = false;
  pageRead = false;
  keywordHeld = false;
  done = false;

  constructor() {
    logMetric({ kind: 'step', step: 1, action: 'start' });
  }

  get step(): GuideStep | null {
    return this.done ? null : (GUIDE_STEPS[this.index] ?? null);
  }

  visible(preview: boolean): GuideStep | null {
    const step = this.step;
    if (step?.id === 15 && preview) {
      if (!this.previewLogged) {
        this.previewLogged = true;
        logMetric({ kind: 'step', step: 16, action: 'start' });
      }
      return GUIDE_STEPS.find((entry) => entry.id === 16) ?? step;
    }
    return step;
  }

  /**
   * Advance action steps whose board condition is already true.
   * A step that was just entered waits until the next sync, so a finished
   * rival turn still paints its bubble before the guide moves on.
   */
  sync(payload: ClientPayload | null): void {
    const step = this.step;
    if (!step || !payload) return;
    if (this.holdPaint) {
      this.holdPaint = false;
      return;
    }
    if (!this.auto(step)) return;
    if (!guideReady(step, payload, { pageRead: this.pageRead, keywordHeld: this.keywordHeld })) return;
    this.advance(payload);
  }

  next(payload: ClientPayload | null): void {
    const step = this.step;
    if (!step || !payload) return;
    if (step.advance !== 'next' && step.advance !== 'rival' && step.advance !== 'hold') return;
    if (!guideReady(step, payload, { pageRead: this.pageRead, keywordHeld: this.keywordHeld })) return;
    this.advance(payload);
  }

  private auto(step: GuideStep): boolean {
    return step.advance !== 'next' && step.advance !== 'hold' && step.advance !== 'play';
  }

  private advance(payload: ClientPayload | null): void {
    const step = this.step;
    if (!step) return;
    this.leave(step.id);
    if (step.id === 15) this.leave(16);
    this.index += 1;
    if (this.step?.id === 16) this.index += 1;
    this.pageRead = false;
    this.keywordHeld = false;
    this.holdPaint = true;
    const landed = this.step;
    if (landed) logMetric({ kind: 'step', step: landed.id, action: 'start' });
    if (payload && landed && this.auto(landed) && guideReady(landed, payload, { pageRead: false, keywordHeld: false })) {
      // The condition was already true as we arrived. The next sync paints, then moves.
    }
  }

  private leave(id: number): void {
    logMetric({ kind: 'step', step: id, ms: Date.now() - this.started, action: 'done' });
    this.started = Date.now();
  }

  skip(): void {
    logMetric({ kind: 'skip', step: this.step?.id, action: 'skip' });
    setTutorialFlag('skipped');
    this.done = true;
  }

  complete(): void {
    logMetric({ kind: 'complete', action: 'done' });
    setTutorialFlag('done');
    this.done = true;
  }
}

export function blankStepText(step: GuideStep, _view: PlayerView | null): string {
  return step.text;
}
