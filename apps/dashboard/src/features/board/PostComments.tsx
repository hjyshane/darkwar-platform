import { useState } from 'react';
import { isAllowed, usePermissions } from '../../lib/permissions';
import { useSession } from '../../lib/useSession';
import type { BoardConfig } from './board';
import {
  type BoardComment,
  type CommentThread,
  useAddComment,
  useComments,
  useEditComment,
  useRemoveComment,
} from './comments';

/** The thread under a post.
 *
 * ONE LEVEL OF REPLY, which is a layout decision as much as a data one: the
 * boards are a narrow column read on a phone, and a second indent leaves the
 * reply about eight words wide. The database refuses a deeper one (0113) so
 * this file never has to recurse.
 *
 * The meta line is the post page's own `post-meta` block — the same tag, name
 * and date treatment the masthead above uses, and the same one the board list
 * was reworked onto. A comment is a smaller version of the thing it hangs off,
 * so it should not invent a third way of printing who and when.
 */
const when = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** The commenter's character.
 *
 * A DASH, NOT "Unknown". `post_authors` returns null when an account has
 * neither a character linked nor a display name, and it returns nothing at all
 * for somebody who has left. Both mean the same thing — we genuinely cannot
 * name this person — and printing "Unknown member" beside a column of real
 * character names states something false about them. BoardList made the same
 * call for the same reason.
 */
function authorName(authors: Record<string, string>, authorId: string | null): string {
  if (authorId === null) {
    return '—';
  }
  return authors[authorId] ?? '—';
}

function CommentBody({ comment }: { comment: BoardComment }) {
  if (comment.deletedAt !== null) {
    return <p className="comment-deleted">Deleted.</p>;
  }
  // PLAIN TEXT, unlike a post. The board's markup carries colours and images,
  // which belong to somebody writing a guide and would turn a thread into a
  // shouting match. Line breaks are kept (`comment-body` sets pre-wrap) because
  // that is the only formatting a comment actually needs.
  return <p className="comment-body">{comment.body}</p>;
}

function Composer({
  busy,
  error,
  label,
  onCancel,
  onSubmit,
  initial = '',
  submitLabel,
}: {
  busy: boolean;
  error: string | null;
  label: string;
  onCancel?: () => void;
  onSubmit: (body: string) => void;
  initial?: string;
  submitLabel: string;
}) {
  const [body, setBody] = useState(initial);
  const empty = body.trim() === '';
  return (
    <form
      className="comment-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty && !busy) {
          onSubmit(body.trim());
          setBody('');
        }
      }}
    >
      <label className="visually-hidden" htmlFor={`comment-${label}`}>
        {label}
      </label>
      <textarea
        id={`comment-${label}`}
        onChange={(event) => setBody(event.target.value)}
        placeholder={label}
        rows={3}
        value={body}
      />
      <div className="comment-actions">
        {/* Disabled on empty rather than validated on submit: the database
            refuses a blank comment (0113) and a round trip to be told so is a
            worse way to learn it. */}
        <button disabled={empty || busy} type="submit">
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel !== undefined && (
          <button onClick={onCancel} type="button">
            Cancel
          </button>
        )}
      </div>
      {error !== null && <p className="error">{error}</p>}
    </form>
  );
}

