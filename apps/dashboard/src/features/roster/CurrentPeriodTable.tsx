// The fortnight now running, week by week.
//
// The members table shows the rank and score of the last FINISHED fortnight,
// and 0134 keeps it that way on purpose — a period with one of its two weekly
// readings taken is half an answer, and a rank that moves mid-fortnight is
// worse than one that waits. That leaves the alliance without any view of the
// two weeks they are actually in, which is where this tab comes in.
//
// SO IT SHOWS READINGS, NOT A SCORE. No percentile, no weights, no tier: the
// same two numbers the game puts on its own weekly boards, straight out of
// `member_current_period_contribution` (0157). Nothing here can move anybody's
// rank, which is what makes showing an unfinished fortnight safe.

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { underFloor, useRankMinimums } from '../../lib/rankMinimums';
import { supabase } from '../../lib/supabase';

interface PeriodRow {
  player_id: string;
  current_name: string | null;
  period_start: string;
  week1_end: string;
  week2_end: string;
  donation_week1: number | null;
  donation_week2: number | null;
  duel_week1: number | null;
  duel_week2: number | null;
  donation_total: number | null;
  duel_total: number | null;
}

/** Which slice of the fortnight the table is showing. `both` is the fortnight
 * to date, which is the figure the scorer will eventually work from. */
type Scope = 'week1' | 'week2' | 'both';

async function fetchCurrentPeriod(): Promise<PeriodRow[]> {
  const { data, error } = await supabase
    .from('member_current_period_contribution')
    .select(
      'player_id, current_name, period_start, week1_end, week2_end, donation_week1, donation_week2, duel_week1, duel_week2, donation_total, duel_total',
    )
    // One row per member (0157), so this counts people and PostgREST's
    // thousand-row cap is nowhere near.
    .limit(200);
  if (error) {
    if (error.code === '42501') {
      return [];
    }
    throw new Error(`current period query failed: ${error.message}`);
  }
  return (data ?? []) as PeriodRow[];
}

function day(iso: string | undefined): string {
  return iso === undefined ? '—' : iso.slice(0, 10);
}

/** The figures for the chosen slice. Null stays null all the way through:
 * a member with no reading has not contributed nothing, they have not been
 * read, and the table says "—" for exactly that reason. */
function slice(row: PeriodRow, scope: Scope): { donation: number | null; duel: number | null } {
  if (scope === 'week1') {
    return { donation: row.donation_week1, duel: row.duel_week1 };
  }
  if (scope === 'week2') {
    return { donation: row.donation_week2, duel: row.duel_week2 };
  }
  return { donation: row.donation_total, duel: row.duel_total };
}

export function CurrentPeriodTable() {
  const [scope, setScope] = useState<Scope>('both');
  const { data, error, isPending } = useQuery({
    queryKey: ['current-period-contribution'],
    queryFn: fetchCurrentPeriod,
  });
  const { data: minimums } = useRankMinimums();

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load this fortnight: {(error as Error).message}</p>;
  }
  const rows = data ?? [];
  if (rows.length === 0) {
    return <p className="empty">Nothing captured for this fortnight yet.</p>;
  }

  const first = rows[0] as PeriodRow;
  // The floor only applies per WEEK. Against the fortnight-to-date column it
  // would compare one number to a weekly figure and mark half the alliance.
  const floors =
    minimums?.enabled === true && scope !== 'both'
      ? { donation: minimums.donationWeekly, duel: minimums.duelWeekly }
      : { donation: 0, duel: 0 };

  const ordered = [...rows].sort((left, right) => {
    const l = slice(left, scope);
    const r = slice(right, scope);
    return (r.donation ?? -1) + (r.duel ?? -1) - ((l.donation ?? -1) + (l.duel ?? -1));
  });

  return (
    <>
      <p className="subtle">
        The fortnight that started <strong>{day(first.period_start)}</strong>. Week one closes{' '}
        {day(first.week1_end)}, week two {day(first.week2_end)} — the game clears each board a
        minute later. These are the readings themselves, not a score: the rank and score columns on
        the members table stay on the last finished fortnight until this one closes.
      </p>

      <div className="row">
        {(
          [
            ['week1', 'Week 1'],
            ['week2', 'Week 2'],
            ['both', 'Both weeks'],
          ] as const
        ).map(([id, label]) => (
          <button
            className={scope === id ? 'active' : ''}
            key={id}
            onClick={() => setScope(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {floors.donation > 0 || floors.duel > 0 ? (
        <p className="subtle">
          Red marks a week under the alliance minimum
          {floors.donation > 0 && <> — donation {floors.donation.toLocaleString('ko-KR')}</>}
          {floors.duel > 0 && <> — duel {floors.duel.toLocaleString('ko-KR')}</>}. A week with no
          reading is never marked: it has not happened, or the collector missed it.
        </p>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="label">Member</th>
              <th className="num">Donation</th>
              <th className="num">Duel</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((row) => {
              const { donation, duel } = slice(row, scope);
              const donationLow = underFloor(donation, floors.donation);
              const duelLow = underFloor(duel, floors.duel);
              return (
                <tr key={row.player_id}>
                  <td className="label">{row.current_name ?? row.player_id.slice(0, 8)}</td>
                  <td className={`num ${donationLow ? 'growth-down' : ''}`}>
                    {donationLow && (
                      <span
                        aria-label="Under the weekly donation minimum"
                        className="below-minimum"
                      >
                        ●
                      </span>
                    )}
                    {donation === null ? '—' : donation.toLocaleString('ko-KR')}
                  </td>
                  <td className={`num ${duelLow ? 'growth-down' : ''}`}>
                    {duelLow && (
                      <span aria-label="Under the weekly duel minimum" className="below-minimum">
                        ●
                      </span>
                    )}
                    {duel === null ? '—' : duel.toLocaleString('ko-KR')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
