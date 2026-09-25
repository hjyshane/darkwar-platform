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
  // FILTERED ON user_id, and the comment that used to be here was wrong.
  //
  // It said `self_read` already restricts this to the caller's own row, so
  // repeating the predicate would be a second place for it to be wrong. But
  // `player_claims` carries TWO select policies and RLS ORs them: `self_read` for
  // your own row, and `manage_read` for anybody with `members.manage` — which
  // officers have, because they are the ones who approve claims.
  //
  // So for an officer this query returned every claim in the table. With one row in
  // it, that row was the admin's approved claim, and a brand-new officer was told
  // "This account is linked to WonderingDuck" — somebody else's character, and no
  // form to claim their own. With two rows `maybeSingle()` would have failed
  // outright.
  //
  // Scoping here is not duplicating the policy. The policy answers "may I see this
  // row"; only the query can say "which of them is MINE".
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (userId === undefined) {
    return null;
  }
  const { data, error } = await supabase
    .from('player_claims')
    .select('player_id, status, note')
    .eq('user_id', userId)
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
    // `claim_player` rather than an insert into `player_claims` (0165). The
    // link now happens in the same call, and it has to: writing the row from
    // here could never touch `app_users`, which is what a claim is actually
    // for. The function also refuses a character another account already
    // holds, which this form cannot check — it cannot read who holds what.
    const { error } = await supabase.rpc('claim_player', { p_player_id: chosen });
    setBusy(false);
    if (error) {
      setFailed(true);
      setMessage(error.message);
      return;
    }
    setFailed(false);
    // Name the character back, rather than "Sent." The whole risk in this
    // form is picking the wrong row out of a hundred-name list, and the only
    // moment that is cheap to notice is right now.
    setMessage(`You are ${nameOf(chosen) ?? chosen}. Pick again if that is wrong.`);
    // Everything, not just the claim: the link changes what this account may
    // read of its own history, and the screens showing it are not this one.
    void queryClient.invalidateQueries();
  }

  // The picked name, wherever the claim is in its life. The roster query is
  // the same one that fills the picker, so a name here cannot disagree with
  // the option that was clicked.
  function nameOf(playerId: string): string | null {
    return players?.find((player) => player.player_id === playerId)?.current_name ?? null;
  }

  if (claim?.status === 'approved') {
    // The roster may not have arrived yet, and a raw uuid is not an answer to
    // "who am I linked to". Say the state plainly and let the name fill in.
    const name = nameOf(claim.player_id);
    return (
      <p className="empty">
        This account is linked to <strong>{name ?? 'your character'}</strong>
        {name === null && ' (loading the name…)'}.
      </p>
    );
  }

  // A pending row is now history rather than a state this form produces
  // (0165): claiming links you in the same call. One can still be here — filed
  // by an older client before the change, or by somebody the function refused —
  // and it is still worth naming, because picking again is what clears it.
  const pending = claim?.status === 'pending' ? nameOf(claim.player_id) : null;

  return (
    <form onSubmit={(event) => void submit(event)}>
      <p className="empty">
        {claim?.status === 'pending' ? (
          <>
            An older claim says you are <strong>{pending ?? 'the character you picked'}</strong>,
            and it was never settled. Picking again replaces it and takes effect immediately.
          </>
        ) : claim?.status === 'rejected' ? (
          <>
            An officer did not accept that claim. Pick again — it takes effect immediately now, so
            choose carefully.
          </>
        ) : (
          'Which character are you? This takes effect as soon as you pick, and an admin can move it later.'
        )}
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
      <button disabled={busy || (playerId || claim?.player_id || '') === ''} type="submit">
        {busy ? 'Linking…' : 'This is me'}
      </button>
      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}
    </form>
  );
}
