/**
 * What one devnet simulation run must already hold, and the refusal when it does not.
 *
 * Costs were measured on the local chain with 8 holders (the devnet cap) and no browser.
 * The local chain funds a vault with 0.1 SOL; devnet funds it with 0.015 SOL, so
 * 85_000_000 lamports were subtracted from each team figure. s7's two 10_000_000
 * transfers are airdrops on the local chain and come out of the team key on devnet,
 * so 20_000_000 was added to s7. s6 does not spend the rehearsal team key.
 * s1's team cost is the highest of four seeds (they spread by about 2_100_000).
 * The other scenarios are one seed each. A margin is added on top of every non-zero
 * figure: 10_000_000 lamports for the team, 10_000 for Bard.
 *
 * No cluster is contacted from this file. The run passes a balance reader in.
 */

const MEASURED_TEAM = {
  s1: 46_367_160n,
  s2: 43_227_720n,
  s3: 28_100_440n,
  s4: 27_053_960n,
  s5: 27_053_960n,
  s6: 0n,
  s7: 67_555_000n,
  s8: 33_373_160n,
  s9: 33_373_160n,
};

const MEASURED_BARD = {
  s1: 10_000n,
  s2: 10_000n,
  s3: 5_000n,
  s4: 5_000n,
  s5: 5_000n,
  s6: 10_000n,
  s7: 20_000n,
  s8: 10_000n,
  s9: 10_000n,
};

export const TEAM_MARGIN = 10_000_000n;
export const BARD_MARGIN = 10_000n;

function needFor(id) {
  const team = MEASURED_TEAM[id];
  const bard = MEASURED_BARD[id];
  if (team == null || bard == null) throw new Error('no measured devnet cost for ' + id);
  return {
    team: team + (team > 0n ? TEAM_MARGIN : 0n),
    bard: bard + BARD_MARGIN,
  };
}

/** Lamports the rehearsal keys must hold to pay for these devnet scenarios once. */
export function needForScenarios(ids) {
  let team = 0n;
  let bard = 0n;
  for (const id of ids) {
    const row = needFor(id);
    team += row.team;
    bard += row.bard;
  }
  return { team, bard };
}

/** SOL text with trailing zeros removed, so 13700000 lamports is "0.0137". */
export function formatSol(lamports) {
  const n = BigInt(lamports);
  const sign = n < 0n ? '-' : '';
  const abs = n < 0n ? -n : n;
  const whole = abs / 1_000_000_000n;
  const frac = (abs % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '') || '0';
  return sign + whole.toString() + '.' + frac;
}

/**
 * Null when both keys can pay. Otherwise the keys that are short, and one message
 * that names each key, its balance and the amount needed.
 */
export function affordabilityRefusal(balances, need) {
  const keys = [];
  for (const key of ['team', 'bard']) {
    const balance = BigInt(balances[key]);
    const needed = BigInt(need[key]);
    if (balance < needed) keys.push({ key, balance, needed });
  }
  if (!keys.length) return null;
  const message = keys.map((row) => (
    row.key + ' key has ' + formatSol(row.balance) + ' SOL and one devnet run needs ' + formatSol(row.needed) + ' SOL'
  )).join('; ') + '. Use --chain local or top up the key.';
  return { keys, message };
}

/**
 * Read both balances, refuse before `start` when either key is short, and otherwise
 * call `start`. Each call reads again, so a repeat checks the keys for that run.
 */
export async function beginDevnetRun({ scenarioIds, readBalances, start }) {
  const need = needForScenarios(scenarioIds);
  const read = await readBalances();
  const balances = { team: BigInt(read.team), bard: BigInt(read.bard) };
  const refusal = affordabilityRefusal(balances, need);
  if (refusal) return { refused: true, refusal, need, balances };
  if (start) await start();
  return { refused: false, refusal: null, need, balances };
}

/** A run report for a refusal. It has no steps, so nothing in it is a step FAIL. */
export function refusedRunReport({ seed, chain, refusal, startedAt, ms }) {
  return {
    seed,
    chain,
    startedAt,
    ms,
    status: 'REFUSED',
    refusal: {
      message: refusal.message,
      keys: refusal.keys.map((row) => ({
        key: row.key,
        balanceLamports: row.balance.toString(),
        neededLamports: row.needed.toString(),
      })),
    },
    networkViolations: [],
    summary: { scenarios: 0, passed: 0, failed: 0, steps: 0, known: 0, refused: 1 },
    scenarios: [],
  };
}
