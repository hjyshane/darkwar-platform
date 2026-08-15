import { useMarkAlertsRead, useReplyAlerts } from '../lib/replyAlerts';
import { guideHash, noticeHash } from '../lib/route';

/** "Somebody answered you", at the top of the page (0117).
 *
 * ABOVE EVERYTHING RATHER THAN ON THE BOARDS, because the whole problem it
 * solves is that the answer is somewhere the reader is not. A member who has
 * commented once and is looking at the arena has no reason to open Guides, and
 * that is exactly when they need telling.
 *
 * IT DISAPPEARS WHEN THERE IS NOTHING, rather than reserving a row that says
 * "no new replies". A permanent strip at the top of every screen would cost
 * every reader something to serve the few who have an answer waiting.
 *
 * Opening the post marks that alert read — following the link IS reading it,
 * and a badge that survives the click would have to be dismissed twice.
 */
const when = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export function ReplyAlerts() {
  const { data } = useReplyAlerts();
  const markRead = useMarkAlertsRead();

  // No error state and no loading state on purpose. This is an extra on top of
  // whatever screen the reader actually came for; a red box about a failed
  // notification query would be worse than the silence it replaces.
  const alerts = data ?? [];
  if (alerts.length === 0) {
    return null;
  }

  return (
    <aside aria-label="New replies" className="reply-alerts">
      <div className="reply-alerts-head">
        <strong>
          {alerts.length} new {alerts.length === 1 ? 'reply' : 'replies'}
        </strong>
        <button
          disabled={markRead.isPending}
          onClick={() => markRead.mutate(alerts.map((alert) => alert.notificationId))}
          type="button"
        >
          Mark all read
        </button>
      </div>
      <ul>
        {alerts.map((alert) => (
          <li key={alert.notificationId}>
            <a
              href={alert.board === 'guide' ? guideHash(alert.postId) : noticeHash(alert.postId)}
              onClick={() => markRead.mutate([alert.notificationId])}
            >
              {/* The name first, because "who answered me" is the question.
                  A dash where a name cannot be resolved, never "Unknown". */}
              <span className="post-author">{alert.authorName ?? '—'}</span> replied on the{' '}
              {alert.board === 'guide' ? 'guides' : 'notices'} board
            </a>
            <time dateTime={alert.createdAt}>{when.format(new Date(alert.createdAt))} UTC</time>
          </li>
        ))}
      </ul>
    </aside>
  );
}
