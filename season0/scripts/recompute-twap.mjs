#!/usr/bin/env node
/**
 * Rebuild a character's time-weighted price from swaps.
 * Offline:  node season0/scripts/recompute-twap.mjs --swaps file.json --start 0 --end 100
 * Devnet:   node season0/scripts/recompute-twap.mjs --pool <address> --start-slot N --end-slot M
 * The devnet path refuses every other cluster.
 */
import { readFileSync } from 'node:fs';
import { PublicKey } from '@solana/web3.js';
import { twapPrice, marketRaw } from '../lib/score.js';
import { defaultConfig } from '../lib/config.js';
import { devnetConnection, assertThisIsDevnet } from './devnet-guard.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

let swaps = [];
if (flag('--swaps')) {
  swaps = JSON.parse(readFileSync(flag('--swaps'), 'utf8'));
} else if (flag('--pool')) {
  const connection = devnetConnection();
  await assertThisIsDevnet(connection);
  const pool = new PublicKey(flag('--pool'));
  const startSlot = Number(flag('--start-slot'));
  const endSlot = Number(flag('--end-slot'));
  const sigs = await connection.getSignaturesForAddress(pool, { limit: 1000 });
  for (const row of sigs.reverse()) {
    if (row.slot < startSlot || row.slot > endSlot) continue;
    const tx = await connection.getTransaction(row.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
    if (!tx || !tx.meta) continue;
    const price = priceFromBalances(tx.meta);
    if (price == null) continue;
    swaps.push({ slot: row.slot, blockTime: tx.blockTime, price, signature: row.signature });
  }
} else {
  throw new Error('Pass --swaps file.json or --pool with --start-slot and --end-slot');
}

const start = Number(flag('--start') || (swaps[0] && swaps[0].blockTime) || 0);
const end = Number(flag('--end') || (swaps.length && swaps[swaps.length - 1].blockTime) || start);
const supply = Number(flag('--supply') || defaultConfig().supply);
const twap = twapPrice(swaps, start, end);
process.stdout.write(JSON.stringify({
  twap,
  marketRaw: marketRaw(twap, supply),
  swapCount: swaps.length,
  start,
  end,
  swaps
}, null, 2) + '\n');

function priceFromBalances(meta) {
  const pre = new Map();
  for (const row of meta.preTokenBalances || []) pre.set(row.accountIndex + ':' + row.mint, Number(row.uiTokenAmount.uiAmount || 0));
  let baseDelta = 0;
  let quoteDelta = 0;
  let saw = false;
  for (const row of meta.postTokenBalances || []) {
    const before = pre.get(row.accountIndex + ':' + row.mint) || 0;
    const after = Number(row.uiTokenAmount.uiAmount || 0);
    const delta = after - before;
    if (!delta) continue;
    saw = true;
    if (row.mint === 'So11111111111111111111111111111111111111112') quoteDelta += delta;
    else baseDelta += delta;
  }
  if (!saw || !baseDelta) return null;
  return Math.abs(quoteDelta / baseDelta);
}
