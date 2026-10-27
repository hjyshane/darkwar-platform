import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AppRole } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';
import {
  HIDEABLE_ROLES,
  TABS,
  fetchTabVisibility,
  isTabShown,
  storedFor,
} from '../../lib/tabVisibility';

/** Roles that can never see a tab whatever is ticked here: the screen is refused to
 * them by its own gate, so a tick would promise something this page cannot deliver. */
const NEVER: Readonly<Record<string, readonly string[]>> = {
  migration: ['viewer', 'member'],
};

/** Which roles see which sidebar tab (0295). Hiding only: ticking a box never shows a
 * tab the role is not entitled to. An admin always sees every tab. */
export function TabVisibilitySetting() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const rules = useQuery({ queryKey: ['tab-visibility'], queryFn: fetchTabVisibility });

  const set = useMutation({
    mutationFn: async (next: { tab: string; role: AppRole; shown: boolean }) => {
      // Shown is the default, so ticking a box removes the row instead of storing a yes.
      const query = next.shown
        ? supabase
            .from('tab_visibility')
            .delete()
            .eq('tab_key', next.tab)
            .eq('role', next.role)
            .select('tab_key')
        : supabase
            .from('tab_visibility')
            .upsert(
              { tab_key: next.tab, role: next.role, visible: false },
              { onConflict: 'tab_key,role' },
            )
            .select('tab_key');
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      // A refused DELETE is filtered to zero rows and reports success, the way a
      // refused UPDATE does (see PermissionsSetting).
      if (next.shown && (data ?? []).length === 0) {
        const held = storedFor(rules.data ?? new Map(), next.tab, next.role);
        if (held !== undefined)
          throw new Error('Nothing was written. Changing tabs needs an admin.');
      }
    },
    onSuccess: () => {
      setFailed(false);
      setMessage('Saved.');
      void queryClient.invalidateQueries({ queryKey: ['tab-visibility'] });
    },
    onError: (error: Error) => {
      setFailed(true);
      setMessage(error.message);
    },
  });

  if (rules.isPending) return <p className="empty loading">Loading…</p>;
  if (rules.error)
    return <p className="error">Could not load tab visibility: {rules.error.message}</p>;

  return (
    <>
      <p className="subtle">
        Who sees each tab in the sidebar. Unticking hides it, and its address says so; ticking never
        shows a tab a role is not entitled to. Admins always see every tab.
      </p>
      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="label">Tab</th>
              {HIDEABLE_ROLES.map((role) => (
                <th className="num" key={role}>
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TABS.map((tab) => (
              <tr key={tab.key}>
                <td className="label">{tab.label}</td>
                {HIDEABLE_ROLES.map((role) => {
                  const never = NEVER[tab.key]?.includes(role) === true;
                  return (
                    <td className="num" key={role}>
                      <input
                        aria-label={`${tab.label} for ${role}`}
                        checked={!never && isTabShown(rules.data, tab.key, role)}
                        disabled={never || set.isPending}
                        onChange={(event) =>
                          set.mutate({ tab: tab.key, role, shown: event.target.checked })
                        }
                        title={never ? 'This screen is not open to that role at all' : undefined}
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
