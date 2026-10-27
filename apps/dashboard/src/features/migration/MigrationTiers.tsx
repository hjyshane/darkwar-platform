import { useQuery } from '@tanstack/react-query';
import { SERVER_ZONE, zonedDayKey, zonedTime } from '../../lib/timezone';
import { TierBadge } from './TierBadge';
import { TIER_BOARD_SIZE, fetchBoardInfo, fetchTierBoard, summarize, tierOf } from './candidates';
import { num, power } from './format';

const STALE_TIME = 60_000;

function serverTime(iso: string): string {
  return `${zonedDayKey(iso, SERVER_ZONE)} ${zonedTime(iso, SERVER_ZONE)}`;
}

/** The merged state-list board, places 1 to 226, with the four tiers cut on it. */
export function MigrationTiers() {
  const board = useQuery({
    queryKey: ['migration', 'tiers'],
    queryFn: fetchTierBoard,
    staleTime: STALE_TIME,
  });
  const info = useQuery({
    queryKey: ['migration', 'board'],
    queryFn: fetchBoardInfo,
    staleTime: STALE_TIME,
  });

  if (board.isPending) return <p className="empty loading">Loading…</p>;
  if (board.error) return <p className="error">{board.error.message}</p>;
  if (board.data.length === 0) {
    return (
      <p className="empty">
        No state rankings captured yet. Open the Migration tab's state list for each server with the
        collector running.
      </p>
    );
  }

  const rows = board.data;
  const summary = summarize(rows);
  const missing = info.data?.missing_servers ?? [];

  return (
    <>
      {missing.length > 0 && (
        <p className="note">
          <strong>
            Missing lists: {missing.join(', ')}. Places below those servers' players are too high
            until they are captured.
          </strong>
        </p>
      )}

      <div className="table-wrap">
        <table className="compact">
          <caption>
            The four tiers, by place across servers 567–588 taken together, by power
          </caption>
          <thead>
            <tr>
              <th scope="col">Tier</th>
              <th scope="col" className="numeric">
                Places
              </th>
              <th scope="col" className="numeric">
                On the board
              </th>
              <th scope="col" className="numeric">
                Weakest in tier
              </th>
              <th scope="col" className="numeric">
                Strongest
              </th>
              <th scope="col">By server</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((s) => (
              <tr key={s.tier}>
                <th scope="row">
                  <TierBadge tier={s.tier} />
                </th>
                <td className="numeric">
                  {s.last === null ? `${num(s.first)}+` : `${num(s.first)}–${num(s.last)}`}
                </td>
                <td className="numeric">{s.last === null ? '—' : num(s.count)}</td>
                <td
                  className="numeric"
                  title={s.floorPower === null ? undefined : num(s.floorPower)}
                >
                  {s.floorPower === null ? '—' : power(s.floorPower)}
                </td>
                <td className="numeric" title={s.topPower === null ? undefined : num(s.topPower)}>
                  {s.topPower === null ? '—' : power(s.topPower)}
                </td>
                <td>
                  {s.byServer.length === 0
                    ? '—'
                    : s.byServer.map(([server, n], index) => (
                        <span key={server}>
                          {index > 0 && ' · '}
                          {server} <span className="subtle">{n}</span>
                        </span>
                      ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-wrap">
        <table className="compact">
          <caption>
            Top {TIER_BOARD_SIZE} — newest state list per server
            {info.data?.oldest_at && info.data.newest_at
              ? ` (${serverTime(info.data.oldest_at)} to ${serverTime(info.data.newest_at)} server time)`
              : ''}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="numeric">
                Place
              </th>
              <th scope="col">Tier</th>
              <th scope="col">Name</th>
              <th scope="col">Server</th>
              <th scope="col">Alliance</th>
              <th scope="col" className="numeric">
                Power
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.game_uid}>
                <td className="numeric">{num(r.overall_rank)}</td>
                <td>
                  <TierBadge tier={tierOf(r.overall_rank)} />
                </td>
                <th scope="row" title={String(r.game_uid)}>
                  {r.name}
                </th>
                <td>{r.server_id}</td>
                <td>{r.alliance_name ?? '—'}</td>
                <td className="numeric" title={num(r.power)}>
                  {power(r.power)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
