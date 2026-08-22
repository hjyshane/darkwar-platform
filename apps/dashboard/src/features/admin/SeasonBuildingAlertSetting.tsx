import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ALERT_SETTING_KEY,
  DEFAULT_ALERT,
  type SeasonBuildingAlert,
  fetchAlert,
} from '../../lib/seasonBuildingAlert';
import { supabase } from '../../lib/supabase';

/** The threshold behind the "!" on the season building board.
 *
 * Two controls because they are two decisions. The LEVEL is what the officers
 * are asking for this week and moves as the season moves; the SWITCH is
 * whether the board says anything about it at all. Keeping them separate
 * means an officer can set next week's target without every member seeing an
 * exclamation mark against their name until the alliance has agreed it.
 */
export function SeasonBuildingAlertSetting() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<SeasonBuildingAlert | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { data, error, isPending } = useQuery({
    queryKey: ['season-building-alert-admin'],
    queryFn: fetchAlert,
  });

  // Seed the editable copy once the saved value arrives, and again if it
  // changes underneath — another admin saving, or this one.
  useEffect(() => {
    if (data !== undefined) {
      setDraft(data);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async (next: SeasonBuildingAlert) => {
      const { error: writeError } = await supabase
        .from('app_settings')
        // `value` is jsonb, typed as Json by the generated types; the
        // setting is a plain object of a number and a boolean, which is
        // Json, but the interface does not carry an index signature.
        .upsert({ key: ALERT_SETTING_KEY, value: { ...next } });
      if (writeError) {
        throw new Error(writeError.message);
      }
    },
    onSuccess: () => {
      setFailed(false);
      setMessage('Saved.');
      // Both the admin copy and the one the board reads.
      queryClient.invalidateQueries({ queryKey: ['season-building-alert-admin'] });
      queryClient.invalidateQueries({ queryKey: ['season-building-alert'] });
    },
    onError: (saveError: Error) => {
      setFailed(true);
      setMessage(`Could not save: ${saveError.message}`);
    },
  });

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the setting: {(error as Error).message}</p>;
  }

  const current = draft ?? DEFAULT_ALERT;

  return (
    <div className="setting">
      <p className="note">
        Members holding any building below this level get a <strong>!</strong> before their name on
        the season building board. A building nobody has seen yet is not counted as behind — an
        empty cell means the collector has not panned over it, not that it is unbuilt.
      </p>

      <label htmlFor="season-alert-level">
        Level
        <input
          id="season-alert-level"
          type="number"
          min={1}
          max={99}
          value={current.level}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            setDraft({ ...current, level: Number.isFinite(next) ? next : current.level });
          }}
        />
      </label>

      <label htmlFor="season-alert-enabled">
        <input
          id="season-alert-enabled"
          type="checkbox"
          checked={current.enabled}
          onChange={(event) => setDraft({ ...current, enabled: event.target.checked })}
        />
        Mark members who are below it
      </label>

      <button
        type="button"
        onClick={() => save.mutate(current)}
        disabled={save.isPending || current.level < 1}
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </button>

      {message !== null && <p className={failed ? 'error' : 'note'}>{message}</p>}
    </div>
  );
}
