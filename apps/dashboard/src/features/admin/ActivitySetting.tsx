import { useActivityScores } from '../../lib/activity';

/** This week's participation score, per member (0114).
 *
 * READS ONLY. There is nothing to save here: every number is derived from
 * what members actually did, and a score somebody can type in is not a score.
 * The section reports what the database answered, the way the rest of this
 * page does.
 *
 * WHO APPEARS IS THE DATABASE'S ANSWER, NOT THIS COMPONENT'S. `activity_scores`
 * is `security_invoker`, so a member reading it gets one row — their own — and
 * somebody with `members.manage` gets the alliance. Nothing here filters, and
 * nothing here should: a component that hid rows would be decoration over a
 * gate that already exists, and the day the two disagreed the decoration would
 * be the thing people trusted.
 */
const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

/** Points, with the trailing zero dropped. Half points are real here — one
 * ranking board is 0.5 — so "3" and "3.5" both have to read cleanly. */
function points(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function ActivitySetting() {
  const { data, error, isPending } = useActivityScores();

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load it: {error.message}</p>;
  }
  // Destructured rather than indexed: every row carries the same week, so the
  // first one is as good as any, but `data[0]` is possibly-undefined and the
  // empty case has to be handled anyway.
  const [first, ...rest] = data;
  if (first === undefined) {
    return <p className="empty">Nobody to score yet.</p>;
  }
  const weekStart = first.weekStart;
  const rows = [first, ...rest];
  return (
    <>
      {/* The week the numbers are about, said once. Without it a low column
          reads as "this member does nothing" when it may just be Monday
          morning — the score resets at 02:00 UTC on Monday. */}
      <p className="hint">
        Week from {day.format(new Date(weekStart))} 02:00 UTC. Signing in is 1 point a day, each
        ranking board opened is 0.5 a day, and a comment is 2.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Member</th>
              <th scope="col">Sign-ins</th>
              <th scope="col">Server</th>
              <th scope="col">Alliance</th>
              <th scope="col">Player</th>
              <th scope="col">Comments</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((score) => (
              <tr key={score.userId}>
                {/* A dash, not "Unknown": an account with no character linked
                    is somebody we genuinely cannot name, and saying otherwise
                    beside real names states something false (0113). */}
                <td>{score.displayName ?? '—'}</td>
                {/* The counts are what somebody checking a number wants —
                    "three sign-ins" explains a 3 better than the 3 does. The
                    points those counts are worth are in the total. */}
                <td>{score.loginDays}</td>
                <td>{score.serverDays}</td>
                <td>{score.allianceDays}</td>
                <td>{score.playerDays}</td>
                <td>{score.commentCount}</td>
                <td>
                  <strong>{points(score.totalPoints)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
