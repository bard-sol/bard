import { Connection, Keypair } from '@solana/web3.js';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEVNET_RPC } from '../lib/config.js';
import { assertDevnetEndpoint, assertDevnetGenesis } from '../lib/cluster.js';

export function devnetConnection() {
  const endpoint = assertDevnetEndpoint(process.env.SOLANA_RPC || DEVNET_RPC);
  return new Connection(endpoint, 'confirmed');
}

export async function assertThisIsDevnet(connection) {
  const genesis = await connection.getGenesisHash();
  assertDevnetGenesis(genesis);
  return genesis;
}

export function loadOrCreateKeypair(file, generate) {
  if (!existsSync(file)) {
    if (!generate) {
      throw new Error('Missing ' + file + '. Re-run with --generate. The secret stays in season0/.keys and is gitignored.');
    }
    mkdirSync(dirname(file), { recursive: true });
    const kp = Keypair.generate();
    writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
    process.stderr.write('Wrote gitignored devnet key ' + kp.publicKey.toBase58() + ' to ' + file + '\n');
    return kp;
  }
  const secret = Uint8Array.from(JSON.parse(readFileSync(file, 'utf8')));
  return Keypair.fromSecretKey(secret);
}
