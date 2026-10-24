import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ignore from 'ignore';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pages = ['index.html', 'explore.html', 'dashboard.html', 'admin.html'];

function referencedAssets() {
  const found = new Set();
  const re = /(?:src|href)=["']([^"'#?]+)/g;
  for (const page of pages) {
    const html = readFileSync(path.join(root, page), 'utf8');
    let match;
    while ((match = re.exec(html))) {
      const ref = match[1];
      if (!ref.startsWith('/') || ref.startsWith('//') || ref === '/') continue;
      found.add(ref.slice(1));
    }
  }
  found.add('vendor/supabase/supabase.js');
  found.add('platform.js');
  return [...found];
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(rel);
  }
  return out;
}

test('assetsignore serves page assets and hides dev files', () => {
  const ig = ignore().add(readFileSync(path.join(root, '.assetsignore'), 'utf8'));
  for (const asset of referencedAssets()) {
    assert.equal(ig.ignores(asset), false, asset + ' must be served');
  }
  const vendor = walk(path.join(root, 'vendor'));
  assert.ok(vendor.length > 0);
  for (const file of vendor) assert.equal(ig.ignores(file), false, file);

  const hidden = [
    'supabase/migrations/20260809170000_platform_schema.sql',
    'supabase/archive/20260321000000_clear_all_member_data.sql',
    'tests/unit/platform.test.js',
    'package.json',
    'package-lock.json',
    '.github/workflows/example.yml',
    'node_modules/wrangler/package.json',
    'worker.js',
    'wrangler.toml',
    'server/api.js',
    'scripts/m2-two-wallet-check.mjs',
    'playwright.config.js',
  ];
  for (const file of hidden) assert.equal(ig.ignores(file), true, file + ' must not be served');
});
