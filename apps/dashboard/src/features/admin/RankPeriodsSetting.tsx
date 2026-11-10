import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import {
  deleteRankPeriodOverride,
  fetchRecentRankPeriods,
  rankPeriodLastDay,
  rankPeriodWeeks,
  resetBoundariesAround,
  saveRankPeriodOverride,
  useRankPeriodOverrides,
} from '../../lib/rankPeriod';

/** Rank periods set by hand, beside the fortnightly grid they interrupt.
 *
 * The grid — every other Monday 02:00 UTC from 2026-08-03 — is the default
 * and stays the default. This is for the weeks it does not fit: a season that
 * opens on the wrong Monday, a server migration that empties the boards. An
 * officer sets a start and a length; the database (`rank_period_bounds`,
 * 0315) then answers from that period where it covers the instant, counts
 * fortnights from its end afterwards, and cuts the fortnight before it short.
 *
 * Resets only, from a list, because a period boundary has to be one the game
 * performs — the weekly readings sit twelve hours before each — and a free
 * date box would accept a Tuesday. The function refuses one anyway, in words.
 */
export function RankPeriodsSetting() {
  const queryClient = useQueryClient();
  const overrides = useRankPeriodOverrides();
  // What the rule now produces around today, so the effect of an entry can
  // be read off the same screen that made it.
  const upcoming = useQuery({
    queryKey: ['rank-periods', 5],
    queryFn: () => fetchRecentRankPeriods(5),
  });
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const done = (sentence: string) => {
    setFailed(false);
    setMessage(sentence);
    // The report screen's picker and the roster's running-period table both
    // read the rule; a changed period moves them.
    void queryClient.invalidateQueries({ queryKey: ['rank-period-overrides'] });
    void queryClient.invalidateQueries({ queryKey: ['rank-periods'] });
    void queryClient.invalidateQueries({ queryKey: ['current-period-contribution'] });
  };
  const fail = (error: Error) => {
    setFailed(true);
    setMessage(error.message);
  };

  const save = useMutation({
    mutationFn: saveRankPeriodOverride,
    onSuccess: () =>
      done(
        'Set. A period already worked out under the old boundaries keeps its rows; rebuild it under "Rank changes" if it should follow the new ones.',
      ),
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: deleteRankPeriodOverride,
    onSuccess: () => done('Removed. The fortnightly grid runs over those weeks again.'),
    onError: fail,
  });

  if (overrides.isPending) {
    return <p className="empty loading">Loading…</p>;
  }
  if (overrides.error) {
    return <p className="error">Could not load the hand-set periods: {overrides.error.message}</p>;
  }

  const list = overrides.data ?? [];
  const busy = save.isPending || remove.isPending;

  return (
    <div className="setting">
      <p className="note">
        Ranks are decided over a fortnight that starts every other Monday at 02:00 UTC. When a
        season or a migration does not fit that rhythm, set the period by hand here: a start on a
        weekly reset and a length of one to four weeks. The fortnights after it count from its end,
        and the one running up to it stops where it begins. Nothing already worked out changes until
        it is rebuilt.
      </p>
      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}

      <h3>Set by hand</h3>
      {list.length === 0 ? (
        <p className="empty">None. Every period is on the grid.</p>
      ) : (
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th scope="col">From (UTC)</th>
                <th scope="col">To</th>
                <th className="num" scope="col">
                  Weeks
                </th>
                <th className="label" scope="col">
                  Note
                </th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {list.map((entry) => (
                <tr key={entry.id}>
                  <td>{iso(entry.start)}</td>
                  <td>{iso(rankPeriodLastDay(entry.end))}</td>
                  <td className="num">{rankPeriodWeeks(entry.start, entry.end)}</td>
                  <td className="label">{entry.note ?? ''}</td>
                  <td>
                    <button disabled={busy} onClick={() => remove.mutate(entry.id)} type="button">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewPeriod busy={busy} onAdd={(entry) => save.mutate(entry)} />

      <h3>What the rule gives now</h3>
      {upcoming.data !== undefined && upcoming.data.length > 0 && (
        <ul className="subtle">
          {upcoming.data.map((period) => (
            <li key={period.start.toISOString()}>
              {iso(period.start)} to {iso(rankPeriodLastDay(period.end))}
              {period.overridden ? ' — set by hand' : ''}
              {period.inProgress ? ' — in progress' : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface NewPeriodProps {
  busy: boolean;
  onAdd: (entry: { start: Date; end: Date; note: string }) => void;
}

const WEEK_MS = 604_800_000;

function NewPeriod({ busy, onAdd }: NewPeriodProps) {
  // Six resets back, eight ahead: a season start is announced a few weeks out
  // and a migration is usually set after the fact.
  const boundaries = resetBoundariesAround(new Date(), 6, 8);
  const thisWeek = boundaries[6] as Date;
  const [start, setStart] = useState<string>(thisWeek.toISOString());
  const [weeks, setWeeks] = useState<string>('2');
  const [note, setNote] = useState('');

  const startDate = new Date(start);
  const endDate = new Date(startDate.getTime() + Number(weeks) * WEEK_MS);

  return (
    <form
      className="row"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd({ start: startDate, end: endDate, note });
      }}
    >
      <label>
        Starts (Monday 02:00 UTC)
        <Select onChange={setStart} value={start}>
          {boundaries.map((boundary) => (
            <option key={boundary.toISOString()} value={boundary.toISOString()}>
              {iso(boundary)}
              {boundary.getTime() === thisWeek.getTime() ? ' (this week)' : ''}
            </option>
          ))}
        </Select>
      </label>
      <label>
        Weeks
        <Select onChange={setWeeks} value={weeks}>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
        </Select>
      </label>
      <label>
        Note
        <input
          maxLength={200}
          onChange={(event) => setNote(event.target.value)}
          placeholder="season 4 start"
          type="text"
          value={note}
        />
      </label>
      <span className="subtle">
        {iso(startDate)} to {iso(rankPeriodLastDay(endDate))}
      </span>
      <button disabled={busy} type="submit">
        Set period
      </button>
    </form>
  );
}
