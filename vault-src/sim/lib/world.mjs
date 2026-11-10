/**
 * One simulated Bard: the real worker API (server/api.js) on a local HTTP port, the local
 * Supabase (PGlite + PostgREST), a chain (local LiteSVM or Solana devnet), and actors that
 * run the real browser client (platform.js + the vendored supabase-js) with their own wallet.
 *
 * Network guard (TRAA-641): the only hosts any code may reach are this machine and
 * api.devnet.solana.com. Production Supabase is answered by the local database inside the
 * process and never contacted; mainnet, X, email and every other host are refused and recorded
 * as violations, which fail the run.
 */
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { handleRequest, rewriteCampaignRequest } from '../../../server/api.js';
import { clearHolderBalanceCache } from '../../../server/queue.js';
import { signerConfigProblem } from '../../../server/config.js';
import { FEE_TREASURY } from '../../../server/chain.js';
import { bootDatabase, createPostgrest } from './postgrest.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEVNET_HOST = 'api.devnet.solana.com';

const platformSource = readFileSync(path.join(root, 'platform.js'), 'utf8');
const supabaseSource = readFileSync(path.join(root, 'vendor', 'supabase', 'supabase.js'), 'utf8');

// The production project ref and anon key are compiled into platform.js. They are read from
// the file, not copied, so the guard follows the file if it changes.
export const PROD_SUPABASE_URL = (platformSource.match(/SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
const PROD_ANON = (platformSource.match(/SUPABASE_ANON\s*=\s*\n?\s*'([^']+)'/) || [])[1];
if (!PROD_SUPABASE_URL || !PROD_ANON) throw new Error('could not read the Supabase settings from platform.js');
export const PROD_SUPABASE_HOST = new URL(PROD_SUPABASE_URL).hostname;

export const violations = [];

export function classifyHost(url) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return { ok: false, reason: 'malformed URL' }; }
  const host = parsed.hostname.toLowerCase();
  if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]') {
    return parsed.protocol === 'http:' ? { ok: true, kind: 'local' } : { ok: false, reason: 'non-http local URL' };
  }
  if (host === 'supabase.co' || host.endsWith('.supabase.co')) return { ok: false, reason: 'Supabase is never contacted: ' + host };
  if (host.includes('mainnet')) return { ok: false, reason: 'mainnet is refused: ' + host };
  if (host === DEVNET_HOST && parsed.protocol === 'https:') return { ok: true, kind: 'devnet' };
  return { ok: false, reason: 'host is outside the simulation: ' + host };
}

let guardInstalled = false;
const realFetch = globalThis.fetch.bind(globalThis);

/** Replace global fetch so nothing in this process reaches a host outside the guard. */
export function installNetworkGuard() {
  if (guardInstalled) return;
  guardInstalled = true;
  globalThis.fetch = async function guardedFetch(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url);
    const verdict = classifyHost(url);
    if (!verdict.ok) {
      violations.push({ at: new Date().toISOString(), url: String(url).slice(0, 200), reason: verdict.reason });
      throw new Error('network guard: ' + verdict.reason);
    }
    return realFetch(input, init);
  };
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(String(k)); },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] || null,
    get length() { return map.size; },
  };
}

const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css' };

function staticFile(pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';
  if (!path.extname(rel) && existsSync(path.join(root, rel + '.html'))) rel += '.html';
  const top = rel.split('/')[0];
  const allowed = (!rel.includes('/') && /\.(html|js|png|jpg)$/.test(rel)) || top === 'vendor';
  if (!allowed || rel.includes('..')) return null;
  const file = path.join(root, rel);
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  return { bytes: readFileSync(file), type: CONTENT_TYPES[path.extname(file)] || 'application/octet-stream' };
}

/**
 * opts.chain      chain object (chain-local.mjs or chain-devnet.mjs)
 * opts.bardWallet the Bard signer public key
 * opts.cutBps     BARD_CUT_BPS for this world (string)
 * opts.cutWallet  BARD_CUT_WALLET, defaults to FEE_TREASURY as in wrangler.toml
 * opts.scored     SCORED_CAMPAIGNS on or off
 */
