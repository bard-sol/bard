import { sha256Hex } from './bytes.js';
import { stateMemo } from './spend.js';
import { voidMemo } from './voidchapter.js';

/** Public mirror proposed for chapter state files. Not Arweave. */
export const GITHUB_MIRROR_REPO = 'https://github.com/bard-sol/bard-chapters';

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}

export function canonicalState(state) {
  return JSON.stringify(sortValue(state));
}

export async function hashState(state) {
  return sha256Hex(canonicalState(state));
}

/**
 * Devnet proof is the memo hash. The file itself is mirrored to Supabase
 * Storage and a public GitHub path. Irys is not used on devnet.
 */
export async function publishPlan(state) {
  const hash = await hashState(state);
  const season = state.season;
  const chapter = state.chapter;
  const status = state.status || 'final';
  const memo = status === 'void'
    ? voidMemo(season, chapter, state.void_reason, hash)
    : stateMemo(season, chapter, hash);
  const file = 's0-chapter-' + chapter + (status === 'void' ? '-void' : '') + '.json';
  const plan = {
    hash,
    memo,
    status,
    irys: null,
    supabasePath: 'season-state/' + file,
    githubPath: 'season0/mirror/' + file,
    githubUrl: GITHUB_MIRROR_REPO + '/blob/main/' + file,
    body: canonicalState(state)
  };
  return Object.assign(plan, mirrorLinks(plan, null));
}

/**
 * Verify sheet targets. Supabase is the primary file. GitHub is the public
 * mirror. The memo hash and the file hash are the proof. No Arweave URL.
 */
export function mirrorLinks(plan, supabaseOrigin) {
  const memoHash = String(plan.memo || '').slice(String(plan.memo || '').lastIndexOf(':') + 1);
  let supabaseUrl = null;
  if (supabaseOrigin) {
    const origin = String(supabaseOrigin).replace(/\/$/, '');
    supabaseUrl = origin + '/storage/v1/object/public/' + plan.supabasePath;
  }
  return {
    supabaseUrl,
    fileHash: plan.hash,
    memoHash,
    matches: memoHash === plan.hash
  };
}
