/**
 * Read-only dump of the Squads v4 program and ProgramConfig from public
 * devnet. Cached under .litesvm-cache (gitignored).
 */
import { Connection, PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEVNET_RPC } from '../src/rpc-guard.js';

export const SQUADS_PROGRAM_ID = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
export const SQUADS_PROGRAMDATA = 'Fy3YMJCvwbAXUgUM5b91ucUVA3jYzwWLHL3MwBqKsh8n';
const PROGRAMDATA_HEADER = 45;

const cacheDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.litesvm-cache');

function soPath() {
  return path.join(cacheDir, 'squads-v4.so');
}
function configPath() {
  return path.join(cacheDir, 'program-config.json');
}

export function cacheDirPath() {
  return cacheDir;
}

function encodeAccount(info, address) {
  return {
    address: String(address),
    lamports: info.lamports,
    owner: info.owner.toBase58(),
    executable: !!info.executable,
    dataBase64: Buffer.from(info.data).toString('base64'),
  };
}

export function decodeAccount(saved) {
  return {
    address: saved.address,
    lamports: BigInt(saved.lamports),
    programAddress: saved.owner,
    executable: !!saved.executable,
    data: Uint8Array.from(Buffer.from(saved.dataBase64, 'base64')),
  };
}

async function dumpFromDevnet() {
  var connection = new Connection(DEVNET_RPC, 'confirmed');
  var programdata = await connection.getAccountInfo(new PublicKey(SQUADS_PROGRAMDATA), 'confirmed');
  if (!programdata) throw new Error('Squads programdata missing on devnet');
  var elf = Buffer.from(programdata.data).subarray(PROGRAMDATA_HEADER);
  if (elf.subarray(0, 4).toString('hex') !== '7f454c46') {
    throw new Error('Squads programdata did not start with ELF after the 45-byte header');
  }
  var configPda = multisig.getProgramConfigPda({})[0];
  var configInfo = await connection.getAccountInfo(configPda, 'confirmed');
  if (!configInfo) throw new Error('Squads ProgramConfig missing on devnet');
  var config = await multisig.accounts.ProgramConfig.fromAccountAddress(connection, configPda);
  var treasuryInfo = await connection.getAccountInfo(config.treasury, 'confirmed');
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(soPath(), elf);
  writeFileSync(configPath(), JSON.stringify({
    programId: SQUADS_PROGRAM_ID,
    programConfig: encodeAccount(configInfo, configPda.toBase58()),
    treasury: treasuryInfo
      ? encodeAccount(treasuryInfo, config.treasury.toBase58())
      : { address: config.treasury.toBase58(), lamports: 1_000_000_000, owner: '11111111111111111111111111111111', executable: false, dataBase64: '' },
    treasuryAddress: config.treasury.toBase58(),
    creationFee: config.multisigCreationFee.toString(),
  }, null, 2));
}

export async function loadSquadsCache() {
  if (!existsSync(soPath()) || !existsSync(configPath())) {
    console.log('dumping Squads v4 from', DEVNET_RPC);
    await dumpFromDevnet();
  }
  var elf = readFileSync(soPath());
  if (elf.subarray(0, 4).toString('hex') !== '7f454c46') {
    throw new Error('Cached Squads .so is not an ELF');
  }
  var meta = JSON.parse(readFileSync(configPath(), 'utf8'));
  return {
    elf: new Uint8Array(elf),
    programId: meta.programId || SQUADS_PROGRAM_ID,
    programConfig: decodeAccount(meta.programConfig),
    treasury: decodeAccount(meta.treasury),
  };
}
