import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { APP_ROLES, type AppRole, fetchPermissions, isAllowed } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';

/** Role x capability, as a grid of checkboxes.
 *
 * Until 0045 "who may edit a notice" was a line of SQL inside a policy, so
 * changing it meant a migration. It is a row now, and this is the screen
 * that writes the row.
 *
 * The grid is shown to everyone who reaches this page, including people who
 * cannot change it. Hiding the rules would not change them, and somebody
 * asking "why can I not post a notice" is answered by looking rather than by
 * asking an admin.
 *
 * One box is deliberately impossible to untick: an admin managing members.
 * The database refuses it with a check constraint, and this greys it out so
 * the refusal is not a surprise.
 */
export function PermissionsSetting() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { data, error, isPending } = useQuery({
    queryKey: ['permissions'],
    queryFn: fetchPermissions,
  });

  const toggle = useMutation({
    mutationFn: async (next: { role: AppRole; capability: string; allowed: boolean }) => {
      const { error: updateError, count } = await supabase
        .from('role_permissions')
        .update({ allowed: next.allowed }, { count: 'exact' })
        .eq('role', next.role)
        .eq('capability', next.capability);
      if (updateError) {
        throw new Error(updateError.message);
      }
      // A refused UPDATE is filtered to zero rows and reports success, so
      // without this the box would appear to move and then spring back on
      // the next refetch with no explanation.
      if (count === 0) {
        throw new Error('Nothing was written. Changing permissions needs "Manage members".');
      }
    },
    onSuccess: () => {
      setFailed(false);
      setMessage('Saved.');
      void queryClient.invalidateQueries({ queryKey: ['permissions'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (mutationError: Error) => {
      setFailed(true);
      setMessage(mutationError.message);
    },
  });

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load permissions: {error.message}</p>;
  }

  const capabilities = data?.capabilities ?? [];
  const grants = data?.grants ?? [];

  return (
    <>
      <p className="subtle">
        What each role may do. The alliance rank (R1–R5) is not on this grid on purpose — it is a
        label, and a promotion in game should not hand out write access here.
      </p>

      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="label">Capability</th>
              {APP_ROLES.map((role) => (
                <th className="num" key={role}>
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {capabilities.map((capability) => (
              <tr key={capability.capability}>
                <td className="label" title={capability.description}>
                  {capability.label}
                </td>
                {APP_ROLES.map((role) => {
                  const allowed = isAllowed(grants, role, capability.capability);
                  // The one box the database will not let anyone move.
                  const locked = role === 'admin' && capability.capability === 'members.manage';
                  return (
                    <td className="num" key={role}>
                      <input
                        aria-label={`${capability.label} for ${role}`}
                        checked={allowed}
                        disabled={locked || toggle.isPending}
                        onChange={(event) =>
                          toggle.mutate({
                            role,
                            capability: capability.capability,
                            allowed: event.target.checked,
                          })
                        }
                        title={locked ? 'An admin cannot give this one away' : undefined}
                        type="checkbox"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
