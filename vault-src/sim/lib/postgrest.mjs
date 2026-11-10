/**
 * A local Supabase for the simulations: PGlite with every migration applied, and a small
 * PostgREST that speaks the part of the protocol Bard uses (server/*.js and supabase-js in
 * platform.js). Each request runs in its own transaction under the role its token names, so
 * row-level security, grants, triggers, checks and SQL functions are the real ones.
 *
 * Unsupported syntax (embedded resources, or=, and=) is refused with a 400 instead of guessed.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { verifyJwt } from '../../../server/auth.js';

// Supabase provides auth.jwt() and auth.uid(); the migrations call them. Same shim as tests/unit/rls.test.js.
export const AUTH_SHIM = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN COALESCE(auth.jwt()->>'sub', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (auth.jwt()->>'sub')::uuid
    ELSE NULL
  END;
$$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
`;

const ROLES = new Set(['anon', 'authenticated', 'service_role']);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'LIKE', ilike: 'ILIKE' };
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

let migratedSnapshot = null;

async function migrationFiles(root) {
  const dir = path.join(root, 'supabase', 'migrations');
  const names = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  return Promise.all(names.map(async (name) => ({ name, sql: await readFile(path.join(dir, name), 'utf8') })));
}

/** A fresh database with every migration applied. The first boot is cached as a data dump. */
export async function bootDatabase(root) {
  if (!migratedSnapshot) {
    const db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(AUTH_SHIM);
    for (const file of await migrationFiles(root)) {
      try {
        await db.exec(file.sql);
      } catch (err) {
        throw new Error('migration ' + file.name + ': ' + (err && err.message ? err.message : err));
      }
    }
    migratedSnapshot = await db.dumpDataDir('none');
    await db.close();
  }
  return new PGlite({ extensions: { pgcrypto }, loadDataDir: migratedSnapshot });
}

export class RestError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details || null;
  }
}

function quoteIdent(name) {
  const text = String(name || '').trim();
  if (!IDENT.test(text)) throw new RestError(400, 'PGRST100', 'unsupported identifier: ' + text);
  return '"' + text + '"';
}

// "(a,b,\"c,d\")" -> ['a', 'b', 'c,d']
export function parseList(text) {
  const inner = String(text || '').trim().replace(/^\(/, '').replace(/\)$/, '');
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === '\\' && quoted && i + 1 < inner.length) { cur += inner[++i]; continue; }
    if (ch === ',' && !quoted) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '' || out.length) out.push(cur.trim());
  return out;
}

/** WHERE clause from PostgREST horizontal filters. Values are always bound parameters. */
export function buildWhere(searchParams, params) {
  const parts = [];
  for (const [key, raw] of searchParams) {
    if (RESERVED.has(key)) continue;
    if (key === 'or' || key === 'and' || key === 'not.or' || key === 'not.and') {
      throw new RestError(400, 'PGRST100', 'logical filters are not supported by the simulation');
    }
    const col = quoteIdent(key);
    let value = String(raw);
    let negate = false;
    if (value.startsWith('not.')) { negate = true; value = value.slice(4); }
    const dot = value.indexOf('.');
    if (dot < 0) throw new RestError(400, 'PGRST100', 'bad filter ' + key + '=' + raw);
    const op = value.slice(0, dot);
    const operand = value.slice(dot + 1);
    let clause;
    if (op === 'in') {
      const items = parseList(operand);
      if (!items.length) clause = 'false';
      else {
        const marks = items.map((item) => { params.push(item); return '$' + params.length; });
        clause = col + ' IN (' + marks.join(', ') + ')';
      }
    } else if (op === 'is') {
      const word = operand.toLowerCase();
      if (!['null', 'true', 'false', 'unknown'].includes(word)) throw new RestError(400, 'PGRST100', 'bad is filter');
      clause = col + ' IS ' + word.toUpperCase();
    } else if (OPS[op]) {
      params.push(op === 'like' || op === 'ilike' ? operand.replace(/\*/g, '%') : operand);
      clause = col + ' ' + OPS[op] + ' $' + params.length;
    } else {
      throw new RestError(400, 'PGRST100', 'unsupported operator ' + op);
    }
    parts.push(negate ? 'NOT (' + clause + ')' : clause);
  }
  return parts.length ? ' WHERE ' + parts.join(' AND ') : '';
}

