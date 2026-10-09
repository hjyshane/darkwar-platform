import { useQuery } from '@tanstack/react-query';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { fetchAllPages } from '../../lib/fetchAllPages';
import { serverHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';
import { type ServerSummary, summariseServers } from './serverSummary';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat('en');

/** Every server a scan has reached, on the landing screen.
 *
 * Derived from the alliance board, not the `servers` table: that table is
 * seeded with 577-584 and gains the rest as untracked rows, so it says which
 * servers exist, not which have been scanned. A server shows up here with its
 * first alliance and needs nothing registered by hand. */
export function ScannedServers({ now }: { now?: Date }) {
  const { data, error } = useQuery({
    queryKey: ['overview', 'servers'],
    queryFn: async (): Promise<ServerSummary[]> => {
      const rows = await fetchAllPages((from, to) =>
        supabase
          .from('alliance_latest')
          .select('server_id, member_count, power, captured_at')
          .order('alliance_id', { ascending: true })
          .range(from, to),
      ).catch((queryError: Error) => {
        throw new Error(`server summary query failed: ${queryError.message}`);
      });
      return summariseServers(
        rows.flatMap((row) =>
          row.server_id === null || row.captured_at === null
            ? []
            : [{ ...row, server_id: row.server_id, captured_at: row.captured_at }],
        ),
      );
    },
    staleTime: 5 * 60_000,
  });

  if (error || data === undefined || data.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="overview-servers-heading">
      <h2 id="overview-servers-heading">Scanned servers ({data.length})</h2>
      <ul className="board-list">
        {data.map((server) => (
          <li key={server.serverId}>
            <a href={serverHash(server.serverId)}>Server {server.serverId}</a>
            <span className="subtle">
              {' '}
              · {plain.format(server.alliances)} alliances
              {server.members !== null && ` · ${plain.format(server.members)} members`}
              {server.power !== null && ` · ${compact.format(server.power)} power`} ·{' '}
            </span>
            <FreshnessBadge capturedAt={server.lastSeen} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}
