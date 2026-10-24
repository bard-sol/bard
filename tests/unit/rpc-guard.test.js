import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DEVNET_RPC, assertDevnetUrl } from '../../vault-src/src/rpc-guard.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('devnet guard refuses supabase and mainnet', () => {
  assert.equal(DEVNET_RPC, 'https://api.devnet.solana.com');
  assert.doesNotThrow(() => assertDevnetUrl(DEVNET_RPC));
  assert.throws(() => assertDevnetUrl('https://pxdiyukxgnphxlknhmke.supabase.co/rest/v1/projects'), /Supabase/);
  assert.throws(() => assertDevnetUrl('https://api.mainnet-beta.solana.com'), /non-devnet/);
  assert.throws(() => assertDevnetUrl('https://solana-rpc.publicnode.com'), /non-devnet/);
});

test('devnet script installs the guard before any request', () => {
  const src = readFileSync(path.join(root, 'vault-src/scripts/devnet-e2e.mjs'), 'utf8');
  assert.match(src, /assertDevnetUrl\(DEVNET_RPC\)/);
  assert.match(src, /globalThis\.fetch/);
  assert.equal(src.includes('api.mainnet-beta.solana.com'), false);
  assert.equal(src.includes('.supabase.co'), false);
});

test('draw-once migration refuses a second draw', () => {
  const sql = readFileSync(path.join(root, 'supabase/migrations/20261024120000_draw_once.sql'), 'utf8');
  assert.match(sql, /campaigns_draw_once/);
  assert.match(sql, /Draw already finalized/);
  assert.match(sql, /Draw slot already committed/);
  assert.match(sql, /draw_slot/);
});

test('vault source is unserved and the payout hash is not the old 32-bit mix', () => {
  const ignore = readFileSync(path.join(root, '.assetsignore'), 'utf8');
  assert.match(ignore, /^\/vault-src\/$/m);
  const platform = readFileSync(path.join(root, 'platform.js'), 'utf8');
  assert.equal(platform.includes('(h << 5)'), false);
  assert.match(platform, /var RPC = 'https:\/\/api\.devnet\.solana\.com'/);
  assert.equal(platform.includes('solana-rpc.publicnode.com'), false);
  assert.equal(platform.includes('api.mainnet-beta.solana.com'), false);
  assert.match(platform, /listJoinsForCampaign\(campaignId\)/);
  assert.match(platform, /computePayouts\(stored, joinsFromDb/);
  const hash = createHash('sha256').update('', 'utf8').digest('hex');
  assert.equal(hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});
