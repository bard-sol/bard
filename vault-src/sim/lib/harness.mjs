/**
 * Steps, checks and the report for the simulations.
 *
 * A step is PASS or FAIL. A failed step stops its scenario. A step marked `known` is checking a
 * bug that is filed but not fixed: it is reported as KNOWN while the bug still reproduces, and
 * as FAIL once it stops reproducing, so the marker cannot outlive the bug.
 */
import { createHash } from 'node:crypto';

export class CheckFailed extends Error {}

export function check(condition, message) {
  if (!condition) throw new CheckFailed(message);
}

function canon(value) {
  return JSON.stringify(value, (k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Set) return [...v].map(String).sort();
    return v;
  });
}

export function checkEqual(actual, expected, label) {
  const a = canon(actual);
  const e = canon(expected);
  if (a !== e) throw new CheckFailed(label + ': expected ' + e + ', got ' + a);
}

/** The call must fail; returns the error text. `pattern` must match it when given. */
export async function refused(promiseOrFn, pattern, label) {
  let text = null;
  try {
    const value = typeof promiseOrFn === 'function' ? await promiseOrFn() : await promiseOrFn;
    if (value && typeof value === 'object' && 'status' in value && value.status >= 400) {
      text = String(value.status) + ' ' + JSON.stringify(value.data);
    }
  } catch (err) {
    text = err && err.message ? err.message : String(err);
  }
  if (text == null) throw new CheckFailed((label || 'call') + ' was accepted but should have been refused');
  // The worker's catch-all for an unknown route is not a refusal; it means the sim is calling the wrong path.
  if (text === '404 {"error":"not found"}') throw new CheckFailed((label || 'call') + ' hit an unknown route');
  if (process.env.SIM_DEBUG_REFUSED) console.log('    refused ' + (label || 'call') + ': ' + text.slice(0, 200));
  if (pattern && !pattern.test(text)) throw new CheckFailed((label || 'call') + ' was refused for the wrong reason: ' + text);
  return text;
}

/** An API response that must be a success. */
export function ok(res, label) {
  if (!res || res.status < 200 || res.status >= 300) {
    throw new CheckFailed((label || 'request') + ' failed: ' + (res ? res.status + ' ' + JSON.stringify(res.data) : 'no response'));
  }
  return res.data;
}

function shortError(err) {
  const text = err && err.message ? err.message : String(err);
  return text.split('\n')[0].slice(0, 400);
}

export function createScenarioRun(scenario, opts) {
  const steps = [];
  const facts = {};
  const notes = {};
  const out = opts.print || ((line) => console.log(line));
  let failed = false;
  let counter = 0;

  async function step(name, fn, stepOpts = {}) {
    if (failed) throw new Error('scenario already failed');
    counter += 1;
    const id = scenario.id + '.' + String(counter).padStart(2, '0');
    const started = Date.now();
    let status;
    let detail = '';
    let error = null;
    let value;
    try {
      value = await fn();
      if (typeof value === 'string') detail = value;
      else if (value && typeof value === 'object' && typeof value.detail === 'string') detail = value.detail;
      status = stepOpts.known ? 'FAIL' : 'PASS';
      if (stepOpts.known) error = 'known bug ' + stepOpts.known + ' no longer reproduces; drop the known marker';
    } catch (err) {
      if (stepOpts.known) {
        status = 'KNOWN';
        detail = stepOpts.known + ': ' + shortError(err);
      } else {
        status = 'FAIL';
        error = shortError(err);
        if (opts.verbose && err && err.stack) out(err.stack);
      }
    }
    const ms = Date.now() - started;
    steps.push({ id, name, status, detail, error, ms, known: stepOpts.known || null });
    const text = status === 'FAIL' ? error : detail;
    out('  ' + status.padEnd(5) + ' ' + id + '  ' + name + (text ? '  — ' + text : '') + '  (' + ms + 'ms)');
    if (status === 'FAIL') {
      failed = true;
      throw new StepAbort(id + ' ' + name + ': ' + error);
    }
    return value;
  }

  return {
    step,
    fact(key, value) { facts[key] = value; },
    note(key, value) { notes[key] = value; },
    get failed() { return failed; },
    result(extra) {
      const counts = { PASS: 0, FAIL: 0, KNOWN: 0 };
      for (const s of steps) counts[s.status] += 1;
      return { id: scenario.id, name: scenario.name, status: failed || counts.FAIL ? 'FAIL' : 'PASS', counts, steps, facts, notes, ...extra };
    },
  };
}

export class StepAbort extends Error {}

export function fingerprint(scenarios) {
  const stable = scenarios.map((s) => ({ id: s.id, status: s.status, steps: s.steps.map((x) => x.name + ':' + x.status), facts: s.facts }));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16);
}
