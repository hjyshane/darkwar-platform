import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchRoster } from '../roster/RosterPanel';

interface FoundPlayer {
  player_id: string;
  current_name: string | null;
  power: number | null;
  server_id: number;
}

/** What a search box may send to `ilike`. `%` and `_` are its wildcards, and
 * a name containing either would otherwise match half the server. */
export function searchPattern(typed: string): string | null {
  const bare = typed.trim().replace(/[%_\\]/g, '');
  return bare.length < 2 ? null : `%${bare}%`;
}

async function searchPlayers(pattern: string): Promise<FoundPlayer[]> {
  const { data, error } = await supabase
    .from('players')
    .select('player_id, current_name, power, server_id')
    .ilike('current_name', pattern)
    .order('power', { ascending: false, nullsFirst: false })
    .limit(20);
  if (error) {
    throw new Error(`player search failed: ${error.message}`);
  }
  return (data ?? []) as FoundPlayer[];
}

async function setMembership(playerId: string, member: boolean): Promise<number> {
  const { data, error } = await supabase.rpc('set_roster_membership', {
    p_player_id: playerId,
    p_member: member,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data ?? 0;
}

/** Put somebody on our roster, or take them off, while the collector is not
 * there to read the member list.
 *
 * ONLY PLAYERS THE COLLECTOR HAS SEEN. A player found here has a game uid,
 * and that uid is what a later capture is matched on — so when the collector
 * comes back, its roster simply replaces this one and the same people line
 * up. Somebody typed in from scratch could never be matched to anything.
 */
export function ManualRosterSetting() {
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const pattern = searchPattern(typed);

  const roster = useQuery({ queryKey: ['roster'], queryFn: fetchRoster });
  const found = useQuery({
    queryKey: ['player-search', pattern],
    queryFn: () => searchPlayers(pattern ?? ''),
    enabled: pattern !== null,
  });

  const change = useMutation({
    mutationFn: ({ playerId, member }: { playerId: string; member: boolean; name: string }) =>
      setMembership(playerId, member),
    onSuccess: (count, { member, name }) => {
      setNote(
        `${name} ${member ? 'added to' : 'removed from'} the roster, which now has ${count} members.`,
      );
      // Everything that asks "who is in the alliance" reads the batch that
      // was just written: the members table, departures, the hive, the rank.
      void queryClient.invalidateQueries();
    },
    onError: (error: Error) => setNote(error.message),
  });

  const members = roster.data ?? [];
  const onRoster = new Set(members.map((member) => member.player_id));
  const candidates = (found.data ?? []).filter((player) => !onRoster.has(player.player_id));

  return (
    <>
      <p className="subtle">
        For when the collector cannot read the member list. Each change writes the whole roster
        forward with one person added or left out, so the rest of the dashboard sees it straight
        away. The next roster the collector captures replaces it — if somebody really did join or
        leave, the capture agrees; if not, it puts things right.
      </p>
      {note !== null && <p className={change.isError ? 'error' : 'subtle'}>{note}</p>}

      <h3>Add a member</h3>
      <label>
        Find a player{' '}
        <input
          onChange={(event) => setTyped(event.target.value)}
          placeholder="at least two letters"
          type="search"
          value={typed}
        />
      </label>
      {pattern !== null &&
        (found.isPending ? (
          <p className="empty">Searching…</p>
        ) : found.error ? (
          <p className="error">{found.error.message}</p>
        ) : candidates.length === 0 ? (
          <p className="empty">
            Nobody by that name who is not already a member. Only players the collector has seen at
            least once can be added.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Server</th>
                <th scope="col">Power</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {candidates.map((player) => (
                <tr key={player.player_id}>
                  <td className="label">{player.current_name ?? '—'}</td>
                  <td className="num">{player.server_id}</td>
                  <td className="num">{player.power?.toLocaleString('ko-KR') ?? '—'}</td>
                  <td>
                    <button
                      disabled={change.isPending}
                      onClick={() =>
                        change.mutate({
                          playerId: player.player_id,
                          member: true,
                          name: player.current_name ?? 'That player',
                        })
                      }
                      type="button"
                    >
                      Add
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

      <h3>On the roster now ({members.length})</h3>
      {roster.isPending ? (
        <p className="empty">Loading…</p>
      ) : roster.error ? (
        <p className="error">Could not load the roster: {roster.error.message}</p>
      ) : members.length === 0 ? (
        <p className="empty">Nobody is on the roster.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Power</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.player_id}>
                <td className="label">{member.current_name ?? '—'}</td>
                <td className="num">{member.power?.toLocaleString('ko-KR') ?? '—'}</td>
                <td>
                  <button
                    disabled={change.isPending}
                    onClick={() => {
                      const name = member.current_name ?? 'this member';
                      if (window.confirm(`Take ${name} off the roster?`)) {
                        change.mutate({ playerId: member.player_id, member: false, name });
                      }
                    }}
                    type="button"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
