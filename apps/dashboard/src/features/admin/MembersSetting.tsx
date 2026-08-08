import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { APP_ROLES, type AppRole, GAME_RANKS } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';

/** Who has signed in, what role they hold, and where they sit in the
 * alliance.
 *
 * Three columns that look alike and are not:
 *
 *   Role    decides what the database will let them do (see the grid below).
 *   Rank    R1-R5, their standing in game. Shown so a reader can tell who is
 *           who; read by nothing. Handing write access out with an in-game
 *           promotion is the mistake this separation exists to prevent.
 *   Player  which character this account IS. Read by exactly one thing so
 *           far — whether they may see their own roster history (0066) — and
 *           it is the only place that link can be made, because a member
 *           setting it themselves could claim to be anyone.
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
  player_id: string | null;
  /** From app_user_directory (0069), which is admin-only. Null when this
   * screen is being read by somebody without members.manage — the view
   * returns no rows at all then, so in practice null means the fallback
   * query below ran. */
  email: string | null;
  last_sign_in_at: string | null;
}

/** The fields of an account this screen may write. `email` and
 * `last_sign_in_at` are read from auth.users through a view and are not
 * columns of app_users, so they must not be reachable from an update. */
type AppUserPatch = Pick<Partial<AppUser>, 'role' | 'game_rank' | 'player_id' | 'display_name'>;

interface LinkablePlayer {
  player_id: string;
  current_name: string | null;
}

/** The accounts, with the address each signed up under where that is
 * permitted.
 *
 * `app_user_directory` (0069) is the only thing in the schema that exposes an
 * email, and it is gated on members.manage. Reading it first and falling back
 * to `app_users` keeps this screen working for a non-admin who opens it — the
 * page deliberately renders for them and lets the database refuse the writes,
 * and an empty table would have been a worse answer than a table with no
 * email column.
 *
 * The fallback is on an EMPTY result, not on an error: the view has a
 * predicate rather than a policy, so somebody without the capability gets
 * zero rows and no complaint.
 */
async function fetchMembers(): Promise<AppUser[]> {
  const directory = await supabase
    .from('app_user_directory')
    .select('user_id, display_name, role, game_rank, player_id, email, last_sign_in_at')
    .order('role')
    .order('display_name', { nullsFirst: false });
  if (directory.error && directory.error.code !== '42501') {
    throw new Error(`member query failed: ${directory.error.message}`);
  }
  if (directory.data && directory.data.length > 0) {
    return directory.data as AppUser[];
  }

  const { data, error } = await supabase
    .from('app_users')
    .select('user_id, display_name, role, game_rank, player_id')
    .order('role')
    .order('display_name', { nullsFirst: false });
  if (error) {
    throw new Error(`member query failed: ${error.message}`);
  }
  return (data ?? []).map((row) => ({ ...row, email: null, last_sign_in_at: null })) as AppUser[];
}

/** Our own alliance's players, for the link picker.
 *
 * Deliberately not `fetchRoster`: that carries power, kills, last seen and an
 * embed because a table needs them, and this needs two columns. Its own key
 * too, so it does not share a cache entry with a query of a different shape.
 *
 * Scoped to our alliance for the same reason RosterPanel is — `players`
 * accumulates everyone ever observed across eight servers, and a picker of
 * 557 strangers is not a picker.
 */
async function fetchLinkablePlayers(): Promise<LinkablePlayer[]> {
  const { data, error } = await supabase
    .from('players')
    .select('player_id, current_name, alliances!players_current_alliance_id_fkey!inner(is_own)')
    .eq('alliances.is_own', true)
    .order('current_name', { nullsFirst: false })
    .limit(200);
  if (error) {
    throw new Error(`player query failed: ${error.message}`);
  }
  return (data ?? []) as LinkablePlayer[];
}

type PendingClaim = {
  user_id: string;
  player_id: string;
  note: string | null;
  created_at: string;
};

/** What members have said about themselves, awaiting a decision.
 *
 * The link box below already existed and asked an admin to know which
 * account belongs to whom. 0068 lets the member answer that, and this is
 * where the answer is accepted or refused — approving writes
 * `app_users.player_id` through a security-definer function, so the rule
 * that a member cannot link themselves (0066) is untouched.
 */
async function fetchPendingClaims(): Promise<PendingClaim[]> {
  const { data, error } = await supabase
    .from('player_claims')
    .select('user_id, player_id, note, created_at')
    .eq('status', 'pending')
    .order('created_at');
  if (error) {
    // An admin without members.manage reads nothing here, and that is not a
    // reason to fail the whole screen.
    if (error.code === '42501') {
      return [];
    }
    throw new Error(`claim query failed: ${error.message}`);
  }
  return (data ?? []) as PendingClaim[];
}

