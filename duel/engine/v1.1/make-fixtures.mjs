// Writes golden replay fixtures (setup + action list + expected hashes). Run once; never overwrite silently.
import fs from 'fs';
import { STARTERS } from './cards-src.mjs';
import { makeSmart, makeNaive } from './pilots.mjs';
import { playMatch } from './play.mjs';
import { replay, stateHash, fnv, ENGINE_VERSION } from './engine.mjs';
const out = 'fixtures/golden-v1.1.json'; if (fs.existsSync(out)) { console.log('exists, not overwriting'); process.exit(0); }
const cases = [['candle', 'fold', 11], ['fold', 'tidewrack', 22], ['tidewrack', 'candle', 33], ['candle', 'candle', 44], ['tidewrack', 'tidewrack', 55], ['fold', 'fold', 66], ['fold', 'candle', 77], ['tidewrack', 'fold', 88]];
const fx = cases.map(([a, b, seed], i) => {
  const setup = { houseA: a, deckA: STARTERS[a], houseB: b, deckB: STARTERS[b], seed, aiVersion: 'pilot-1.1.0' };
  const r = playMatch(setup, [i % 2 ? makeNaive(seed) : makeSmart({ stance: ['balanced', 'aggressive', 'patient'][i % 3] }), makeSmart({ slip: 300, salt: 99 })]);
  const s = replay(setup, r.actions);
  return { name: `${a}-v-${b}-s${seed}`, setup, actions: r.actions, expect: { winner: s.winner, reason: s.reason, verses: s.players.map((p) => p.verses), stateHash: stateHash(s), logHash: fnv(JSON.stringify(s.log)), logLen: s.log.length } };
});
fs.mkdirSync('fixtures', { recursive: true });
fs.writeFileSync(out, JSON.stringify({ engine: ENGINE_VERSION, fixtures: fx }, null, 1)); console.log('wrote', fx.length);