function Comment({
  comment,
  authors,
  viewerId,
  mayModerate,
  config,
  postId,
  children,
  onReply,
}: {
  comment: BoardComment;
  authors: Record<string, string>;
  viewerId: string | null;
  mayModerate: boolean;
  config: BoardConfig;
  postId: string;
  children?: React.ReactNode;
  /** Absent on a reply: replies cannot be replied to, so the button that would
   * offer it does not exist rather than being rendered and refused. */
  onReply?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const edit = useEditComment(config, postId);
  const remove = useRemoveComment(config, postId);

  const gone = comment.deletedAt !== null;
  const mine = viewerId !== null && comment.authorId === viewerId;

  return (
    <li className="comment">
      <div className="post-meta">
        <span className="post-author">{authorName(authors, comment.authorId)}</span>
        <time dateTime={comment.createdAt}>{when.format(new Date(comment.createdAt))} UTC</time>
        {/* Only when it differs, as on the post above. An "edited" stamp on
            every comment would say nothing. */}
        {!gone && comment.updatedAt !== comment.createdAt && (
          <span className="post-edited">edited {when.format(new Date(comment.updatedAt))} UTC</span>
        )}
      </div>

      {editing ? (
        <Composer
          busy={edit.isPending}
          error={edit.error?.message ?? null}
          initial={comment.body}
          label="Edit your comment"
          onCancel={() => setEditing(false)}
          onSubmit={(body) => {
            edit.mutate({ id: comment.id, body }, { onSuccess: () => setEditing(false) });
          }}
          submitLabel="Save"
        />
      ) : (
        <CommentBody comment={comment} />
      )}

      {!gone && !editing && (
        <div className="comment-actions">
          {onReply !== undefined && (
            <button onClick={onReply} type="button">
              Reply
            </button>
          )}
          {mine && (
            <button onClick={() => setEditing(true)} type="button">
              Edit
            </button>
          )}
          {/* Yours, or anybody's if you may take the post down. Keyed to the
              capability rather than to the role: an officer handed
              `guide.delete` from the permission grid should get the button
              without a deploy, which is the whole point of the grid. */}
          {(mine || mayModerate) && (
            <button
              disabled={remove.isPending}
              onClick={() => remove.mutate(comment.id)}
              type="button"
            >
              Delete
            </button>
          )}
        </div>
      )}
      {remove.error !== null && <p className="error">{remove.error.message}</p>}
      {children}
    </li>
  );
}

function Thread({
  thread,
  authors,
  viewerId,
  mayModerate,
  mayWrite,
  config,
  postId,
}: {
  thread: CommentThread;
  authors: Record<string, string>;
  viewerId: string | null;
  mayModerate: boolean;
  mayWrite: boolean;
  config: BoardConfig;
  postId: string;
}) {
  const [replying, setReplying] = useState(false);
  const add = useAddComment(config, postId);

  return (
    <Comment
      authors={authors}
      comment={thread.comment}
      config={config}
      mayModerate={mayModerate}
      onReply={mayWrite ? () => setReplying(true) : undefined}
      postId={postId}
      viewerId={viewerId}
    >
      {(thread.replies.length > 0 || replying) && (
        <ul className="comment-replies">
          {thread.replies.map((reply) => (
            <Comment
              authors={authors}
              comment={reply}
              config={config}
              key={reply.id}
              mayModerate={mayModerate}
              postId={postId}
              viewerId={viewerId}
            />
          ))}
          {replying && (
            <li className="comment">
              <Composer
                busy={add.isPending}
                error={add.error?.message ?? null}
                label="Write a reply"
                onCancel={() => setReplying(false)}
                onSubmit={(body) => {
                  add.mutate(
                    { body, parentId: thread.comment.id },
                    { onSuccess: () => setReplying(false) },
                  );
                }}
                submitLabel="Reply"
              />
            </li>
          )}
        </ul>
      )}
    </Comment>
  );
}

export function Comments({ config, postId }: { config: BoardConfig; postId: string }) {
  const { data, error, isPending } = useComments(config, postId);
  const { data: session } = useSession();
  const { data: permissions } = usePermissions();
  const add = useAddComment(config, postId);

  // Member and above, which is what 0113's insert policy says. The composer is
  // hidden rather than shown-and-refused: a viewer has not been admitted, and
  // a form that always fails is worse than no form.
  const role = session?.role ?? 'viewer';
  const mayWrite = role === 'member' || role === 'officer' || role === 'admin';
  const mayModerate = isAllowed(
    permissions?.grants,
    role,
    config.table === 'guides' ? 'guide.delete' : 'announcement.delete',
  );

  if (isPending) {
    return (
      <section className="comments">
        <h3>Comments</h3>
        <p className="empty">Loading…</p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="comments">
        <h3>Comments</h3>
        <p className="error">Could not load them: {error.message}</p>
      </section>
    );
  }

  const { threads, authors, viewerId, liveCount } = data;
  return (
    <section className="comments">
      {/* The count in the heading, because "are there any?" is the question
          somebody scrolling past the post is asking. */}
      <h3>Comments{liveCount > 0 && <span className="comment-count">{liveCount}</span>}</h3>

      {threads.length === 0 ? (
        <p className="empty">Nothing yet.</p>
      ) : (
        <ul className="comment-list">
          {threads.map((thread) => (
            <Thread
              authors={authors}
              config={config}
              key={thread.comment.id}
              mayModerate={mayModerate}
              mayWrite={mayWrite}
              postId={postId}
              thread={thread}
              viewerId={viewerId}
            />
          ))}
        </ul>
      )}

      {mayWrite && (
        <Composer
          busy={add.isPending}
          error={add.error?.message ?? null}
          label="Write a comment"
          onSubmit={(body) => add.mutate({ body, parentId: null })}
          submitLabel="Comment"
        />
      )}
    </section>
  );
}
