import type { ClientPayload, UnitView } from '../types.js';

export interface ToastCopy {
  title: string;
  body: string;
  info?: boolean;
}

/** Titles and help lines from Design's toasts.html. Names fill the same slots as the examples. */
export function toastCopy(title: string, body: string, info = false): ToastCopy {
  return { title, body, info };
}

export const PLAY_STEP_OVER = 'Plays, the Legend power and the champion all come before your first attack or move.';

export function playToast(payload: ClientPayload, cardName: string, cost: number, pageName: string | null, pageFull: number | null, noteTaken: boolean): ToastCopy | null {
  const view = payload.view;
  if (!view.yourTurn) return toastCopy('Not your turn', `${view.foeLegend.name} is playing. You can still read any card.`);
  if (view.phase === 'fight') return toastCopy('Play step is over', PLAY_STEP_OVER);
  if (cost > view.ink) return toastCopy('Not enough Ink', `${cardName} costs <em>${cost} Ink</em>. You have ${view.ink}.`);
  if (noteTaken) return toastCopy('One note per Page', `You already have a Marginalia on ${pageName ?? 'that Page'}.`);
  if (pageFull === 2) return toastCopy('Page full (2)', 'The Torn Margin holds only 2 units per side.');
  if (pageFull != null && pageFull >= 4) return toastCopy('Page full (4)', `${pageName ?? 'That Page'} already has 4 of your units.`);
  return null;
}

export function attackToast(payload: ClientPayload, unit: UnitView | null, defender: UnitView | null): ToastCopy | null {
  const view = payload.view;
  if (!view.yourTurn) return toastCopy('Not your turn', `${view.foeLegend.name} is playing. You can still read any card.`);
  if (defender?.keywords.includes('Hidden')) return toastCopy('Hidden: can\'t be targeted', `${defender.name} can\'t be chosen until it attacks.`);
  if (defender && unit && defender.page === unit.page) {
    const page = view.pages[unit.page];
    const bound = page?.slots.map((slot) => slot.foe).find((foe) => foe?.keywords.includes('Bound'));
    if (bound && defender.instanceId !== bound.instanceId) return toastCopy('Must attack the Bound unit first', `<em>${bound.name}</em> is Bound. Attack it before the others here.`);
  }
  if (unit && defender && unit.page !== defender.page) return toastCopy('Wrong Page', 'Units only attack enemies on their own Page.');
  if (unit?.exhausted) return toastCopy('Tired: played this turn', 'New characters act next turn. <em>Swift</em> ones can act now.');
  return null;
}

export function moveToast(unit: UnitView | null, destFull: boolean, destName: string): ToastCopy | null {
  if (destFull) return toastCopy('No room there', `${destName} is full, so it can\'t move there.`);
  if (unit?.exhausted) return toastCopy('Tired: it moved', 'Moving uses its turn. <em>Board</em> units can still attack.');
  return null;
}

export function legendToast(payload: ClientPayload): ToastCopy | null {
  const view = payload.view;
  if (!view.yourTurn || view.phase === 'fight') {
    if (view.phase === 'fight') return toastCopy('Play step is over', PLAY_STEP_OVER);
    return toastCopy('Not your turn', `${view.foeLegend.name} is playing. You can still read any card.`);
  }
  if (view.youLegend.powerUsed) return toastCopy('Legend power used', `${view.youLegend.name}'s power is back next turn.`);
  if (view.ink < view.youLegend.powerCost) return toastCopy('Legend needs 2 Ink', `You have ${view.ink}.`);
  return null;
}

export function endTurnWarning(payload: ClientPayload): { ink: string | null; ready: string | null } {
  const view = payload.view;
  const ready = view.pages.flatMap((page) => page.slots.map((slot) => slot.you)).find((unit) => unit && !unit.exhausted);
  return {
    ink: view.ink > 0 ? `You still have ${view.ink} Ink. End anyway?` : null,
    ready: ready ? `Your ${ready.name} can still attack or move.` : null,
  };
}

export const INFO_TOASTS = {
  handFull: toastCopy('Hand full', 'You had 10 cards, so the card you drew burned.', true),
  deckEmpty: toastCopy('Deck empty', 'No card to draw this turn. Nothing else happens.', true),
  timeout: toastCopy('Time\'s up', 'Your turn ended.', true),
  moot: toastCopy('The Moot-Rings', 'Opening Lines don\'t happen here. Play it anyway?', true),
  silenced: toastCopy('Silenced', 'This unit can\'t gain keywords.', true),
  moveBlocked: toastCopy('Move blocked', 'Undertow couldn\'t move it: that Page is full.', true),
};

export const TIP_COPY = {
  mulligan: 'Swap cards you don\'t want. You get one mulligan.',
  second: 'You\'re second, so you get +1 card, Spare Ink, extra Ink and 1 Verse to start.',
  spare: 'Tap Spare Ink for +1 Ink this turn. One use.',
  afterAttack: 'Plays, the Legend power and the champion all come before your first attack or move.',
  bound: 'Bound: you must attack this first.',
  ward: 'Ward blocks the first damage. Hit it with something small first.',
  trap: 'That was a Marginalia trap. They trigger on your turn.',
  matchPoint: 'They\'re close to 8. Contest their Pages!',
};
