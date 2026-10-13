/** Marker ping-pongs on [0, 1]. One sweep is a one-way pass. */
export function triangle(t) {
  let x = Number(t) % 2;
  if (x < 0) x += 2;
  return x <= 1 ? x : 2 - x;
}

export function markerAt({ phase, speed, elapsedSec }) {
  return triangle(Number(phase) + Number(speed) * Number(elapsedSec));
}

export function strikeAccuracy(distance) {
  const d = Math.abs(Number(distance));
  if (d <= 0.02) return 1;
  if (d >= 0.3) return 0;
  const a = 1 - (d - 0.02) / 0.28;
  return a * a;
}

export function strikePower(accuracy) {
  return Math.round(20 * Number(accuracy));
}

/**
 * Client reports milliseconds since the round started.
 * Server rejects a wall-clock disagreement over 1.5s, or a round over 10.5s.
 * No tap still counts as a Strike with accuracy 0.
 */
export function validateStrikeTiming({ clientElapsedMs, serverElapsedMs }) {
  const clientS = Number(clientElapsedMs) / 1000;
  const serverS = Number(serverElapsedMs) / 1000;
  if (!Number.isFinite(clientS) || clientS < 0 || clientS > 10.5) {
    return { ok: false, reason: 'duration' };
  }
  if (!Number.isFinite(serverS) || Math.abs(clientS - serverS) > 1.5) {
    return { ok: false, reason: 'skew' };
  }
  return { ok: true, elapsedSec: clientS };
}

export function scoreTap({ phase, speed, clientElapsedMs, serverElapsedMs, tapped }) {
  const timing = validateStrikeTiming({ clientElapsedMs, serverElapsedMs });
  if (!timing.ok) return timing;
  if (!tapped) {
    return { ok: true, accuracy: 0, power: 0, distance: null, noTap: true };
  }
  const x = markerAt({ phase, speed, elapsedSec: timing.elapsedSec });
  const distance = Math.abs(x - 0.5);
  const accuracy = strikeAccuracy(distance);
  return { ok: true, accuracy, power: strikePower(accuracy), distance, marker: x, noTap: false };
}
