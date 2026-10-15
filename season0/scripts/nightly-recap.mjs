#!/usr/bin/env node
/**
 * Prints the 22:00 GST narration for one chapter.
 * Does not call Solana, Supabase, or a push service. Devnet copy only.
 * Usage: node season0/scripts/nightly-recap.mjs [chapter] [crowd line]
 */
import { buildRecap } from '../lib/recap.js';
import { DEVNET_RPC } from '../lib/config.js';

const chapter = Number(process.argv[2] || 1);
const crowdLine = process.argv[3] || null;
const nowMs = Date.now();
const recap = buildRecap({ chapter, nowMs, crowdLine });

process.stdout.write(JSON.stringify({
  job: 'nightly-recap',
  cluster: 'devnet',
  rpc: DEVNET_RPC,
  networkCalls: false,
  supabase: false,
  pushSent: false,
  narrationOnly: true,
  affectsScore: false,
  ...recap
}, null, 2) + '\n');
