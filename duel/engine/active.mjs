// Live rules pin.
// Cards are exported before the engine: v1.1/engine.mjs reads them from here.
// A data-only card-number pass (v1.2) is a new cards module plus this cards path.
export {
  CARDS_VERSION,
  STARTERS,
  PAGES,
  LEGENDS,
  CARDS,
} from './v1.1/cards-src.mjs';
export { RULES_VERSION } from './v1.1/manifest.mjs';
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
} from './v1.1/engine.mjs';
export { PILOT_VERSION, makeSmart } from './v1.1/pilots.mjs';

export const FIXTURES_V1 = new URL('./v1/fixtures/golden-v1.json', import.meta.url);
export const FIXTURES = new URL('./v1.1/fixtures/golden-v1.1.json', import.meta.url);
