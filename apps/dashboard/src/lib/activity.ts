import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from './supabase';
import { useSession } from './useSession';

/** Recording what a member did, and totalling it over a range (0114, 0118).
 *
 * Four things score: signing in, and opening each of the three ranking boards.
 * All four are capped at one a day by the primary key on `activity_events`, so
 * this file does not try to remember what it has already sent — it fires on
 * every visit and lets the database refuse the repeats. That is the same
 * bargain `useMarkRead` makes with `post_reads`, and it is what keeps the
 * client honest across two tabs, a reload and a second device.
 *
 * COMMENTS ARE NOT RECORDED HERE. They are counted from `post_comments` by the
 * daily view, so that deleting one takes its points with it.
 */
export type ActivityKind = 'login' | 'rank_server' | 'rank_alliance' | 'rank_player';

/** Fire-and-forget: the member came to read a ranking, not to be told their
 * score could not be written.
 *
 * A duplicate is the ORDINARY case — the second visit of the day and every
 * visit after it — so a 409 is success as far as this is concerned. Anything
 * else is swallowed too: the alternative is an error banner on a board that
 * loaded perfectly, over a number nobody is looking at yet.
 */
async function record(kind: ActivityKind, userId: string): Promise<void> {
  await supabase.from('activity_events').insert({ user_id: userId, kind });
}

/** Record one activity when the screen opens.
 *
 * Keyed on the user id rather than on the session object, which is a new
 * object on every refetch and would re-fire the insert each time the query
 * settled — the same trap `BoardPostPage` documents for its read mark.
 *
 * A viewer records nothing: the insert policy refuses them, and sending a
 * request per page open that is always refused is noise in the log.
 */
export function useRecordActivity(kind: ActivityKind): void {
  const { data: session } = useSession();
  const userId = session?.userId ?? null;
  const scores = session?.role !== 'viewer';
  useEffect(() => {
    if (userId !== null && scores) {
      void record(kind, userId);
    }
  }, [kind, userId, scores]);
}

/** A day of one member's activity, straight from `activity_daily`. */
export interface ActivityDay {
  userId: string;
  /** `YYYY-MM-DD`, on the 02:00 clock the game week uses. */
  day: string;
  loginDays: number;
  serverDays: number;
  allianceDays: number;
  playerDays: number;
  commentCount: number;
  points: number;
}

/** One member's total over whatever range was asked for. */
export interface ActivityTotal {
  userId: string;
  /** Their character, or null when we cannot name them — the table prints a
   * dash rather than calling anybody unknown (0113). */
  displayName: string | null;
  loginDays: number;
  serverDays: number;
  allianceDays: number;
  playerDays: number;
  commentCount: number;
  totalPoints: number;
}

/** An inclusive range of activity days, or all of time.
 *
 * Null on either end means "no bound that side", which is how the default —
 * everything — is expressed without a magic date. Dates are the plain
 * `YYYY-MM-DD` the view emits, not timestamps: the 02:00 boundary is already
 * baked into `day` by `activity_day_of`, so comparing dates here cannot
 * reintroduce a timezone question.
 */
export interface ActivityRange {
  from: string | null;
  to: string | null;
}

export const ALL_TIME: ActivityRange = { from: null, to: null };

/** Every member's score over a range, highest first.
 *
 * TWO QUERIES, JOINED HERE, and the second one is not optional: `activity_daily`
 * has no row for somebody who has done nothing, and those are exactly the
 * members this screen exists to find. `activity_members` is the name list they
 * come from.
 *
 * Who appears is decided by the database, not here — both views are
 * `security_invoker`, so a member reading them sees only themselves and
 * somebody with `members.manage` sees the alliance.
 */
export function useActivityTotals(range: ActivityRange) {
  return useQuery({
    queryKey: ['activity-scores', range.from, range.to],
    queryFn: async (): Promise<ActivityTotal[]> => {
      let daily = supabase
        .from('activity_daily')
        .select(
          'user_id, day, login_days, server_days, alliance_days, player_days, comment_count, points',
        );
      // Applied as bounds rather than as a single `between`, so either end can
      // be left open — "since the first of the month" is a range too.
      if (range.from !== null) {
        daily = daily.gte('day', range.from);
      }
      if (range.to !== null) {
        daily = daily.lte('day', range.to);
      }

      const [days, members] = await Promise.all([
        daily,
        supabase.from('activity_members').select('user_id, display_name'),
      ]);
      if (days.error) {
        throw new Error(`activity query failed: ${days.error.message}`);
      }
      if (members.error) {
        throw new Error(`activity members query failed: ${members.error.message}`);
      }

      return totalsFor(
        (members.data ?? []).map((row) => ({
          userId: String(row.user_id),
          displayName: (row.display_name as string | null) ?? null,
        })),
        (days.data ?? []).map((row) => ({
          userId: String(row.user_id),
          day: String(row.day),
          loginDays: Number(row.login_days ?? 0),
          serverDays: Number(row.server_days ?? 0),
          allianceDays: Number(row.alliance_days ?? 0),
          playerDays: Number(row.player_days ?? 0),
          commentCount: Number(row.comment_count ?? 0),
          points: Number(row.points ?? 0),
        })),
      );
    },
  });
}

/** Sum the days onto the members, strongest first.
 *
 * Exported for its own test. The arithmetic is trivial and the part worth
 * pinning is what happens at the edges: a member with no days still gets a
 * row of zeroes (the screen is for finding them), and a day belonging to
 * somebody not in the member list is dropped rather than inventing a row —
 * that is what a viewer's old activity looks like after a demotion.
 */
export function totalsFor(
  members: ReadonlyArray<{ userId: string; displayName: string | null }>,
  days: readonly ActivityDay[],
): ActivityTotal[] {
  const byUser = new Map<string, ActivityTotal>(
    members.map((member) => [
      member.userId,
      {
        userId: member.userId,
        displayName: member.displayName,
        loginDays: 0,
        serverDays: 0,
        allianceDays: 0,
        playerDays: 0,
        commentCount: 0,
        totalPoints: 0,
      },
    ]),
  );
  for (const day of days) {
    const total = byUser.get(day.userId);
    if (total === undefined) {
      continue;
    }
    total.loginDays += day.loginDays;
    total.serverDays += day.serverDays;
    total.allianceDays += day.allianceDays;
    total.playerDays += day.playerDays;
    total.commentCount += day.commentCount;
    total.totalPoints += day.points;
  }
  return [...byUser.values()].sort((a, b) => b.totalPoints - a.totalPoints);
}