export function MembersSetting() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const { data, error, isPending } = useQuery({
    queryKey: ['members-admin'],
    queryFn: fetchMembers,
  });
  const { data: players } = useQuery({
    queryKey: ['linkable-players'],
    queryFn: fetchLinkablePlayers,
  });
  const { data: claims } = useQuery({
    queryKey: ['player-claims'],
    queryFn: fetchPendingClaims,
  });

  /** Take someone's access away.
   *
   * This used to set the role to 'viewer' and null the character, on the
   * reasoning that deleting the row would only make the next sign-in recreate
   * it as a viewer. 0094 supersedes that: the demoted row kept `display_name`
   * and `game_rank`, which is how `players.current_alliance_id` ended up
   * carrying departed members' badges for good, and nothing anywhere recorded
   * that the departure had happened.
   *
   * `remove_member()` deletes the row and writes an audit entry carrying the
   * name, which is the last moment that name is reachable. It refuses three
   * things this component no longer has to think about: removing yourself
   * (leaving is its own act, on your own screen), removing an admin when you
   * are not one, and doing any of it without `members.manage`.
   *
   * The auth account is untouched either way. Deleting a login needs the
   * service key, and "left the alliance" does not mean "account destroyed".
   */
  const revoke = useMutation({
    mutationFn: async (userId: string) => {
      const { error: rpcError } = await supabase.rpc('remove_member', { p_user: userId });
      if (rpcError) {
        throw new Error(rpcError.message);
      }
    },
    onSuccess: () => {
      setFailed(false);
      setMessage('Removed. The account can sign in but sees nothing until a code is redeemed.');
      void queryClient.invalidateQueries({ queryKey: ['members-admin'] });
      void queryClient.invalidateQueries({ queryKey: ['player-claims'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
      void queryClient.invalidateQueries({ queryKey: ['member-history'] });
    },
    onError: (mutationError: Error) => {
      setFailed(true);
      setMessage(mutationError.message);
    },
  });

  const decide = useMutation({
    mutationFn: async (next: { userId: string; approve: boolean }) => {
      const { error: rpcError } = await supabase.rpc(
        next.approve ? 'approve_player_claim' : 'reject_player_claim',
        { p_user: next.userId },
      );
      if (rpcError) {
        throw new Error(rpcError.message);
      }
    },
    onSuccess: () => {
      setFailed(false);
      setMessage('Saved.');
      void queryClient.invalidateQueries({ queryKey: ['player-claims'] });
      void queryClient.invalidateQueries({ queryKey: ['members-admin'] });
      // Same reason the link box invalidates it: approving is a link, and
      // the cached history answer predates it.
      void queryClient.invalidateQueries({ queryKey: ['member-history'] });
    },
    onError: (mutationError: Error) => {
      setFailed(true);
      setMessage(mutationError.message);
    },
  });

  const save = useMutation({
    // Not Partial<AppUser>: that type now carries `email` and
    // `last_sign_in_at`, which belong to auth.users and are not columns of
    // app_users. Naming the writable fields is what caught it.
    mutationFn: async (next: { userId: string; patch: AppUserPatch }) => {
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
      // Linking an account to a player changes what that reader may see on
      // the player page (0066). The cached history answer is from before the
      // link and would keep saying "not yours".
      void queryClient.invalidateQueries({ queryKey: ['member-history'] });
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
        enforces it, so a promotion in game grants nothing here. <strong>Player</strong> says which
        character the account is: set it and they can see their own roster history, leave it and
        they cannot. Only an admin can set it, which is the point — an account that could name
        itself could name anyone.
      </p>

      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}

      {(claims ?? []).length > 0 && (
        <section aria-labelledby="member-claims">
          <h3 id="member-claims">Claims waiting</h3>
          <p className="subtle">
            What each account says it is. Approving is what writes <strong>Player</strong> below —
            the member cannot do it themselves.
          </p>
          <table>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Claims to be</th>
                <th scope="col">Note</th>
                <th scope="col">Decide</th>
              </tr>
            </thead>
            <tbody>
              {(claims ?? []).map((claim) => {
                const account = members.find((member) => member.user_id === claim.user_id);
                const player = (players ?? []).find(
                  (candidate) => candidate.player_id === claim.player_id,
                );
                return (
                  <tr key={claim.user_id}>
                    <td className="label">{account?.display_name ?? claim.user_id}</td>
                    <td className="label">{player?.current_name ?? claim.player_id}</td>
                    <td>{claim.note ?? '—'}</td>
                    <td>
                      <button
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ userId: claim.user_id, approve: true })}
                        type="button"
                      >
                        Approve
                      </button>{' '}
                      <button
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ userId: claim.user_id, approve: false })}
                        type="button"
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {members.length === 0 ? (
        <p className="empty">Nobody has signed in yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="label">Name</th>
                {/* The address is how an admin tells one unnamed row from
                    another. display_name is whatever the person typed, which
                    is usually nothing. */}
                <th className="label">Email</th>
                <th className="label">Role</th>
                <th className="label">Rank</th>
                <th className="label">Player</th>
                <th className="label">Remove</th>
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
                    {member.email ?? <span className="subtle">needs Manage members</span>}
                    {member.email !== null && member.last_sign_in_at === null && (
                      <span className="badge" title="Signed up but has never signed in">
                        never signed in
                      </span>
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
                  <td className="label">
                    <select
                      aria-label={`Player for ${member.display_name ?? member.user_id}`}
                      disabled={save.isPending}
                      onChange={(event) =>
                        save.mutate({
                          userId: member.user_id,
                          patch: { player_id: event.target.value || null },
                        })
                      }
                      value={member.player_id ?? ''}
                    >
                      <option value="">— not linked</option>
                      {(players ?? []).map((player) => (
                        <option key={player.player_id} value={player.player_id}>
                          {player.current_name ?? player.player_id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {/* Already a viewer: there is nothing left to take, and a
                        button that would do nothing should not offer to. */}
                    {member.role === 'viewer' ? (
                      <span className="subtle">—</span>
                    ) : (
                      <button
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(member.user_id)}
                        title="Set the account back to viewer and unlink its character"
                        type="button"
                      >
                        Remove
                      </button>
                    )}
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
