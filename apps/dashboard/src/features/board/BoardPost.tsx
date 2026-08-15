import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { RichText, RichTitle } from '../../components/RichText';
import { supabase } from '../../lib/supabase';
import { Comments } from './PostComments';
import {
  type BoardConfig,
  GUIDE_COLUMNS,
  NOTICE_COLUMNS,
  type BoardPost as Post,
  toPost,
  useMarkRead,
  useNeighbours,
} from './board';
import { useScraps, useToggleScrap } from './scraps';
import { useRecordView } from './views';

/** One post, on its own page.
 *
 * Its own address (`#/guides/<id>`) so a member can send somebody the thing
 * itself rather than the list it happens to be on this week.
 *
 * OPENING IT MARKS IT READ, in an effect rather than on a click: arriving by a
 * pasted link is opening it too, and a handler on the list row would leave those
 * readers permanently unread.
 */
const when = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export function BoardPostPage({
  config,
  postId,
  backHref,
  backLabel,
  tagLabel,
  hrefFor,
  children,
}: {
  config: BoardConfig;
  postId: string;
  backHref: string;
  backLabel: string;
  tagLabel: (tag: string | null) => string | null;
  /** The address of a sibling post, for the previous/next links. Passed in for
   * the same reason `backHref` is: the route belongs to the board, not here. */
  hrefFor: (id: string) => string;
  /** Editor controls, when the reader may write. Passed in rather than decided
   * here: which capability applies differs between the two boards. */
  children?: React.ReactNode;
}) {
  const markRead = useMarkRead(config);
  // Every open counts (0119), unlike the read mark above which is once per
  // account. The function refuses viewers and drafts, so this is safe to fire
  // before we know whether the post loaded.
  useRecordView(config, postId);

  const { data, error, isPending } = useQuery({
    queryKey: ['post', config.table, postId],
    queryFn: async () => {
      const isGuide = config.table === 'guides';
      // The two tables asked for separately rather than through the config. A
      // `.from(config.table).eq(config.idColumn, …)` typechecks against the
      // INTERSECTION of both tables' columns, which does not contain either id —
      // spelling each query out keeps the column names checked.
      const { data: row, error: queryError } = isGuide
        ? await supabase.from('guides').select(GUIDE_COLUMNS).eq('guide_id', postId).maybeSingle()
        : await supabase
            .from('announcements')
            .select(NOTICE_COLUMNS)
            .eq('announcement_id', postId)
            .maybeSingle();
      if (queryError) {
        throw new Error(`post query failed: ${queryError.message}`);
      }
      if (row === null) {
        return null;
      }
      const record = row as unknown as Record<string, unknown>;
      const authors = await supabase.from('post_authors').select('user_id, display_name');
      const createdBy = (record.created_by as string | null) ?? null;
      return {
        // The list's own mapping, not a second copy of it. The copy that used to
        // live here is how a notice draft would have read as posted on its own
        // page after 0108 — the two drifted the moment one board gained a column.
        post: toPost(config, record) satisfies Post,
        author:
          createdBy === null
            ? null
            : ((authors.data ?? []).find((entry) => entry.user_id === createdBy)?.display_name ??
              null),
      };
    },
  });

  const found = data ?? null;
  // On whether the post EXISTS, not on the post itself: the row object is new on
  // every refetch, and depending on it would mark the post read again each time
  // the query settled. `mutate` is stable, so naming it costs nothing.
  const exists = found !== null;
  const mark = markRead.mutate;
  useEffect(() => {
    if (exists) {
      mark(postId);
    }
  }, [exists, mark, postId]);

  if (isPending) {
    return (
      <main>
        <p className="empty">Loading…</p>
      </main>
    );
  }
  if (error) {
    return (
      <main>
        <p className="error">Could not load it: {error.message}</p>
      </main>
    );
  }
  if (found === null) {
    return (
      <main>
        <p className="empty">
          Nothing here with that address. It may have been deleted, or it may be a draft you cannot
          see. <a href={backHref}>{backLabel}</a>
        </p>
      </main>
    );
  }

  const { post, author } = found;
  const tag = tagLabel(post.tag);
  return (
    <main>
      <article>
        {/* A masthead, not a line of small print. Who wrote it, when, and what
            kind of post it is were one grey sentence that ran into the first
            paragraph; a reader skimming for "is this current?" had to read prose
            to find a date. Same facts, given a block of their own and a rule
            under it, so the body starts somewhere. */}
        <header className="post-header">
          <h2>
            <RichTitle title={post.title} />
            {post.pinned && <span className="badge badge-fresh">pinned</span>}
            {post.liveAt === null && <span className="badge badge-missing">draft</span>}
          </h2>
          <div className="post-meta">
            {tag !== null && <span className="post-tag">{tag}</span>}
            {author !== null && <span className="post-author">{author}</span>}
            <time dateTime={post.liveAt ?? post.createdAt}>
              {post.liveAt === null
                ? `Written ${when.format(new Date(post.createdAt))} UTC`
                : `${when.format(new Date(post.liveAt))} UTC`}
            </time>
            {/* Only when it differs. An "edited" stamp on every post would say
                nothing; on the few that were, it says the version you are
                reading is not the one that was announced. */}
            {post.updatedAt !== post.createdAt && (
              <span className="post-edited">
                edited {when.format(new Date(post.updatedAt))} UTC
              </span>
            )}
          </div>
        </header>
        {post.body.trim() === '' ? (
          <p className="empty">No body — the title is all of it.</p>
        ) : (
          <RichText body={post.body} />
        )}
        <ScrapButton config={config} postId={post.id} />
      </article>
      {/* Between the post and the way out of it. The thread is part of reading
          this post, so it comes before the previous/list/next row — that row is
          for somebody who has finished, and a reader who has not seen the
          comments has not. */}
      <Comments config={config} postId={post.id} />
      <PostNav
        backHref={backHref}
        backLabel={backLabel}
        config={config}
        createdAt={post.createdAt}
        hrefFor={hrefFor}
        postId={post.id}
      />
      {children}
    </main>
  );
}

