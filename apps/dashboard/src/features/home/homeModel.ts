// Home (2026-11-18): the pure half. What each card says, decided from plain
// rows so every rule can be tested without a query. Clocks are SERVER TIME
// (UTC-2), the one members read in game.

import { DUEL, type Theme, serverNow, themesOf } from '../eventGuide/guide';

/** Today's Alliance Duel theme, or null on Sunday (no Duel) or when the
 * collector has not read today's theme yet. */
export function todaysDuel(
  themes: readonly Theme[],
  now: Date,
): { day: number; name: string } | null {
  const { weekday } = serverNow(now);
  if (weekday === 7) return null;
  const theme = themesOf(themes, DUEL).find((t) => t.day === weekday);
  return theme?.name ? { day: weekday, name: theme.name } : null;
}

/** My row in the alliance's newest Black Gold signup reading, as a line.
 * `state` 1 starter, 2 substitute; `team_index` 1 = A, 2 = B (0178). Null row:
 * not on the newest reading at all. */
export function blackGoldLine(
  row: { team_index: number | null; state: number | null } | null,
  readAt: string | null,
): string {
  if (readAt === null) return 'No Black Gold signup list has been read yet.';
  if (row === null || row.team_index === null || (row.state !== 1 && row.state !== 2)) {
    return 'You are not on a team in the latest signup list.';
  }
  const team = row.team_index === 1 ? 'Team A' : row.team_index === 2 ? 'Team B' : 'a team';
  return `You are on ${team}, ${row.state === 1 ? 'starter' : 'substitute'}.`;
}

export interface TimedEntry {
  title: string;
  startsAt: string;
}

/** The next Black Gold time for a team from the alliance's captured times
 * ("Black Gold · Team A"), or the next of either when the team is unknown. */
export function nextBlackGold(
  entries: readonly TimedEntry[],
  teamIndex: number | null,
  now: Date,
): TimedEntry | null {
  const wanted = teamIndex === 1 ? 'team a' : teamIndex === 2 ? 'team b' : null;
  const upcoming = entries
    .filter((e) => /black gold/i.test(e.title))
    .filter((e) => wanted === null || e.title.toLowerCase().includes(wanted))
    .filter((e) => new Date(e.startsAt).getTime() >= now.getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return upcoming[0] ?? null;
}
