// Pre-deploy check: Bard's second signer must not be the fee treasury or the cut wallet.
//
//   npm run check:signer
//   BARD_SIGNER_PUBKEY=<pubkey> npm run check:signer -- --require-signer
//   npm run check:signer -- --url https://bard.is --require-signer --expect-network mainnet-beta
//
// It reads the [vars] sections of wrangler.toml, lets BARD_SIGNER_PUBKEY / BARD_CUT_WALLET in the
// environment override them (so a value can be checked before it is set as a Cloudflare secret),
// and with --url also reads the live GET /api/config. It prints public keys only; it never reads
// SOLANA_RPC or any other secret. Exit 0 = safe, 1 = unsafe, 2 = bad arguments.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bardSigner, cutSettings, signerConfigProblem } from '../server/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NETWORKS = ['mainnet-beta', 'devnet', 'testnet'];
const USAGE = 'usage: check-signer-config [--require-signer] [--url https://host] [--expect-network mainnet-beta|devnet|testnet]';

function parseTomlValue(raw, where) {
  const text = raw.trim();
  if (text.startsWith('"""') || text.startsWith("'''")) throw new Error(where + ': multi-line strings are not supported in vars');
  if (text.startsWith('[') || text.startsWith('{')) throw new Error(where + ': arrays and inline tables are not supported in vars');
  if (text.startsWith('"')) {
    let out = '';
    for (let i = 1; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '\\') {
        const next = text[i + 1];
        if (next !== '"' && next !== '\\') throw new Error(where + ': unsupported escape in string');
        out += next;
        i += 1;
      } else if (ch === '"') {
        const rest = text.slice(i + 1).trim();
        if (rest && !rest.startsWith('#')) throw new Error(where + ': unexpected text after string');
        return out;
      } else {
        out += ch;
      }
    }
    throw new Error(where + ': unterminated string');
  }
  if (text.startsWith("'")) {
    const end = text.indexOf("'", 1);
    if (end < 0) throw new Error(where + ': unterminated string');
    const rest = text.slice(end + 1).trim();
    if (rest && !rest.startsWith('#')) throw new Error(where + ': unexpected text after string');
    return text.slice(1, end);
  }
  return text.replace(/\s*#.*$/, '');
}

