#!/usr/bin/env node
/**
 * Pre-fund the Season 0 devnet SOL drip wallet.
 * Refuses any RPC that is not devnet. Never calls mainnet.
 *
 *   node season0/scripts/prefund-drip.mjs --generate --sol 10
 *
 * The secret key is written to season0/.keys/drip.json (gitignored).
 * Put that key in the worker as BARD_DRIP_SECRET. Do not commit it.
 */
import { resolve } from 'node:path';
import { devnetConnection, assertThisIsDevnet, loadOrCreateKeypair } from './devnet-guard.mjs';

const args = process.argv.slice(2);
const generate = args.includes('--generate');
const solFlag = args.indexOf('--sol');
const targetSol = solFlag === -1 ? 10 : Number(args[solFlag + 1]);
if (!Number.isFinite(targetSol) || targetSol <= 0 || targetSol > 20) {
  throw new Error('Refusing target outside 0–20 devnet SOL');
}

const file = resolve(process.cwd(), 'season0/.keys/drip.json');
const drip = loadOrCreateKeypair(file, generate);
const connection = devnetConnection();
const genesis = await assertThisIsDevnet(connection);
const target = BigInt(Math.round(targetSol * 1e9));
let balance = BigInt(await connection.getBalance(drip.publicKey));
process.stdout.write(JSON.stringify({
  cluster: 'devnet',
  genesis,
  drip: drip.publicKey.toBase58(),
  balanceSol: Number(balance) / 1e9,
  targetSol
}) + '\n');

let hops = 0;
while (balance < target) {
  if (hops++ > 25) throw new Error('Devnet airdrop did not reach the target. Try again later.');
  const sig = await connection.requestAirdrop(drip.publicKey, 1_000_000_000);
  await connection.confirmTransaction(sig, 'confirmed');
  balance = BigInt(await connection.getBalance(drip.publicKey));
  process.stdout.write(JSON.stringify({ airdrop: sig, balanceSol: Number(balance) / 1e9 }) + '\n');
}
process.stdout.write('Drip wallet is funded on devnet. Nothing was sent to mainnet.\n');
