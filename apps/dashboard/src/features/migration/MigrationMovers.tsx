import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import { serverHash } from '../../lib/route';
import { SERVER_ZONE, zonedDayKey, zonedTime } from '../../lib/timezone';
import { TierBadge } from './TierBadge';
import { TIERS_TOP_DOWN, TIER_LABELS, tierOf } from './candidates';
import { num, power } from './format';
import {
  type ListFreshness,
  type Mover,
  NO_MOVER_FILTERS,
  fetchFreshness,
  fetchMovers,
  filterMovers,
  flows,
  staleLists,
  tally,
} from './movers';

const STALE_TIME = 60_000;
const DAY = 86_400_000;

function serverTime(iso: string): string {
  return `${zonedDayKey(iso, SERVER_ZONE)} ${zonedTime(iso, SERVER_ZONE)}`;
}

/** When each server's list was last read. A list read before the window opened cannot
 * show who moved, so the old ones are named: they have to be opened in the game again. */
function Freshness({ rows }: { rows: ListFreshness[] }) {
  const old = new Set(staleLists(rows, Date.now(), DAY));
  return (
    <details open={old.size > 0}>
      <summary>
        <h3>
          Lists read{' '}
          <span className="subtle">
            {rows.length - old.size} of {rows.length} within a day
          </span>
        </h3>
      </summary>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th scope="col">Server</th>
              <th scope="col">Last read</th>
              <th scope="col" className="numeric">
                Players
              </th>
              <th scope="col" className="numeric">
                Movers
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
                  {old.has(r.server_id) && r.captured_at !== null && (
                    <span className="subtle"> · read again to see who moved since</span>
                  )}
                </td>
                <td className="numeric">{num(r.listed)}</td>
                <td className="numeric">{old.has(r.server_id) ? '—' : num(r.movers)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Who moved servers, read off the state lists: the people whose current server is not the
 * one their uid ends in. Only movers are listed. */
export function MigrationMovers() {
  const movers = useQuery({
    queryKey: ['migration', 'movers'],
    queryFn: fetchMovers,
    staleTime: STALE_TIME,
  });
  const fresh = useQuery({
    queryKey: ['migration', 'freshness'],
    queryFn: fetchFreshness,
    staleTime: STALE_TIME,
  });
  const [filters, setFilters] = useState(NO_MOVER_FILTERS);

  if (movers.isPending || fresh.isPending) return <p className="empty loading">Loading…</p>;
  if (movers.error) return <p className="error">{movers.error.message}</p>;
  if (fresh.error) return <p className="error">{fresh.error.message}</p>;

  const all: Mover[] = movers.data;
  const rows = filterMovers(all, filters, tierOf);
  const servers = [...new Set(all.flatMap((m) => [m.home_server, m.server_id]))].sort(
    (a, b) => a - b,
  );
  const set = (patch: Partial<typeof filters>) => setFilters({ ...filters, ...patch });

  return (
    <>
      <p className="note">
        {num(all.length)} players on the state lists are on a different server from the one they
        started on. Only the top 150 of each list is read, and only lists read since the window
        opened show arrivals: servers not yet read again are named below.
      </p>
      <Freshness rows={fresh.data} />

      {all.length === 0 ? (
        <p className="empty">No mover on any list yet.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="compact">
              <caption>Where they went</caption>
              <thead>
                <tr>
                  <th scope="col">Server</th>
                  <th scope="col" className="numeric">
                    Arrived
                  </th>
                  <th scope="col" className="numeric">
                    Left
                  </th>
                </tr>
              </thead>
              <tbody>
                {tally(all).map((t) => (
                  <tr key={t.server}>
                    <th scope="row">
                      <a href={serverHash(t.server)}>{t.server}</a>
                    </th>
                    <td className="numeric">{t.arrived === 0 ? '—' : num(t.arrived)}</td>
                    <td className="numeric">{t.left === 0 ? '—' : num(t.left)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="table-wrap">
            <table className="compact">
              <caption>From → to</caption>
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col" className="numeric">
                    Players
                  </th>
                </tr>
              </thead>
              <tbody>
                {flows(all)
                  .slice(0, 40)
                  .map((f) => (
                    <tr key={`${f.from}>${f.to}`}>
                      <td>{f.from}</td>
                      <td>{f.to}</td>
                      <td className="numeric">{num(f.count)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="migration-bar">
            <label>
              From{' '}
              <Select value={filters.from} onChange={(from) => set({ from })}>
                <option value="">All</option>
                {servers.map((s) => (
                  <option key={s} value={String(s)}>
                    {s}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              To{' '}
              <Select value={filters.to} onChange={(to) => set({ to })}>
                <option value="">All</option>
                {servers.map((s) => (
                  <option key={s} value={String(s)}>
                    {s}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              Tier{' '}
              <Select value={filters.tier} onChange={(tier) => set({ tier })}>
                <option value="">All</option>
                {TIERS_TOP_DOWN.map((t) => (
                  <option key={t} value={t}>
                    {TIER_LABELS[t]}
                  </option>
                ))}
              </Select>
            </label>
            <span className="subtle">
              {rows.length === all.length
                ? `${num(all.length)} movers`
                : `${num(rows.length)} of ${num(all.length)}`}
            </span>
          </div>

          <div className="table-wrap">
            <table className="compact">
              <caption>The movers, strongest first</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">From → to</th>
                  <th scope="col">Alliance</th>
                  <th scope="col" className="numeric">
                    Power
                  </th>
                  <th scope="col" className="numeric">
                    Place
                  </th>
                  <th scope="col">Tier</th>
                  <th scope="col">Read</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.game_uid}>
                    <th scope="row" title={String(m.game_uid)}>
                      {m.name}
                    </th>
                    <td>
                      {m.home_server} → <strong>{m.server_id}</strong>
                    </td>
                    <td>{m.alliance_name ?? '—'}</td>
                    <td className="numeric" title={num(m.power)}>
                      {power(m.power)}
                    </td>
                    <td className="numeric">{num(m.board_rank)}</td>
                    <td>
                      <TierBadge tier={tierOf(m.board_rank)} />
                    </td>
                    <td>{serverTime(m.captured_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
