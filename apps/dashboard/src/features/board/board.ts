import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAGE_SIZE, pageOf } from '../../lib/pagination';
import { supabase } from '../../lib/supabase';

/** The two boards, in the one place that knows they are the same shape.
 *
 * Guides and notices differ in three ways and no more: which table they live in,
 * whether a post has a category or a visibility, and which column says it is
 * live (`published_at` vs a start/end window). Everything else — the list, the
 * pager, the read marks, the author names, the reader — is identical, so it is
 * written once and configured rather than copied and left to drift.
 */
export interface BoardPost {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  /** When the alliance could first see it. Null for a guide still in draft. */
  liveAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  /** The category for a guide, the visibility for a notice. One label either
   * way, because the list has one column for it. */
  tag: string | null;
}

export interface BoardConfig {
  /** The table, and the read-mark column that points at it. */
  table: 'guides' | 'announcements';
  readColumn: 'guide_id' | 'announcement_id';
}

export const GUIDES: BoardConfig = { table: 'guides', readColumn: 'guide_id' };
export const NOTICES: BoardConfig = { table: 'announcements', readColumn: 'announcement_id' };

const GUIDE_COLUMNS =
  'guide_id, title, body, category, pinned, published_at, created_at, updated_at, created_by';
const NOTICE_COLUMNS =
  'announcement_id, title, body, visibility, pinned, starts_at, ends_at, created_at, updated_at, created_by';

/** One row, whichever table it came from. */
function toPost(config: BoardConfig, row: Record<string, unknown>): BoardPost {
  const isGuide = config.table === 'guides';
  return {
    id: String(isGuide ? row.guide_id : row.announcement_id),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    pinned: row.pinned === true,
    // A notice has no publish step: it is live from `starts_at`, or from the
    // moment it was written when that is null. Mapping both to one field is what
    // lets the list template stay single.
    liveAt: isGuide
      ? ((row.published_at as string | null) ?? null)
      : ((row.starts_at as string | null) ?? (row.created_at as string | null) ?? null),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    createdBy: (row.created_by as string | null) ?? null,
    tag: String((isGuide ? row.category : row.visibility) ?? '') || null,
  };
}

export interface BoardPage {
  posts: BoardPost[];
  pinned: BoardPost[];
  total: number;
  page: number;
  pageCount: number;
  authors: Record<string, string>;
  read: Set<string>;
}

/** One page of a board, with its pinned posts, author names and read marks.
 *
 * The count comes from PostgREST's `Prefer: count=exact` rather than from
 * fetching everything and measuring it — the point of a pager is not to download
 * the whole board.
 */
export function useBoard(config: BoardConfig, page: number) {
  return useQuery({
    queryKey: ['board', config.table, page],
    queryFn: async (): Promise<BoardPage> => {
      const columns = config.table === 'guides' ? GUIDE_COLUMNS : NOTICE_COLUMNS;
      // Pinned first, then newest. Asked for as a separate query rather than
      // sorted into the same page: a pinned post has to stay visible on page 3,
      // and sorting it to the top of page 1 only pins it for people who never
      // turn a page.
      const pinnedResult = await supabase
        .from(config.table)
        .select(columns)
        .eq('pinned', true)
        .order('created_at', { ascending: false })
        .limit(10);
      if (pinnedResult.error) {
        throw new Error(`${config.table} pinned query failed: ${pinnedResult.error.message}`);
      }

      const counted = await supabase
        .from(config.table)
        .select(columns, { count: 'exact' })
        .eq('pinned', false)
        .order('created_at', { ascending: false })
        .range(0, 0);
      if (counted.error) {
        throw new Error(`${config.table} count failed: ${counted.error.message}`);
      }
      const total = counted.count ?? 0;
      const window = pageOf(total, page, PAGE_SIZE);

      const rows = await supabase
        .from(config.table)
        .select(columns)
        .eq('pinned', false)
        .order('created_at', { ascending: false })
        .range(window.from, window.to);
      if (rows.error) {
        throw new Error(`${config.table} query failed: ${rows.error.message}`);
      }

      const posts = (rows.data ?? []).map((row) =>
        toPost(config, row as unknown as Record<string, unknown>),
      );
      const pinned = (pinnedResult.data ?? []).map((row) =>
        toPost(config, row as unknown as Record<string, unknown>),
      );

      // Author names and read marks for what is on screen, not for the board.
      // Empty results are the ordinary case for a signed-out reader and for a
      // board whose posts all predate 0079.
      const authors = await supabase.from('post_authors').select('user_id, display_name');
      const reads = await supabase.from('post_reads').select(config.readColumn);

      return {
        posts,
        pinned,
        total,
        page: window.page,
        pageCount: window.pageCount,
        authors: Object.fromEntries(
          (authors.data ?? []).map((row) => [row.user_id, row.display_name]),
        ),
        read: new Set(
          (reads.data ?? [])
            .map((row) => (row as Record<string, string | null>)[config.readColumn])
            .filter((value): value is string => value !== null),
        ),
      };
    },
  });
}

/** Mark a post read, once.
 *
 * `ignore-duplicates` rather than a check-then-insert: opening the same post
 * twice is normal, and the unique index is the thing that decides. A 409 handled
 * as an error would put a red message on screen for having read something twice.
 */
export function useMarkRead(config: BoardConfig) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (postId: string) => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (userId === undefined) {
        return;
      }
      // Written out per board rather than with a computed key: `post_reads` has
      // a column per board and a check that exactly one is set, and a computed
      // key erases that from the types — the compiler could no longer tell a
      // typo from a column.
      const reads = supabase.from('post_reads');
      await (config.readColumn === 'guide_id'
        ? reads.upsert({ user_id: userId, guide_id: postId }, { ignoreDuplicates: true })
        : reads.upsert({ user_id: userId, announcement_id: postId }, { ignoreDuplicates: true }));
    },
    // Not awaited by the reader: the mark is a side effect of opening the post,
    // and a failed one must not stop the post being shown.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['board', config.table] });
    },
  });
}