export function buildColumns(select) {
  const text = String(select == null ? '*' : select).trim();
  if (text === '' || text === '*') return '*';
  return text.split(',').map((part) => {
    const item = part.trim();
    if (item === '*') return '*';
    if (item.includes('(')) throw new RestError(400, 'PGRST100', 'embedded resources are not supported by the simulation');
    let alias = null;
    let expr = item;
    const colon = item.indexOf(':');
    if (colon > 0 && item[colon + 1] !== ':') { alias = item.slice(0, colon); expr = item.slice(colon + 1); }
    let cast = null;
    const castAt = expr.indexOf('::');
    if (castAt > 0) { cast = expr.slice(castAt + 2); expr = expr.slice(0, castAt); }
    let sql = quoteIdent(expr);
    if (cast) sql += '::' + quoteIdent(cast).slice(1, -1);
    if (alias) sql += ' AS ' + quoteIdent(alias);
    else if (cast) sql += ' AS ' + quoteIdent(expr);
    return sql;
  }).join(', ');
}

export function buildOrder(order) {
  if (!order) return '';
  const terms = String(order).split(',').map((term) => {
    const bits = term.trim().split('.');
    let sql = quoteIdent(bits[0]);
    for (const bit of bits.slice(1)) {
      if (bit === 'asc') sql += ' ASC';
      else if (bit === 'desc') sql += ' DESC';
      else if (bit === 'nullsfirst') sql += ' NULLS FIRST';
      else if (bit === 'nullslast') sql += ' NULLS LAST';
      else throw new RestError(400, 'PGRST100', 'bad order ' + term);
    }
    return sql;
  });
  return ' ORDER BY ' + terms.join(', ');
}

function intParam(value, label) {
  if (value == null || value === '') return null;
  if (!/^\d+$/.test(String(value))) throw new RestError(400, 'PGRST100', 'bad ' + label);
  return Number(value);
}

function preferOf(headers) {
  const out = {};
  for (const part of String(headers.get('prefer') || '').split(',')) {
    const [k, v] = part.split('=').map((s) => s && s.trim());
    if (k) out[k] = v == null ? true : v;
  }
  return out;
}

function wantsObject(headers) {
  return String(headers.get('accept') || '').includes('application/vnd.pgrst.object+json');
}

function pgStatus(code, role) {
  if (code === '23505' || code === '23503') return 409;
  if (code === '42501') return role === 'anon' ? 401 : 403;
  if (code === '42P01' || code === '42883') return 404;
  if (code === 'PGRST116') return 406;
  return 400;
}

// PostgREST serialises bigint and numeric as JSON numbers; PGlite returns bigint as BigInt.
function plain(value) {
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = plain(v);
    return out;
  }
  return value;
}

/**
 * opts.db         PGlite instance (from bootDatabase)
 * opts.jwtSecret  secret the Bard worker signs wallet sessions with
 * opts.serviceKey the service-role key the worker sends
 * opts.anonKeys   anon keys accepted as role anon (the browser's built-in key)
 * opts.log        optional (entry) => void for every request
 */
