import { Pager } from '../../components/Pager';
import type { BoardPage, BoardPost } from './board';

/** A board: titles, who wrote them, when, and whether you have read them.
 *
 * The shape people already know from every forum. It replaced a page that
 * rendered every post's whole body one after another, which meant three guides
 * filled the screen and a fourth was below the fold.
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
  return (
    <tr className={read ? undefined : 'board-unread'}>
      <td className="label">
        <a href={hrefFor(post.id)}>{post.title}</a>
        {post.pinned && <span className="badge badge-fresh">pinned</span>}
        {post.liveAt === null && <span className="badge badge-missing">draft</span>}
        {/* Unread said in words as well as in weight, because bold alone is not
            something everybody can see. */}
        {!read && <span className="badge badge-missing">new</span>}
      </td>
      <td>{tag ?? <span className="subtle">—</span>}</td>
      <td className="label">
        {post.createdBy !== null && authors[post.createdBy] !== undefined ? (
          authors[post.createdBy]
        ) : (
          // Not "Unknown": a post written before 0079, or by an account with no
          // character linked, has an author we genuinely cannot name.
          <span className="subtle">—</span>
        )}
      </td>
      <td title={post.liveAt ?? post.createdAt}>
        {day.format(new Date(post.liveAt ?? post.createdAt))}
      </td>
      {/* A plain date, not a FreshnessBadge. The badge exists to say whether
          OBSERVED data is current, and it colours itself once a reading is old —
          which beside an edit date reads as though the guide itself had gone off,
          when all it means is that nobody has had to change it. */}
      <td title={post.updatedAt}>
        {post.updatedAt !== post.createdAt ? (
          day.format(new Date(post.updatedAt))
        ) : (
          <span className="subtle">—</span>
        )}
      </td>
    </tr>
  );
}

export function BoardList({
  data,
  hrefFor,
  onGo,
  tagHeading,
  tagLabel,
  empty,
}: {
  data: BoardPage;
  hrefFor: (id: string) => string;
  onGo: (page: number) => void;
  tagHeading: string;
  tagLabel: (tag: string | null) => string | null;
  empty: React.ReactNode;
}) {
  if (data.posts.length === 0 && data.pinned.length === 0) {
    return <p className="empty">{empty}</p>;
  }
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="label" scope="col">
                Title
              </th>
              <th scope="col">{tagHeading}</th>
              <th className="label" scope="col">
                Author
              </th>
              <th scope="col">Posted</th>
              <th scope="col">Edited</th>
            </tr>
          </thead>
          <tbody>
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
          </tbody>
        </table>
      </div>
      <Pager onGo={onGo} page={data.page} pageCount={data.pageCount} />
      <p className="subtle">
        {data.total} post{data.total === 1 ? '' : 's'}
        {data.pinned.length > 0 && ` · ${data.pinned.length} pinned, shown on every page`}
      </p>
    </>
  );
}
