import type { Json } from '@dw/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  type HistoryRow,
  type HistorySource,
  SOURCE_LABELS,
  canUndo,
  describeItem,
  shortValue,
} from '../../lib/settings/history';
import { SITE_SETTINGS_KEY } from '../../lib/settings/useSiteSetting';
import { supabase } from '../../lib/supabase';

const LIMIT = 200;

/** Settings › Operations › Change history: the newest changes to any setting
 * (0347), who made them, and Undo for the install's settings. */
export function SettingsHistory() {
  const client = useQueryClient();
  const [source, setSource] = useState<HistorySource | 'all'>('all');
  const [confirming, setConfirming] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const history = useQuery({
    queryKey: ['settings-history', source],
    queryFn: async (): Promise<HistoryRow[]> => {
      let query = supabase
        .from('settings_history')
        .select(
          'history_id, source, alliance_id, item, old_value, new_value, changed_by, changed_at',
        )
        .order('changed_at', { ascending: false })
        .limit(LIMIT);
      if (source !== 'all') query = query.eq('source', source);
      const { data, error } = await query;
      if (error) {
        throw new Error(
          error.code === 'PGRST205' || error.code === '42P01'
            ? 'the database does not keep history yet (migration 0347 is not applied)'
            : error.message,
        );
      }
      return data ?? [];
    },
  });

  const names = useQuery({
    queryKey: ['settings-history', 'names'],
    queryFn: async (): Promise<ReadonlyMap<string, string>> => {
      const { data, error } = await supabase.from('app_users').select('user_id, display_name');
      if (error) return new Map();
      return new Map((data ?? []).map((row) => [row.user_id, row.display_name ?? 'unnamed']));
    },
    staleTime: 10 * 60_000,
  });

  const undo = useMutation({
    mutationFn: async (row: HistoryRow) => {
      // Writing the old value back is an ordinary change: it goes through the
      // same policy as the form, and lands in this list itself.
      const { error } =
        row.old_value === null
          ? await supabase.from('app_settings').delete().eq('key', row.item)
          : await supabase
              .from('app_settings')
              .upsert({ key: row.item, value: row.old_value as Json });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, row) =>
      setMessage({ text: `Undone: ${describeItem(row)} is back to what it was.`, failed: false }),
    onError: (error: Error) =>
      setMessage({ text: `Could not undo: ${error.message}`, failed: true }),
    onSettled: async () => {
      setConfirming(null);
      await client.invalidateQueries({ queryKey: ['settings-history'] });
      await client.invalidateQueries({ queryKey: SITE_SETTINGS_KEY });
      await client.invalidateQueries({ queryKey: ['app_settings'] });
    },
  });

  return (
    <div className="settings-history">
      <p className="note">
        Every change to a setting since history began to be kept: the permission grid, tab
        visibility, names and order, the server group and every stored setting. Undo is offered for
        the site-wide settings; anything else is changed back on its own screen. The newest {LIMIT}{' '}
        are shown.
      </p>
      <label htmlFor="history-source">
        Show{' '}
        <select
          id="history-source"
          onChange={(event) => setSource(event.target.value as HistorySource | 'all')}
          value={source}
        >
          <option value="all">Everything</option>
          {(Object.keys(SOURCE_LABELS) as HistorySource[]).map((key) => (
            <option key={key} value={key}>
              {SOURCE_LABELS[key]}
            </option>
          ))}
        </select>
      </label>
      {message !== null && (
        <p className={message.failed ? 'error' : 'note'} role={message.failed ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      {history.isPending && <p className="empty loading">Loading…</p>}
      {history.error && (
        <p className="error">Could not load the history: {history.error.message}</p>
      )}
      {history.data?.length === 0 && <p className="empty">No change has been recorded yet.</p>}
      {history.data !== undefined && history.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">What</th>
                <th scope="col">Was</th>
                <th scope="col">Now</th>
                <th scope="col">
                  <span className="visually-hidden">Undo</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((row) => (
                <tr key={row.history_id}>
                  <td>{new Date(row.changed_at).toLocaleString()}</td>
                  <td>
                    {row.changed_by === null
                      ? 'the system'
                      : (names.data?.get(row.changed_by) ?? 'someone')}
                  </td>
                  <td>
                    <span className="subtle">
                      {SOURCE_LABELS[row.source as HistorySource] ?? row.source}
                    </span>{' '}
                    {describeItem(row)}
                  </td>
                  <td>
                    <code title={JSON.stringify(row.old_value)}>{shortValue(row.old_value)}</code>
                  </td>
                  <td>
                    <code title={JSON.stringify(row.new_value)}>{shortValue(row.new_value)}</code>
                  </td>
                  <td>
                    {canUndo(row) &&
                      (confirming === row.history_id ? (
                        <>
                          <button
                            disabled={undo.isPending}
                            onClick={() => undo.mutate(row)}
                            type="button"
                          >
                            {undo.isPending ? 'Undoing…' : 'Confirm undo'}
                          </button>{' '}
                          <button onClick={() => setConfirming(null)} type="button">
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setConfirming(row.history_id)} type="button">
                          Undo
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