export async function createWorld(opts) {
  installNetworkGuard();
  clearHolderBalanceCache();
  const chain = opts.chain;
  const db = await bootDatabase(root);
  const jwtSecret = 'sim-' + randomBytes(24).toString('hex');
  const serviceKey = 'sim-service-' + randomBytes(24).toString('hex');
  const restLog = [];
  const pg = createPostgrest({ db, jwtSecret, serviceKey, anonKeys: [PROD_ANON], log: (entry) => restLog.push(entry) });
  const SIM_SUPABASE = 'http://supabase.sim.invalid';
  let base = '';

  const env = {
    SUPABASE_URL: SIM_SUPABASE,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    SUPABASE_JWT_SECRET: jwtSecret,
    BARD_SIGNER_PUBKEY: opts.bardWallet,
    BARD_CUT_BPS: opts.cutBps == null ? '500' : String(opts.cutBps),
    BARD_CUT_WALLET: opts.cutWallet || FEE_TREASURY,
    SCORED_CAMPAIGNS: opts.scored ? 'true' : 'false',
    SOLANA_RPC: '',
    ...(opts.extraEnv || {}),
    fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      if (url.origin === SIM_SUPABASE) return pg.handle(input, init);
      if (chain.name === 'local' && base && url.origin === base && url.pathname === '/__sim_rpc') return chain.rpcFetch(input, init);
      const verdict = classifyHost(url.toString());
      if (!verdict.ok) {
        violations.push({ at: new Date().toISOString(), url: url.toString().slice(0, 200), reason: 'worker: ' + verdict.reason });
        throw new Error('network guard: ' + verdict.reason);
      }
      return chain.rpcFetch(input, init);
    },
  };

  const signerProblem = signerConfigProblem(env);
  if (signerProblem) throw new Error('signer guard: ' + signerProblem);
  if (opts.bardWallet === FEE_TREASURY || opts.bardWallet === env.BARD_CUT_WALLET) throw new Error('signer guard: the Bard signer is the fee wallet');

  async function app(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__sim_rpc' && chain.name === 'local') return chain.rpcFetch(request);
    if (url.pathname.startsWith('/api/')) {
      const response = await handleRequest(request, env);
      if (response) return response;
    }
    const rewritten = rewriteCampaignRequest(request);
    const file = staticFile(new URL(rewritten.url).pathname);
    if (!file) return new Response('not found', { status: 404 });
    return new Response(file.bytes, { status: 200, headers: { 'content-type': file.type, 'cache-control': 'no-store' } });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const request = new Request(base + req.url, {
        method: req.method,
        headers: req.headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      });
      const response = await app(request);
      const bytes = Buffer.from(await response.arrayBuffer());
      const headers = {};
      response.headers.forEach((value, key) => { headers[key] = value; });
      res.writeHead(response.status, headers);
      res.end(bytes);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(err && err.message ? err.message : 'server error');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  env.SOLANA_RPC = chain.name === 'local' ? base + '/__sim_rpc' : chain.rpcUrl;

  /** What a page's fetch does: same-origin to the worker, the Supabase project to the local DB. */
  async function browserFetch(input, init) {
    const raw = typeof input === 'string' ? input : (input && input.url);
    const url = new URL(raw, base);
    if (url.hostname === PROD_SUPABASE_HOST) {
      const target = SIM_SUPABASE + url.pathname + url.search;
      if (!url.pathname.startsWith('/rest/v1/')) return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
      if (input instanceof Request) return pg.handle(new Request(target, input));
      return pg.handle(target, init);
    }
    if (url.origin === base) {
      const request = input instanceof Request ? new Request(url.toString(), input) : new Request(url.toString(), init);
      return app(request);
    }
    return globalThis.fetch(url.toString(), init);
  }

  /** Raw API call, outside platform.js (used for abuse cases and assertions). */
  async function api(method, pathname, body, token) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = 'Bearer ' + token;
    const res = await app(new Request(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = { text }; } }
    return { status: res.status, data };
  }

  /** Raw PostgREST call as a role: 'service', 'anon' or a session token. */
  async function rest(method, pathAndQuery, body, as = 'service', extraHeaders = {}) {
    const token = as === 'service' ? serviceKey : (as === 'anon' ? PROD_ANON : as);
    const headers = { authorization: 'Bearer ' + token, apikey: PROD_ANON, 'content-type': 'application/json', ...extraHeaders };
    if (method !== 'GET' && !headers.prefer) headers.prefer = 'return=representation';
    const res = await pg.handle(SIM_SUPABASE + '/rest/v1' + pathAndQuery, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch { data = { text }; } }
    return { status: res.status, data };
  }

  /** Direct SQL as the database owner: time travel and assertions only, never a product path. */
  async function sql(query, params) {
    const res = await db.query(query, params || []);
    return res.rows;
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }

  return { env, base, db, pg, chain, app, api, rest, sql, browserFetch, restLog, close, prodAnon: PROD_ANON, serviceKey, jwtSecret };
}

/**
 * An actor is one person with one wallet using Bard through the real browser client.
 * platform.js and supabase-js run in their own VM context with their own session storage.
 */
export async function createActor(world, keypair, label) {
  const logs = [];
  const quiet = {
    log: (...a) => logs.push(a.join(' ')),
    info: (...a) => logs.push(a.join(' ')),
    warn: (...a) => logs.push('warn ' + a.join(' ')),
    error: (...a) => logs.push('error ' + a.join(' ')),
    debug: () => {},
  };
  const sandbox = {
    console: quiet,
    URL, URLSearchParams, Headers, Request, Response, FormData, Blob, AbortController, AbortSignal,
    TextEncoder, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    structuredClone, atob, btoa, crypto: globalThis.crypto, WebSocket: globalThis.WebSocket,
    Event: globalThis.Event, EventTarget: globalThis.EventTarget,
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    navigator: { userAgent: 'bard-sim' },
    location: new URL(world.base + '/'),
    fetch: (input, init) => world.browserFetch(input, init),
    document: {
      querySelector: () => ({}),
      getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute() {}, append() {}, appendChild() {} }),
      head: { appendChild() {} },
      body: { appendChild() {}, prepend() {}, insertBefore() {} },
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(supabaseSource, sandbox, { filename: 'vendor/supabase/supabase.js' });
  vm.runInContext(platformSource, sandbox, { filename: 'platform.js' });
  const platform = sandbox.BardPlatform;
  if (!platform) throw new Error('platform.js did not define BardPlatform');
  const wallet = keypair.publicKey.toBase58();
  const provider = {
    publicKey: { toString: () => wallet, toBase58: () => wallet },
    async connect() { return { publicKey: this.publicKey }; },
    async signMessage(bytes) {
      return { signature: nacl.sign.detached(Uint8Array.from(bytes), keypair.secretKey) };
    },
  };
  const actor = {
    label,
    wallet,
    keypair,
    platform,
    logs,
    token: null,
    async signIn() {
      const out = await platform.signIn(provider);
      actor.token = out.token;
      return out;
    },
    async mode() {
      const ready = await platform.init();
      return ready.mode;
    },
    sign(message) {
      return bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey));
    },
  };
  return actor;
}
