import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { RichText } from '../../components/RichText';
import { supabase } from '../../lib/supabase';
import { type BoardConfig, type BoardPost as Post, useMarkRead } from './board';

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

const GUIDE_COLUMNS =
  'guide_id, title, body, category, pinned, published_at, created_at, updated_at, created_by';
const NOTICE_COLUMNS =
  'announcement_id, title, body, visibility, pinned, starts_at, ends_at, created_at, updated_at, created_by';

export function BoardPostPage({
  config,
  postId,
  backHref,
  backLabel,
  tagLabel,
  children,
}: {
  config: BoardConfig;
  postId: string;
  backHref: string;
  backLabel: string;
  tagLabel: (tag: string | null) => string | null;
  /** Editor controls, when the reader may write. Passed in rather than decided
   * here: which capability applies differs between the two boards. */
  children?: React.ReactNode;
}) {
  const markRead = useMarkRead(config);

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
        post: {
          id: postId,
          title: String(record.title ?? ''),
          body: String(record.body ?? ''),
          pinned: record.pinned === true,
          liveAt: isGuide
            ? ((record.published_at as string | null) ?? null)
            : ((record.starts_at as string | null) ?? (record.created_at as string | null) ?? null),
          createdAt: String(record.created_at ?? ''),
          updatedAt: String(record.updated_at ?? ''),
          createdBy,
          tag: String((isGuide ? record.category : record.visibility) ?? '') || null,
        } satisfies Post,
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
      <p className="subtle">
        <a href={backHref}>← {backLabel}</a>
      </p>
      <article>
        <h2>
          {post.title}
          {post.pinned && <span className="badge badge-fresh">pinned</span>}
          {post.liveAt === null && <span className="badge badge-missing">draft</span>}
        </h2>
        <p className="subtle">
          {author !== null && <>By {author} · </>}
          {post.liveAt === null
            ? `Written ${when.format(new Date(post.createdAt))} UTC`
            : `Posted ${when.format(new Date(post.liveAt))} UTC`}
          {post.updatedAt !== post.createdAt &&
            ` · edited ${when.format(new Date(post.updatedAt))} UTC`}
          {tag !== null && ` · ${tag}`}
        </p>
        {post.body.trim() === '' ? (
          <p className="empty">No body — the title is all of it.</p>
        ) : (
          <RichText body={post.body} />
        )}
      </article>
      {children}
    </main>
  );
}
