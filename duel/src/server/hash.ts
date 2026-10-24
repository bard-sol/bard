import { createHash } from 'node:crypto';
import { stableStringify } from '../engine/rng.js';

export function hashState(state: unknown): string {
  return createHash('sha256').update(stableStringify(state)).digest('hex');
}
