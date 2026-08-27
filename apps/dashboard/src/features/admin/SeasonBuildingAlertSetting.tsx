import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ALERT_SETTING_KEY,
  DEFAULT_ALERT,
  type SeasonBuildingAlert,
  fetchAlert,
} from '../../lib/seasonBuildingAlert';
import { supabase } from '../../lib/supabase';
import { SEASON3_BUILDINGS } from '../season/buildings';

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
        A level per building. Members under one get a <strong>!</strong> before their name on the
        season building board, and the number itself is marked in the column that is short. Leave a
        building empty and it is not judged at all — which is how you say "the lab is what matters
        this week". A building nobody has seen yet is never counted as behind: an empty cell means
        the collector has not panned over it, not that it is unbuilt.
      </p>

      {current.legacyLevel !== null && (
        // Said out loud rather than migrated silently: the number came from
        // the old one-level-for-everything setting, and saving here replaces
        // it with whatever is in the boxes below.
        <p className="empty">
          The old single level of <strong>{current.legacyLevel}</strong> is still in force for every
          building. Setting any level below and saving replaces it.
        </p>
      )}

      <label htmlFor="season-alert-enabled">
        <input
          checked={current.enabled}
          id="season-alert-enabled"
          onChange={(event) => setDraft({ ...current, enabled: event.target.checked })}
          type="checkbox"
        />
        Mark members who are below these levels
      </label>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="label">Building</th>
              <th className="num">Level</th>
            </tr>
          </thead>
          <tbody>
            {SEASON3_BUILDINGS.map((kind) => {
              const key = String(kind.id);
              const value = current.perBuilding[key];
              return (
                <tr key={kind.id}>
                  <td className="label">
                    <label htmlFor={`season-floor-${kind.id}`}>{kind.name}</label>
                  </td>
                  <td className="num">
                    <input
                      id={`season-floor-${kind.id}`}
                      max={99}
                      min={1}
                      onChange={(event) => {
                        const next = Number.parseInt(event.target.value, 10);
                        const perBuilding = { ...current.perBuilding };
                        // An emptied box removes the floor rather than
                        // storing a zero: "not judged" and "must be above
                        // nothing" are the same on screen and different in
                        // the setting, and only one of them survives an edit.
                        if (Number.isFinite(next) && next > 0) {
                          perBuilding[key] = next;
                        } else {
                          delete perBuilding[key];
                        }
                        setDraft({ ...current, perBuilding, legacyLevel: null });
                      }}
                      placeholder="—"
                      type="number"
                      value={value ?? ''}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button disabled={save.isPending} onClick={() => save.mutate(current)} type="button">
        {save.isPending ? 'Saving…' : 'Save'}
      </button>

      {message !== null && <p className={failed ? 'error' : 'note'}>{message}</p>}
    </div>
  );
}
