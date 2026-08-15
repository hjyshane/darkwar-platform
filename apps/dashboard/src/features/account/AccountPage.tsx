import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { RichTitle } from '../../components/RichText';
import { guideHash, noticeHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../lib/useSession';
import { LeaveAllianceForm } from '../auth/LeaveAllianceForm';
import { FavouritesBlock } from '../overview/FavouritesBlock';
import { PlayerPage } from '../player/PlayerPage';

/** Everything that is yours: what you wrote, what you kept, who you are.
 *
 * Its own page rather than a top-level nav tab. The nav is alliance data and
 * already wraps on a phone; this is one member's own shelf, so it sits beside
 * "Signed in as…" in the header where the other account controls are.
 *
 * NOTHING HERE IS A NEW PERMISSION. Posts come back through the boards' own
 * policies, comments through 0113's, favourites and scraps through 0022's, and
 * leaving through `leave_alliance()` (0094). What this page adds is
 * `created_by = me`, which is a filter rather than a gate.
 */
const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

type Tab = 'posts' | 'comments' | 'favourites' | 'scraps' | 'player' | 'leave';

const TABS: ReadonlyArray<[Tab, string]> = [
  ['posts', 'Posts'],
  ['comments', 'Comments'],
  ['favourites', 'Favourites'],
  ['scraps', 'Scraps'],
  ['player', 'My character'],
  // Last, and deliberately far from the rest: it is the one thing here that
  // cannot be undone by clicking again.
  ['leave', 'Leave'],
];

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

/** Posts, comments and scraps for the signed-in member, plus which character
 * they are.
 *
 * One hook and one query key for all of it, because the page shows them as
 * tabs over a single answer — switching tabs is not a reason to go back to the
 * database, and the whole lot is smaller than one page of the roster.
 */
function useMine(userId: string | null) {
  return useQuery({
    enabled: userId !== null,
    queryKey: ['mine', userId],
    queryFn: async () => {
      const [guides, notices, comments, scrapGuides, scrapNotices, account] = await Promise.all([
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
        // Which character this account is. A member may read their own
        // app_users row (0006), so this needs no new view.
        supabase
          .from('app_users')
          .select('player_id')
          .eq('user_id', userId ?? '')
          .maybeSingle(),
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

      return {
        posts,
        comments: mineComments,
        scraps,
        playerId: (account.data?.player_id as string | null) ?? null,
      };
    },
  });
}

/** The tab bar, kept outside `<main>`.
 *
 * The character tab renders `PlayerPage`, which brings its own `<main>` — two
 * of those in one document is invalid, and nesting them is worse. So the nav
 * sits above whatever the tab renders rather than inside it.
 */
function AccountTabs({
  tab,
  counts,
  onPick,
}: {
  tab: Tab;
  counts: Partial<Record<Tab, number>>;
  onPick: (tab: Tab) => void;
}) {
  return (
    <nav aria-label="My account" className="tabs subtabs account-tabs">
      {TABS.map(([id, label]) => (
        <button
          key={id}
          aria-current={tab === id ? 'page' : undefined}
          className="tab"
          onClick={() => onPick(id)}
          type="button"
        >
          {label}
          {counts[id] !== undefined && ` (${counts[id]})`}
        </button>
      ))}
    </nav>
  );
}

export function AccountPage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<Tab>('posts');
  const { data, error, isPending } = useMine(session?.userId ?? null);

  if (session?.userId == null) {
    return (
      <main>
        <p className="empty">
          <a href="#/login">Sign in</a> to see your account.
        </p>
      </main>
    );
  }

  const counts: Partial<Record<Tab, number>> =
    data === undefined
      ? {}
      : { posts: data.posts.length, comments: data.comments.length, scraps: data.scraps.length };

  // The character tab hands the whole screen to PlayerPage, which is a page in
  // its own right — the alternative was a link, and a tab that is only a link
  // is a worse link.
  if (tab === 'player' && data?.playerId != null) {
    return (
      <>
        <AccountTabs counts={counts} onPick={setTab} tab={tab} />
        <PlayerPage playerId={data.playerId} />
      </>
    );
  }

  return (
    <>
      <AccountTabs counts={counts} onPick={setTab} tab={tab} />
      <main>
        {isPending && <p className="empty">Loading…</p>}
        {error && <p className="error">Could not load it: {error.message}</p>}

        {tab === 'player' && data !== undefined && data.playerId === null && (
          <p className="empty">
            No character is linked to this account yet. Ask an officer to confirm which character
            you are from the <a href="#/login">sign-in screen</a>.
          </p>
        )}

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

        {/* The starred players, alliances and servers, rendered by the block
            the overview already uses. Same rows, same shape — a second
            renderer would drift from it the first time either changed. */}
        {tab === 'favourites' && <FavouritesBlock />}

        {data !== undefined && tab === 'scraps' && (
          <ul className="board-list">
            {data.scraps.length === 0 && (
              <p className="empty">You have not scrapped anything yet.</p>
            )}
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

        {/* Labelled, not headed. The form's own button already says "Leave the
            alliance", and a heading above it saying the same thing reads as a
            rendering fault rather than as emphasis. */}
        {tab === 'leave' && (
          <section aria-label="Leaving the alliance">
            <LeaveAllianceForm />
          </section>
        )}
      </main>
    </>
  );
}
