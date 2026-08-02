import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { rankPeriodEnd, rankPeriodStart, rankPeriodWeekEnds } from '../../lib/rankPeriod';
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

async function fetchPeriod(periodStart: Date): Promise<RankRow[]> {
  const { data, error } = await supabase
    .from('rank_period_snapshots')
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

  // The period now in progress, the one before it — which is the newest one
  // with a complete fortnight behind it — and the one before that, which is
  // what it gets compared against.
  const current = rankPeriodStart(new Date());
  const closed = new Date(current.getTime() - 14 * 24 * 3600 * 1000);
  const previous = new Date(closed.getTime() - 14 * 24 * 3600 * 1000);

  const report = useQuery({
    queryKey: ['rank-report', closed.toISOString()],
    queryFn: async () => {
      const [now, before] = await Promise.all([fetchPeriod(closed), fetchPeriod(previous)]);
      return { now, before };
    },
  });

  const build = useMutation({
    mutationFn: async (periodStart: Date) => {
      const { error } = await supabase.rpc('build_rank_period', {
        p_period_start: periodStart.toISOString(),
      });
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      setFailed(false);
      setMessage('Worked out from the captures inside the period.');
      void queryClient.invalidateQueries({ queryKey: ['rank-report'] });
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
      <p className="subtle">
        Period <strong>{iso(closed)}</strong> to <strong>{iso(rankPeriodEnd(closed))}</strong>.
        Contribution and duel were read at {iso(firstWeek)} 01:59Z and {iso(secondWeek)} 01:59Z —
        one minute before the game clears each week — and power at the period's own two boundaries.
      </p>

      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}

      <div className="row">
        <button disabled={build.isPending} onClick={() => build.mutate(closed)} type="button">
          {now.length === 0 ? 'Work out this period' : 'Rebuild'}
        </button>
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
