import { resetWeekStart } from '@dw/game-clock';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../../lib/supabase';

/** The last `count` game weeks, newest first, each named by its reset
 * instant — the only form `enter_weekly_scores` accepts (0176). */
export function recentWeeks(now: Date, count: number): string[] {
  const current = resetWeekStart(now).getTime();
  return Array.from({ length: count }, (_, index) =>
    new Date(current - index * 7 * 86_400_000).toISOString(),
  );
}

/** A typed score, or null when the box is empty.
 *
 * Commas and spaces are dropped, because scores are copied off a game screen
 * that prints `1,234,567`. Anything else that is not a whole number comes
 * back as NaN, so the form can say which box is wrong instead of saving a
 * zero somebody did not type.
 */
export function parseScore(typed: string): number | null {
  const bare = typed.replace(/[,\s]/g, '');
  if (bare === '') {
    return null;
  }
  return /^\d+$/.test(bare) ? Number(bare) : Number.NaN;
}

export interface TypedRow {
  duel: string;
  donation: string;
}

export interface WeeklyEntry {
  player_id: string;
  duel: number | null;
  donation: number | null;
}

/** What the draft sends: only members with something typed, and only the
 * boards that were typed. An empty box is "leave it", never zero. */
export function entriesFrom(draft: ReadonlyMap<string, TypedRow>): WeeklyEntry[] {
  return [...draft].flatMap(([playerId, row]) => {
    const duel = parseScore(row.duel);
    const donation = parseScore(row.donation);
    return duel === null && donation === null ? [] : [{ player_id: playerId, duel, donation }];
  });
}

interface WeekScore {
  player_id: string;
  current_name: string | null;
  duel: number | null;
  duel_typed: boolean | null;
  donation: number | null;
  donation_typed: boolean | null;
}

async function fetchWeekScores(week: string): Promise<WeekScore[]> {
  const { data, error } = await supabase.rpc('week_scores', { p_week_start: week });
  if (error) {
    throw new Error(`week scores query failed: ${error.message}`);
  }
  return (data ?? []) as WeekScore[];
}

/** One board's cell: what is on record, and a box to type into when typing
 * can still make a difference.
 *
 * A CAPTURED READING HAS NO BOX. The collector always wins (0176), so a value
 * typed over a capture would be saved, ignored by every reader, and look
 * like it had worked. */
function ScoreCell({
  value,
  typed,
  draft,
  onChange,
  label,
}: {
  value: number | null;
  typed: boolean | null;
  draft: string;
  onChange: (next: string) => void;
  label: string;
}) {
  if (value !== null && typed === false) {
    return (
      <td className="num">
        {value.toLocaleString('ko-KR')}{' '}
        <span className="badge" title="Read by the collector. A typed value would be ignored.">
          captured
        </span>
      </td>
    );
  }
  const bad = Number.isNaN(parseScore(draft));
  return (
    <td className="num">
      {value !== null && (
        <>
          {value.toLocaleString('ko-KR')}{' '}
          <span className="badge" title="Typed in by hand. A capture from this week replaces it.">
            typed
          </span>{' '}
        </>
      )}
      <input
        aria-invalid={bad}
        aria-label={label}
        inputMode="numeric"
        onChange={(event) => onChange(event.target.value)}
        placeholder={value === null ? '—' : 'correct'}
        size={12}
        value={draft}
      />
    </td>
  );
}

/** Weekly duel and donation totals, typed in for a week the collector
 * missed.
 *
 * WHAT THE RANK IS BUILT FROM, and nothing more: the weekly boards, one game
 * week at a time. Typed values are ordinary readings stamped at the start of
 * their week, so a capture from the same week — even one synced much later —
 * replaces them without anybody having to tidy up.
 */
export function ManualScoresSetting() {
  const queryClient = useQueryClient();
  const [weeks] = useState(() => recentWeeks(new Date(), 8));
  const [week, setWeek] = useState(weeks[0] ?? '');
  const [draft, setDraft] = useState<Map<string, TypedRow>>(new Map());
  const [note, setNote] = useState<string | null>(null);

  const { data, error, isPending } = useQuery({
    queryKey: ['week-scores', week],
    queryFn: () => fetchWeekScores(week),
  });

  const entries = entriesFrom(draft);
  const invalid = entries.some(
    (entry) => Number.isNaN(entry.duel ?? 0) || Number.isNaN(entry.donation ?? 0),
  );

  const save = useMutation({
    mutationFn: async () => {
      const { data: written, error: saveError } = await supabase.rpc('enter_weekly_scores', {
        p_week_start: week,
        p_entries: entries as unknown as never,
      });
      if (saveError) {
        throw new Error(saveError.message);
      }
      return written ?? 0;
    },
    onSuccess: (written) => {
      setDraft(new Map());
      setNote(`Saved ${written} score${written === 1 ? '' : 's'}.`);
      // The roster's weekly columns, the current period and the rank report
      // all read what was just written.
      void queryClient.invalidateQueries();
    },
    onError: (saveError: Error) => setNote(saveError.message),
  });

  function type(playerId: string, board: keyof TypedRow, value: string) {
    const next = new Map(draft);
    const row = next.get(playerId) ?? { duel: '', donation: '' };
    next.set(playerId, { ...row, [board]: value });
    setDraft(next);
    setNote(null);
  }

  const rows = data ?? [];
  return (
    <>
      <p className="subtle">
        For weeks the collector could not run. Type each member's <strong>weekly</strong> total as
        the game shows it at the end of the week. A reading the collector captured always wins, so a
        captured score has no box, and anything typed here is replaced as soon as a capture from the
        same week arrives.
      </p>
      <label>
        Week starting{' '}
        <select
          onChange={(event) => {
            setWeek(event.target.value);
            setDraft(new Map());
            setNote(null);
          }}
          value={week}
        >
          {weeks.map((entry, index) => (
            <option key={entry} value={entry}>
              {entry.slice(0, 10)}
              {index === 0 ? ' (this week)' : ''}
            </option>
          ))}
        </select>
      </label>

      {isPending ? (
        <p className="empty">Loading…</p>
      ) : error ? (
        <p className="error">Could not load this week: {error.message}</p>
      ) : rows.length === 0 ? (
        <p className="empty">Nobody is on the roster to enter scores for.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Member</th>
              <th scope="col">Duel (weekly)</th>
              <th scope="col">Donation (weekly)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const typedRow = draft.get(row.player_id) ?? { duel: '', donation: '' };
              return (
                <tr key={row.player_id}>
                  <td className="label">{row.current_name ?? '—'}</td>
                  <ScoreCell
                    draft={typedRow.duel}
                    label={`Duel score for ${row.current_name ?? 'this member'}`}
                    onChange={(value) => type(row.player_id, 'duel', value)}
                    typed={row.duel_typed}
                    value={row.duel}
                  />
                  <ScoreCell
                    draft={typedRow.donation}
                    label={`Donation score for ${row.current_name ?? 'this member'}`}
                    onChange={(value) => type(row.player_id, 'donation', value)}
                    typed={row.donation_typed}
                    value={row.donation}
                  />
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p>
        <button
          disabled={entries.length === 0 || invalid || save.isPending}
          onClick={() => save.mutate()}
          type="button"
        >
          {entries.length === 0
            ? 'Nothing typed'
            : `Save ${entries.length} member${entries.length === 1 ? '' : 's'}`}
        </button>{' '}
        {invalid && <span className="error">Scores are whole numbers.</span>}
        {note !== null && <span className={save.isError ? 'error' : 'subtle'}>{note}</span>}
      </p>
    </>
  );
}
