import { useState } from 'react';
import { ALL_TIME, type ActivityRange, useActivityTotals } from '../../lib/activity';

/** Participation scores, over whatever period is asked for (0114, 0118).
 *
 * READS ONLY. There is nothing to save here: every number is derived from what
 * members actually did, and a score somebody can type in is not a score.
 *
 * WHO APPEARS IS THE DATABASE'S ANSWER, NOT THIS COMPONENT'S. `activity_daily`
 * and `activity_members` are both `security_invoker`, so a member reading them
 * gets one row — their own — and somebody with `members.manage` gets the
 * alliance. Nothing here filters by person, and nothing here should: a
 * component that hid rows would be decoration over a gate that already exists,
 * and the day the two disagreed the decoration is what people would trust.
 */
const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

/** Points, with the trailing zero dropped. Half points are real here — one
 * ranking board is 0.5 — so "3" and "3.5" both have to read cleanly. */
function points(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** The activity day `n` days before today, as `YYYY-MM-DD`.
 *
 * Built from the UTC date rather than the local one, because `day` is a UTC
 * date on the 02:00 clock (0118) and a reader in Seoul comparing it against
 * their own midnight would be a day out for two hours every morning.
 */
function daysAgo(count: number): string {
  const now = new Date();
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - count);
  return new Date(utc).toISOString().slice(0, 10);
}

const PRESETS: ReadonlyArray<{ label: string; range: () => ActivityRange }> = [
  // All time first, because it is the default. A score with no range chosen is
  // everything somebody has ever done, which is the honest answer to "who
  // shows up" for an alliance that has been running longer than a week.
  { label: 'All time', range: () => ALL_TIME },
  { label: 'Last 7 days', range: () => ({ from: daysAgo(6), to: null }) },
  { label: 'Last 30 days', range: () => ({ from: daysAgo(29), to: null }) },
];

export function ActivitySetting() {
  const [range, setRange] = useState<ActivityRange>(ALL_TIME);
  const { data, error, isPending } = useActivityTotals(range);

  const preset =
    range.from === null && range.to === null
      ? 'All time'
      : (PRESETS.find((entry) => {
          const candidate = entry.range();
          return candidate.from === range.from && candidate.to === range.to;
        })?.label ?? null);

  return (
    <>
      <div className="activity-range">
        <div className="activity-presets">
          {PRESETS.map((entry) => (
            <button
              key={entry.label}
              aria-pressed={preset === entry.label}
              onClick={() => setRange(entry.range())}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>
        {/* The exact dates, for the question a preset cannot answer — "how did
            everybody do during the event last month". Either end may be left
            empty, which is what makes "since the 1st" a range. */}
        <div className="activity-dates">
          <label htmlFor="activity-from">
            From
            <input
              id="activity-from"
              onChange={(event) =>
                setRange((current) => ({ ...current, from: event.target.value || null }))
              }
              type="date"
              value={range.from ?? ''}
            />
          </label>
          <label htmlFor="activity-to">
            To
            <input
              id="activity-to"
              onChange={(event) =>
                setRange((current) => ({ ...current, to: event.target.value || null }))
              }
              type="date"
              value={range.to ?? ''}
            />
          </label>
        </div>
      </div>

      <p className="hint">
        {range.from === null && range.to === null
          ? 'Every day on record.'
          : `${range.from === null ? 'From the beginning' : day.format(new Date(range.from))} to ${
              range.to === null ? 'today' : day.format(new Date(range.to))
            }.`}{' '}
        Signing in is 1 point a day, each ranking board opened is 0.5 a day, and a comment is 2.
        Days run 02:00 to 02:00 UTC, like the game week.
      </p>

      {isPending && <p className="empty">Loading…</p>}
      {error && <p className="error">Could not load it: {error.message}</p>}
      {data !== undefined && data.length === 0 && <p className="empty">Nobody to score yet.</p>}
      {data !== undefined && data.length > 0 && (
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
              {data.map((score) => (
                <tr key={score.userId}>
                  {/* A dash, not "Unknown": an account with no character
                      linked is somebody we genuinely cannot name, and saying
                      otherwise beside real names states something false. */}
                  <td>{score.displayName ?? '—'}</td>
                  {/* The counts, because "three sign-ins" explains a 3 better
                      than the 3 does. What they are worth is in the total. */}
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
      )}
    </>
  );
}