// Returns { 'vars': {...}, 'env.<name>.vars': {...} } for the sections that exist. Anything it
// cannot read with certainty throws, so this check cannot pass because the file changed shape.
export function readVarsSections(toml) {
  const sections = {};
  let current = null;
  String(toml).split(/\r?\n/).forEach((original, index) => {
    const line = original.replace(/^\uFEFF/, '').trim();
    if (!line || line.startsWith('#')) return;
    const where = 'wrangler.toml line ' + (index + 1);
    if (line.startsWith('[')) {
      const header = line.match(/^\[\[([^[\]]+)\]\]\s*(?:#.*)?$/) || line.match(/^\[([^[\]]+)\]\s*(?:#.*)?$/);
      if (!header) throw new Error(where + ': unrecognised table header');
      const name = header[1].trim();
      current = !line.startsWith('[[') && (name === 'vars' || /^env\.[A-Za-z0-9_-]+\.vars$/.test(name)) ? name : null;
      if (current && !sections[current]) sections[current] = {};
      return;
    }
    if (current === null) {
      if (/^"?vars"?\s*[=.]/.test(line)) throw new Error(where + ': vars must be a [vars] section, not an inline table');
      return;
    }
    const pair = line.match(/^(?:([A-Za-z0-9_-]+)|"([^"]+)")\s*=\s*(.*)$/);
    if (!pair) throw new Error(where + ': cannot read this line in a vars section');
    sections[current][pair[1] || pair[2]] = parseTomlValue(pair[3], where);
  });
  return sections;
}

function parseArgs(argv) {
  const out = { requireSigner: false, url: '', expectNetwork: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    const value = () => {
      if (eq > 0) return arg.slice(eq + 1);
      i += 1;
      if (i >= argv.length) throw new Error(name + ' needs a value');
      return argv[i];
    };
    if (name === '--require-signer') out.requireSigner = true;
    else if (name === '--url') out.url = value();
    else if (name === '--expect-network') out.expectNetwork = value();
    else throw new Error('unknown argument ' + arg);
  }
  if (out.expectNetwork && !NETWORKS.includes(out.expectNetwork)) throw new Error('--expect-network must be one of ' + NETWORKS.join(', '));
  if (out.expectNetwork && !out.url) throw new Error('--expect-network needs --url');
  if (out.url && !/^https?:\/\//i.test(out.url)) throw new Error('--url must be an http(s) URL');
  return out;
}

export async function run({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  readText = (file) => readFileSync(file, 'utf8'),
  tomlPath = path.join(root, 'wrangler.toml'),
  log = console.log,
} = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    log(err.message);
    log(USAGE);
    return 2;
  }
  let failed = 0;
  const ok = (message) => log('ok   ' + message);
  const fail = (message) => { failed += 1; log('FAIL ' + message); };

  const overlay = {};
  for (const key of ['BARD_SIGNER_PUBKEY', 'BARD_CUT_WALLET']) {
    if (env[key] != null && String(env[key]).trim() !== '') overlay[key] = String(env[key]).trim();
  }
  const source = Object.keys(overlay).length ? ' (with environment overrides)' : '';

  let sections;
  try {
    sections = readVarsSections(readText(tomlPath));
  } catch (err) {
    fail('cannot read wrangler.toml: ' + err.message);
    return 1;
  }
  if (!Object.keys(sections).length) sections = { vars: {} };

  const requireHere = args.requireSigner && !args.url;
  for (const [name, vars] of Object.entries(sections)) {
    const label = 'wrangler.toml [' + name + ']' + source;
    const effective = { ...vars, ...overlay };
    let cut;
    try {
      cut = cutSettings(effective);
    } catch (err) {
      fail(label + ': ' + err.message);
      continue;
    }
    const problem = signerConfigProblem(effective);
    const signer = bardSigner(effective);
    if (problem) fail(label + ': ' + problem);
    else if (!signer && requireHere) fail(label + ': BARD_SIGNER_PUBKEY is not set');
    else if (!signer) ok(label + ': BARD_SIGNER_PUBKEY is not set here (the sign step waits until it is set as a secret)');
    else ok(label + ': signer ' + signer + ' differs from the fee treasury and the cut wallet ' + cut.cutWallet);
  }

  if (args.url) {
    const target = new URL('/api/config', args.url);
    let cfg = null;
    try {
      const res = await fetchImpl(target.href, { headers: { accept: 'application/json' } });
      if (!res.ok) fail(target.origin + '/api/config answered HTTP ' + res.status);
      else cfg = await res.json();
    } catch {
      fail(target.origin + '/api/config could not be read');
    }
    if (cfg) {
      const label = target.origin + '/api/config';
      const liveSigner = String(cfg.bardSignerPubkey || '').trim();
      const liveProblem = signerConfigProblem({ BARD_SIGNER_PUBKEY: liveSigner, BARD_CUT_WALLET: cfg.cutWallet });
      if (cfg.signerError) fail(label + ': ' + cfg.signerError);
      else if (liveProblem) fail(label + ': ' + liveProblem);
      else if (!liveSigner && args.requireSigner) fail(label + ': BARD_SIGNER_PUBKEY is not set');
      else if (!liveSigner) ok(label + ': BARD_SIGNER_PUBKEY is not set (the sign step waits)');
      else ok(label + ': signer ' + liveSigner + ' differs from the fee treasury and the cut wallet ' + cfg.cutWallet);

      const solana = cfg.solana || {};
      if (solana.error) fail(label + ': solana network unusable: ' + solana.error);
      else if (!solana.network || !solana.rpc) fail(label + ': no solana network in the response');
      else if (args.expectNetwork && solana.network !== args.expectNetwork) {
        fail(label + ': the worker reads ' + solana.network + ' but ' + args.expectNetwork + ' was expected');
      } else ok(label + ': the worker and the browser use ' + solana.network);
    }
  }

  log(failed ? failed + ' problem' + (failed === 1 ? '' : 's') + ' found' : 'signer config is safe');
  return failed ? 1 : 0;
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (invokedDirectly()) {
  run().then((code) => { process.exitCode = code; }).catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exitCode = 1;
  });
}
