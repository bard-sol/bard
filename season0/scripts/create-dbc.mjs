#!/usr/bin/env node
/**
 * Create the Season 0 devnet DBC config and the eight character pools.
 * Refuses any RPC that is not devnet. Does not run unless you execute it.
 *
 *   node season0/scripts/create-dbc.mjs --dry-run
 *   node season0/scripts/create-dbc.mjs --generate --metadata-base https://example.dev/season0/meta
 *
 * Fee claimer defaults to the payer. Pass --fee-claimer <pubkey> for the devnet Squads vault.
 * Public addresses can be written with --write-public. Secrets stay in season0/.keys/.
 */
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { Keypair, PublicKey } from '@solana/web3.js';
import { DynamicBondingCurveClient } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { PROGRAMS } from '../lib/config.js';
import { CHARACTER_POOLS } from '../lib/dbc.js';
import { buildSeasonCurve } from '../lib/dbc-curve.js';
import { devnetConnection, assertThisIsDevnet, loadOrCreateKeypair } from './devnet-guard.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

if (args.includes('--dry-run')) {
  const curve = buildSeasonCurve();
  process.stdout.write(JSON.stringify({
    cluster: 'devnet',
    rpc: 'https://api.devnet.solana.com',
    quoteMint: PROGRAMS.wsol,
    collectFeeMode: curve.collectFeeMode,
    migrationOption: curve.migrationOption,
    migrationFeeOption: curve.migrationFeeOption,
    partnerPermanentLockedLiquidityPercentage: curve.partnerPermanentLockedLiquidityPercentage,
    creatorTradingFeePercentage: curve.creatorTradingFeePercentage,
    tokenDecimal: curve.tokenDecimal,
    tokenUpdateAuthority: curve.tokenUpdateAuthority,
    migrationQuoteThresholdLamports: curve.migrationQuoteThreshold.toString(),
    migratedPoolFeeBps: curve.migratedPoolFee.poolFeeBps,
    pools: CHARACTER_POOLS.map((c) => c.symbol),
    note: 'Dry run only. No transaction was sent.'
  }, null, 2) + '\n');
  process.exit(0);
}

const connection = devnetConnection();
const genesis = await assertThisIsDevnet(connection);
const payer = loadOrCreateKeypair(resolve(process.cwd(), 'season0/.keys/payer.json'), args.includes('--generate'));
const feeClaimerArg = flag('--fee-claimer');
const feeClaimer = feeClaimerArg ? new PublicKey(feeClaimerArg) : payer.publicKey;
const metadataBase = (flag('--metadata-base') || 'https://bard.is/season0/meta').replace(/\/$/, '');
const client = new DynamicBondingCurveClient(connection, 'confirmed');
const curve = buildSeasonCurve();
const configKp = Keypair.generate();

async function send(tx, signers) {
  const latest = await connection.getLatestBlockhash('confirmed');
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(...signers);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
  return signature;
}

const configTx = await client.partner.createConfig({
  config: configKp.publicKey,
  feeClaimer,
  leftoverReceiver: feeClaimer,
  quoteMint: new PublicKey(PROGRAMS.wsol),
  payer: payer.publicKey,
  ...curve
});
const configSig = await send(configTx, [payer, configKp]);
const pools = [];
for (const character of CHARACTER_POOLS) {
  const mint = Keypair.generate();
  const poolTx = await client.pool.createPool({
    name: character.name,
    symbol: character.symbol,
    uri: metadataBase + '/' + character.id + '.json',
    payer: payer.publicKey,
    poolCreator: payer.publicKey,
    config: configKp.publicKey,
    baseMint: mint.publicKey
  });
  const signature = await send(poolTx, [payer, mint]);
  pools.push({
    id: character.id,
    symbol: character.symbol,
    mint: mint.publicKey.toBase58(),
    signature
  });
  process.stdout.write(JSON.stringify({ created: character.symbol, signature }) + '\n');
}

const result = {
  cluster: 'devnet',
  genesis,
  config: configKp.publicKey.toBase58(),
  configSignature: configSig,
  feeClaimer: feeClaimer.toBase58(),
  pools
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (args.includes('--write-public')) {
  const file = resolve(process.cwd(), 'season0/devnet.public.json');
  const current = JSON.parse(readFileSync(file, 'utf8'));
  current.feeClaimer = result.feeClaimer;
  current.dbcConfig = result.config;
  current.pools = Object.fromEntries(pools.map((p) => [p.id, { mint: p.mint, symbol: p.symbol }]));
  writeFileSync(file, JSON.stringify(current, null, 2) + '\n');
}
