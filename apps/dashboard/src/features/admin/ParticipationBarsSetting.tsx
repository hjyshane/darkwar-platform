import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { type Bars, NO_BARS, fetchBars, saveBar } from '../participation/data';

/** The daily score an officer counts as taking part, per board.
 *
 * Two optional numbers. Set one and the participation page gains a column
 * counting the days each member reached it; leave it empty and there is no
 * column and no judgement. The bar is the bar TODAY: changing it re-judges the
 * whole range, history included, because the page compares each day's score
 * with it when it is asked for, not when the day happened.
 */
export function ParticipationBarsSetting() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<{ duel: string; donation: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { data, error, isPending } = useQuery({
    queryKey: ['participation-bars'],
    queryFn: fetchBars,
  });

  // Seed the editable copy once the saved value arrives, and again if it changes.
  useEffect(() => {
    if (data !== undefined) {
      setDraft({ duel: data.duel?.toString() ?? '', donation: data.donation?.toString() ?? '' });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async (next: Bars) => {
      const saved = data ?? NO_BARS;
      // Only what changed: each call is a write the audit trail would show.
      if (next.duel !== saved.duel) await saveBar('duel', next.duel);
      if (next.donation !== saved.donation) await saveBar('donation', next.donation);
    },
    onSuccess: () => {
      setFailed(false);
      setMessage('Saved.');
      // The bars, and the report that was asked with the old ones.
      queryClient.invalidateQueries({ queryKey: ['participation-bars'] });
      queryClient.invalidateQueries({ queryKey: ['participation'] });
    },
    onError: (saveError: Error) => {
      setFailed(true);
      setMessage(`Could not save: ${saveError.message}`);
    },
  });

  if (isPending) {
    return <p className="empty loading">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the setting: {(error as Error).message}</p>;
  }

  const current = draft ?? { duel: '', donation: '' };
  const parse = (text: string): number | null => {
    const value = Number.parseInt(text, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  return (
    <div className="setting">
      <p className="note">
        The score that counts as taking part on a day. With a number here, the participation page
        shows how many days each member reached it, beside the days they scored at all. Leave a box
        empty for no bar. The bar applies to the whole range shown, history included — change it and
        every past day is judged against the new number.
      </p>

      <div className="row">
        <label htmlFor="bar-duel">
          Duel points per day
          <input
            id="bar-duel"
            inputMode="numeric"
            min={1}
            onChange={(event) => setDraft({ ...current, duel: event.target.value })}
            placeholder="no bar"
            type="number"
            value={current.duel}
          />
        </label>
        <label htmlFor="bar-donation">
          Donation per day
          <input
            id="bar-donation"
            inputMode="numeric"
            min={1}
            onChange={(event) => setDraft({ ...current, donation: event.target.value })}
            placeholder="no bar"
            type="number"
            value={current.donation}
          />
        </label>
      </div>

      <div className="row">
        <button
          className="primary"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({ duel: parse(current.duel), donation: parse(current.donation) })
          }
          type="button"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {message && <span className={failed ? 'error' : 'subtle'}>{message}</span>}
      </div>
    </div>
  );
}
