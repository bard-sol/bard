export const DRAW_SLOT_OFFSET = 150;

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr32(x, n) { return (x >>> n) | (x << (32 - n)); }

export function sha256Hex(str) {
  const bytes = new TextEncoder().encode(String(str));
  const bitLen = bytes.length * 8;
  const withPad = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(withPad.length - 4, bitLen >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr32(w[j - 15], 7) ^ rotr32(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr32(w[j - 2], 17) ^ rotr32(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let k = 0; k < 64; k++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[k] + w[k]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  let hex = '';
  for (let n = 0; n < 8; n++) hex += ('00000000' + H[n].toString(16)).slice(-8);
  return hex;
}

export function decimalToRaw(value, decimals) {
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 18) throw new Error('Bad mint decimals');
  let s;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.floor(value) !== value) throw new Error('Fractional amounts must be decimal strings');
    s = String(value);
  } else {
    s = String(value == null ? '' : value).trim();
  }
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Bad amount');
  const parts = s.split('.');
  let frac = parts[1] || '';
  if (frac.length > d) throw new Error('Amount has more decimals than the mint');
  while (frac.length < d) frac += '0';
  return BigInt(d === 0 ? parts[0] : parts[0] + frac);
}

export function rawToDecimal(raw, decimals) {
  const d = Number(decimals);
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  let s = v.toString();
  if (d === 0) return (neg ? '-' : '') + s;
  while (s.length <= d) s = '0' + s;
  const whole = s.slice(0, s.length - d);
  const frac = s.slice(s.length - d).replace(/0+$/, '');
  return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
}

function scaledParts(value) {
  let s = String(value == null ? '0' : value).trim();
  const neg = s.charAt(0) === '-';
  if (neg) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Bad amount');
  const parts = s.split('.');
  const whole = parts[0].replace(/^0+(?=\d)/, '');
  const frac = parts[1] || '';
  return { neg, scale: frac.length, n: BigInt((whole + frac) || '0') };
}

function formatScaled(n, scale) {
  const neg = n < 0n;
  const v = neg ? -n : n;
  let s = v.toString();
  if (scale === 0) return (neg ? '-' : '') + s;
  while (s.length <= scale) s = '0' + s;
  const whole = s.slice(0, s.length - scale) || '0';
  const frac = s.slice(s.length - scale).replace(/0+$/, '');
  return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
}

function alignDecimals(a, b) {
  const A = scaledParts(a);
  const B = scaledParts(b);
  const scale = A.scale > B.scale ? A.scale : B.scale;
  let na = A.n * (10n ** BigInt(scale - A.scale));
  let nb = B.n * (10n ** BigInt(scale - B.scale));
  if (A.neg) na = -na;
  if (B.neg) nb = -nb;
  return { na, nb, scale };
}

export function subDecimal(a, b) {
  const x = alignDecimals(a, b);
  let n = x.na - x.nb;
  if (n < 0n) n = 0n;
  return formatScaled(n, x.scale);
}

function wholeNumber(value, fallback) {
  const s = String(value == null || value === '' ? fallback : value).trim();
  if (!/^\d+$/.test(s)) throw new Error('Expected a whole number');
  return BigInt(s);
}

export function canonicalPayoutText(payouts) {
  return (payouts || []).slice().sort((a, b) => {
    if (a.wallet < b.wallet) return -1;
    if (a.wallet > b.wallet) return 1;
    return 0;
  }).map((p) => String(p.wallet) + ':' + String(p.amountRaw)).join('\n');
}

export function payoutHash(payouts) {
  return sha256Hex(canonicalPayoutText(payouts));
}

export function planReservation(projectReserved, campaignReserved, addAmount, balanceRaw, decimals) {
  const addRaw = decimalToRaw(addAmount, decimals);
  if (addRaw <= 0n) throw new Error('Reserve amount must be greater than 0');
  const projRaw = decimalToRaw(projectReserved || 0, decimals);
  const campRaw = decimalToRaw(campaignReserved || 0, decimals);
  const balance = BigInt(String(balanceRaw));
  if (projRaw + addRaw > balance) throw new Error('Reservation exceeds vault token balance');
  return {
    projectReserved: rawToDecimal(projRaw + addRaw, decimals),
    campaignReserved: rawToDecimal(campRaw + addRaw, decimals),
    added: rawToDecimal(addRaw, decimals),
  };
}

function campaignConfig(campaign) {
  let cfg = campaign && campaign.config ? campaign.config : {};
  if (typeof cfg === 'string') {
    try { cfg = JSON.parse(cfg); } catch { cfg = {}; }
  }
  return cfg;
}

