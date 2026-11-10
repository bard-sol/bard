/**
 * Bard launch simulations.
 *
 *   npm run sim                         every scenario, a fresh seed
 *   npm run sim -- --seed 1a2b3c        replay a run
 *   npm run sim -- --only s1,s7         some scenarios
 *   npm run sim -- --chain local        every scenario on the local chain (no network at all)
 *   npm run sim -- --chain devnet       every scenario on public Solana devnet (costs devnet SOL)
 *   npm run sim -- --repeat 3           three runs in a row, each with its own seed
 *   npm run sim -- --no-ui              skip the browser checks
 *
 * The default chain is "mixed": scenario 1, the full journey, runs on public Solana devnet and
 * the rest run on a local Solana (LiteSVM with the real Squads and SPL Token programs). The
 * database is always a local Supabase (PGlite with every migration); production is never
 * contacted. Prints PASS, FAIL or KNOWN per step and per scenario and writes a JSON report to
 * sim-reports/. A devnet run whose team or Bard key cannot pay is REFUSED before anything is
 * sent, and that report has no step FAIL. Exits 1 when any step fails, a run is refused, or
 * the network guard saw a refused request.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeRng, freshSeed } from './lib/rng.mjs';
import { createScenarioRun, fingerprint, StepAbort } from './lib/harness.mjs';
import { createLocalChain } from './lib/chain-local.mjs';
import { root, violations, installNetworkGuard } from './lib/world.mjs';
import { createBrowser } from './lib/ui.mjs';
import { scenarios } from './scenarios/index.mjs';

function parseArgs(argv) {
  const args = { chain: 'mixed', only: null, seed: null, repeat: 1, ui: true, verbose: false, report: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(a + ' needs a value');
      return argv[++i];
    };
    if (a === '--seed') args.seed = next();
    else if (a === '--chain') args.chain = next();
    else if (a === '--only') args.only = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--repeat') args.repeat = Math.max(1, parseInt(next(), 10) || 1);
    else if (a === '--no-ui') args.ui = false;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--report') args.report = next();
    else if (a === '--list') args.list = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error('unknown argument ' + a);
  }
  if (!['mixed', 'local', 'devnet'].includes(args.chain)) throw new Error('--chain must be mixed, local or devnet');
  if (args.seed && args.repeat > 1) throw new Error('--seed replays one run; drop --repeat');
  return args;
}

function chainFor(args, scenario) {
  if (args.chain === 'local') return 'local';
  if (args.chain === 'devnet') return 'devnet';
  return scenario.devnetInMixed ? 'devnet' : 'local';
}

async function runOnce(args, seed, browser) {
  const started = Date.now();
  const selected = scenarios.filter((s) => !args.only || args.only.includes(s.id));
  if (!selected.length) throw new Error('no scenario matches --only ' + args.only.join(','));
  const devnetIds = selected.filter((scenario) => chainFor(args, scenario) === 'devnet').map((scenario) => scenario.id);
  if (devnetIds.length) {
    const { beginDevnetRun, refusedRunReport } = await import('./lib/devnet-afford.mjs');
    const { readRehearsalBalances } = await import('./lib/chain-devnet.mjs');
    const decision = await beginDevnetRun({
      scenarioIds: devnetIds,
      readBalances: () => readRehearsalBalances(root),
    });
    if (decision.refused) {
      const report = refusedRunReport({
        seed,
        chain: args.chain,
        refusal: decision.refusal,
        startedAt: new Date(started).toISOString(),
        ms: Date.now() - started,
      });
      console.log('');
      console.log('REFUSED  ' + report.refusal.message);
      return finishReport(args, seed, started, report);
    }
  }
  const violationsBefore = violations.length;
  console.log('');
  console.log('Bard launch simulation  seed ' + seed + '  chain ' + args.chain + '  ' + selected.length + ' scenarios');
  const results = [];
  for (const scenario of selected) {
    const chainName = chainFor(args, scenario);
    const rng = makeRng(seed, scenario.id);
    console.log('');
    console.log(scenario.id + '  ' + scenario.name + '  [' + chainName + ' chain]');
    const run = createScenarioRun(scenario, { verbose: args.verbose });
    const ctx = {
      seed,
      rng,
      chainName,
      step: run.step,
      fact: run.fact,
      note: run.note,
      browser,
      async makeChain() {
        if (chainName === 'local') return createLocalChain({ rng: rng.child('chain') });
        const { createDevnetChain } = await import('./lib/chain-devnet.mjs');
        return createDevnetChain({ root });
      },
      /** Holder counts: 5 to 50 on the local chain; 5 to 8 on devnet to keep devnet SOL spend small. */
      holderCount(min = 5, max = 50) {
        return chainName === 'devnet' ? rng.int(Math.max(5, min), Math.min(8, max)) : rng.int(min, max);
      },
    };
    const t0 = Date.now();
    let crash = null;
    try {
      await scenario.run(ctx);
    } catch (err) {
      if (!(err instanceof StepAbort)) {
        crash = err && err.message ? err.message : String(err);
        console.log('  FAIL  ' + scenario.id + '  scenario crashed outside a step — ' + crash.split('\n')[0]);
        if (args.verbose && err && err.stack) console.log(err.stack);
      }
    }
    const result = run.result({ chain: chainName, ms: Date.now() - t0, crash });
    if (crash) result.status = 'FAIL';
    results.push(result);
    const known = result.counts.KNOWN ? ', ' + result.counts.KNOWN + ' known' : '';
    console.log(result.status + '  ' + scenario.id + '  ' + scenario.name + '  (' + result.counts.PASS + ' pass, ' + result.counts.FAIL + ' fail' + known + ', ' + (result.ms / 1000).toFixed(1) + 's)');
  }
  const runViolations = violations.slice(violationsBefore);
  const failed = results.filter((r) => r.status !== 'PASS');
  const report = {
    seed,
    chain: args.chain,
    startedAt: new Date(started).toISOString(),
    ms: Date.now() - started,
    status: failed.length || runViolations.length ? 'FAIL' : 'PASS',
    fingerprint: fingerprint(results),
    networkViolations: runViolations,
    summary: {
      scenarios: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      steps: results.reduce((n, r) => n + r.steps.length, 0),
      known: results.reduce((n, r) => n + r.counts.KNOWN, 0),
    },
    scenarios: results,
  };
  console.log('');
  if (runViolations.length) {
    console.log('FAIL  network guard refused ' + runViolations.length + ' request(s):');
    for (const v of runViolations.slice(0, 10)) console.log('      ' + v.reason + '  ' + v.url);
  }
  console.log(report.status + '  seed ' + seed + '  ' + report.summary.passed + '/' + report.summary.scenarios + ' scenarios, '
    + report.summary.steps + ' steps, ' + report.summary.known + ' known bugs, fingerprint ' + report.fingerprint
    + ', ' + (report.ms / 1000).toFixed(1) + 's');
  return finishReport(args, seed, started, report);
}

function finishReport(args, seed, started, report) {
  const file = args.report && args.repeat === 1
    ? path.resolve(args.report)
    : path.join(root, 'sim-reports', 'sim-' + seed + '-' + new Date(started).toISOString().replace(/[:.]/g, '-') + '.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log('report ' + path.relative(process.cwd(), file));
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: npm run sim -- [--seed S] [--only s1,s2] [--chain mixed|local|devnet] [--repeat N] [--no-ui] [--report file] [--list]');
    return 0;
  }
  if (args.list) {
    for (const s of scenarios) console.log(s.id + '  ' + s.name);
    return 0;
  }
  installNetworkGuard();
  const browser = args.ui ? await createBrowser() : null;
  let code = 0;
  try {
    for (let i = 0; i < args.repeat; i++) {
      const seed = args.seed || freshSeed();
      const report = await runOnce(args, seed, browser);
      if (report.status !== 'PASS') code = 1;
    }
  } finally {
    if (browser) await browser.close();
  }
  return code;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
