/**
 * Tidewrack's guided turns for bubble-guide v1.2.
 * A later script change is a change to this list. The interpreter does not
 * know card names.
 *
 * Riptide is set before the Deckhand attacks. An attack ends the play step,
 * so the written order (attack, then set the trap) cannot be applied. The
 * trap does not fire on the rival's own attack, and the turn still ends with
 * Deckle Doodle at 3/1 and Riptide face-down on Port Foxing (page 1).
 * Turn 4 plays both units before the Tide Runner attacks, for the same reason.
 */
export interface TutorialBeat {
  op: 'play' | 'attack';
  id: string;
  page: 0 | 1;
  /** Def id of the opposing unit this play or attack chooses. */
  target?: string;
}

export interface TutorialTurn {
  turn: number;
  steps: TutorialBeat[];
}

export const TUTORIAL_LINE: TutorialTurn[] = [
  { turn: 1, steps: [{ op: 'play', id: 't_deckhand', page: 1 }] },
  { turn: 2, steps: [{ op: 'play', id: 't_deckhand', page: 0, target: 'c_novice' }] },
  {
    turn: 3,
    steps: [
      { op: 'play', id: 't_riptide', page: 1 },
      { op: 'attack', id: 't_deckhand', page: 1, target: 'n_doodle' },
    ],
  },
  {
    turn: 4,
    steps: [
      { op: 'play', id: 't_runner', page: 1, target: 'n_doodle' },
      { op: 'play', id: 't_cutpurse', page: 1, target: 'n_doodle' },
      { op: 'attack', id: 't_runner', page: 1, target: 'n_doodle' },
    ],
  },
];
