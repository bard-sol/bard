// Live rules pin. v1.3/engine.mjs reads cards from ./cards-src.mjs.
// The client re-exports that same module. A data-only card pass replaces
// v1.3/cards-src.mjs and, if the file moves, the path below.
export { STARTERS, PAGES, LEGENDS, CARDS } from './v1.3/cards-src.mjs';
export const CARDS_VERSION = 'cards-proto-1.3';
export const RULES_VERSION = 'rules-1.3.0';
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
} from './v1.3/engine.mjs';
export { PILOT_VERSION, makeSmart, AI_SLIP } from './v1.3/pilots.mjs';

export const FIXTURES_V1 = new URL('./v1/fixtures/golden-v1.json', import.meta.url);
export const FIXTURES_V11 = new URL('./v1.1/fixtures/golden-v1.1.json', import.meta.url);
export const FIXTURES = new URL('./v1.3/fixtures/golden-v1.3.json', import.meta.url);
