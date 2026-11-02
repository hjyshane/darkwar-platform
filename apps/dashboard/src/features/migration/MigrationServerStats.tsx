import { useQuery } from '@tanstack/react-query';
import { BarChart, BarLegend } from '../../components/BarChart';
import { serverHash } from '../../lib/route';
import { SERVER_ZONE, zonedDayKey, zonedTime } from '../../lib/timezone';
import { net, fetchServerStats, movementRows, restOfList, tierRows } from './boards';
import { num, power, signed } from './format';

const STALE_TIME = 60_000;

function serverTime(iso: string): string {
  return `${zonedDayKey(iso, SERVER_ZONE)} ${zonedTime(iso, SERVER_ZONE)}`;
}

/** Every server at a glance: when its list was read, who is on it by tier, and how many moved
 * in and out, with the same figures drawn. A list read before the window opened shows no
 * movers, so the read time is the first thing to look at. */
export function MigrationServerStats() {
  const stats = useQuery({
    queryKey: ['migration', 'server-stats'],
    queryFn: fetchServerStats,
    staleTime: STALE_TIME,
  });

  if (stats.isPending) return <p className="empty loading">Loading…</p>;
  if (stats.error) return <p className="error">{stats.error.message}</p>;
  const rows = stats.data;
  const read = rows.filter((r) => r.captured_at !== null).length;
  if (read === 0) {
    return (
      <p className="empty">
        No state list has been read yet. Open each server's ranking in the game's migration tab with
        the collector running.
      </p>
    );
  }
  const totalIn = rows.reduce((sum, r) => sum + r.moved_in, 0);

  return (
    <>
      <p className="note">
        {num(read)} of {num(rows.length)} servers have a state list; {num(totalIn)} players are on a
        server other than the one their account started on. Arrivals come from the lists and the
        alliance rosters we opened, so they undercount any server whose lists and rosters were not
        read since the window opened.
      </p>

      <h3>Who is on each list</h3>
      <BarChart
        ariaLabel="Players of the top three tiers on each server's list; the figures are in the table below"
        rows={tierRows(rows)}
      />
      <BarLegend
        items={[
          { key: 'commander', label: 'Commander', className: 'bar-commander' },
          { key: 'elite', label: 'Elite', className: 'bar-elite' },
          { key: 'advanced', label: 'Advanced', className: 'bar-advanced' },
        ]}
      />

      <h3>Who moved</h3>
      <BarChart
        diverging
        ariaLabel="Players who left (left) and arrived (right) per server; the figures are in the table below"
        rows={movementRows(rows)}
      />
      <BarLegend
        items={[
          { key: 'out', label: 'Left', className: 'bar-out' },
          { key: 'in', label: 'Arrived', className: 'bar-in' },
        ]}
      />

      <div className="table-wrap">
        <table className="compact">
          <caption>Each server's newest state list</caption>
          <thead>
            <tr>
              <th scope="col">Server</th>
              <th scope="col">List read</th>
              <th scope="col" className="numeric">
                Players
              </th>
              <th scope="col" className="numeric">
                Strongest
              </th>
              <th scope="col" className="numeric">
                150th
              </th>
              <th scope="col" className="numeric">
                Total power
              </th>
              <th scope="col" className="numeric">
                Commander
              </th>
              <th scope="col" className="numeric">
                Elite
              </th>
              <th scope="col" className="numeric">
                Advanced
              </th>
              <th scope="col" className="numeric">
                Rest
              </th>
              <th scope="col" className="numeric">
                Arrived
              </th>
              <th scope="col" className="numeric">
                Left
              </th>
              <th scope="col" className="numeric">
                Net
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.server_id}>
                <th scope="row">
                  <a href={serverHash(r.server_id)}>{r.server_id}</a>
                </th>
                <td>
                  {r.captured_at === null ? (
                    <span className="subtle">never</span>
                  ) : (
                    serverTime(r.captured_at)
                  )}
                </td>
                <td className="numeric">{num(r.listed)}</td>
                <td className="numeric">{power(r.max_power)}</td>
                <td className="numeric">{power(r.min_power)}</td>
                <td className="numeric">{power(r.total_power)}</td>
                <td className="numeric">{num(r.commanders)}</td>
                <td className="numeric">{num(r.elites)}</td>
                <td className="numeric">{num(r.advanced)}</td>
                <td className="numeric">{num(restOfList(r))}</td>
                <td className="numeric">{num(r.moved_in)}</td>
                <td className="numeric">{num(r.moved_out)}</td>
                <td className="numeric">{signed(net(r))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
