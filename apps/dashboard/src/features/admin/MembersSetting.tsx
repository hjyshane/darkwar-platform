import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { APP_ROLES, type AppRole, GAME_RANKS } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';

/** Who has signed in, what role they hold, and where they sit in the
 * alliance.
 *
 * Two columns that look alike and are not:
 *
 *   Role   decides what the database will let them do (see the grid below).
 *   Rank   R1-R5, their standing in game. Shown so a reader can tell who is
 *          who; read by nothing. Handing write access out with an in-game
 *          promotion is the mistake this separation exists to prevent.
 *
 * Rows appear when somebody signs in — the join flow creates them. This
 * screen changes existing rows and does not invite anyone, which is why
 * there is no "add" form: an account that has never signed in has no row to
 * edit, and inventing one would create a user the auth system knows nothing
 * about.
 */
interface AppUser {
  user_id: string;
  display_name: string | null;
  role: AppRole;
  game_rank: string | null;
}

async function fetchMembers(): Promise<AppUser[]> {
  const { data, error } = await supabase
    .from('app_users')
    .select('user_id, display_name, role, game_rank')
    .order('role')
    .order('display_name', { nullsFirst: false });
  if (error) {
    throw new Error(`member query failed: ${error.message}`);
  }
  return (data ?? []) as AppUser[];
}

export function MembersSetting() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { data, error, isPending } = useQuery({
    queryKey: ['members-admin'],
    queryFn: fetchMembers,
  });

  const save = useMutation({
    mutationFn: async (next: { userId: string; patch: Partial<AppUser> }) => {
      const { error: updateError, count } = await supabase
        .from('app_users')
        .update(next.patch, { count: 'exact' })
        .eq('user_id', next.userId);
      if (updateError) {
        throw new Error(updateError.message);
      }
      // Refused updates come back as zero rows, not as an error.
      if (count === 0) {
        throw new Error('Nothing was written. Changing a member needs "Manage members".');
      }
    },
    onSuccess: () => {
      setFailed(false);
      setMessage('Saved.');
      void queryClient.invalidateQueries({ queryKey: ['members-admin'] });
      // Their own role may have changed, and every gate in the app reads it.
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
    return <p className="error">Could not load members: {error.message}</p>;
  }

  const members = data ?? [];
  return (
    <>
      <p className="subtle">
        A row appears here once somebody signs in. <strong>Role</strong> decides what the database
        allows; <strong>Rank</strong> is their standing in the alliance and is shown only — nothing
        enforces it, so a promotion in game grants nothing here.
      </p>

      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}

      {members.length === 0 ? (
        <p className="empty">Nobody has signed in yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="label">Name</th>
                <th className="label">Role</th>
                <th className="label">Rank</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.user_id}>
                  <td className="label">
                    {member.display_name ?? (
                      <span className="subtle">{member.user_id.slice(0, 8)}</span>
                    )}
                  </td>
                  <td className="label">
                    <select
                      aria-label={`Role for ${member.display_name ?? member.user_id}`}
                      disabled={save.isPending}
                      onChange={(event) =>
                        save.mutate({
                          userId: member.user_id,
                          patch: { role: event.target.value as AppRole },
                        })
                      }
                      value={member.role}
                    >
                      {APP_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="label">
                    <select
                      aria-label={`Alliance rank for ${member.display_name ?? member.user_id}`}
                      disabled={save.isPending}
                      onChange={(event) =>
                        save.mutate({
                          userId: member.user_id,
                          // Blank is null: "not recorded" is a state, and R1
                          // is not a sensible default for it.
                          patch: { game_rank: event.target.value || null },
                        })
                      }
                      value={member.game_rank ?? ''}
                    >
                      <option value="">—</option>
                      {GAME_RANKS.map((rank) => (
                        <option key={rank} value={rank}>
                          {rank}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
