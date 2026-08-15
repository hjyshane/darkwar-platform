import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from './supabase';
import { useSession } from './useSession';

/** Recording what a member did, and reading the score it adds up to (0114).
 *
 * Four things score: signing in, and opening each of the three ranking boards.
 * All four are capped at one a day by the primary key on `activity_events`, so
 * this file does not try to remember what it has already sent — it fires on
 * every visit and lets the database refuse the repeats. That is the same
 * bargain `useMarkRead` makes with `post_reads`, and it is what keeps the
 * client honest across two tabs, a reload and a second device.
 *
 * COMMENTS ARE NOT RECORDED HERE. They are counted from `post_comments` by the
 * score view, so that deleting one takes its points with it.
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

export interface ActivityScore {
  userId: string;
  /** The commenter's character, or null when we cannot name them — the table
   * prints a dash rather than calling anybody unknown (0113). */
  displayName: string | null;
  weekStart: string;
  loginDays: number;
  serverDays: number;
  allianceDays: number;
  playerDays: number;
  commentCount: number;
  loginPoints: number;
  rankingPoints: number;
  commentPoints: number;
  totalPoints: number;
}

/** This week's scores, highest first.
 *
 * Who appears is decided by the database, not here: `activity_scores` is
 * `security_invoker`, so a member reading it sees only their own row and
 * somebody with `members.manage` sees the whole alliance. The admin screen
 * does not have to ask.
 */
export function useActivityScores() {
  return useQuery({
    queryKey: ['activity-scores'],
    queryFn: async (): Promise<ActivityScore[]> => {
      const { data, error } = await supabase
        .from('activity_scores')
        .select(
          'user_id, display_name, week_start, login_days, server_days, alliance_days, player_days, comment_count, login_points, ranking_points, comment_points, total_points',
        )
        .order('total_points', { ascending: false });
      if (error) {
        throw new Error(`activity scores query failed: ${error.message}`);
      }
      return (data ?? []).map((row) => ({
        userId: String(row.user_id),
        displayName: (row.display_name as string | null) ?? null,
        weekStart: String(row.week_start ?? ''),
        loginDays: Number(row.login_days ?? 0),
        serverDays: Number(row.server_days ?? 0),
        allianceDays: Number(row.alliance_days ?? 0),
        playerDays: Number(row.player_days ?? 0),
        commentCount: Number(row.comment_count ?? 0),
        loginPoints: Number(row.login_points ?? 0),
        rankingPoints: Number(row.ranking_points ?? 0),
        commentPoints: Number(row.comment_points ?? 0),
        totalPoints: Number(row.total_points ?? 0),
      }));
    },
  });
}
