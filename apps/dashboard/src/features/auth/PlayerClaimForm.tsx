import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../../lib/supabase';

type ClaimablePlayer = { player_id: string; current_name: string | null; code: string | null };
type LinkedPlayer = { player_id: string; current_name: string | null };

async function fetchClaimablePlayers(): Promise<ClaimablePlayer[]> {
  // Every own alliance's roster, not only the one being viewed: somebody in
  // two alliances links their character in each from the same screen.
  const { data, error } = await supabase
    .from('players')
    .select(
      'player_id, current_name, alliances!players_current_alliance_id_fkey!inner(is_own, current_code)',
    )
    .eq('alliances.is_own', true)
    .order('current_name');
  if (error) {
    throw new Error(`roster query failed: ${error.message}`);
  }
  return data.map(({ alliances, ...row }) => ({ ...row, code: alliances.current_code }));
}

async function fetchMyPlayers(): Promise<LinkedPlayer[]> {
  // FILTERED ON user_id for the same reason player_claims was (see git
  // history of this file): RLS ORs "your own" with "members.manage", so an
  // officer would otherwise be shown everybody's characters as their own.
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (userId === undefined) {
    return [];
  }
  const { data, error } = await supabase
    .from('user_players')
    .select('player_id, players(current_name)')
    .eq('user_id', userId)
    .order('created_at');
  if (error) {
    throw new Error(`linked players query failed: ${error.message}`);
  }
  return data.map((row) => ({ player_id: row.player_id, current_name: row.players.current_name }));
}

/** Say which characters you are.
 *
 * Any number since 0193: a character in each alliance, or alts in one. Each
 * character still belongs to at most one account, and `claim_player` is what
 * refuses one somebody else holds — this form cannot see who holds what. The
 * first character linked is the one the account is shown as.
 */
export function PlayerClaimForm() {
  const queryClient = useQueryClient();
  const { data: players } = useQuery({ queryKey: ['claimable'], queryFn: fetchClaimablePlayers });
  const { data: mine } = useQuery({ queryKey: ['my-players'], queryFn: fetchMyPlayers });
  const [playerId, setPlayerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  function nameOf(id: string): string | null {
    return (
      mine?.find((p) => p.player_id === id)?.current_name ??
      players?.find((p) => p.player_id === id)?.current_name ??
      null
    );
  }

  async function run(
    action: () => PromiseLike<{ error: { message: string } | null }>,
    done: string,
  ) {
    setBusy(true);
    setMessage(null);
    const { error } = await action();
    setBusy(false);
    if (error) {
      setFailed(true);
      setMessage(error.message);
      return;
    }
    setFailed(false);
    setMessage(done);
    setPlayerId('');
    // Everything: a link changes what this account may read of its own
    // history, and the screens showing that are not this one.
    void queryClient.invalidateQueries();
  }

  function add(event: React.FormEvent) {
    event.preventDefault();
    if (playerId === '') {
      return;
    }
    // Name it back: the risk in this form is picking the wrong row out of a
    // long list, and right now is when that is cheap to notice.
    const name = nameOf(playerId) ?? 'that character';
    void run(
      () => supabase.rpc('claim_player', { p_player_id: playerId }),
      `Linked ${name}. Remove it below if that is wrong.`,
    );
  }

  function remove(id: string) {
    const name = nameOf(id) ?? 'that character';
    void run(() => supabase.rpc('unlink_player', { p_player_id: id }), `Removed ${name}.`);
  }

  const linked = new Set((mine ?? []).map((p) => p.player_id));

  return (
    <div>
      {mine !== undefined && mine.length > 0 ? (
        <ul className="linked-players">
          {mine.map((player, index) => (
            <li key={player.player_id}>
              <strong>{player.current_name ?? 'a character with no name yet'}</strong>
              {index === 0 && ' (shown as)'}{' '}
              <button disabled={busy} onClick={() => remove(player.player_id)} type="button">
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">
          No character linked yet. This takes effect as soon as you pick, and an admin can move it
          later.
        </p>
      )}
      <form onSubmit={add}>
        <label>
          {mine !== undefined && mine.length > 0 ? 'Add another character' : 'Character'}
          <select onChange={(event) => setPlayerId(event.target.value)} required value={playerId}>
            <option value="">Choose…</option>
            {(players ?? [])
              .filter((player) => !linked.has(player.player_id))
              .map((player) => (
                <option key={player.player_id} value={player.player_id}>
                  {player.current_name ?? player.player_id}
                  {player.code ? ` [${player.code}]` : ''}
                </option>
              ))}
          </select>
        </label>
        <button disabled={busy || playerId === ''} type="submit">
          {busy ? 'Linking…' : 'This is me'}
        </button>
      </form>
      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}
    </div>
  );
}
