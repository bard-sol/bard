import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
  const names = readdirSync(path.join(root, 'supabase/migrations'));
  assert.equal(names.includes('20261024120000_draw_once.sql'), false);
  assert.equal(names.includes('20261025140000_m3_settlement_server.sql'), true);
  const sql = readFileSync(path.join(root, 'supabase/migrations/20261025140000_m3_settlement_server.sql'), 'utf8');
  assert.match(sql, /campaigns_draw_once/);
  assert.match(sql, /Draw already finalized/);
  assert.match(sql, /Draw slot already committed/);
  assert.match(sql, /draw_slot/);
  assert.match(sql, /reservation is server-only/);
  assert.equal(existsSync(path.join(root, 'supabase/migrations/20261024120000_draw_once.sql')), false);
});

test('vault source is unserved and settlement writes go through the worker', () => {
  const ignore = readFileSync(path.join(root, '.assetsignore'), 'utf8');
  assert.match(ignore, /^\/vault-src\/$/m);
  const platform = readFileSync(path.join(root, 'platform.js'), 'utf8');
  const api = readFileSync(path.join(root, 'server/api.js'), 'utf8');
  assert.equal(platform.includes('(h << 5)'), false);
  assert.equal(platform.includes('api.devnet.solana.com'), false);
  assert.equal(platform.includes('solana-rpc.publicnode.com'), false);
  assert.equal(platform.includes('api.mainnet-beta.solana.com'), false);
  assert.match(platform, /\/api\/settlements\/propose/);
  assert.equal(platform.includes("from('vault_settlements').insert"), false);
  assert.equal(platform.includes("from('vault_reservations')"), false);
  assert.match(api, /joinsForCampaign\(env, campaign\.id\)/);
  assert.match(api, /payout_hash: built\.hash/);
  const hash = createHash('sha256').update('', 'utf8').digest('hex');
  assert.equal(hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});
