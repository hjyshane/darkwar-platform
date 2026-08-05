import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../../lib/supabase';

type ClaimablePlayer = { player_id: string; current_name: string | null };
type Claim = { player_id: string; status: string; note: string | null };

async function fetchClaimablePlayers(): Promise<ClaimablePlayer[]> {
  const { data, error } = await supabase
    .from('players')
    .select('player_id, current_name, alliances!players_current_alliance_id_fkey!inner(is_own)')
    .eq('alliances.is_own', true)
    .order('current_name');
  if (error) {
    throw new Error(`roster query failed: ${error.message}`);
  }
  return data.map(({ alliances: _joined, ...row }) => row);
}

async function fetchMyClaim(): Promise<Claim | null> {
  // No filter on user_id: self_read already restricts this to the caller's
  // own row, and repeating the predicate in the query would be a second
  // place for it to be wrong.
  const { data, error } = await supabase
    .from('player_claims')
    .select('player_id, status, note')
    .maybeSingle();
  if (error) {
    if (error.code === '42501') {
      return null;
    }
    throw new Error(`claim query failed: ${error.message}`);
  }
  return data;
}

/** Say which character you are.
 *
 * The admin already had a box for this on the members screen, and it asked
 * them to know something only the member knows. This is the member's half:
 * they state it, an admin decides, and `app_users.player_id` still moves
 * only through `approve_player_claim()` — 0066's rule that self-service
 * linking must not exist is intact, because a claim grants nothing.
 *
 * The picker is the alliance roster rather than a free-text name. A typo in
 * a name is a claim an admin cannot act on, and the roster is already on
 * screen for anyone who can file a claim at all.
 */
export function PlayerClaimForm() {
  const queryClient = useQueryClient();
  const { data: players } = useQuery({ queryKey: ['claimable'], queryFn: fetchClaimablePlayers });
  const { data: claim } = useQuery({ queryKey: ['my-claim'], queryFn: fetchMyClaim });
  const [playerId, setPlayerId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const { data: session } = await supabase.auth.getUser();
    const userId = session.user?.id;
    // `chosen`, not `playerId`: the select shows an existing claim through
    // its `value` while the state stays empty until something is picked, so
    // resubmitting an unchanged claim would post an empty player_id.
    const chosen = playerId || claim?.player_id || '';
    if (userId === undefined || chosen === '') {
      return;
    }
    setBusy(true);
    setMessage(null);
    // Upsert, because the table holds one row per account: someone who
    // picked the wrong character says so again rather than filing a second
    // claim for an admin to reconcile. `status` returns to pending, which is
    // deliberate — a changed answer has not been decided.
    const { error } = await supabase.from('player_claims').upsert(
      {
        user_id: userId,
        player_id: chosen,
        note: note.trim() === '' ? null : note.trim(),
        status: 'pending',
      },
      { onConflict: 'user_id' },
    );
    setBusy(false);
    if (error) {
      setFailed(true);
      setMessage(error.message);
      return;
    }
    setFailed(false);
    setMessage('Sent. An officer will confirm it.');
    void queryClient.invalidateQueries({ queryKey: ['my-claim'] });
  }

  if (claim?.status === 'approved') {
    const name = players?.find((player) => player.player_id === claim.player_id)?.current_name;
    return (
      <p className="empty">
        This account is linked to <strong>{name ?? claim.player_id}</strong>.
      </p>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <p className="empty">
        {claim?.status === 'pending'
          ? 'Your claim is waiting for an officer to confirm it. Picking again replaces it.'
          : 'Which character are you? An officer confirms this before it takes effect.'}
      </p>
      <label>
        Character
        <select
          onChange={(event) => setPlayerId(event.target.value)}
          required
          value={playerId || (claim?.player_id ?? '')}
        >
          <option value="">Choose…</option>
          {(players ?? []).map((player) => (
            <option key={player.player_id} value={player.player_id}>
              {player.current_name ?? player.player_id}
            </option>
          ))}
        </select>
      </label>
      <label>
        Note (optional)
        <input
          onChange={(event) => setNote(event.target.value)}
          placeholder="Anything that helps an officer recognise you"
          value={note}
        />
      </label>
      <button disabled={busy || (playerId || claim?.player_id || '') === ''} type="submit">
        {busy ? 'Sending…' : 'Send claim'}
      </button>
      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}
    </form>
  );
}
