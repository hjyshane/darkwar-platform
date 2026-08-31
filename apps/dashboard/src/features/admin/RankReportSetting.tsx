import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  rankPeriodLastDay,
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
export interface RankRow {
  player_id: string;
  name: string | null;
  donation_total: number | null;
  duel_total: number | null;
  power_growth: number | null;
  activity_score: number | null;
  offline_hours: number | null;
  tier: string | null;
  tier_reason: string | null;
  /** 0155: a week that WAS read came in under the alliance floor. Recorded for
   * everyone, including the officers and newcomers it cannot demote. */
  below_minimum: boolean | null;
  minimum_missed: string | null;
  /** 0159: the season building's level as it stood at the END of this period,
   * and the points it moved the score by. Null level means no sighting at or
   * before then — a gap in the sweep, never a penalty. Both are absent from
   * every period scored before version 6, which is why the column hides
   * itself rather than printing a row of dashes. */
  lab_level: number | null;
  lab_adjustment: number | null;
  /** When this answer was worked out. Shown beside the tier counts: the table
   * redraws identically when a rebuild lands close to the previous one, and
   * without a timestamp "nothing changed" and "nothing happened" look the
   * same — which cost two misread rebuilds on 2026-08-12. */
  computed_at: string;
}

const TIER_ORDER: Record<string, number> = { R1: 1, R2: 2, R3: 3 };

/** The Why column, in the words an officer would use.
 *
 * IT USED TO PRINT 'score' FOR EVERYTHING IT DID NOT RECOGNISE. Only `offline`
 * and the minimums were special-cased, so the two reasons that produce a BLANK
 * tier — an officer who is measured but not ranked (0072), and a newcomer with
 * less than a fortnight of history — both came out as "score" beside an empty
 * rank and an empty figure. On the 2026-08-17 period that was fourteen of
 * ninety-six rows claiming a score nobody had computed.
 *
 * The reasons are matched by PREFIX rather than in full, so rewording the
 * sentence in a later migration degrades to showing the migration's own text
 * instead of silently falling back to "score" again. The scorer's wording is
 * the fallback, never a guess.
 */
export function whyLabel(row: RankRow): string {
  const reason = row.tier_reason ?? '';
  if (reason === 'offline') {
    return `offline ${Math.round(row.offline_hours ?? 0)}h`;
  }
  if (row.below_minimum === true) {
    return `under weekly ${row.minimum_missed ?? 'minimum'}`;
  }
  if (reason.startsWith('not measured')) {
    return 'joined too recently to score';
  }
  if (reason.startsWith('measured but not ranked')) {
    return 'officer — measured, not ranked';
  }
  if (reason.startsWith('nothing was captured')) {
    return 'nothing captured this period';
  }
  const lab = row.lab_adjustment ?? 0;
  if (lab !== 0) {
    return `score, season building ${lab > 0 ? '+' : ''}${lab}`;
  }
  return reason === '' ? 'score' : reason;
}

/** The period the Members tab will compare this one against.
 *
 * Mirrors `rank_period_movement` (0100): the newest earlier period that was
 * built under the SAME scoring version. Null when there is none, which is a
 * first assignment rather than a missing figure.
 */
async function fetchPreviousPeriod(periodStart: Date): Promise<Date | null> {
  const at = periodStart.toISOString();
  const current = await supabase
    .from('rank_period_snapshots')
    .select('scoring_version')
    .eq('period_start', at)
    .order('scoring_version', { ascending: false })
    .limit(1);
  if (current.error !== null || current.data.length === 0) {
    return null;
  }
  const version = current.data[0]?.scoring_version;
  if (version === undefined || version === null) {
    // A period built with no version recorded cannot be matched against one,
    // and guessing would compare two different scoring rules — the thing 0100
    // exists to prevent.
    return null;
  }
  const prior = await supabase
    .from('rank_period_snapshots')
    .select('period_start')
    .lt('period_start', at)
    .eq('scoring_version', version)
    .order('period_start', { ascending: false })
    .limit(1);
  if (prior.error !== null || prior.data.length === 0) {
    return null;
  }
  const found = prior.data[0]?.period_start;
  return found === undefined ? null : new Date(found);
}

