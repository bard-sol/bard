/** Whole-token integer splits. Base units are applied by the transaction builder. */

export function splitTrain(tokens) {
  const x = Number(tokens);
  if (!Number.isInteger(x)) throw new Error('spend must be an integer number of tBard');
  if (x <= 0) throw new Error('spend must be positive');
  const burn = Math.floor(x * 0.5);
  const liq = Math.floor(x * 0.3);
  const pot = x - burn - liq;
  return { burn, liq, pot, total: x };
}

export function toBaseUnits(tokens, decimals) {
  const d = decimals == null ? 6 : decimals;
  if (!Number.isInteger(tokens)) throw new Error('integer tokens');
  return BigInt(tokens) * 10n ** BigInt(d);
}

export function actionMemo({ action, charId, chapter, nonce }) {
  if (!action || !charId || chapter == null || !nonce) throw new Error('incomplete memo');
  return 'bard:v1:' + action + ':' + charId + ':' + chapter + ':' + nonce;
}

export function stateMemo(season, chapter, hash) {
  return 'bard:v1:state:' + season + ':' + chapter + ':' + hash;
}

export function revivalTarget(trainCredited, config) {
  const factor = config && config.revival_factor != null ? config.revival_factor : 0.35;
  const min = config && config.revival_min_target != null ? config.revival_min_target : 5000;
  const max = config && config.revival_max_target != null ? config.revival_max_target : 60000;
  const raw = factor * Math.max(0, Number(trainCredited) || 0);
  return Math.min(max, Math.max(min, raw));
}

export function trainCredit(paid, { discounted }) {
  const x = Number(paid);
  if (!Number.isInteger(x) || x <= 0) throw new Error('bad train amount');
  return discounted ? x * 1.5 : x;
}

export function stakeMemo({ charId, chapter, nonce }) {
  return actionMemo({ action: 'stake', charId, chapter, nonce });
}
