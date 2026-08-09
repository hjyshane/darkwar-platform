import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { playerHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';

/** What changed when the last rank period was built.
 *
 * The table below says where everybody stands. This says who MOVED, which is the
 * thing an officer acts on — somebody who dropped a tier needs a word, somebody who
 * climbed deserves one, and the biggest gain is worth naming out loud.
 *
 * THE DIRECTION LIVES IN SQL (0087), not here. R1 is the lowest tier and R3 the
 * highest — the activity score bands establish it, cleanly separated — and
 * `tier_change` is already signed so that positive means climbed. Recomputing that
 * in TypeScript would be a second place for it to be backwards, and backwards this
 * screen congratulates the people who slipped while having a word with the ones who
 * improved. Nothing about the output would look wrong.
 *
 * A member with no comparison is absent rather than listed as unchanged: an officer
 * is measured and deliberately not ranked (0072), and a first measurement is not a
 * promotion.
 */
interface MovementRow {
  player_id: string;
  name: string | null;
  period_start: string;
  previous_period_start: string | null;
  tier: string | null;
  previous_tier: string | null;
  activity_score: number | null;
  tier_change: number | null;
  score_change: number | null;
}

async function fetchMovement(): Promise<MovementRow[]> {
  const { data, error } = await supabase
    .from('rank_period_movement')
    .select(
      'player_id, name, period_start, previous_period_start, tier, previous_tier, activity_score, tier_change, score_change',
    )
    .limit(300);
  if (error) {
    // Member-only, like every other rank figure. A logged-out reader gets the
    // roster without this rather than an error page — the same rule the rank
    // columns follow.
    if (error.code === '42501') {
      return [];
    }
    throw new Error(`rank movement query failed: ${error.message}`);
  }
  return (data ?? []) as MovementRow[];
}

const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

function score(value: number): string {
  return value.toFixed(1);
}

/** One person, as a link. Every name here is somebody an officer may want to open. */
function Who({ row }: { row: MovementRow }) {
  return <a href={playerHash(row.player_id)}>{row.name ?? row.player_id.slice(0, 8)}</a>;
}

/** Behind a click, until the view underneath is fixed.
 *
 * `pg_stat_statements` on production, for the exact select below: 64 calls,
 * mean 3,173 ms, max 7,949 ms. The statement timeout is what the reader saw —
 * a 500 on the members screen, every time — and until it fired, every visit
 * to the roster waited on it.
 *
 * The roster is the point of that screen and this is a summary above it, so
 * the summary does not get to hold it up. `enabled` keeps the request from
 * leaving at all while closed; opening it is a decision the reader makes
 * knowing it may be slow.
 *
 * TEMPORARY, and the fix belongs in the view. The same select of SEVEN
 * columns runs in 105 ms against the same rows — it is the nine-column shape
 * that collapses, which points at 0088 rather than at the data. Undo this
 * once that is understood; a summary an officer has to ask for is a worse
 * screen than one that is simply there.
 */
export function RankMovement() {
  const [open, setOpen] = useState(false);
  const { data, error, isPending } = useQuery({
    queryKey: ['rank-movement'],
    queryFn: fetchMovement,
    enabled: open,
  });

  if (!open) {
    return (
      <p className="subtle">
        <button className="link" onClick={() => setOpen(true)} type="button">
          Show rank changes
        </button>{' '}
        — kept out of the way while it is slow to build.
      </p>
    );
  }

  if (isPending) {
    return <p className="subtle">Working out who moved…</p>;
  }

  if (error) {
    // Said out loud now, unlike before. Silence was right when this loaded
    // unasked; after a click it would read as a broken button.
    return <p className="error">Could not work out rank changes: {error.message}</p>;
  }

  const rows = data ?? [];
  const compared = rows.filter((row) => row.tier_change !== null);
  if (rows.length === 0) {
    return null;
  }

  const period = rows[0]?.period_start;
  const previous = rows[0]?.previous_period_start ?? null;

  // Only the first period exists, so nothing has moved yet — and saying "nobody
  // changed rank" would imply a comparison that has not happened.
  if (previous === null || compared.length === 0) {
    return (
      <p className="subtle">
        Rank period of {period === undefined ? 'unknown date' : day.format(new Date(period))}. No
        earlier period to compare against yet, so there is no movement to show.
      </p>
    );
  }

  const climbed = compared
    .filter((row) => (row.tier_change ?? 0) > 0)
    .sort((a, b) => (b.tier_change ?? 0) - (a.tier_change ?? 0));
  const slipped = compared
    .filter((row) => (row.tier_change ?? 0) < 0)
    .sort((a, b) => (a.tier_change ?? 0) - (b.tier_change ?? 0));

  // The biggest gain, taken over EVERYBODY with a score comparison rather than only
  // those who changed tier. A member can gain thirty points and stay in the same
  // band, and that is still the best improvement in the alliance.
  const gained = [...rows]
    .filter((row) => row.score_change !== null && (row.score_change ?? 0) > 0)
    .sort((a, b) => (b.score_change ?? 0) - (a.score_change ?? 0));
  const best = gained[0] ?? null;

  return (
    <div className="rank-movement">
      <p className="subtle">
        Since the rank period of {previous === null ? '' : day.format(new Date(previous))} →{' '}
        {period === undefined ? '' : day.format(new Date(period))}, comparing {compared.length}{' '}
        graded members.
      </p>
      <div className="stats">
        {/* Climbed first. The list an officer reads to say well done is the one that
            should be easiest to reach. */}
        <div className="movement-card movement-up">
          <h3>
            Climbed <span className="badge badge-fresh">{climbed.length}</span>
          </h3>
          {climbed.length === 0 ? (
            <p className="empty">Nobody climbed a tier.</p>
          ) : (
            <ul>
              {climbed.map((row) => (
                <li key={row.player_id}>
                  <Who row={row} /> {row.previous_tier} → <strong>{row.tier}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="movement-card movement-down">
          <h3>
            Slipped <span className="badge badge-missing">{slipped.length}</span>
          </h3>
          {slipped.length === 0 ? (
            <p className="empty">Nobody dropped a tier.</p>
          ) : (
            <ul>
              {slipped.map((row) => (
                <li key={row.player_id}>
                  <Who row={row} /> {row.previous_tier} → <strong>{row.tier}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="movement-card">
          <h3>Biggest gain</h3>
          {best === null ? (
            <p className="empty">No score rose this period.</p>
          ) : (
            <p>
              <Who row={best} /> <strong>+{score(best.score_change ?? 0)}</strong>
              <br />
              <span className="subtle">
                now {best.activity_score === null ? '—' : score(best.activity_score)}
                {best.tier !== null && ` · ${best.tier}`}
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
