import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  rankPeriodEnd,
  rankPeriodStart,
  rankPeriodWeekEnds,
  recentRankPeriods,
} from '../../lib/rankPeriod';
import { supabase } from '../../lib/supabase';

/** Which members changed rank over the last two weeks, and why.
 *
 * The point of this screen is a decision made in the game, not in this app:
 * it says who to promote and who to demote, and the reason has to be legible
 * enough to defend to the person being demoted.
 *
 * There is no scheduler behind it. The period boundaries are fixed — every
 * other Monday 02:00 UTC — and the figures come from observations bounded by
 * those times, so opening this on Wednesday reports exactly what opening it
 * on Monday would have. What a scheduled job would add is a notification,
 * not an answer, and nothing here is currently running at 02:05 to send one.
 *
 * The period is built on open when it has no rows yet. Rebuilding is offered
 * because a capture that syncs late makes the answer better, and the
 * function is idempotent by design.
 */
interface RankRow {
  player_id: string;
  name: string | null;
  donation_total: number | null;
  duel_total: number | null;
  power_growth: number | null;
  activity_score: number | null;
  offline_hours: number | null;
  tier: string | null;
  tier_reason: string | null;
}

const TIER_ORDER: Record<string, number> = { R1: 1, R2: 2, R3: 3 };

/** A rank period is a fortnight. Written once rather than as
 * `14 * 24 * 3600 * 1000` at each of the four places that needed it. */
const PERIOD_MS = 14 * 24 * 3600 * 1000;

