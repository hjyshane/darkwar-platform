// What the alliance Overview shows, as plain functions so the rules can be
// checked without a screen.

export interface OverviewMember {
  playerId: string | null;
  name: string | null;
  gameUid: number;
  power: number | null;
  hqLevel: number | null;
}

/** The strongest `limit` members by power. A member with no power read sorts last
 * and is left out rather than shown as zero: no reading is not a weak player. */
export function strongest<T extends { power: number | null; gameUid: number }>(
  members: readonly T[],
  limit: number,
): T[] {
  return members
    .filter((member) => member.power !== null)
    .sort((a, b) => (b.power ?? 0) - (a.power ?? 0) || a.gameUid - b.gameUid)
    .slice(0, limit);
}

/** Departures last seen as a member within `days` of `now`.
 *
 * Unconfirmed ones stay in: a short roster capture looks exactly like somebody
 * leaving (0067), so the screen marks them instead of hiding what may be real. */
export function recentDepartures<T extends { last_seen_in_alliance_at: string }>(
  rows: readonly T[],
  now: Date,
  days: number,
): T[] {
  const since = now.getTime() - days * 24 * 60 * 60 * 1000;
  return rows.filter((row) => Date.parse(row.last_seen_in_alliance_at) >= since);
}
