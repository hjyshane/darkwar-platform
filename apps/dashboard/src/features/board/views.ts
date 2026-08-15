import { useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import type { BoardConfig } from './board';

/** How many times a post has been opened (0119).
 *
 * Counts OPENS, not people. `post_reads` already knows who has read what and
 * is deliberately private — 0079 refused to answer "who has read my notice" —
 * so nothing here touches it: re-opening a post you have already read counts
 * again, exactly as a stranger's first visit does.
 */
export interface ViewStat {
  total: number;
  /** The last seven days, which is what "hot" is scored on. A single running
   * total cannot be windowed after the fact, which is why the table keeps a
   * row per day. */
  recent: number;
}

/** Record that this post was opened.
 *
 * Fire-and-forget through an RPC rather than a table write: the increment is
 * an upsert-and-add, which a client would have to do in two round trips with a
 * race in the middle, and the function refuses viewers and drafts where the
 * caller cannot skip it.
 *
 * Keyed on the post id alone, so it fires once per post opened rather than on
 * every refetch — the same shape `BoardPostPage` uses for its read mark, and
 * for the same reason.
 */
export function useRecordView(config: BoardConfig, postId: string): void {
  const isGuide = config.readColumn === 'guide_id';
  useEffect(() => {
    void supabase.rpc('record_post_view', {
      p_guide_id: isGuide ? postId : undefined,
      p_announcement_id: isGuide ? undefined : postId,
    });
  }, [isGuide, postId]);
}

/** Which posts get a tag, and which one gets "top".
 *
 * TWO TAGS BECAUSE THEY ANSWER TWO QUESTIONS. "Top" is the most-read post on
 * the board, all time — a standing recommendation that changes rarely. "Hot"
 * is about the last seven days, so it decays: a post that stops being talked
 * about loses it, which is the entire difference between a busy thread and a
 * famous one.
 *
 * Hot is scored on readers AND comments, weighted so that a comment counts for
 * more than an open. Somebody replying is a stronger signal that a post is
 * live than somebody glancing at it, and views are the easier number to run up.
 *
 * The threshold is deliberately a floor rather than a ranking: on a board this
 * size "the busiest post" is often busy by one view, and a tag that always
 * appears somewhere says nothing.
 */
const HOT_FLOOR = 5;

export function hotPostIds(
  views: Record<string, ViewStat>,
  commentCounts: Record<string, number>,
  postIds: readonly string[],
): Set<string> {
  const hot = new Set<string>();
  for (const id of postIds) {
    const score = (views[id]?.recent ?? 0) + (commentCounts[id] ?? 0) * 3;
    if (score >= HOT_FLOOR) {
      hot.add(id);
    }
  }
  return hot;
}

/** The single most-read post, or null when nothing has been read at all.
 *
 * One post, not a set: "top" that lands on four entries is a decoration. Ties
 * go to the first in board order rather than showing both — the board is
 * newest-first, so that is the more recent of two equals.
 */
export function topPostId(
  views: Record<string, ViewStat>,
  postIds: readonly string[],
): string | null {
  let best: string | null = null;
  let bestViews = 0;
  for (const id of postIds) {
    const total = views[id]?.total ?? 0;
    if (total > bestViews) {
      best = id;
      bestViews = total;
    }
  }
  return best;
}
