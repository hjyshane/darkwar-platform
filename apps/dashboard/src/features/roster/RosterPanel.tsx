import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { useSession } from '../../lib/useSession';
import { type RosterRow, RosterTable } from './RosterTable';

/** Three queries rather than an embedded select.
 *
 * Contribution moved to its own member-only table in 0020 and presence in
 * 0024, so both are a join away. Fetching them separately keeps the shape
 * flat — the sort and search work on top-level keys, and a nested object
 * would silently stop being sortable — and it makes the permission boundary
 * obvious: logged out, those queries return nothing because RLS filters
 * every row, and the merge leaves the columns null. The table already
 * renders null as "—", which is the honest answer: not zero, not hidden,
 * just not visible to you.
 */
async function fetchRoster(): Promise<RosterRow[]> {
  const { data: players, error } = await supabase
    .from('players')
    .select('player_id, game_uid, current_name, hq_level, power, kills, last_seen_at')
    .order('power', { ascending: false, nullsFirst: false })
    .limit(50);
  if (error) {
    throw new Error(`roster query failed: ${error.message}`);
  }

  const { data: contributions, error: contributionError } = await supabase
    .from('player_contributions')
    .select('player_id, daily_donation_score, alliance_battle_score')
    .in(
      'player_id',
      players.map((player) => player.player_id),
    );
  if (contributionError) {
    throw new Error(`contribution query failed: ${contributionError.message}`);
  }

  const { data: presence, error: presenceError } = await supabase
    .from('player_presence')
    .select('player_id, online_state, offline_since, observed_at')
    .in(
      'player_id',
      players.map((player) => player.player_id),
    );
  if (presenceError) {
    throw new Error(`presence query failed: ${presenceError.message}`);
  }

  const byPlayer = new Map(contributions.map((row) => [row.player_id, row]));
  const presenceByPlayer = new Map(presence.map((row) => [row.player_id, row]));
  return players.map((player) => ({
    ...player,
    daily_donation_score: byPlayer.get(player.player_id)?.daily_donation_score ?? null,
    alliance_battle_score: byPlayer.get(player.player_id)?.alliance_battle_score ?? null,
    ...lastOnline(presenceByPlayer.get(player.player_id)),
  }));
}

type PresenceRow = {
  online_state: string | null;
  offline_since: string | null;
  observed_at: string;
};

/** Collapse presence to one sortable instant.
 *
 * Sorting on offline_since alone would be backwards: it is null for players
 * who are online, and the sort puts nulls last, so the people playing right
 * now would sink below everyone who left days ago. For someone online the
 * last moment we know they were there is observed_at — the snapshot that
 * said so — so that is what the column means: last known to be online.
 */
function lastOnline(presence: PresenceRow | undefined) {
  if (presence === undefined || presence.online_state === null) {
    return { online_state: null, last_online_at: null };
  }
  return {
    online_state: presence.online_state,
    last_online_at:
      presence.online_state === 'online' ? presence.observed_at : presence.offline_since,
  };
}

export function RosterPanel() {
  const { data, error, isPending } = useQuery({ queryKey: ['roster'], queryFn: fetchRoster });
  const { data: session } = useSession();
  const restricted = session !== undefined && session.role === 'viewer';
  return (
    <section aria-labelledby="roster-heading">
      <h2 id="roster-heading">{TERMS.members}</h2>
      {/* Without this the contribution columns are just full of em dashes,
          which elsewhere in this app means "never observed". Here it means
          "not yours to see", and those are different enough that saying so
          is the whole point (FR-UI-008). */}
      {restricted && (
        <p className="empty">
          Donation and duel figures are alliance-only.{' '}
          {session?.email ? (
            <>
              This account is a viewer — <a href="#/login">redeem an invitation code</a> to see
              them.
            </>
          ) : (
            <>
              <a href="#/login">Sign in</a> to see them.
            </>
          )}
        </p>
      )}
      {isPending && <p className="empty">Loading…</p>}
      {error && <p className="error">Could not load members: {error.message}</p>}
      {data && <RosterTable rows={data} />}
    </section>
  );
}