export function asCampaign(row) {
  const source = row || {};
  return {
    rewardMode: source.reward_mode || source.rewardMode || 'fixed',
    reward: source.reward,
    pool: source.pool_size != null ? source.pool_size : source.pool,
    vaultReserved: source.vault_reserved != null ? source.vault_reserved : source.vaultReserved,
    unit: source.reward_unit || source.unit || 'TOKEN',
    config: campaignConfig(source),
    createdAt: source.created_at || source.createdAt,
    drawSeed: source.draw_seed || source.drawSeed || null,
    drawWinners: source.draw_winners || source.drawWinners || null,
    drawSlot: source.draw_slot || source.drawSlot || null,
    drawSeedSlot: source.draw_seed_slot || source.drawSeedSlot || null,
    drawCount: source.draw_count != null ? source.draw_count : (source.drawCount != null ? source.drawCount : 0),
  };
}

function growingRaw(campaign, decimals) {
  const cfg = campaignConfig(campaign);
  const start = decimalToRaw(cfg.growStart != null && cfg.growStart !== '' ? cfg.growStart : (campaign && (campaign.pool || campaign.reward)) || 0, decimals);
  const add = decimalToRaw(cfg.growAdd || 0, decimals);
  const cap = cfg.growCap ? decimalToRaw(cfg.growCap, decimals) : 0n;
  const created = campaign && campaign.createdAt ? new Date(campaign.createdAt).getTime() : Date.now();
  const ms = cfg.growEvery === 'day' ? 86400000 : 7 * 86400000;
  const periods = BigInt(Math.max(0, Math.floor((Date.now() - created) / ms)));
  let now = start + add * periods;
  if (cap > 0n && now > cap) now = cap;
  return now;
}

function payoutRow(wallet, raw, decimals, progress) {
  return { wallet, amount: rawToDecimal(raw, decimals), amountRaw: raw.toString(), progress: progress || 0 };
}

export function payoutRawAmount(payout, decimals) {
  if (payout && payout.amountRaw != null && String(payout.amountRaw).trim() !== '') {
    const raw = String(payout.amountRaw).trim();
    if (!/^\d+$/.test(raw)) throw new Error('amountRaw must be an integer string');
    return BigInt(raw);
  }
  return decimalToRaw(payout && payout.amount, decimals);
}

export function computePayouts(campaign, joins, decimals) {
  const view = asCampaign(campaign);
  const d = decimals == null ? 0 : decimals;
  const rows = (joins || []).filter((j) => {
    if (j.status === 'rejected') return false;
    return !!(j.qualified || (j.status === 'approved' && (j.progress || 0) > 0));
  }).slice().sort((a, b) => {
    if (!!b.qualified !== !!a.qualified) return b.qualified ? 1 : -1;
    const progress = (b.progress || 0) - (a.progress || 0);
    if (progress) return progress;
    if (a.wallet < b.wallet) return -1;
    if (a.wallet > b.wallet) return 1;
    return 0;
  });
  if (!rows.length) throw new Error('No qualified or scored holders to pay');
  const rewardMode = view.rewardMode || 'fixed';
  const unit = view.unit || 'TOKEN';
  const poolSource = view.vaultReserved || view.pool || view.reward || 0;
  let payouts = [];
  if (rewardMode === 'fixed') {
    let fixedRaw = 0n;
    if (view.reward != null && String(view.reward).trim() !== '') fixedRaw = decimalToRaw(view.reward, d);
    if (fixedRaw <= 0n) {
      const poolRawFixed = decimalToRaw(poolSource || 0, d);
      if (poolRawFixed <= 0n) throw new Error('Set a reward amount or pool first');
      fixedRaw = poolRawFixed / BigInt(rows.length);
    }
    if (fixedRaw <= 0n) throw new Error('Set a reward amount or pool first');
    payouts = rows.map((j) => payoutRow(j.wallet, fixedRaw, d, j.progress));
  } else if (rewardMode === 'top3' || rewardMode === 'topn') {
    const poolRawTop = decimalToRaw(view.pool || view.vaultReserved || 0, d);
    if (poolRawTop <= 0n) throw new Error('Top N needs a pool size');
    const top = rows.slice(0, 3);
    const cfg = campaignConfig(view);
    const parts = [
      wholeNumber(cfg.top3First != null ? cfg.top3First : 50, 50),
      wholeNumber(cfg.top3Second != null ? cfg.top3Second : 30, 30),
      wholeNumber(cfg.top3Third != null ? cfg.top3Third : 20, 20),
    ];
    payouts = top.map((j, i) => payoutRow(j.wallet, poolRawTop * parts[i] / 100n, d, j.progress));
  } else if (rewardMode === 'growing') {
    const grow = growingRaw(view, d);
    if (grow <= 0n) throw new Error('Growing pool needs a starting size');
    payouts = [payoutRow(rows[0].wallet, grow, d, rows[0].progress)];
  } else {
    const poolRaw = decimalToRaw(view.pool || view.vaultReserved || view.reward || 0, d);
    if (poolRaw <= 0n) throw new Error('Shared pool needs a pool size');
    const each = poolRaw / BigInt(rows.length);
    const rem = poolRaw % BigInt(rows.length);
    payouts = rows.map((j, i) => payoutRow(j.wallet, each + (BigInt(i) < rem ? 1n : 0n), d, j.progress));
  }
  payouts = payouts.filter((x) => x.amountRaw !== '0' && x.wallet);
  const totalRaw = payouts.reduce((s, x) => s + BigInt(x.amountRaw), 0n);
  return { payouts, total: rawToDecimal(totalRaw, d), totalRaw: totalRaw.toString(), unit, hash: payoutHash(payouts) };
}