export function createPostgrest(opts) {
  const { db, jwtSecret, serviceKey } = opts;
  const anonKeys = new Set(opts.anonKeys || []);
  const procCache = new Map();

  async function claimsFor(headers) {
    const auth = String(headers.get('authorization') || '');
    const match = auth.match(/^Bearer\s+(\S+)$/i);
    const token = match ? match[1] : String(headers.get('apikey') || '');
    if (!token) return { role: 'anon', claims: { role: 'anon' } };
    if (serviceKey && token === serviceKey) return { role: 'service_role', claims: { role: 'service_role' } };
    if (anonKeys.has(token)) return { role: 'anon', claims: { role: 'anon' } };
    const claims = await verifyJwt(jwtSecret, token);
    if (!claims) throw new RestError(401, 'PGRST301', 'JWT invalid');
    const role = String(claims.role || '');
    if (!ROLES.has(role) || role === 'service_role') throw new RestError(401, 'PGRST301', 'JWT role not allowed');
    return { role, claims };
  }

  async function asRole(who, fn) {
    if (!ROLES.has(who.role)) throw new RestError(401, 'PGRST301', 'bad role');
    return db.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE ' + who.role);
      await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(who.claims)]);
      return fn(tx);
    });
  }

  async function procInfo(name) {
    if (procCache.has(name)) return procCache.get(name);
    const res = await db.query(
      `SELECT p.proargnames AS names, p.proargmodes AS modes,
              ARRAY(SELECT format_type(t, NULL) FROM unnest(p.proargtypes) AS t) AS types,
              p.proretset AS retset, rt.typtype AS rettype, format_type(p.prorettype, NULL) AS rettypename
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_type rt ON rt.oid = p.prorettype
        WHERE n.nspname = 'public' AND p.proname = $1`,
      [name]
    );
    if (res.rows.length !== 1) throw new RestError(404, 'PGRST202', 'function ' + name + ' not found');
    const row = res.rows[0];
    const modes = row.modes || [];
    const inputs = [];
    let t = 0;
    (row.names || []).forEach((argName, i) => {
      const mode = modes[i] || 'i';
      if (mode === 'i' || mode === 'b' || mode === 'v') inputs.push({ name: argName, type: row.types[t++] });
    });
    const info = { inputs, retset: row.retset, composite: row.rettype === 'c' || row.rettypename === 'record' };
    procCache.set(name, info);
    return info;
  }

  // PostgREST builds the response body with json_agg, so types serialise exactly as in production
  // (numeric and bigint as JSON numbers, timestamptz with an offset).
  async function jsonRows(tx, sourceSql, params) {
    const res = await tx.query(
      'WITH pgrst_source AS (' + sourceSql + ") SELECT coalesce(json_agg(_t), '[]')::text AS body FROM pgrst_source _t",
      params
    );
    return JSON.parse(res.rows[0].body);
  }

  async function handleTable(method, table, url, headers, body, who) {
    const t = quoteIdent(table);
    const prefer = preferOf(headers);
    const params = [];
    if (method === 'GET' || method === 'HEAD') {
      const where = buildWhere(url.searchParams, params);
      const limit = intParam(url.searchParams.get('limit'), 'limit');
      const offset = intParam(url.searchParams.get('offset'), 'offset');
      const sql = 'SELECT ' + buildColumns(url.searchParams.get('select')) + ' FROM ' + t + where
        + buildOrder(url.searchParams.get('order'))
        + (limit != null ? ' LIMIT ' + limit : '') + (offset != null ? ' OFFSET ' + offset : '');
      const rows = await asRole(who, (tx) => jsonRows(tx, sql, params));
      return { status: 200, rows };
    }
    const returning = prefer.return === 'representation'
      ? ' RETURNING ' + buildColumns(url.searchParams.get('select'))
      : '';
    if (method === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      if (!rows.length || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
        throw new RestError(400, 'PGRST102', 'insert body must be an object or array of objects');
      }
      const conflict = url.searchParams.get('on_conflict');
      const resolution = prefer.resolution || '';
      const out = await asRole(who, async (tx) => {
        const all = [];
        for (const row of rows) {
          const cols = Object.keys(row).map(quoteIdent);
          const p = [JSON.stringify(row)];
          let sql = cols.length
            ? 'INSERT INTO ' + t + ' (' + cols.join(', ') + ') SELECT ' + cols.join(', ')
              + ' FROM jsonb_populate_record(NULL::' + t + ', $1::jsonb)'
            : 'INSERT INTO ' + t + ' DEFAULT VALUES';
          if (resolution === 'merge-duplicates' || resolution === 'ignore-duplicates') {
            if (!conflict) throw new RestError(400, 'PGRST100', 'upsert needs on_conflict in the simulation');
            const keys = conflict.split(',').map(quoteIdent);
            if (resolution === 'ignore-duplicates') sql += ' ON CONFLICT (' + keys.join(', ') + ') DO NOTHING';
            else {
              const sets = cols.filter((c) => !keys.includes(c)).map((c) => c + ' = EXCLUDED.' + c);
              sql += ' ON CONFLICT (' + keys.join(', ') + ') DO ' + (sets.length ? 'UPDATE SET ' + sets.join(', ') : 'NOTHING');
            }
          }
          if (returning) all.push(...(await jsonRows(tx, sql + returning, p)));
          else await tx.query(sql, p);
        }
        return all;
      });
      return { status: 201, rows: out, minimal: !returning };
    }
    if (method === 'PATCH') {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RestError(400, 'PGRST102', 'patch body must be an object');
      const cols = Object.keys(body).map(quoteIdent);
      if (!cols.length) throw new RestError(400, 'PGRST102', 'empty patch');
      params.push(JSON.stringify(body));
      const where = buildWhere(url.searchParams, params);
      const sql = 'UPDATE ' + t + ' SET (' + cols.join(', ') + ') = (SELECT ' + cols.join(', ')
        + ' FROM jsonb_populate_record(NULL::' + t + ', $1::jsonb))' + where + returning;
      const sqlOne = cols.length === 1
        ? 'UPDATE ' + t + ' SET ' + cols[0] + ' = (SELECT ' + cols[0] + ' FROM jsonb_populate_record(NULL::' + t + ', $1::jsonb))' + where + returning
        : sql;
      const rows = await asRole(who, (tx) => (returning ? jsonRows(tx, sqlOne, params) : tx.query(sqlOne, params).then(() => [])));
      return { status: returning ? 200 : 204, rows, minimal: !returning };
    }
    if (method === 'DELETE') {
      const where = buildWhere(url.searchParams, params);
      const sql = 'DELETE FROM ' + t + where;
      const rows = await asRole(who, (tx) => (returning ? jsonRows(tx, sql + returning, params) : tx.query(sql, params).then(() => [])));
      return { status: returning ? 200 : 204, rows, minimal: !returning };
    }
    throw new RestError(405, 'PGRST000', 'method not allowed');
  }

  async function handleRpc(name, url, body, who) {
    quoteIdent(name);
    const info = await procInfo(name);
    const args = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const params = [];
    const named = [];
    for (const key of Object.keys(args)) {
      const input = info.inputs.find((item) => item.name === key);
      if (!input) throw new RestError(404, 'PGRST202', 'function ' + name + ' has no argument ' + key);
      const value = args[key];
      params.push(value == null ? null : (typeof value === 'object' ? JSON.stringify(value) : String(value)));
      named.push(quoteIdent(key) + ' => $' + params.length + '::' + input.type);
    }
    const call = quoteIdent(name) + '(' + named.join(', ') + ')';
    if (info.retset) {
      const rows = await asRole(who, (tx) => jsonRows(tx, 'SELECT * FROM ' + call, params));
      return { status: 200, rows };
    }
    const sql = info.composite
      ? 'SELECT to_json(_r)::text AS body FROM ' + call + ' _r'
      : 'SELECT to_json(' + call + ')::text AS body';
    const res = await asRole(who, (tx) => tx.query(sql, params));
    return { status: 200, value: res.rows[0] && res.rows[0].body != null ? JSON.parse(res.rows[0].body) : null };
  }

  function respond(status, payload, extraHeaders) {
    const headers = { 'content-type': 'application/json; charset=utf-8', ...(extraHeaders || {}) };
    if (payload === undefined) return new Response(null, { status, headers });
    return new Response(JSON.stringify(plain(payload)), { status, headers });
  }

  /** fetch-compatible handler for any URL whose path starts with /rest/v1/. */
  async function handle(input, init = {}) {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const headers = request.headers;
    if (method === 'OPTIONS') return new Response(null, { status: 204 });
    let who = { role: 'anon' };
    try {
      who = await claimsFor(headers);
      const rest = url.pathname.replace(/^\/rest\/v1\/?/, '');
      if (rest === url.pathname) throw new RestError(404, 'PGRST000', 'not a REST path');
      const text = method === 'GET' || method === 'HEAD' ? '' : await request.text();
      let body = null;
      if (text) {
        try { body = JSON.parse(text); } catch { throw new RestError(400, 'PGRST102', 'invalid JSON body'); }
      }
      let result;
      if (rest.startsWith('rpc/')) result = await handleRpc(rest.slice(4), url, body, who);
      else result = await handleTable(method, rest, url, headers, body, who);
      if (opts.log) opts.log({ role: who.role, method, path: url.pathname, query: url.search, status: result.status });
      if (result.minimal) return respond(result.status, undefined);
      if ('value' in result) return respond(result.status, result.value);
      if (wantsObject(headers)) {
        if (result.rows.length !== 1) {
          throw new RestError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned',
            'The result contains ' + result.rows.length + ' rows');
        }
        return respond(result.status, result.rows[0]);
      }
      return respond(result.status, result.rows);
    } catch (err) {
      const code = err instanceof RestError ? err.code : String((err && err.code) || 'XX000');
      const status = err instanceof RestError ? err.status : pgStatus(code, who.role);
      if (opts.log) opts.log({ role: who.role, method, path: url.pathname, query: url.search, status, error: err.message });
      return respond(status, {
        code,
        message: err && err.message ? err.message : String(err),
        details: (err && (err.details || err.detail)) || null,
        hint: (err && err.hint) || null,
      });
    }
  }

  return { handle, asRole, claimsFor };
}
