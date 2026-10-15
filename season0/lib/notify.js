/** Web push is capped at 3 sends per wallet per UTC day. */

export function allowPush({ sent, cap }) {
  const limit = cap == null ? 3 : cap;
  const used = Number(sent) || 0;
  if (used >= limit) return { ok: false, reason: 'cap', sent: used, remaining: 0 };
  return { ok: true, sent: used + 1, remaining: limit - used - 1 };
}
