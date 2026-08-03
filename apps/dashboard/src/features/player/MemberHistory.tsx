import { useQuery } from '@tanstack/react-query';
import { formatAge } from '../../lib/freshness';
import {
  type HistoryRow,
  collapseHistory,
  delta,
  observedOnlineState,
} from '../../lib/memberHistory';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../lib/useSession';

/** One member's roster history, for that member and for officers (0066).
 *
 * The table has been filled since 0003 and nothing rendered it. What it adds
 * over `player_power_growth` is the shape: that view gives one delta against
 * one reference time, and the question this answers — when did this change,
 * and what else changed with it — needs the sequence.
 *
 * RLS is the boundary. This component's job is to make the three ways it can
 * come back empty tell three different stories, because the database returns
 * the same empty list for all of them and "—" would be a lie in two:
 *
 *   not signed in         → sign in
 *   signed in, unlinked   → an admin has to say which player you are
 *   signed in, not yours  → this is somebody else's history
 *
 * That last one is the whole point of the migration and is the one a bare
 * empty table would misreport as "we have never observed this member".
 */
async function fetchHistory(playerId: string): Promise<HistoryRow[]> {
  const { data, error } = await supabase
    .from('alliance_member_snapshots')
    // No offline_since: 0024 added the column and never granted it, so
    // naming it here would 42501 the whole query rather than that column.
    // No month_card_expires_at or raw either — admin-only by column grant
    // since 0016, and the pass has its own screen.
    .select('snapshot_id, captured_at, power, kills, member_rank, presence_redacted, online_state')
    .eq('player_id', playerId)
    // Oldest first: collapseHistory reasons forwards, because "when did this
    // become true" is a question about the earliest row of a run.
    .order('captured_at', { ascending: true })
    .limit(1000);
  if (error) {
    throw new Error(`history query failed: ${error.message}`);
  }
  return (data ?? []) as HistoryRow[];
}

const plain = new Intl.NumberFormat('ko-KR');

function num(value: number | null): string {
  return value === null ? '—' : plain.format(value);
}

/** A delta, signed, or nothing at all when either end was unobserved. */
function signed(value: number | null): string {
  if (value === null) {
    return '';
  }
  return value === 0 ? '' : `${value > 0 ? '+' : '−'}${plain.format(Math.abs(value))}`;
}

export function MemberHistory({ playerId, now }: { playerId: string; now?: Date }) {
  const current = now ?? new Date();
  const { data: session } = useSession();
  const { data, error, isPending } = useQuery({
    queryKey: ['member-history', playerId],
    queryFn: () => fetchHistory(playerId),
  });

  if (session?.email == null) {
    return (
      <p className="empty">
        Roster history is for the member it is about, and for officers.{' '}
        <a href="#/login">Sign in</a> to see yours.
      </p>
    );
  }
  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the history: {error.message}</p>;
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    const isOfficer = session.role === 'officer' || session.role === 'admin';
    if (isOfficer) {
      // An officer may read every row, so empty here really is empty.
      return <p className="empty">No roster snapshot has ever recorded this member.</p>;
    }
    return (
      <p className="empty">
        This is somebody else's history, or your account has not been linked to a player yet. An
        admin sets that link on the Members screen.
      </p>
    );
  }

  // Newest first for reading; the collapse ran forwards.
  const kept = collapseHistory(rows);
  const display = [...kept].reverse();

  return (
    <>
      <p className="subtle">
        {kept.length} change{kept.length === 1 ? '' : 's'} across {rows.length} capture
        {rows.length === 1 ? '' : 's'}. Captures that repeated the previous reading are not listed.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="label" scope="col">
                When
              </th>
              <th className="num" scope="col">
                Power
              </th>
              <th className="num" scope="col">
                Kills
              </th>
              <th className="num" scope="col">
                Rank
              </th>
              <th scope="col">Presence</th>
            </tr>
          </thead>
          <tbody>
            {display.map((entry, index) => {
              // The row before this one in TIME, which is the next one down
              // the reversed list.
              const previous = display[index + 1] ?? null;
              const state = observedOnlineState(entry);
              return (
                <tr key={entry.snapshot_id}>
                  <td className="label" title={entry.captured_at}>
                    {formatAge(entry.captured_at, current)}
                  </td>
                  <td className="num">
                    {num(entry.power)}
                    {previous !== null && (
                      <span className="subtle"> {signed(delta(entry.power, previous.power))}</span>
                    )}
                  </td>
                  <td className="num">
                    {num(entry.kills)}
                    {previous !== null && (
                      <span className="subtle"> {signed(delta(entry.kills, previous.kills))}</span>
                    )}
                  </td>
                  <td className="num">{num(entry.member_rank)}</td>
                  <td>
                    {/* Redacted is not offline. The capture came from outside
                        the alliance, where the game reports everyone online,
                        so nobody observed this member's presence at all. */}
                    {entry.presence_redacted ? (
                      <span className="badge badge-missing">Not observed</span>
                    ) : (
                      (state ?? '—')
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
