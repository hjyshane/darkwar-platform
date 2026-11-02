import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { BarChart, BarLegend } from '../../components/BarChart';
import { Select } from '../../components/ui/Select';
import { serverHash } from '../../lib/route';
import { SERVER_ZONE, zonedDayKey, zonedTime } from '../../lib/timezone';
import {
  type AllianceSort,
  allianceMoverRows,
  arrangeAlliances,
  fetchAllianceStats,
} from './boards';
import { num, power } from './format';

const STALE_TIME = 60_000;

const SORTS: ReadonlyArray<{ sort: AllianceSort; label: string }> = [
  { sort: 'moved', label: 'Movers' },
  { sort: 'power', label: 'Total power' },
  { sort: 'members', label: 'Members read' },
  { sort: 'server', label: 'Server' },
  { sort: 'name', label: 'Name' },
];

function serverTime(iso: string): string {
  return `${zonedDayKey(iso, SERVER_ZONE)} ${zonedTime(iso, SERVER_ZONE)}`;
}

/** Alliances across all servers, from the member lists we opened: how many members were read,
 * their power, how many started on another server, and how many reach each tier by power. */
export function MigrationAllianceStats() {
  const stats = useQuery({
    queryKey: ['migration', 'alliance-stats'],
    queryFn: fetchAllianceStats,
    staleTime: STALE_TIME,
  });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<AllianceSort>('moved');
  const [descending, setDescending] = useState(true);

  if (stats.isPending) return <p className="empty loading">Loading…</p>;
  if (stats.error) return <p className="error">{stats.error.message}</p>;
  if (stats.data.length === 0) {
    return (
      <p className="empty">
        No alliance member list has been read lately. Open an alliance's member list from the
        Cross-Server ranking in the game with the collector running.
      </p>
    );
  }

  const rows = arrangeAlliances(stats.data, search, sort, descending);
  const totalMoved = stats.data.reduce((sum, r) => sum + r.moved, 0);

  return (
    <>
      <p className="note">
        {num(stats.data.length)} alliances whose member list was read in the last 30 days;{' '}
        {num(totalMoved)} of their members started on another server. Tiers here are judged by power
        against the cut-offs of the merged board (the 10th, 46th and 226th strongest), since a
        member list carries no place.
      </p>

      <h3>Alliances with the most movers</h3>
      <BarChart
        ariaLabel="Alliances with the most members who moved server; the figures are in the table below"
        rows={allianceMoverRows(stats.data, 15)}
      />
      <BarLegend
        items={[{ key: 'moved', label: 'Members who moved', className: 'bar-alliance' }]}
      />

      <div className="migration-bar">
        <label>
          Find{' '}
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="name or tag"
          />
        </label>
        <label>
          Sort{' '}
          <Select value={sort} onChange={(value) => setSort(value as AllianceSort)}>
            {SORTS.map((s) => (
              <option key={s.sort} value={s.sort}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
        <button type="button" onClick={() => setDescending(!descending)}>
          {descending ? 'Largest first ▼' : 'Smallest first ▲'}
        </button>
        <span className="subtle">
          {rows.length === stats.data.length
            ? `${num(rows.length)} alliances`
            : `${num(rows.length)} of ${num(stats.data.length)}`}
        </span>
      </div>

      <div className="table-wrap">
        <table className="compact">
          <caption>Alliances by their newest member list</caption>
          <thead>
            <tr>
              <th scope="col">Alliance</th>
              <th scope="col">Server</th>
              <th scope="col" className="numeric">
                Members read
              </th>
              <th scope="col" className="numeric">
                Total power
              </th>
              <th scope="col" className="numeric">
                Movers
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
              <th scope="col">List read</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.alliance_id}>
                <th scope="row">
                  {r.code ? `[${r.code}] ` : ''}
                  {r.name ?? '(unnamed)'}
                </th>
                <td>
                  <a href={serverHash(r.server_id)}>{r.server_id}</a>
                </td>
                <td className="numeric">{num(r.members)}</td>
                <td
                  className="numeric"
                  title={r.total_power === null ? undefined : num(r.total_power)}
                >
                  {power(r.total_power)}
                </td>
                <td className="numeric">{r.moved === 0 ? '—' : num(r.moved)}</td>
                <td className="numeric">{r.commanders === 0 ? '—' : num(r.commanders)}</td>
                <td className="numeric">{r.elites === 0 ? '—' : num(r.elites)}</td>
                <td className="numeric">{r.advanced === 0 ? '—' : num(r.advanced)}</td>
                <td>{serverTime(r.captured_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
