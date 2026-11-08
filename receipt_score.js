// Pure checks for the public receipt. The page hashes body.inputs itself
// (canonicalJson + sha256Hex) and compares that with each settlement score_hash.
// It does not trust the score_hash field on the score response.

export function hashScoreInputs(inputs, canonicalJson, sha256Hex) {
  if (typeof canonicalJson !== 'function' || typeof sha256Hex !== 'function') {
    throw new Error('score hash needs canonicalJson and sha256Hex');
  }
  return sha256Hex(canonicalJson(inputs));
}

function hashVerdict(settlement, inputHash) {
  if (!settlement || !settlement.score_hash) return '';
  if (inputHash === settlement.score_hash) return 'score inputs match';
  return 'locked score hash does not match the current inputs';
}

export function settlementScoreLine(settlement, inputHash) {
  const item = settlement || {};
  const base = (item.status || 'settlement') + ' · payout ' + (item.payout_hash || '') + ' · score ' + (item.score_hash || '');
  const verdict = hashVerdict(item, inputHash);
  return verdict ? base + ' · ' + verdict : base;
}

export function recomputeScoreNote(body, again, inputHash) {
  const results = Array.isArray(body && body.results) ? body.results : [];
  const scored = Array.isArray(again && again.results) ? again.results : [];
  const bad = [];
  for (const row of results) {
    const found = scored.find((item) => item && row && item.wallet === row.wallet);
    if (!found || found.score_milli !== row.score_milli) bad.push((row && (row.handle || row.wallet)) || '—');
  }
  const hashBad = [];
  const settlements = Array.isArray(body && body.settlements) ? body.settlements : [];
  for (const item of settlements) {
    if (!item || !item.score_hash) continue;
    if (inputHash !== item.score_hash) hashBad.push((item.status || 'settlement') + ' ' + (item.id || ''));
  }
  if (!bad.length && !hashBad.length) return 'all ' + results.length + ' scores match';
  const parts = [];
  if (bad.length) parts.push('mismatch ' + bad.join(', '));
  for (const name of hashBad) parts.push(name.trim() + ' locked score hash does not match the current inputs');
  return parts.join('; ');
}

if (typeof window !== 'undefined') {
  window.BardReceiptScore = {
    hashScoreInputs,
    settlementScoreLine,
    recomputeScoreNote,
  };
}
