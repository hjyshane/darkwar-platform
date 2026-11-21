import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { saveAllianceSetting } from '../../lib/allianceSetting';
import {
  DEFAULT_TRENDS,
  MAX_TOWER_LEVEL,
  TRENDS_SETTING_KEY,
  type AllianceTrendsSetting as Trends,
  fetchTrendsSetting,
} from '../../lib/allianceTrendsSetting';

/** The two figures on the alliance page's Activity tab an officer gets to
 * define: which tower level is worth counting, and where "since" starts.
 *
 * Stored per alliance (0342), like the season building alert — everybody who
 * opens the page sees the same count against the same level, because a number
 * two officers read differently is not a number they can discuss. */
export function AllianceTrendsSetting() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Trends | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { data, error, isPending } = useQuery({
    queryKey: ['alliance-trends-setting-admin'],
    queryFn: fetchTrendsSetting,
  });

  useEffect(() => {
    if (data !== undefined) {
      setDraft(data);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async (next: Trends) => {
      await saveAllianceSetting(TRENDS_SETTING_KEY, { ...next });
    },
    onSuccess: () => {
      setFailed(false);
      setMessage('Saved.');
      // Both the admin copy and the one the alliance page reads.
      queryClient.invalidateQueries({ queryKey: ['alliance-trends-setting-admin'] });
      queryClient.invalidateQueries({ queryKey: ['alliance-trends-setting'] });
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

  const current = draft ?? DEFAULT_TRENDS;

  return (
    <div className="setting">
      <p className="note">
        Two figures on the alliance page's Activity tab. The tower level is the one the "Tower N or
        higher" count and its chart line are measured against. The start date is where every "since"
        figure — the power change and the change in mean tower level — is measured from: the first
        complete capture on or after that day. Leave the date empty to measure from the first
        capture there is.
      </p>

      <label htmlFor="alliance-trends-level">
        Tower level to count from{' '}
        <input
          id="alliance-trends-level"
          max={MAX_TOWER_LEVEL}
          min={1}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            // An emptied box goes back to the default rather than storing a
            // level nobody typed.
            setDraft({
              ...current,
              towerLevel:
                Number.isFinite(next) && next >= 1
                  ? Math.min(next, MAX_TOWER_LEVEL)
                  : DEFAULT_TRENDS.towerLevel,
            });
          }}
          type="number"
          value={current.towerLevel}
        />
      </label>

      <label htmlFor="alliance-trends-since">
        Measure changes since{' '}
        <input
          id="alliance-trends-since"
          onChange={(event) =>
            setDraft({ ...current, since: event.target.value === '' ? null : event.target.value })
          }
          type="date"
          value={current.since ?? ''}
        />
      </label>
      {current.since !== null && (
        <button onClick={() => setDraft({ ...current, since: null })} type="button">
          Back to the first capture
        </button>
      )}

      <button disabled={save.isPending} onClick={() => save.mutate(current)} type="button">
        {save.isPending ? 'Saving…' : 'Save'}
      </button>

      {message !== null && <p className={failed ? 'error' : 'note'}>{message}</p>}
    </div>
  );
}
