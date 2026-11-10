/**
 * Seeded randomness for the simulations. Every choice a scenario makes (how many holders, who
 * joins, who cheats, amounts) comes from here, and every wallet is derived from the seed, so
 * `--seed X` replays a run.
 */
import { createHash, randomBytes } from 'node:crypto';

function sha256(text) {
  return createHash('sha256').update(text).digest();
}

/** A fresh seed for a run that was not given one: 12 hex characters, short enough to retype. */
export function freshSeed() {
  return randomBytes(6).toString('hex');
}

// sfc32: small, fast, and good enough for picking test cases. State comes from sha256(seed:label).
function sfc32(a, b, c, d) {
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function makeRng(seed, label = 'root') {
  const root = String(seed);
  const state = sha256(root + ':' + label);
  const next = sfc32(state.readUInt32LE(0), state.readUInt32LE(4), state.readUInt32LE(8), state.readUInt32LE(12));
  for (let i = 0; i < 12; i++) next();
  const rng = {
    seed: root,
    label,
    next,
    /** Integer in [min, max], both inclusive. */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    bool(p = 0.5) {
      return next() < p;
    },
    pick(list) {
      if (!list.length) throw new Error('pick from an empty list');
      return list[Math.floor(next() * list.length)];
    },
    shuffle(list) {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    /** n distinct items from list. */
    sample(list, n) {
      return rng.shuffle(list).slice(0, Math.max(0, Math.min(n, list.length)));
    },
    /** 32 bytes for Keypair.fromSeed: the same seed and name always give the same wallet. */
    seedBytes(name) {
      return Uint8Array.from(sha256(root + ':wallet:' + name));
    },
    /** An independent stream for a sub-part, so adding a step in one scenario does not shift another. */
    child(name) {
      return makeRng(root, label + '/' + name);
    },
  };
  return rng;
}
