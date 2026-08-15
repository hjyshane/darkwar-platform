import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

/** "Somebody answered you" (0117).
 *
 * The rows are written by a trigger on `post_comments`, so nothing here has to
 * know who the parent's author was — which is just as well, since RLS may hide
 * that from the person replying. This file only reads them and marks them
 * read.
 */
export interface ReplyAlert {
  notificationId: string;
  commentId: string;
  createdAt: string;
  /** Where the reply lives, so the banner can link to the post rather than
   * just announcing that something happened somewhere. */
  board: 'guide' | 'notice';
  postId: string;
  /** Who answered, by their character. Null when we cannot name them. */
  authorName: string | null;
}

export function replyAlertsKey(): readonly string[] {
  return ['reply-alerts'];
}

/** Unread replies to your comments, newest first.
 *
 * The comment is embedded rather than fetched separately: PostgREST can follow
 * the foreign key in one request, and the banner needs the reply's post to
 * link anywhere useful. `post_authors` is a second request because it is a
 * view keyed on the author, not a relationship PostgREST can traverse.
 */
export function useReplyAlerts() {
  return useQuery({
    queryKey: replyAlertsKey(),
    queryFn: async (): Promise<ReplyAlert[]> => {
      // One line, not concatenated — the supabase-js type parser reads this
      // literally and a `+` between two halves breaks it (0102, 0107).
      const [rows, authors] = await Promise.all([
        supabase
          .from('comment_notifications')
          .select(
            'notification_id, comment_id, created_at, post_comments(guide_id, announcement_id, author_user_id)',
          )
          .is('read_at', null)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase.from('post_authors').select('user_id, display_name'),
      ]);
      if (rows.error) {
        throw new Error(`reply alerts query failed: ${rows.error.message}`);
      }

      const names = new Map(
        (authors.data ?? [])
          .filter((row) => row.display_name !== null)
          .map((row) => [String(row.user_id), row.display_name as string]),
      );

      return (rows.data ?? []).flatMap((row) => {
        const record = row as unknown as Record<string, unknown>;
        const comment = record.post_comments as Record<string, unknown> | null;
        // The reply is gone (the post was deleted) but the cascade has not
        // caught up, or RLS hides it. Either way there is nothing to open, and
        // a banner that leads nowhere is worse than no banner.
        if (comment == null) {
          return [];
        }
        const guideId = (comment.guide_id as string | null) ?? null;
        const announcementId = (comment.announcement_id as string | null) ?? null;
        const postId = guideId ?? announcementId;
        if (postId === null) {
          return [];
        }
        const authorId = (comment.author_user_id as string | null) ?? null;
        return [
          {
            notificationId: String(record.notification_id),
            commentId: String(record.comment_id),
            createdAt: String(record.created_at ?? ''),
            board: guideId !== null ? ('guide' as const) : ('notice' as const),
            postId,
            authorName: authorId === null ? null : (names.get(authorId) ?? null),
          },
        ];
      });
    },
  });
}

/** Mark alerts read.
 *
 * Takes a list rather than one id so "dismiss all" is one request. Marking one
 * is the same call with one element — there is no second code path to keep in
 * step.
 */
export function useMarkAlertsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (notificationIds: readonly string[]) => {
      if (notificationIds.length === 0) {
        return;
      }
      const { error } = await supabase
        .from('comment_notifications')
        .update({ read_at: new Date().toISOString() })
        .in('notification_id', [...notificationIds]);
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: replyAlertsKey() });
    },
  });
}
