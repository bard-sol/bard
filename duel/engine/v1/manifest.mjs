// Cards and rules versions for this module.
// Gameplay's v1.1 lands as a new folder; engine/active.mjs is the only pin.
import { readFileSync } from 'node:fs';

const proto = JSON.parse(readFileSync(new URL('./cards-proto.json', import.meta.url), 'utf8'));

/** Matches `version` inside cards-proto.json. */
export const CARDS_VERSION = proto.version;

/** rules-spec.md as shipped with engine 1.0.0. */
export const RULES_VERSION = 'rules-1.0.0';
