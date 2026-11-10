import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootDatabase } from '../../vault-src/sim/lib/postgrest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Every literal PostgREST read in server/*.js names its table and columns. PostgREST answers a
// column that does not exist with a 400, so a typo breaks the route in production while mocked
// unit tests pass. The launch simulation found one (TRAA-2319): the public campaign state asked
// vault_settlements for created_at, a column the table never had.
async function literalSelects() {
  const dir = path.join(root, 'server');
  const out = [];
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.js'))) {
    const text = await readFile(path.join(dir, name), 'utf8');
    const re = /select=([a-z_*][a-z0-9_,*]*)/g;
    let m;
    while ((m = re.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 400), m.index);
      const tables = [...before.matchAll(/(?:'\/|select\(env, '|\(env, '(?:GET|PATCH|POST|DELETE)', '\/)([a-z_]+)[?']/g)];
      if (!tables.length) continue;
      const table = tables[tables.length - 1][1];
      out.push({ file: name, table, columns: m[1].split(',').filter((c) => c && c !== '*') });
    }
  }
  return out;
}

test('every column a server route selects exists in the migrated schema', async () => {
  const db = await bootDatabase(root);
  try {
    const res = await db.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`);
    const schema = new Map();
    for (const row of res.rows) {
      if (!schema.has(row.table_name)) schema.set(row.table_name, new Set());
      schema.get(row.table_name).add(row.column_name);
    }
    const selects = await literalSelects();
    assert.ok(selects.length > 30, 'expected to find the server selects, found ' + selects.length);
    const missing = [];
    for (const s of selects) {
      const cols = schema.get(s.table);
      if (!cols) { missing.push(s.file + ': table ' + s.table); continue; }
      for (const c of s.columns) if (!cols.has(c)) missing.push(s.file + ': ' + s.table + '.' + c);
    }
    assert.deepEqual(missing, []);
  } finally {
    await db.close();
  }
});
