import { useQuery } from '@tanstack/react-query';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { compactNumber } from '../../lib/compactNumber';
import { fetchAllPages } from '../../lib/fetchAllPages';
import { useT } from '../../lib/i18n';
import { serverHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';
import { type ServerSummary, summariseServers } from './serverSummary';

const compact = compactNumber(1);
const plain = new Intl.NumberFormat('en');

/** Every server a scan has reached, on the landing screen.
 *
 * Derived from the alliance board, not the `servers` table: that table says
 * which servers exist, not which have been scanned. A server shows up here with
 * its first alliance and needs nothing registered by hand. */
export function ScannedServers({ now }: { now?: Date }) {
  const t = useT();
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
      <h2 id="overview-servers-heading">
        {t('Scanned servers ({count})', { count: data.length })}
      </h2>
      <ul className="board-list">
        {data.map((server) => (
          <li key={server.serverId}>
            <a href={serverHash(server.serverId)}>
              {t('Server {server}', { server: server.serverId })}
            </a>
            <span className="subtle">
              {' '}
              · {t('{count} alliances', { count: plain.format(server.alliances) })}
              {server.members !== null &&
                ` · ${t('{count} members', { count: plain.format(server.members) })}`}
              {server.power !== null &&
                ` · ${t('{power} power', { power: compact.format(server.power) })}`}{' '}
              ·{' '}
            </span>
            <FreshnessBadge capturedAt={server.lastSeen} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}
