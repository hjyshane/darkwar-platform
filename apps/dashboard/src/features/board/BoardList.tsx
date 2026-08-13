import { Pager } from '../../components/Pager';
import { RichTitle } from '../../components/RichText';
import type { BoardPage, BoardPost } from './board';

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
  read,
  tagLabel,
}: {
  post: BoardPost;
  hrefFor: (id: string) => string;
  authors: Record<string, string>;
  read: boolean;
  tagLabel: (tag: string | null) => string | null;
}) {
  const tag = tagLabel(post.tag);
  // Not "Unknown": a post written before 0079, or by an account with no
  // character linked, has an author we genuinely cannot name.
  const author = post.createdBy !== null ? authors[post.createdBy] : undefined;
  return (
    <li className={read ? undefined : 'board-unread'}>
      <a href={hrefFor(post.id)}>
        <RichTitle title={post.title} />
      </a>
      {post.pinned && <span className="badge badge-fresh">pinned</span>}
      {post.liveAt === null && <span className="badge badge-missing">draft</span>}
      {/* Unread said in words as well as in weight, because bold alone is not
          something everybody can see. */}
      {!read && <span className="badge badge-missing">new</span>}
      {/* The post page's own meta block (`post-meta`), so the list shows the
          facts in the same clothes the opened post does. */}
      <div className="post-meta">
        {tag !== null && <span className="post-tag">{tag}</span>}
        {author !== undefined && <span className="post-author">{author}</span>}
        <time dateTime={post.liveAt ?? post.createdAt}>
          {day.format(new Date(post.liveAt ?? post.createdAt))}
        </time>
        {/* Only when it differs, as on the post page: an "edited" stamp on
            every entry would say nothing. */}
        {post.updatedAt !== post.createdAt && (
          <span className="post-edited">edited {day.format(new Date(post.updatedAt))}</span>
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
  if (data.posts.length === 0 && data.pinned.length === 0) {
    return <p className="empty">{empty}</p>;
  }
  return (
    <>
      <ul className="board-list">
        {/* Pinned above the page, and on every page. Sorting them to the top
            of page one would pin them only for people who never turn a page. */}
        {data.pinned.map((post) => (
          <Row
            key={post.id}
            authors={data.authors}
            hrefFor={hrefFor}
            post={post}
            read={data.read.has(post.id)}
            tagLabel={tagLabel}
          />
        ))}
        {data.posts.map((post) => (
          <Row
            key={post.id}
            authors={data.authors}
            hrefFor={hrefFor}
            post={post}
            read={data.read.has(post.id)}
            tagLabel={tagLabel}
          />
        ))}
      </ul>
      <Pager onGo={onGo} page={data.page} pageCount={data.pageCount} />
      <p className="subtle">
        {data.total} post{data.total === 1 ? '' : 's'}
        {data.pinned.length > 0 && ` · ${data.pinned.length} pinned, shown on every page`}
      </p>
    </>
  );
}
