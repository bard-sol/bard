/**
 * The moves a project team, Bard and holders make, shared by every scenario. Each move goes
 * through the same code a person would use: platform.js for anything the site does, the vault
 * builders in vault-src/src for anything a wallet signs, and the worker API underneath.
 */
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { createTwoOfTwo, createPayoutProposal, teamApprove, executePayout } from '../../src/index.js';
import { lockNeed } from '../../../server/money.js';
import { createActor, createWorld } from './world.mjs';
import { check, checkEqual, ok } from './harness.mjs';

export const LAMPORTS = 1_000_000_000n;

/** Build one simulated Bard for a scenario. */
export async function openSim(ctx, opts = {}) {
  const chain = await ctx.makeChain();
  const keys = await chain.teamKeys(ctx.rng);
  const world = await createWorld({
    chain,
    bardWallet: keys.bard.publicKey.toBase58(),
    cutBps: opts.cutBps,
    cutWallet: opts.cutWallet,
    scored: opts.scored,
    extraEnv: opts.extraEnv,
  });
  const sim = { ctx, chain, world, rng: ctx.rng, bard: keys.bard, defaultTeam: keys.team, actors: new Map(), keys: new Map() };
  if (chain.name === 'local') await chain.fundSol(keys.bard.publicKey, 2n * LAMPORTS);
  sim.bardActor = await actor(sim, keys.bard, 'bard');
  await sim.bardActor.signIn();
  return sim;
}

export async function closeSim(sim) {
  if (!sim) return;
  if (sim.chain.reclaim) {
    try { sim.ctx.note('reclaimedTokenAccounts', await sim.chain.reclaim(sim.keys)); } catch { /* rent only */ }
  }
  await sim.world.close();
  await sim.chain.close();
}

export async function actor(sim, keypair, label) {
  const a = await createActor(sim.world, keypair, label);
  sim.actors.set(label, a);
  sim.keys.set(a.wallet, keypair);
  return a;
}

/** A team: a wallet that signs in to Bard. On the local chain it gets 20 SOL; on devnet it is the rehearsal key. */
export async function makeTeam(sim, label) {
  const keypair = sim.chain.name === 'devnet' && label === 'team' ? sim.defaultTeam : Keypair.fromSeed(sim.rng.seedBytes('team:' + label));
  if (sim.chain.name === 'local') await sim.chain.fundSol(keypair.publicKey, 20n * LAMPORTS);
  const team = await actor(sim, keypair, label);
  await team.signIn();
  return team;
}

/** Holders: seeded wallets that sign in. They never need SOL; the team pays any chain fees for them. */
export async function makeHolders(sim, count, prefix = 'holder') {
  const out = [];
  for (let i = 0; i < count; i++) {
    const label = prefix + '-' + String(i + 1).padStart(2, '0');
    const keypair = Keypair.fromSeed(sim.rng.seedBytes(label));
    const holder = await actor(sim, keypair, label);
    await holder.signIn();
    out.push(holder);
  }
  return out;
}

/**
 * A project with its token and a funded 2-of-2 vault, linked on Bard.
 * opts: name, ticker, decimals, depositRaw (tokens put in the vault), extraRaw (kept by the team)
 */
export async function launchProject(sim, team, opts) {
  const { chain, world } = sim;
  const decimals = opts.decimals;
  const mintKeypair = Keypair.fromSeed(sim.rng.seedBytes('mint:' + team.label + ':' + opts.ticker + (chain.keySalt ? ':' + chain.keySalt : '')));
  const mint = await chain.createMint(team.keypair, mintKeypair, decimals);
  await chain.mintTo(team.keypair, mint, team.wallet, opts.depositRaw + (opts.extraRaw || 0n));
  const created = await createTwoOfTwo(chain.connection, team.keypair, team.wallet, sim.bard.publicKey.toBase58());
  const vaultSol = chain.name === 'devnet' ? 15_000_000n : LAMPORTS / 10n;
  await sendSol(sim, team.keypair, created.vault, vaultSol);
  if (opts.depositRaw > 0n) {
    await chain.transferTokens(team.keypair, team.keypair, mint, created.vault, opts.depositRaw, decimals);
  }
  const project = await team.platform.createProject({ name: opts.name, ticker: opts.ticker, mint });
  check(project && project.id, 'project was not created');
  const linked = await team.platform.updateProjectVault(project.id, { address: created.vault, multisig: created.multisig, mint });
  checkEqual(linked.vaultStatus, 'linked', 'vault status');
  const rows = ok(await world.rest('GET', '/projects?id=eq.' + project.id + '&select=*'), 'read project');
  return { project: rows[0], id: project.id, mint, decimals, multisig: created.multisig, vault: created.vault, team, ticker: opts.ticker };
}

export async function sendSol(sim, from, to, lamports) {
  const conn = sim.chain.connection;
  const block = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: from.publicKey, recentBlockhash: block.blockhash }).add(
    SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: new PublicKey(to), lamports: Number(lamports) })
  );
  tx.sign(from);
  const sig = await conn.sendRawTransaction(tx.serialize());
  if (sim.chain.name === 'devnet') {
    await conn.confirmTransaction({ signature: sig, blockhash: block.blockhash, lastValidBlockHeight: block.lastValidBlockHeight }, 'confirmed');
  }
  return sig;
}

