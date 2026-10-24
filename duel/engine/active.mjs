// Live rules pin. Gameplay v1.1 is a new versioned folder plus a change to the
// paths and version re-exports below. Match setup records those versions.
export {
  ENGINE_VERSION,
  DEFAULT_RULES,
  MAX_TURNS,
  WIN_VERSES,
  newMatch,
  legalActions,
  apply,
  isLegal,
  replay,
  stateHash,
  fnv,
  clientView,
  clientLog,
  cardById,
  validateDeck,
} from './v1/engine.mjs';
export { PILOT_VERSION, makeSmart } from './v1/pilots.mjs';
export { CARDS_VERSION, RULES_VERSION } from './v1/manifest.mjs';
export { STARTERS, PAGES, LEGENDS, CARDS } from './v1/cards-src.mjs';

export const FIXTURES = new URL('./v1/fixtures/golden-v1.json', import.meta.url);
