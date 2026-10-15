/** Credit a parsed spend only when the split, mint, signer, destinations and memo all match. */

function amountOf(value) {
  return BigInt(value);
}

export function matchSpend(instructions, expected) {
  const ixs = instructions || [];
  const memos = ixs.filter((ix) => ix.type === 'memo').map((ix) => ix.text);
  if (!memos.includes(expected.memo)) return { ok: false, reason: 'memo' };
  const mint = expected.mint;
  const wallet = expected.wallet;

  if (expected.kind === 'revive') {
    const burn = ixs.find((ix) => ix.type === 'burn' && ix.mint === mint && ix.authority === wallet && amountOf(ix.amount) === amountOf(expected.amount));
    if (!burn) return { ok: false, reason: 'burn' };
    return { ok: true, credit: amountOf(expected.amount).toString(), kind: 'revive' };
  }

  if (expected.kind === 'stake') {
    const transfer = ixs.find((ix) => ix.type === 'transfer' && ix.mint === mint && ix.authority === wallet && ix.destination === expected.escrow && amountOf(ix.amount) === amountOf(expected.amount));
    if (!transfer) return { ok: false, reason: 'stake' };
    return { ok: true, credit: amountOf(expected.amount).toString(), kind: 'stake' };
  }

  const burn = ixs.find((ix) => ix.type === 'burn' && ix.mint === mint && ix.authority === wallet && amountOf(ix.amount) === amountOf(expected.burn));
  const liq = ixs.find((ix) => ix.type === 'transfer' && ix.mint === mint && ix.authority === wallet && ix.destination === expected.liqDestination && amountOf(ix.amount) === amountOf(expected.liqAmount));
  const pot = ixs.find((ix) => ix.type === 'transfer' && ix.mint === mint && ix.authority === wallet && ix.destination === expected.potDestination && amountOf(ix.amount) === amountOf(expected.potAmount));
  if (!burn || !liq || !pot) return { ok: false, reason: 'split' };
  return { ok: true, credit: (amountOf(expected.burn) + amountOf(expected.liqAmount) + amountOf(expected.potAmount)).toString(), kind: 'train' };
}

/** Pull burn, transfer and memo instructions out of a jsonParsed transaction. */
export function instructionsFromParsed(tx) {
  const out = [];
  const lists = [];
  if (tx && tx.transaction && tx.transaction.message) lists.push(tx.transaction.message.instructions || []);
  const inner = (tx && tx.meta && tx.meta.innerInstructions) || [];
  for (const group of inner) lists.push(group.instructions || []);
  for (const list of lists) {
    for (const ix of list) {
      if (ix.program === 'spl-memo' || (ix.parsed && ix.programId && String(ix.programId).startsWith('Memo'))) {
        out.push({ type: 'memo', text: typeof ix.parsed === 'string' ? ix.parsed : (ix.parsed && ix.parsed) || '' });
      }
      const parsed = ix.parsed;
      if (!parsed || !parsed.type) continue;
      if (parsed.type === 'burn' || parsed.type === 'burnChecked') {
        const info = parsed.info || {};
        out.push({ type: 'burn', mint: info.mint, authority: info.authority || info.owner, amount: info.amount || (info.tokenAmount && info.tokenAmount.amount) });
      }
      if (parsed.type === 'transfer' || parsed.type === 'transferChecked') {
        const info = parsed.info || {};
        out.push({
          type: 'transfer',
          mint: info.mint,
          authority: info.authority || info.owner || info.multisigAuthority,
          destination: info.destination,
          amount: info.amount || (info.tokenAmount && info.tokenAmount.amount)
        });
      }
    }
  }
  const logs = (tx && tx.meta && tx.meta.logMessages) || [];
  for (const line of logs) {
    const memo = String(line).match(/Memo \(len \d+\): "([^"]*)"/);
    if (memo) out.push({ type: 'memo', text: memo[1] });
  }
  return out;
}
