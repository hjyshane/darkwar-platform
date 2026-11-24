import { Pager } from '../../components/Pager';
import { RichTitle } from '../../components/RichText';
import { useT } from '../../lib/i18n';
import { BOARD_HOT_SCORE } from '../../lib/settings/registry';
import { useSiteSetting } from '../../lib/settings/useSiteSetting';
import type { BoardPage, BoardPost } from './board';
import { hotPostIds, topPostId } from './views';

/** A board: titles with their byline underneath, the shape the post page uses.
 *
 * A LIST, NOT A TABLE. The five-column table gave Kind, Author, Posted and
 * Edited a column each, which read fine on one 1440 screen and clipped on
 * every phone — and a reader scanning a board is choosing by TITLE, not
 * comparing dates down a column. Each entry now carries the same meta block
 * the opened post shows (`post-meta`: tag chip, author, date, edited), so the
 * list and the post agree about what the facts look like.
 *
 * READ MARKS ARE PER ACCOUNT (0079), so a post opened on a phone is not unread
 * again on a PC. Unread is the emphasised state, not read: the list is for
 * finding what you have not seen, and marking the majority would emphasise
 * nothing.
 */
const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

function Row({
  post,
  hrefFor,
  authors,
  commentCount,
  viewCount,
  hot,
  top,
  read,
  tagLabel,
}: {
  post: BoardPost;
  hrefFor: (id: string) => string;
  authors: Record<string, string>;
  /** Live comments on this post (0115). Zero prints nothing — "0" in a column
   * of counts reads as a measurement, and "nobody has answered" is better said
   * by the absence of the mark. */
  commentCount: number;
  /** Opens, all time. Printed beside the comment count; zero prints nothing,
   * for the same reason a "0" in a column of counts reads as a measurement. */
  viewCount: number;
  /** Busy in the last seven days (0119). Decays, unlike `top`. */
  hot: boolean;
  /** The most-read post on this board, all time. At most one. */
  top: boolean;
  read: boolean;
  tagLabel: (tag: string | null) => string | null;
}) {
  const t = useT();
  const tag = tagLabel(post.tag);
  // Not "Unknown": a post written before 0079, or by an account with no
  // character linked, has an author we genuinely cannot name.
  const author = post.createdBy !== null ? authors[post.createdBy] : undefined;
  return (
    <li className={read ? undefined : 'board-unread'}>
      <a href={hrefFor(post.id)}>
        <RichTitle title={post.title} />
      </a>
      {/* Beside the title, where a reader choosing what to open is already
          looking — not down in the meta line with the dates. "Is anybody
          talking about this" is a reason to open a post; the date is not. */}
      {commentCount > 0 && (
        <span className="board-comments" title={t('{count} comments', { count: commentCount })}>
          {commentCount}
        </span>
      )}
      {/* Two tags answering two questions: `top` is the most-read post on the
          board and changes rarely, `hot` is about this week and decays. A post
          can be both, and the order puts the rarer one first. */}
      {top && <span className="badge badge-top">{t('top')}</span>}
      {hot && <span className="badge badge-hot">{t('hot')}</span>}
      {post.pinned && <span className="badge badge-fresh">{t('pinned')}</span>}
      {post.liveAt === null && <span className="badge badge-missing">{t('draft')}</span>}
      {/* Unread said in words as well as in weight, because bold alone is not
          something everybody can see. */}
      {!read && <span className="badge badge-missing">{t('new')}</span>}
      {/* The post page's own meta block (`post-meta`), so the list shows the
          facts in the same clothes the opened post does. */}
      <div className="post-meta">
        {tag !== null && <span className="post-tag">{tag}</span>}
        {author !== undefined && <span className="post-author">{author}</span>}
        <time dateTime={post.liveAt ?? post.createdAt}>
          {day.format(new Date(post.liveAt ?? post.createdAt))}
        </time>
        {/* Down here with the dates rather than up beside the title: how many
            people opened something is context once you are already reading the
            entry, not a reason to pick it out of a list. The comment count is
            the one that belongs next to the title. */}
        {viewCount > 0 && (
          <span className="post-views">
            {viewCount === 1
              ? t('{count} view', { count: viewCount })
              : t('{count} views', { count: viewCount })}
          </span>
        )}
        {/* Only when it differs, as on the post page: an "edited" stamp on
            every entry would say nothing. */}
        {post.updatedAt !== post.createdAt && (
          <span className="post-edited">
            {t('edited {date}', { date: day.format(new Date(post.updatedAt)) })}
          </span>
        )}
      </div>
    </li>
  );
}

export function BoardList({
  data,
  hrefFor,
  onGo,
  tagLabel,
  empty,
}: {
  data: BoardPage;
  hrefFor: (id: string) => string;
  onGo: (page: number) => void;
  tagLabel: (tag: string | null) => string | null;
  empty: React.ReactNode;
}) {
  const hotScore = useSiteSetting(BOARD_HOT_SCORE);
  const t = useT();
  if (data.posts.length === 0 && data.pinned.length === 0) {
    return <p className="empty">{empty}</p>;
  }
  // Scored across everything on screen, pinned included: "the most read post"
  // that skipped the pinned ones would be a different claim from the one the
  // tag makes.
  const onScreen = [...data.pinned, ...data.posts].map((post) => post.id);
  const hot = hotPostIds(data.views, data.commentCounts, onScreen, hotScore);
  const top = topPostId(data.views, onScreen);
  return (
    <>
      <ul className="board-list">
        {/* Pinned above the page, and on every page. Sorting them to the top
            of page one would pin them only for people who never turn a page. */}
        {data.pinned.map((post) => (
          <Row
            key={post.id}
            authors={data.authors}
            commentCount={data.commentCounts[post.id] ?? 0}
            hot={hot.has(post.id)}
            hrefFor={hrefFor}
            post={post}
            read={data.read.has(post.id)}
            tagLabel={tagLabel}
            top={top === post.id}
            viewCount={data.views[post.id]?.total ?? 0}
          />
        ))}
        {data.posts.map((post) => (
          <Row
            key={post.id}
            authors={data.authors}
            commentCount={data.commentCounts[post.id] ?? 0}
            hot={hot.has(post.id)}
            hrefFor={hrefFor}
            post={post}
            read={data.read.has(post.id)}
            tagLabel={tagLabel}
            top={top === post.id}
            viewCount={data.views[post.id]?.total ?? 0}
          />
        ))}
      </ul>
      <Pager onGo={onGo} page={data.page} pageCount={data.pageCount} />
      <p className="subtle">
        {data.total === 1
          ? t('{count} post', { count: data.total })
          : t('{count} posts', { count: data.total })}
        {data.pinned.length > 0 &&
          ` · ${t('{count} pinned, shown on every page', { count: data.pinned.length })}`}
      </p>
    </>
  );
}