/** The team mints `raw` tokens to each holder (a holder buying the token). */
export async function giveTokens(sim, project, holders, rawFor) {
  for (const holder of holders) {
    const raw = typeof rawFor === 'function' ? rawFor(holder) : rawFor;
    if (raw > 0n) await sim.chain.mintTo(project.team.keypair, project.mint, holder.wallet, raw);
  }
}

/** What the campaign builder posts; returns the stored campaign row. */
export async function createCampaign(sim, project, input) {
  const made = await project.team.platform.createCampaign(project.id, input);
  check(made && made.id, 'campaign was not created');
  const rows = ok(await sim.world.rest('GET', '/campaigns?id=eq.' + made.id + '&select=*'), 'read campaign');
  return rows[0];
}

export function expectedLock(prizeRaw, cutBps) {
  return lockNeed(BigInt(prizeRaw), BigInt(cutBps));
}

/** Every holder joins through platform.js, the way campaign.html calls it. */
export async function joinAll(project, campaign, holders, opts = {}) {
  const out = [];
  for (const holder of holders) {
    const evidence = opts.evidence ? opts.evidence(holder) : null;
    const referrer = opts.referrer ? opts.referrer(holder) : null;
    out.push(await holder.platform.joinCampaign(project.id, campaign.id, holder.wallet, null, false, evidence, referrer, null));
  }
  return out;
}

export async function joinRows(sim, campaignId) {
  return ok(await sim.world.rest('GET', '/campaign_joins?campaign_id=eq.' + campaignId + '&select=*&order=wallet.asc'), 'read joins');
}

export async function publicState(sim, campaignId) {
  return ok(await sim.world.api('GET', '/api/campaigns/' + campaignId + '/state'), 'public state');
}

/** Move a campaign's start back so it has run for `days` (and its clock has ended if it had a length). */
export async function ageCampaign(sim, campaignId, days) {
  await sim.world.sql("UPDATE public.campaigns SET created_at = created_at - make_interval(secs => $1) WHERE id = $2", [days * 86400, campaignId]);
}

/**
 * Close and pay a campaign the way the team and Bard do it:
 * team proposes on Bard, builds and approves the vault transaction with its wallet, records it;
 * Bard approves with its signer and records it; the team executes and records the signature.
 */
export async function settle(sim, project, campaignId, opts = {}) {
  const team = project.team;
  const settlement = await team.platform.proposeSettlement(project.id, campaignId);
  check(settlement && settlement.id, 'no settlement was proposed');
  if (opts.afterPropose) await opts.afterPropose(settlement);
  const cut = settlement.cut_waived === true || !settlement.cut_wallet || BigInt(settlement.cut_raw || 0) === 0n
    ? null
    : { wallet: settlement.cut_wallet, amountRaw: String(settlement.cut_raw) };
  const proposal = await createPayoutProposal(sim.chain.connection, team.keypair, team.wallet, project.multisig, project.mint, settlement.payouts, cut);
  const teamSig = await teamApprove(sim.chain.connection, team.keypair, team.wallet, project.multisig, proposal.transactionIndex);
  const teamSigned = await team.platform.signSettlement(settlement.id, 'team', { sig: teamSig, txIndex: proposal.transactionIndex });
  check(teamSigned.team_signed === true, 'team signature was not recorded');
  if (opts.afterTeamSign) await opts.afterTeamSign(settlement, proposal);
  await teamApprove(sim.chain.connection, sim.bard, sim.bard.publicKey.toBase58(), project.multisig, proposal.transactionIndex);
  const bardSigned = await sim.bardActor.platform.signSettlement(settlement.id, 'bard', { txIndex: proposal.transactionIndex });
  check(bardSigned.bard_signed === true, 'Bard signature was not recorded');
  checkEqual(bardSigned.status, 'both_signed', 'status after both signatures');
  if (opts.afterBothSigned) await opts.afterBothSigned(settlement, proposal);
  const before = await balances(sim, project, settlement);
  const signature = await executePayout(sim.chain.connection, team.keypair, team.wallet, project.multisig, proposal.transactionIndex);
  const executed = await team.platform.executeSettlement(settlement.id, signature, project.id);
  checkEqual(executed.status, 'executed', 'settlement status');
  const after = await balances(sim, project, settlement);
  for (const payout of settlement.payouts) {
    checkEqual((after.get(payout.wallet) - before.get(payout.wallet)).toString(), String(payout.amountRaw), 'paid to ' + payout.wallet);
  }
  if (cut) {
    checkEqual((after.get(cut.wallet) - before.get(cut.wallet)).toString(), cut.amountRaw, 'cut paid to the cut wallet');
  }
  return { settlement, executed, signature, txIndex: proposal.transactionIndex };
}

async function balances(sim, project, settlement) {
  const map = new Map();
  const wallets = settlement.payouts.map((p) => p.wallet);
  if (settlement.cut_wallet) wallets.push(settlement.cut_wallet);
  for (const wallet of wallets) map.set(wallet, await sim.chain.tokenBalance(wallet, project.mint));
  return map;
}

export function vaultAta(project) {
  return getAssociatedTokenAddressSync(new PublicKey(project.mint), new PublicKey(project.vault), true, TOKEN_PROGRAM_ID).toBase58();
}

/** Human amount text for raw units, for step details. */
export function human(raw, decimals) {
  const s = BigInt(raw).toString().padStart(decimals + 1, '0');
  if (!decimals) return s;
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? whole + '.' + frac : whole;
}

export function labelOf(sim, wallet) {
  for (const [label, a] of sim.actors) if (a.wallet === wallet) return label;
  return wallet;
}
