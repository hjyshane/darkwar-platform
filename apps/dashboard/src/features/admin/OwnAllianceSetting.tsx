import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { allianceHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';

/** Which alliances the dashboard treats as ours (phase 5 of the
 * multi-alliance plan: more than one may be pinned; the first is PRIMARY).
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

/** The pinned list, in order. Reads both shapes: `{alliance_ids: [...]}` since
 * 0192, and the single `{alliance_id}` every earlier save wrote. */
export function readPinned(value: unknown): string[] {
  if (value === null || typeof value !== 'object') {
    return [];
  }
  const v = value as { alliance_ids?: unknown; alliance_id?: unknown };
  if (Array.isArray(v.alliance_ids)) {
    return v.alliance_ids.filter((id): id is string => typeof id === 'string');
  }
  return typeof v.alliance_id === 'string' ? [v.alliance_id] : [];
}

async function fetchAlliances(): Promise<{ rows: AllianceRow[]; pinned: string[] }> {
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
  return { rows: alliances.data ?? [], pinned: readPinned(setting.data?.value) };
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
    // The whole list, in order. Empty clears the pin and hands the decision
    // back to the evidence. Always written in the list shape.
    mutationFn: async (next: string[]) => {
      if (next.length === 0) {
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
        .upsert({ key: 'own_alliance', value: { alliance_ids: next } });
      if (upsertError) {
        throw new Error(upsertError.message);
      }
    },
    onSuccess: (_result, next) => {
      setFailed(false);
      setMessage(next.length === 0 ? 'Pin cleared — back to the evidence.' : 'Saved.');
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
  const pinned = data?.pinned ?? [];
  return (
    <>
      <p className="subtle">
        The dashboard treats an alliance as ours when a roster capture showed real presence for it —
        the game hides presence for alliances you are not in. Pin one to say so outright; the pin
        wins, and the evidence column keeps showing what was actually observed.
      </p>
      <p className="subtle">
        Pin more than one to run several alliances side by side: each gets its own members, boards,
        schedule, hive plans and rank settings, and people switch between the ones they belong to.
        The first is the <strong>primary</strong>. It keeps the shared settings slot (its rank tiers
        are the ones every other alliance starts from), the role column older screens still write,
        and — until Discord routing is per alliance — the only rank-period announcement. Change the
        primary deliberately.
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
                <th className="num">Order</th>
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
                    {pinned.includes(row.alliance_id) ? (
                      <button
                        className="linklike"
                        disabled={save.isPending}
                        onClick={() => save.mutate(pinned.filter((id) => id !== row.alliance_id))}
                        type="button"
                      >
                        {pinned.length === 1 ? 'clear pin' : 'unpin'}
                      </button>
                    ) : (
                      <button
                        className="linklike"
                        disabled={save.isPending}
                        onClick={() => save.mutate([...pinned, row.alliance_id])}
                        type="button"
                      >
                        {pinned.length === 0 ? 'pin this' : 'pin as well'}
                      </button>
                    )}
                  </td>
                  <td className="num">
                    {pinned[0] === row.alliance_id ? (
                      <span className="badge badge-fresh">primary</span>
                    ) : pinned.includes(row.alliance_id) ? (
                      <button
                        className="linklike"
                        disabled={save.isPending}
                        onClick={() =>
                          save.mutate([
                            row.alliance_id,
                            ...pinned.filter((id) => id !== row.alliance_id),
                          ])
                        }
                        type="button"
                      >
                        make primary
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pinned.length > 0 && (
        <p className="subtle">
          {pinned.length === 1
            ? 'A pin is set. Clear it to go back to deciding from what the rosters show.'
            : `${pinned.length} alliances are pinned. Unpinning one takes it off the switcher; its data stays.`}
        </p>
      )}
    </>
  );
}