export function eligibleDrawRows(joins) {
  return (joins || []).filter((j) => j && j.status !== 'rejected' && (j.qualified || j.status === 'approved')).map((j) => ({
    wallet: String(j.wallet),
    x_handle: j.x_handle || null,
  })).sort((a, b) => {
    if (a.wallet < b.wallet) return -1;
    if (a.wallet > b.wallet) return 1;
    return 0;
  });
}

export function shuffleSeeded(list, seed) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const hex = sha256Hex(String(seed) + ':' + String(i));
    const j = parseInt(hex.slice(0, 8), 16) % (i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

export function deriveWinners(joins, seed, topN) {
  const rows = eligibleDrawRows(joins);
  const shuffled = shuffleSeeded(rows, seed);
  let n = parseInt(topN, 10);
  if (Number.isNaN(n) || n <= 0 || n > shuffled.length) n = shuffled.length;
  return shuffled.slice(0, n);
}

export function assertDrawStep(campaign, step) {
  const view = asCampaign(campaign);
  const winners = view.drawWinners;
  if ((winners && winners.length) || view.drawSeed) throw new Error('Draw already finalized');
  if (step === 'commit' && view.drawSlot) throw new Error('Draw slot already committed');
  if (step === 'finalize' && !view.drawSlot) throw new Error('Commit a future slot first');
  return view;
}

export function isSkippedSlot(err) {
  const msg = String(err && (err.message || err) || '');
  const code = Math.abs(Number(err && err.code));
  return /skipped/i.test(msg) || code === 32007 || code === 32009 || /32007/.test(msg) || /32009/.test(msg);
}

export async function findFinalizedBlockhash(readSlot, readBlock, committedSlot) {
  const current = Number(await readSlot());
  if (!(current >= Number(committedSlot))) throw new Error('Slot ' + committedSlot + ' is not final yet');
  for (let i = 0; i < 512; i++) {
    const target = Number(committedSlot) + i;
    try {
      const block = await readBlock(target);
      if (block && block.blockhash) return { slot: target, blockhash: block.blockhash };
    } catch (err) {
      if (isSkippedSlot(err)) continue;
      throw err;
    }
  }
  throw new Error('No block found at or after slot ' + committedSlot);
}

export function accountKeysOf(tx) {
  const keys = [];
  const message = tx && tx.transaction && tx.transaction.message;
  const raw = (message && (message.accountKeys || message.staticAccountKeys)) || [];
  for (const key of raw) {
    if (typeof key === 'string') keys.push(key);
    else if (key && key.pubkey) keys.push(key.pubkey);
  }
  const loaded = (tx && tx.meta && tx.meta.loadedAddresses) || {};
  for (const key of [...(loaded.writable || []), ...(loaded.readonly || [])]) keys.push(key);
  return keys;
}

export function parsedTransfers(tx) {
  const groups = [];
  const message = tx && tx.transaction && tx.transaction.message;
  if (message && Array.isArray(message.instructions)) groups.push(...message.instructions);
  const inner = (tx && tx.meta && tx.meta.innerInstructions) || [];
  for (const group of inner) {
    if (group && Array.isArray(group.instructions)) groups.push(...group.instructions);
  }
  const out = [];
  for (const ix of groups) {
    const parsed = ix && ix.parsed;
    if (!parsed || (parsed.type !== 'transferChecked' && parsed.type !== 'transfer') || !parsed.info) continue;
    const info = parsed.info;
    const amount = info.tokenAmount && info.tokenAmount.amount != null ? info.tokenAmount.amount : info.amount;
    out.push({
      source: info.source || '',
      destination: info.destination || '',
      mint: info.mint || '',
      authority: info.authority || '',
      amount: amount == null ? '' : String(amount),
    });
  }
  return out;
}