async function fetchPeriod(periodStart: Date): Promise<RankRow[]> {
  const { data, error } = await supabase
    // The view, not the table. 0071 added `scoring_version` so an old answer
    // can be kept rather than rewritten, which means the table now holds more
    // than one row per member per period — reading it directly shows somebody
    // twice as soon as a period is rebuilt under a new version. The view keeps
    // the newest.
    .from('rank_period_latest')
    .select(
      'player_id, name, donation_total, duel_total, power_growth, activity_score, offline_hours, tier, tier_reason',
    )
    .eq('period_start', periodStart.toISOString())
    .order('activity_score', { ascending: false, nullsFirst: false });
  if (error) {
    throw new Error(`rank period query failed: ${error.message}`);
  }
  return (data ?? []) as RankRow[];
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function RankReportSetting() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Whether this rebuild also clears hand-set R1-R3 ranks. Component state, not a
  // stored setting: it deletes something a person typed, so it should be a
  // decision made at the moment the button is pressed.
  const [applyToAssigned, setApplyToAssigned] = useState(false);

  // The period now in progress, and the newest one with a complete fortnight
  // behind it. That second one is the default to report on.
  const current = rankPeriodStart(new Date());
  const newestClosed = new Date(current.getTime() - PERIOD_MS);

  // Which period the screen is looking at.
  //
  // It used to be `newestClosed` and nothing else, and on a young database
  // that is a screen showing two empty fortnights: the grid is anchored at
  // 2026-07-27 02:00 UTC, so today the newest CLOSED period is 07-13 — before
  // this collector existed. Every figure read zero and the dates looked stale,
  // because they were. The only period with data in it is the one in progress,
  // and there was no way to ask for it.
  const [chosen, setChosen] = useState<string | null>(null);
  const closed = chosen === null ? newestClosed : new Date(chosen);
  const previous = new Date(closed.getTime() - PERIOD_MS);
  const inProgress = closed.getTime() === current.getTime();

  // Grid boundaries rather than free dates: a period boundary IS a game week
  // boundary, and an arbitrary start puts the two weekly contribution readings
  // somewhere the game never cleared a board. See recentRankPeriods.
  const options = recentRankPeriods(new Date(), 6);

  const report = useQuery({
    queryKey: ['rank-report', closed.toISOString()],
    queryFn: async () => {
      const [now, before] = await Promise.all([fetchPeriod(closed), fetchPeriod(previous)]);
      return { now, before };
    },
  });

  const build = useMutation({
    mutationFn: async (periodStart: Date) => {
      // `rebuild_rank_period`, not `build_rank_period` (0090). The wrapper is
      // the one allowed to touch `player_ranks`, and it only does so when the
      // box below is ticked and the caller may manage members.
      const { error } = await supabase.rpc('rebuild_rank_period', {
        p_period_start: periodStart.toISOString(),
        p_apply_to_assigned: applyToAssigned,
      });
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      setFailed(false);
      setMessage(
        applyToAssigned
          ? 'Worked out from the captures inside the period, and applied to R1-R3.'
          : 'Worked out from the captures inside the period. Hand-set ranks left alone.',
      );
      // EVERYTHING, not just this screen's own query. A rebuild changes the rank
      // and the score on the members table (`roster`), the movement highlights
      // (`rank-movement`) and every player page — and invalidating only
      // `rank-report` left all of those showing the previous answer until a
      // reload, which reads as "Rebuild did nothing".
      //
      // Coarse on purpose. A rebuild is a rare, deliberate act, and listing the
      // keys that depend on a rank is a list that goes stale the next time
      // somebody adds a screen that reads one.
      void queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      setFailed(true);
      setMessage(error.message);
    },
  });

  const [firstWeek, secondWeek] = rankPeriodWeekEnds(closed);

  if (report.isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (report.error) {
    return <p className="error">Could not load the report: {report.error.message}</p>;
  }

  const now = report.data?.now ?? [];
  const before = report.data?.before ?? [];
  const beforeByPlayer = new Map(before.map((row) => [row.player_id, row]));

  // Only the members whose tier moved. A list of everyone is the roster; the
  // report is the difference.
  const changed = now
    .filter((row) => {
      const was = beforeByPlayer.get(row.player_id)?.tier;
      return was != null && row.tier != null && was !== row.tier;
    })
    .sort((left, right) => {
      const l = TIER_ORDER[left.tier ?? ''] ?? 0;
      const r = TIER_ORDER[right.tier ?? ''] ?? 0;
      return r - l || (right.activity_score ?? 0) - (left.activity_score ?? 0);
    });

  const counts = now.reduce<Record<string, number>>((acc, row) => {
    const tier = row.tier ?? '—';
    acc[tier] = (acc[tier] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <label>
        Period
        {/* On the grid, not free dates. A period boundary is a game week
            boundary — Monday 02:00 UTC, every other one — and the two weekly
            contribution readings sit one minute before the game clears each
            week. An arbitrary start puts those readings in the wrong place and
            scores everybody at zero. */}
        <select
          onChange={(event) => {
            setChosen(event.target.value);
            // A success or error sentence describes the rebuild of the period
            // it ran on. Left standing while the reader switches periods, it
            // reads as that period's result — which is how a 07-20 success
            // masqueraded as an 08-03 one twice on 2026-08-12.
            setMessage(null);
          }}
          value={closed.toISOString()}
        >
          {options.map((start) => (
            <option key={start.toISOString()} value={start.toISOString()}>
              {iso(start)} to {iso(rankPeriodEnd(start))}
              {start.getTime() === current.getTime() ? ' (in progress)' : ''}
            </option>
          ))}
        </select>
      </label>

      <p className="subtle">
        Period <strong>{iso(closed)}</strong> to <strong>{iso(rankPeriodEnd(closed))}</strong>.
        Contribution and duel were read at {iso(firstWeek)} 01:59Z and {iso(secondWeek)} 01:59Z —
        one minute before the game clears each week — and power at the period's own two boundaries.
      </p>

      {inProgress && (
        // Said rather than refused. Building a period that has not finished is
        // a legitimate thing to want — on a young database it is the only
        // period with any captures in it — but its second weekly reading has
        // not happened yet, so half the contribution figures will be missing
        // and that must not read as somebody having contributed nothing.
        <p className="empty">
          This period is still running. Its second weekly reading is on {iso(secondWeek)}, so
          contribution and duel for week two are not in yet — building it now gives a partial
          answer, not a wrong one.
        </p>
      )}

      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}

      <div className="row">
        <button disabled={build.isPending} onClick={() => build.mutate(closed)} type="button">
          {now.length === 0 ? 'Work out this period' : 'Rebuild'}
        </button>
        {/* Off by default, and deliberately not remembered between visits.
            Ticking it DELETES the hand-set rank of everyone the period could
            grade, and there is no undo on this screen — so it has to be a thing
            somebody chose this time, not a setting they turned on in June. */}
        <label className="row">
          <input
            checked={applyToAssigned}
            onChange={(event) => setApplyToAssigned(event.target.checked)}
            type="checkbox"
          />
          <span>
            Overwrite hand-set R1–R3
            <br />
            <span className="subtle">
              Clears the override so the computed rank shows. R4 and R5 are never touched, and
              nobody the period could not grade is cleared.
            </span>
          </span>
        </label>
        {now.length > 0 && (
          <span className="subtle">
            {Object.entries(counts)
              .sort()
              .map(([tier, count]) => `${tier} ${count}`)
              .join(' · ')}
          </span>
        )}
      </div>

      {now.length === 0 ? (
        <p className="empty">
          Nothing worked out for this period yet. Building it reads the captures that fall inside it
          — if the collector did not run near the two week endings, the figures will be short by
          however much it missed.
        </p>
      ) : before.length === 0 ? (
        <p className="empty">
          No previous period to compare against, so every rank here is a first assignment rather
          than a change.
        </p>
      ) : changed.length === 0 ? (
        <p className="empty">Nobody changed rank this period.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="label">Member</th>
                <th className="label">Rank</th>
                <th className="num">Score</th>
                <th className="num">Donation</th>
                <th className="num">Duel</th>
                <th className="num">Power</th>
                <th className="label">Why</th>
              </tr>
            </thead>
            <tbody>
              {changed.map((row) => {
                const was = beforeByPlayer.get(row.player_id)?.tier ?? '—';
                const up = (TIER_ORDER[row.tier ?? ''] ?? 0) > (TIER_ORDER[was] ?? 0);
                return (
                  <tr key={row.player_id}>
                    <td className="label">{row.name ?? row.player_id.slice(0, 8)}</td>
                    <td className={`label ${up ? 'growth-up' : 'growth-down'}`}>
                      {was} → {row.tier}
                    </td>
                    <td className="num">
                      {row.activity_score === null ? '—' : row.activity_score.toFixed(1)}
                    </td>
                    <td className="num">{row.donation_total?.toLocaleString('ko-KR') ?? '—'}</td>
                    <td className="num">{row.duel_total?.toLocaleString('ko-KR') ?? '—'}</td>
                    <td className={`num ${(row.power_growth ?? 0) < 0 ? 'growth-down' : ''}`}>
                      {row.power_growth === null ? '—' : `${row.power_growth.toFixed(1)}%`}
                    </td>
                    <td className="label">
                      {/* Away is not the same as idle, and the person being
                          demoted will ask which one it was. */}
                      {row.tier_reason === 'offline'
                        ? `offline ${Math.round(row.offline_hours ?? 0)}h`
                        : 'score'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
