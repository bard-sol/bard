/** How long an unjoined friend lobby stays in Durable Object storage. */
export const LOBBY_TTL_MS = 30 * 60 * 1000;

/** How long a match record stays after it is created. Bounds Durable Object storage. */
export const MATCH_TTL_MS = 24 * 60 * 60 * 1000;

export function lobbyDeadline(createdAt: string): number {
  return Date.parse(createdAt) + LOBBY_TTL_MS;
}

export function matchDeadline(createdAt: string): number {
  return Date.parse(createdAt) + MATCH_TTL_MS;
}

/** Earliest future wake among a turn clock and the storage deadlines. */
export function nextWake(times: Array<number | null>, now: number): number | null {
  let soonest: number | null = null;
  for (const time of times) {
    if (time == null || !Number.isFinite(time)) continue;
    if (soonest == null || time < soonest) soonest = time;
  }
  if (soonest == null) return null;
  return soonest < now ? now : soonest;
}
