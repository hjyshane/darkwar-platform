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

/** `rank_period_movement` waits for a fortnight to finish (0132); the preview view
 * (0275) is its mirror and reads only the fortnight still running. Which one is
 * asked for is the reader's explicit choice - see the toggle below. */
type MovementSource = 'rank_period_movement' | 'rank_period_movement_preview';

async function fetchMovement(source: MovementSource): Promise<MovementRow[]> {
  const { data, error } = await supabase
    .from(source)
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

export function RankMovement() {
  // Off by default and per visit: the finished fortnight is the headline, and a
  // partial answer must be asked for each time rather than remembered.
  const [preview, setPreview] = useState(false);

  const finished = useQuery({
    queryKey: ['rank-movement'],
    queryFn: () => fetchMovement('rank_period_movement'),
  });
  const running = useQuery({
    queryKey: ['rank-movement-preview'],
    queryFn: () => fetchMovement('rank_period_movement_preview'),
    enabled: preview,
  });

  if (finished.isPending || finished.error) {
    // Silent on both. This is a summary above a table that stands on its own, and a
    // loading line or an error banner above the roster would push the roster down
    // for something nobody came here for. The error still surfaces in the console.
    return null;
  }

  const toggle = (
    <p>
      <button type="button" onClick={() => setPreview((on) => !on)}>
        {preview ? 'Back to the last finished period' : 'Preview the fortnight in progress'}
      </button>
    </p>
  );

  if (preview) {
    if (running.isPending) {
      return (
        <div className="rank-movement">
          {toggle}
          <p className="subtle">Loading the preview…</p>
        </div>
      );
    }
    if (running.error) {
      return (
        <div className="rank-movement">
          {toggle}
          <p className="empty">The preview could not be loaded.</p>
        </div>
      );
    }
    return (
      <div className="rank-movement">
        {toggle}
        <p className="subtle">
          <strong>Preview.</strong> This fortnight is still running, so every reading in it is
          partial. Tiers can still move before it finishes.
        </p>
        <MovementBody rows={running.data ?? []} emptyNote="No fortnight is running right now." />
      </div>
    );
  }

  const rows = finished.data ?? [];
  if (rows.length === 0) {
    return <div className="rank-movement">{toggle}</div>;
  }

  return (
    <div className="rank-movement">
      {toggle}
      <MovementBody rows={rows} emptyNote="" />
    </div>
  );
}

function MovementBody({ rows, emptyNote }: { rows: MovementRow[]; emptyNote: string }) {
  const compared = rows.filter((row) => row.tier_change !== null);
  if (rows.length === 0) {
    return emptyNote === '' ? null : <p className="empty">{emptyNote}</p>;
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
    <>
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
    </>
  );
}
