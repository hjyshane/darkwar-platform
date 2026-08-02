import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { allianceHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';

/** Which alliance the dashboard treats as ours.
 *
 * Two facts, kept apart on purpose (0032), and this screen shows both
 * because the interesting case is when they disagree:
 *
 *   evidence  an al.rank response that did NOT redact presence, which the
 *             game only does for an alliance the viewer is in
 *   pin       an admin saying so outright, which wins
 *
 * Setting the pin does not erase the evidence, and the table below keeps
 * showing it — "the pin says CBFW but every roster we hold is someone
 * else's" is the state worth being able to see.
 *
 * The screen does not gate itself on the role. RLS is the boundary: a
 * non-admin's write is refused by the policy, and the form reports what the
 * database said rather than deciding in advance what it would have said.
 * The month-cards page took the same line for the same reason.
 */
interface AllianceRow {
  alliance_id: string;
  current_name: string | null;
  current_code: string | null;
  server_id: number;
  member_count: number | null;
  is_own: boolean;
  roster_unredacted_seen: boolean;
}

async function fetchAlliances(): Promise<{ rows: AllianceRow[]; pinned: string | null }> {
  const [alliances, setting] = await Promise.all([
    supabase
      .from('alliances')
      .select(
        'alliance_id, current_name, current_code, server_id, member_count, is_own, roster_unredacted_seen',
      )
      // Everything we could plausibly be in, plus whatever is currently
      // marked — a pin to an alliance with no evidence must stay visible or
      // it cannot be undone from here.
      .or('roster_unredacted_seen.eq.true,is_own.eq.true')
      .order('member_count', { ascending: false, nullsFirst: false }),
    supabase.from('app_settings').select('value').eq('key', 'own_alliance').maybeSingle(),
  ]);
  if (alliances.error) {
    throw new Error(`alliance query failed: ${alliances.error.message}`);
  }
  if (setting.error) {
    throw new Error(`settings query failed: ${setting.error.message}`);
  }
  const value = setting.data?.value as { alliance_id?: string } | null | undefined;
  return { rows: alliances.data ?? [], pinned: value?.alliance_id ?? null };
}

export function OwnAllianceSetting() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { data, error, isPending } = useQuery({
    queryKey: ['admin-own-alliance'],
    queryFn: fetchAlliances,
  });

  const save = useMutation({
    mutationFn: async (allianceId: string | null) => {
      if (allianceId === null) {
        const { error: deleteError } = await supabase
          .from('app_settings')
          .delete()
          .eq('key', 'own_alliance');
        if (deleteError) {
          throw new Error(deleteError.message);
        }
        return;
      }
      // updated_by is stamped by a trigger from the session (0033), so it is
      // deliberately not sent here.
      const { error: upsertError } = await supabase
        .from('app_settings')
        .upsert({ key: 'own_alliance', value: { alliance_id: allianceId } });
      if (upsertError) {
        throw new Error(upsertError.message);
      }
    },
    onSuccess: (_result, allianceId) => {
      setFailed(false);
      setMessage(allianceId === null ? 'Pin cleared — back to the evidence.' : 'Saved.');
      // is_own is recomputed by a trigger, so every screen that reads it is
      // now stale, not just this one.
      void queryClient.invalidateQueries();
    },
    onError: (mutationError: Error) => {
      setFailed(true);
      // Passed through as written: a policy refusal says 42501 and that is
      // the honest answer to "why did nothing happen".
      setMessage(mutationError.message);
    },
  });

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load alliances: {error.message}</p>;
  }

  const rows = data?.rows ?? [];
  return (
    <>
      <p className="subtle">
        The dashboard treats an alliance as ours when a roster capture showed real presence for it —
        the game hides presence for alliances you are not in. Pin one to say so outright; the pin
        wins, and the evidence column keeps showing what was actually observed.
      </p>

      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}

      {rows.length === 0 ? (
        <p className="empty">No alliance has been observed yet. Capture a roster first.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="label">Alliance</th>
                <th className="num">Server</th>
                <th className="num">Members</th>
                <th className="num">Evidence</th>
                <th className="num">In use</th>
                <th className="num">Pin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.alliance_id}>
                  <td className="label">
                    <a href={allianceHash(row.alliance_id)}>
                      {row.current_code ? `[${row.current_code}] ` : ''}
                      {row.current_name ?? row.alliance_id.slice(0, 8)}
                    </a>
                  </td>
                  <td className="num">{row.server_id}</td>
                  <td className="num">{row.member_count ?? '—'}</td>
                  <td className="num">
                    {row.roster_unredacted_seen ? (
                      <span className="badge badge-fresh">roster seen</span>
                    ) : (
                      <span className="badge badge-missing">none</span>
                    )}
                  </td>
                  <td className="num">
                    {row.is_own && <span className="badge badge-fresh">ours</span>}
                  </td>
                  <td className="num">
                    {data?.pinned === row.alliance_id ? (
                      <button
                        className="linklike"
                        disabled={save.isPending}
                        onClick={() => save.mutate(null)}
                        type="button"
                      >
                        clear pin
                      </button>
                    ) : (
                      <button
                        className="linklike"
                        disabled={save.isPending}
                        onClick={() => save.mutate(row.alliance_id)}
                        type="button"
                      >
                        pin this
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.pinned !== null && data?.pinned !== undefined && (
        <p className="subtle">
          A pin is set. Clear it to go back to deciding from what the rosters show.
        </p>
      )}
    </>
  );
}