async function fetchPeriod(periodStart: Date): Promise<RankRow[]> {
  const { data, error } = await supabase
    // The view, not the table. 0071 added `scoring_version` so an old answer
    // can be kept rather than rewritten, which means the table now holds more
    // than one row per member per period — reading it directly shows somebody
    // twice as soon as a period is rebuilt under a new version. The view keeps
    // the newest.
    .from('rank_period_latest')
    .select(
      'player_id, name, donation_total, duel_total, power_growth, activity_score, offline_hours, tier, tier_reason, below_minimum, minimum_missed, lab_level, lab_adjustment, computed_at',
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
  // Tier changes, or the whole roster with its score movement. Component state:
  // it is a way of looking at one answer, not a property of the answer.
  const [showAll, setShowAll] = useState(false);

  // The period now in progress. It is both the default and the one the Build
  // button acts on, so the fortnight the alliance is actually living in is the
  // one that gets built.
  const current = rankPeriodStart(new Date());

  // Which period the screen is looking at.
  //
  // It used to be `newestClosed` and nothing else, and on a young database that
  // is a screen showing two empty fortnights: every figure read zero and the
  // dates looked stale, because they were. The picker fixed that.
  //
  // THE DEFAULT IS NOW THE PERIOD IN PROGRESS, and that changed for a reason
  // worth writing down. Pressing Build built whatever the screen was pointed
  // at, and the screen pointed at the newest CLOSED period — so on the morning
  // a new fortnight opened, Build rebuilt the old one and the Members tab went
  // on showing the fortnight before that. Nothing was broken and nothing said
  // so: the movement highlights read from the newest period that EXISTS, and
  // the new one had never been created by anybody.
  //
  // Building a period that has not finished gives a partial answer rather than
  // a wrong one, and the screen says so below. A stale answer says nothing.
  const [chosen, setChosen] = useState<string | null>(null);
  const viewing = chosen === null ? current : new Date(chosen);
  const inProgress = viewing.getTime() === current.getTime();

  // Grid boundaries rather than free dates: a period boundary IS a game week
  // boundary, and an arbitrary start puts the two weekly contribution readings
  // somewhere the game never cleared a board. See recentRankPeriods.
  const options = recentRankPeriods(new Date(), 6);

  const report = useQuery({
    queryKey: ['rank-report', viewing.toISOString()],
    queryFn: async () => {
      // ASKED, NOT CALCULATED. This used to be `viewing - 14 days`, and the
      // Members tab does something else: `rank_period_movement` (0100) takes
      // the most recent EARLIER period carrying the SAME scoring version,
      // because subtracting two periods scored by different rules reports the
      // difference between the rules rather than between the people.
      //
      // With a period missing from the grid or built under an older version —
      // production has both — the two screens then disagree about what
      // "previous" means and show different tables for the same fortnight.
      // That was the bug. One rule, and it is the view's.
      const previousStart = await fetchPreviousPeriod(viewing);
      const [now, before] = await Promise.all([
        fetchPeriod(viewing),
        previousStart === null ? Promise.resolve([]) : fetchPeriod(previousStart),
      ]);
      return { now, before, previousStart };
    },
  });

  // Sending is separate from building on purpose, and manual on purpose. The
  // message names people who were demoted; nobody should learn they dropped a
  // tier because a rebuild happened to run. An officer presses Build, reads the
  // table, and only then decides to post it.
  const announce = useMutation({
    mutationFn: async () => {
      // The function composes the message server-side and picks the channel
      // from the notification routing. The browser deliberately cannot say what
      // gets posted: 0076 allows a browser to insert only `event = 'test'`, so
      // that nothing can put arbitrary words into the alliance channel over the
      // collector's name.
      const { data, error } = await supabase.rpc('announce_rank_period');
      if (error) {
        throw new Error(error.message);
      }
      return data as string;
    },
    onSuccess: (outcome) => {
      setFailed(false);
      // The function reports what it decided — queued, already sent, switched
      // off, nothing finished yet. All four are ordinary outcomes and none of
      // them is an error, so they read the same way.
      setMessage(outcome);
    },
    onError: (mutationError: Error) => {
      setFailed(true);
      setMessage(mutationError.message);
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

  const [firstWeek, secondWeek] = rankPeriodWeekEnds(viewing);

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

  // Everyone, by score. A TIER change is a step over a percentile boundary, so
  // a member can gain fifteen points and still read as "no change" — which is
  // most of the alliance most of the time, and exactly the movement an officer
  // wants to see before deciding anything. The tier list stays the default
  // because it is the list that produces a decision; this one is the evidence
  // behind it.
  const everyone = [...now].sort(
    (left, right) => (right.activity_score ?? -1) - (left.activity_score ?? -1),
  );
  const rows = showAll ? everyone : changed;

  // The season column appears only for a period the season rule actually
  // touched. Judged on the WHOLE period (`now`), not on the filtered `rows`,
  // so the column does not come and go as the "show everyone" toggle moves.
  //
  // Between seasons — and for every period scored before version 6 — this is
  // a column of dashes that says nothing, and a report an officer has to
  // defend a demotion from is the wrong place for one.
  const showsLab = now.some((row) => row.lab_level !== null || (row.lab_adjustment ?? 0) !== 0);

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
          value={viewing.toISOString()}
        >
          {options.map((start) => (
            <option key={start.toISOString()} value={start.toISOString()}>
              {iso(start)} to {iso(rankPeriodLastDay(start))}
              {start.getTime() === current.getTime() ? ' (in progress)' : ''}
            </option>
          ))}
        </select>
      </label>

      <p className="subtle">
        Period <strong>{iso(viewing)}</strong> to <strong>{iso(rankPeriodLastDay(viewing))}</strong>
        . Contribution and duel were read at {iso(firstWeek)} 01:59Z and {iso(secondWeek)} 01:59Z —
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
          <br />
          {/* Because a button that visibly does nothing reads as broken. 0089
              exists because "the computed rank did not follow the rebuild" was a
              real complaint; 0134 makes that deliberately true again for the
              unfinished period, and the place to say so is next to the button
              rather than in a migration nobody on this screen can see. */}
          It will show here, but not on the Members tab or on anybody's player page — those show the
          last finished fortnight until this one closes on {iso(rankPeriodLastDay(viewing))}.
        </p>
      )}

      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}

      <div className="row">
        <button disabled={build.isPending} onClick={() => build.mutate(viewing)} type="button">
          {now.length === 0 ? 'Work out this period' : 'Rebuild'}
        </button>
        {/* Always the newest FINISHED period, whatever the picker is showing,
            because that is the period `rank_period_movement` describes — and
            0100 keeps the "previous period of the same version" rule in one
            place. The function says so when the two disagree. */}
        <button disabled={announce.isPending} onClick={() => announce.mutate()} type="button">
          {announce.isPending ? 'Sending…' : 'Send to Discord'}
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
            {/* The newest row's timestamp IS the rebuild's: every row a pass
                writes carries the same computed_at. Without this, a rebuild
                that lands near the previous one redraws the table identically
                and reads as a click that did nothing. */}
            {' · worked out '}
            {new Date(Math.max(...now.map((row) => Date.parse(row.computed_at))))
              .toISOString()
              .slice(0, 16)
              .replace('T', ' ')}
            Z
          </span>
        )}
      </div>

      {now.length > 0 && (
        <div className="row">
          <button
            className={showAll ? '' : 'active'}
            onClick={() => setShowAll(false)}
            type="button"
          >
            Rank changes ({changed.length})
          </button>
          <button
            className={showAll ? 'active' : ''}
            onClick={() => setShowAll(true)}
            type="button"
          >
            Everyone ({everyone.length})
          </button>
        </div>
      )}

      {now.length === 0 ? (
        <p className="empty">
          Nothing worked out for this period yet. Building it reads the captures that fall inside it
          — if the collector did not run near the two week endings, the figures will be short by
          however much it missed.
        </p>
      ) : !showAll && before.length === 0 ? (
        <p className="empty">
          No previous period to compare against, so every rank here is a first assignment rather
          than a change. Everyone still lists this period's scores.
        </p>
      ) : rows.length === 0 ? (
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
                {showsLab && <th className="num">Season</th>}
                <th className="label">Why</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const previous = beforeByPlayer.get(row.player_id);
                const was = previous?.tier ?? '—';
                const moved = row.tier != null && was !== '—' && was !== row.tier;
                const up = (TIER_ORDER[row.tier ?? ''] ?? 0) > (TIER_ORDER[was] ?? 0);
                // Null on either side is not a delta of zero — a member with no
                // score last period has not stood still, they were unmeasured.
                const delta =
                  row.activity_score === null || (previous?.activity_score ?? null) === null
                    ? null
                    : row.activity_score - (previous?.activity_score as number);
                return (
                  <tr key={row.player_id}>
                    <td className="label">
                      {row.below_minimum === true && (
                        // The demotion is already in the tier; this says WHY,
                        // and says it to the person who has to defend it.
                        <span
                          aria-label={`Below the weekly ${row.minimum_missed ?? ''} minimum`}
                          className="below-minimum"
                          title={`Below the weekly ${row.minimum_missed ?? 'minimum'}`}
                        >
                          ●
                        </span>
                      )}
                      {row.name ?? row.player_id.slice(0, 8)}
                    </td>
                    <td className={`label ${moved ? (up ? 'growth-up' : 'growth-down') : ''}`}>
                      {moved ? `${was} → ${row.tier}` : (row.tier ?? '—')}
                    </td>
                    <td className="num">
                      {row.activity_score === null ? '—' : row.activity_score.toFixed(1)}
                      {delta !== null && Math.abs(delta) >= 0.05 && (
                        <span className={delta > 0 ? 'growth-up' : 'growth-down'}>
                          {' '}
                          {delta > 0 ? '+' : ''}
                          {delta.toFixed(1)}
                        </span>
                      )}
                    </td>
                    <td className="num">{row.donation_total?.toLocaleString('ko-KR') ?? '—'}</td>
                    <td className="num">{row.duel_total?.toLocaleString('ko-KR') ?? '—'}</td>
                    <td className={`num ${(row.power_growth ?? 0) < 0 ? 'growth-down' : ''}`}>
                      {row.power_growth === null ? '—' : `${row.power_growth.toFixed(1)}%`}
                    </td>
                    {showsLab && (
                      <td className="num">
                        {/* The level and what it cost, together. The level
                            alone does not say whether it mattered, and the
                            points alone do not say what to go and build. */}
                        {row.lab_level === null ? '—' : row.lab_level}
                        {(row.lab_adjustment ?? 0) !== 0 && (
                          <span
                            className={
                              (row.lab_adjustment as number) > 0 ? 'growth-up' : 'growth-down'
                            }
                          >
                            {' '}
                            {(row.lab_adjustment as number) > 0 ? '+' : ''}
                            {row.lab_adjustment}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="label">
                      {/* Away is not the same as idle, and the person being
                          demoted will ask which one it was. */}
                      {whyLabel(row)}
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
