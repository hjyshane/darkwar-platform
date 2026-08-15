import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { BoardConfig } from './board';

/** Comments on a post, for both boards.
 *
 * Configured off the same `BoardConfig` the list and the read marks use, for
 * the reason board.ts gives: guides and notices differ in which table they
 * live in and nothing else that a comment can see. `readColumn` already names
 * the discriminator (`guide_id` / `announcement_id`) and `post_comments`
 * carries exactly those two columns, so there is nothing new to configure.
 *
 * REPLIES ARE ONE LEVEL DEEP and that is settled in the database (0113), not
 * here. This file assumes it rather than enforcing it: a reply's parent always
 * has `parentId === null`, so grouping is one pass and there is no recursion
 * to bound.
 */
export interface BoardComment {
  id: string;
  parentId: string | null;
  /** The commenter's account. Null once they have left the alliance — the
   * comment stays, the byline goes (0113, following 0094). */
  authorId: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  /** Set means removed. The row survives so replies keep their parent. */
  deletedAt: string | null;
}

export interface CommentThread {
  comment: BoardComment;
  replies: BoardComment[];
}

export interface CommentsPage {
  threads: CommentThread[];
  /** Author uuid to their character's name. Absent means we cannot name them —
   * an account with no character linked, or one that has left. The board
   * prints a dash; see the renderer for why not "Unknown". */
  authors: Record<string, string>;
  /** Who is reading, so the page can offer edit and remove on their own
   * comments. Null when signed out. */
  viewerId: string | null;
  /** How many comments are actually on screen, for the heading. Deleted ones
   * are not comments any more even when their tombstone is holding up a
   * reply. */
  liveCount: number;
}

/** One line, not concatenated. The supabase-js type parser reads this string
 * literally and a `+` between two halves breaks it — twice bitten already
 * (0102, 0107). */
const COMMENT_COLUMNS =
  'comment_id, parent_comment_id, author_user_id, body, created_at, updated_at, deleted_at';

function toComment(row: Record<string, unknown>): BoardComment {
  return {
    id: String(row.comment_id),
    parentId: (row.parent_comment_id as string | null) ?? null,
    authorId: (row.author_user_id as string | null) ?? null,
    body: String(row.body ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    deletedAt: (row.deleted_at as string | null) ?? null,
  };
}

/** Group a flat list into top-level comments and their replies.
 *
 * A DELETED COMMENT IS ONLY KEPT WHEN IT IS HOLDING SOMETHING UP. That is the
 * whole justification for the soft delete: a reply must not lose its parent,
 * and a thread with a hole in the middle reads as a rendering fault. A deleted
 * comment with no replies is holding nothing up, so it goes — leaving a
 * tombstone there would just be litter. Deleted replies always go, since
 * nothing hangs off them.
 */
export function groupComments(rows: readonly BoardComment[]): CommentThread[] {
  const tops = rows.filter((row) => row.parentId === null);
  const repliesByParent = new Map<string, BoardComment[]>();
  for (const row of rows) {
    if (row.parentId === null || row.deletedAt !== null) {
      continue;
    }
    const existing = repliesByParent.get(row.parentId);
    if (existing === undefined) {
      repliesByParent.set(row.parentId, [row]);
    } else {
      existing.push(row);
    }
  }
  const threads: CommentThread[] = [];
  for (const comment of tops) {
    const replies = repliesByParent.get(comment.id) ?? [];
    if (comment.deletedAt !== null && replies.length === 0) {
      continue;
    }
    threads.push({ comment, replies });
  }
  return threads;
}

export function commentsKey(config: BoardConfig, postId: string): readonly string[] {
  return ['comments', config.table, postId];
}

/** Every comment on one post, oldest first.
 *
 * Oldest first, unlike the board itself. A board is a list of separate things
 * and the newest matters most; a thread is a conversation and reading it
 * backwards makes the replies arrive before what they answer.
 *
 * The whole thread in one request rather than a pager. A post's comments are
 * bounded by how many people are in the alliance, and paging them would mean a
 * reply could land on a different page from its parent.
 */
export function useComments(config: BoardConfig, postId: string) {
  return useQuery({
    queryKey: commentsKey(config, postId),
    queryFn: async (): Promise<CommentsPage> => {
      // Both go out together: neither depends on the other, and a round trip
      // across an ocean is the budget (0102).
      const [rows, authors, auth] = await Promise.all([
        supabase
          .from('post_comments')
          .select(COMMENT_COLUMNS)
          .eq(config.readColumn, postId)
          .order('created_at', { ascending: true }),
        supabase.from('post_authors').select('user_id, display_name'),
        supabase.auth.getUser(),
      ]);
      if (rows.error) {
        throw new Error(`comments query failed: ${rows.error.message}`);
      }

      const comments = (rows.data ?? []).map((row) =>
        toComment(row as unknown as Record<string, unknown>),
      );
      return {
        threads: groupComments(comments),
        authors: Object.fromEntries(
          (authors.data ?? [])
            // Null is 0113's "we genuinely cannot name this person". Dropped
            // here so the renderer has one absence to handle rather than two.
            .filter((row) => row.display_name !== null)
            .map((row) => [row.user_id, row.display_name as string]),
        ),
        viewerId: auth.data.user?.id ?? null,
        liveCount: comments.filter((comment) => comment.deletedAt === null).length,
      };
    },
  });
}

/** Write one, or reply to one.
 *
 * `author_user_id` is NOT sent. 0113's actor trigger sets it from `auth.uid()`
 * and pins it on update — an author field the author can write is not an
 * author field (0033's rule, fourth time).
 */
export function useAddComment(config: BoardConfig, postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, parentId }: { body: string; parentId: string | null }) => {
      // Spelled out per board rather than with a computed key, the way
      // `useMarkRead` is and for the same reason: `post_comments` has a column
      // per board with a check that exactly one is set, and a computed key
      // erases that from the types so the compiler can no longer tell a typo
      // from a column.
      //
      // The CALL is duplicated, not the row object. Building the row in a
      // ternary first infers `guide_id?: undefined` on the notice branch and
      // the insert types reject the union — which is the type checker being
      // right, since "the guide id is present and undefined" is not a state
      // the exactly-one check allows.
      const comments = supabase.from('post_comments');
      const { error } = await (config.readColumn === 'guide_id'
        ? comments.insert({ guide_id: postId, body, parent_comment_id: parentId })
        : comments.insert({ announcement_id: postId, body, parent_comment_id: parentId }));
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: commentsKey(config, postId) });
    },
  });
}

export function useEditComment(config: BoardConfig, postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const { error } = await supabase.from('post_comments').update({ body }).eq('comment_id', id);
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: commentsKey(config, postId) });
    },
  });
}

/** Remove one — which is an UPDATE, not a DELETE.
 *
 * `authenticated` holds no DELETE grant on the table at all (0113), so this is
 * the only way a comment goes away and the soft-delete rule cannot be walked
 * around from here.
 */
export function useRemoveComment(config: BoardConfig, postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('post_comments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('comment_id', id);
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: commentsKey(config, postId) });
    },
  });
}