/** Keep this post, or stop keeping it (0116).
 *
 * Under the body rather than up in the masthead: scrapping is something you
 * decide once you have read the thing, and the masthead is where somebody
 * skimming for "is this current" is looking.
 *
 * The button says what pressing it will DO, not what the state is — "Scrapped"
 * as a label on a pressed button reads as a status and gets clicked by people
 * trying to scrap. `aria-pressed` carries the state for anybody who needs it
 * announced.
 */
function ScrapButton({ config, postId }: { config: BoardConfig; postId: string }) {
  const { data: scraps } = useScraps();
  const toggle = useToggleScrap(config);
  // Undefined while loading is not "not scrapped": showing Scrap and then
  // flipping it to Remove a beat later is how somebody double-presses and
  // undoes themselves.
  if (scraps === undefined) {
    return null;
  }
  const scrapped =
    config.readColumn === 'guide_id'
      ? scraps.guideIds.has(postId)
      : scraps.announcementIds.has(postId);
  return (
    <div className="post-scrap">
      <button
        aria-pressed={scrapped}
        disabled={toggle.isPending}
        onClick={() => toggle.mutate({ postId, scrapped })}
        type="button"
      >
        {scrapped ? 'Remove from scraps' : 'Scrap this'}
      </button>
      {toggle.error !== null && <p className="error">{toggle.error.message}</p>}
    </div>
  );
}

/** Where to go when you have finished reading.
 *
 * Three destinations in one row: the post before, the list, the post after. The
 * list link is the wide one in the middle because it is the one people want
 * most and it used to be six grey words at the top of the page — above the
 * title, where somebody who has just read to the bottom is not looking.
 *
 * Newer on the LEFT, older on the right, matching the list above: the board is
 * newest-first, so left is up the page and right is down it. Each side carries
 * the neighbour's title, because "Next →" tells a reader nothing about whether
 * they want to press it.
 *
 * An end of the board is a disabled-looking span rather than a missing element:
 * the row keeps its shape, and the reader learns there is nothing further
 * instead of wondering whether the link failed to render.
 */
function PostNav({
  config,
  postId,
  createdAt,
  backHref,
  backLabel,
  hrefFor,
}: {
  config: BoardConfig;
  postId: string;
  createdAt: string;
  backHref: string;
  backLabel: string;
  hrefFor: (id: string) => string;
}) {
  const { data } = useNeighbours(config, postId, createdAt);
  const newer = data?.newer ?? null;
  const older = data?.older ?? null;
  return (
    <nav aria-label="More on this board" className="post-nav">
      {newer === null ? (
        <span className="post-nav-end">Newest here</span>
      ) : (
        <a className="post-nav-link" href={hrefFor(newer.id)}>
          <span className="post-nav-dir">← Newer</span>
          <span className="post-nav-title">
            <RichTitle title={newer.title} />
          </span>
        </a>
      )}
      <a className="post-nav-back" href={backHref}>
        {backLabel}
      </a>
      {older === null ? (
        <span className="post-nav-end">Oldest here</span>
      ) : (
        <a className="post-nav-link post-nav-right" href={hrefFor(older.id)}>
          <span className="post-nav-dir">Older →</span>
          <span className="post-nav-title">
            <RichTitle title={older.title} />
          </span>
        </a>
      )}
    </nav>
  );
}
