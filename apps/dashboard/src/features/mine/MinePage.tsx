import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { RichTitle } from '../../components/RichText';
import { guideHash, noticeHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../lib/useSession';

/** What you wrote, and what you kept.
 *
 * Its own page rather than a tenth top-level tab: the main nav is alliance
 * data and already wraps on a phone, while this is one member's own things.
 * Three lists in one place, because they answer the same question — "where was
 * that thing of mine".
 *
 * NOTHING HERE IS A NEW PERMISSION. Posts come back through the boards' own
 * policies, comments through 0113's, scraps through 0022's; a member who could
 * not read one of these elsewhere cannot read it here either. What this page
 * adds is `created_by = me`, which is a filter, not a gate.
 */
const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

type Tab = 'posts' | 'comments' | 'scraps';

interface MinePost {
  id: string;
  board: 'guide' | 'notice';
  title: string;
  at: string;
  draft: boolean;
}

interface MineComment {
  id: string;
  board: 'guide' | 'notice';
  postId: string;
  body: string;
  at: string;
}

function hashFor(board: 'guide' | 'notice', postId: string): string {
  return board === 'guide' ? guideHash(postId) : noticeHash(postId);
}

/** Posts, comments and scraps for the signed-in member.
 *
 * One hook and one query key for all three, because the page shows them as
 * tabs over a single answer — switching tabs is not a reason to go back to the
 * database, and the three lists together are smaller than one page of the
 * roster.
 */
function useMine(userId: string | null) {
  return useQuery({
    enabled: userId !== null,
    queryKey: ['mine', userId],
    queryFn: async () => {
      const [guides, notices, comments, scrapGuides, scrapNotices] = await Promise.all([
        supabase
          .from('guides')
          .select('guide_id, title, created_at, published_at')
          .eq('created_by', userId ?? '')
          .order('created_at', { ascending: false }),
        supabase
          .from('announcements')
          .select('announcement_id, title, created_at, published_at')
          .eq('created_by', userId ?? '')
          .order('created_at', { ascending: false }),
        // Own comments, deleted ones excluded: this is "what I said", and a
        // list of your own tombstones is not that.
        supabase
          .from('post_comments')
          .select('comment_id, guide_id, announcement_id, body, created_at')
          .eq('author_user_id', userId ?? '')
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
        supabase
          .from('favourites')
          .select('guide_id, guides(title, published_at)')
          .not('guide_id', 'is', null),
        supabase
          .from('favourites')
          .select('announcement_id, announcements(title, published_at)')
          .not('announcement_id', 'is', null),
      ]);

      const posts: MinePost[] = [
        ...(guides.data ?? []).map((row) => ({
          id: String(row.guide_id),
          board: 'guide' as const,
          title: String(row.title ?? ''),
          at: String(row.created_at ?? ''),
          draft: row.published_at === null,
        })),
        ...(notices.data ?? []).map((row) => ({
          id: String(row.announcement_id),
          board: 'notice' as const,
          title: String(row.title ?? ''),
          at: String(row.created_at ?? ''),
          draft: row.published_at === null,
        })),
      ].sort((a, b) => b.at.localeCompare(a.at));

      const mineComments: MineComment[] = (comments.data ?? []).flatMap((row) => {
        const guideId = (row.guide_id as string | null) ?? null;
        const announcementId = (row.announcement_id as string | null) ?? null;
        const postId = guideId ?? announcementId;
        if (postId === null) {
          return [];
        }
        return [
          {
            id: String(row.comment_id),
            board: guideId !== null ? ('guide' as const) : ('notice' as const),
            postId,
            body: String(row.body ?? ''),
            at: String(row.created_at ?? ''),
          },
        ];
      });

      const scraps: MinePost[] = [
        ...(scrapGuides.data ?? []).flatMap((row) => {
          const post = row.guides as { title?: string; published_at?: string | null } | null;
          if (row.guide_id === null || post == null) {
            return [];
          }
          return [
            {
              id: String(row.guide_id),
              board: 'guide' as const,
              title: String(post.title ?? ''),
              at: '',
              draft: (post.published_at ?? null) === null,
            },
          ];
        }),
        ...(scrapNotices.data ?? []).flatMap((row) => {
          const post = row.announcements as { title?: string; published_at?: string | null } | null;
          if (row.announcement_id === null || post == null) {
            return [];
          }
          return [
            {
              id: String(row.announcement_id),
              board: 'notice' as const,
              title: String(post.title ?? ''),
              at: '',
              draft: (post.published_at ?? null) === null,
            },
          ];
        }),
      ];

      return { posts, comments: mineComments, scraps };
    },
  });
}

export function MinePage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<Tab>('posts');
  const { data, error, isPending } = useMine(session?.userId ?? null);

  if (session?.userId == null) {
    return (
      <main>
        <p className="empty">
          <a href="#/login">Sign in</a> to see what you have written.
        </p>
      </main>
    );
  }

  return (
    <main>
      <section aria-labelledby="mine-heading">
        <h2 id="mine-heading">Mine</h2>
        {/* The same tab markup the settings groups use, so the selected state
            cannot drift between the two bars. */}
        <nav aria-label="My things" className="tabs subtabs">
          {(
            [
              ['posts', 'Posts'],
              ['comments', 'Comments'],
              ['scraps', 'Scraps'],
            ] as ReadonlyArray<[Tab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              aria-current={tab === id ? 'page' : undefined}
              className="tab"
              onClick={() => setTab(id)}
              type="button"
            >
              {label}
              {data !== undefined && ` (${data[id].length})`}
            </button>
          ))}
        </nav>
      </section>

      {isPending && <p className="empty">Loading…</p>}
      {error && <p className="error">Could not load it: {error.message}</p>}

      {data !== undefined && tab === 'posts' && (
        <ul className="board-list">
          {data.posts.length === 0 && <p className="empty">You have not written a post yet.</p>}
          {data.posts.map((post) => (
            <li key={`${post.board}-${post.id}`}>
              <a href={hashFor(post.board, post.id)}>
                <RichTitle title={post.title} />
              </a>
              {post.draft && <span className="badge badge-missing">draft</span>}
              <div className="post-meta">
                <span className="post-tag">{post.board === 'guide' ? 'guide' : 'notice'}</span>
                <time dateTime={post.at}>{day.format(new Date(post.at))}</time>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data !== undefined && tab === 'comments' && (
        <ul className="board-list">
          {data.comments.length === 0 && <p className="empty">You have not commented yet.</p>}
          {data.comments.map((comment) => (
            <li key={comment.id}>
              {/* The comment itself is the link text. On this page the reader
                  is looking for something they said, not for the post it was
                  under — the board chip and the date place it. */}
              <a href={hashFor(comment.board, comment.postId)}>{comment.body}</a>
              <div className="post-meta">
                <span className="post-tag">{comment.board === 'guide' ? 'guide' : 'notice'}</span>
                <time dateTime={comment.at}>{day.format(new Date(comment.at))}</time>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data !== undefined && tab === 'scraps' && (
        <ul className="board-list">
          {data.scraps.length === 0 && <p className="empty">You have not scrapped anything yet.</p>}
          {data.scraps.map((post) => (
            <li key={`${post.board}-${post.id}`}>
              <a href={hashFor(post.board, post.id)}>
                <RichTitle title={post.title} />
              </a>
              {post.draft && <span className="badge badge-missing">draft</span>}
              <div className="post-meta">
                <span className="post-tag">{post.board === 'guide' ? 'guide' : 'notice'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
