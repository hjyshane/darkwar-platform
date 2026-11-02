import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import { SERVER_ZONE, zonedDayKey, zonedTime } from '../../lib/timezone';
import { TierBadge } from './TierBadge';
import { DEFAULT_SERVER, SERVERS, fetchServerTop } from './boards';
import { tierOf } from './candidates';
import { num, power } from './format';

const STALE_TIME = 60_000;

function serverTime(iso: string): string {
  return `${zonedDayKey(iso, SERVER_ZONE)} ${zonedTime(iso, SERVER_ZONE)}`;
}

/** One server's top 150 as the game's own migration tab lists it: pick a server and read its
 * newest state list. The tier is the place on the merged board of every server, not on this
 * list alone, since that is what the game cuts the tiers on. */
export function MigrationServerTop() {
  const [server, setServer] = useState(DEFAULT_SERVER);
  const list = useQuery({
    queryKey: ['migration', 'server-top', server],
    queryFn: () => fetchServerTop(server),
    staleTime: STALE_TIME,
  });
  const rows = list.data ?? [];
  const moved = rows.filter((r) => r.home_server !== server).length;
  const readAt = rows[0]?.captured_at;

  return (
    <>
      <div className="migration-bar">
        <label>
          Server{' '}
          <Select value={String(server)} onChange={(value) => setServer(Number(value))}>
            {SERVERS.map((s) => (
              <option key={s} value={String(s)}>
                {s}
              </option>
            ))}
          </Select>
        </label>
        {readAt && (
          <span className="subtle">
            list read {serverTime(readAt)} server time · {num(rows.length)} players · {num(moved)}{' '}
            moved in
          </span>
        )}
      </div>

      {list.isPending && <p className="empty loading">Loading…</p>}
      {list.error && <p className="error">{list.error.message}</p>}
      {list.data && rows.length === 0 && (
        <p className="empty">
          No state list has been read for server {server} yet. Open its ranking in the game's
          migration tab with the collector running.
        </p>
      )}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="compact">
            <caption>
              Server {server}: the strongest {num(rows.length)} players on its newest list. Tier is
              the place across servers 567–588.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="numeric">
                  #
                </th>
                <th scope="col">Name</th>
                <th scope="col">From → now</th>
                <th scope="col">Alliance</th>
                <th scope="col" className="numeric">
                  Power
                </th>
                <th scope="col" className="numeric">
                  Place
                </th>
                <th scope="col">Tier</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.game_uid}>
                  <td className="numeric">{num(r.server_place)}</td>
                  <th scope="row" title={String(r.game_uid)}>
                    {r.name}
                  </th>
                  <td>
                    {r.home_server === server ? (
                      '—'
                    ) : (
                      <>
                        {r.home_server} → <strong>{server}</strong>
                      </>
                    )}
                  </td>
                  <td>{r.alliance_name ?? '—'}</td>
                  <td className="numeric" title={num(r.power)}>
                    {power(r.power)}
                  </td>
                  <td className="numeric">{num(r.board_rank)}</td>
                  <td>
                    <TierBadge tier={tierOf(r.board_rank)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
