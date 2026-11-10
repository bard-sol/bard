import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  affordabilityRefusal,
  beginDevnetRun,
  formatSol,
  needForScenarios,
  refusedRunReport,
} from '../../vault-src/sim/lib/devnet-afford.mjs';

const s1 = needForScenarios(['s1']);

test('a stubbed balance under the devnet limit refuses before the run starts', async () => {
  const originalFetch = globalThis.fetch;
  let started = 0;
  let reads = 0;
  globalThis.fetch = () => { throw new Error('the affordability test must not call the network'); };
  try {
    const decision = await beginDevnetRun({
      scenarioIds: ['s1'],
      readBalances: async () => {
        reads += 1;
        return { team: 13_700_000n, bard: s1.bard };
      },
      start: async () => { started += 1; },
    });
    assert.equal(reads, 1);
    assert.equal(started, 0);
    assert.equal(decision.refused, true);
    assert.equal(decision.refusal.keys.length, 1);
    assert.equal(decision.refusal.keys[0].key, 'team');
    assert.match(decision.refusal.message, /team key has 0\.0137 SOL and one devnet run needs 0\.05636716 SOL/);
    assert.match(decision.refusal.message, /Use --chain local or top up the key\./);
    const report = refusedRunReport({
      seed: 't',
      chain: 'mixed',
      refusal: decision.refusal,
      startedAt: '2026-11-10T00:00:00.000Z',
      ms: 1,
    });
    assert.equal(report.status, 'REFUSED');
    assert.deepEqual(report.scenarios, []);
    assert.equal(report.summary.failed, 0);
    assert.equal(report.summary.steps, 0);
    assert.equal(JSON.stringify(report).includes('"FAIL"'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a stubbed balance at or above the limit lets the run start', async () => {
  const originalFetch = globalThis.fetch;
  let started = 0;
  globalThis.fetch = () => { throw new Error('the affordability test must not call the network'); };
  try {
    for (const team of [s1.team, s1.team + 1n]) {
      const decision = await beginDevnetRun({
        scenarioIds: ['s1'],
        readBalances: async () => ({ team, bard: s1.bard }),
        start: async () => { started += 1; },
      });
      assert.equal(decision.refused, false);
      assert.equal(decision.refusal, null);
    }
    assert.equal(started, 2);
    assert.equal(affordabilityRefusal({ team: s1.team, bard: s1.bard }, s1), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('each check reads the balances again, and a short Bard key is named', async () => {
  const need = needForScenarios(['s1', 's7']);
  assert.equal(need.team, needForScenarios(['s1']).team + needForScenarios(['s7']).team);
  let reads = 0;
  const readBalances = async () => {
    reads += 1;
    if (reads === 1) return { team: need.team, bard: need.bard };
    return { team: need.team, bard: 0n };
  };
  const first = await beginDevnetRun({ scenarioIds: ['s1', 's7'], readBalances, start: async () => {} });
  let started = 0;
  const second = await beginDevnetRun({
    scenarioIds: ['s1', 's7'],
    readBalances,
    start: async () => { started += 1; },
  });
  assert.equal(first.refused, false);
  assert.equal(second.refused, true);
  assert.equal(started, 0);
  assert.equal(reads, 2);
  assert.equal(second.refusal.keys.map((row) => row.key).join(','), 'bard');
  assert.match(second.refusal.message, /bard key has 0\.0 SOL and one devnet run needs/);
  const both = affordabilityRefusal({ team: 1n, bard: 1n }, s1);
  assert.deepEqual(both.keys.map((row) => row.key), ['team', 'bard']);
  assert.equal(both.message.indexOf('Use --chain local or top up the key.'), both.message.lastIndexOf('Use --chain local or top up the key.'));
  assert.equal(formatSol(0n), '0.0');
});
