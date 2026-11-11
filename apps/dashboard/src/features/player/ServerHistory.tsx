import { serverHash } from '../../lib/route';
import { SERVER_ZONE, zonedDayKey } from '../../lib/timezone';
import type { ServerPath } from './serverPath';

function day(iso: string | null): string | null {
  return iso === null ? null : zonedDayKey(iso, SERVER_ZONE);
}

/** Every server the player has stood on, oldest first: the one the account
 * was made on, then each move as the collector first saw it. A move is dated
 * by the first sighting on the new server, so "arrived by" is an upper bound,
 * and "left after" the lower one when we saw them on the old server at all. */
export function ServerHistory({ path }: { path: ServerPath }) {
  return (
    <>
      <p className="note">
        Started on <a href={serverHash(path.homeServerId)}>Server {path.homeServerId}</a>
        {path.moved
          ? `, moved ${path.stops.length - 1} time${path.stops.length > 2 ? 's' : ''}.`
          : '.'}{' '}
        A move is seen only when a board or roster naming the player is read, so the dates bracket
        the move rather than mark it.
      </p>
      <div className="table-wrap">
        <table className="compact">
          <thead>
            <tr>
              <th scope="col">Server</th>
              <th scope="col">Arrived by</th>
              <th scope="col">Last seen on the previous server</th>
            </tr>
          </thead>
          <tbody>
            {path.stops.map((stop, at) => (
              // Position, not server: a player can return to a server.
              // biome-ignore lint/suspicious/noArrayIndexKey: the path is append-only and never reordered
              <tr key={at}>
                <th scope="row">
                  <a href={serverHash(stop.serverId)}>{stop.serverId}</a>
                  {at === 0 && <span className="subtle"> · first server</span>}
                  {stop.current && <span className="subtle"> · now</span>}
                </th>
                <td>{stop.arrivedBy === null ? '—' : day(stop.arrivedBy)}</td>
                <td>
                  {at === 0
                    ? '—'
                    : (day(stop.leftPreviousAfter) ?? (
                        <span className="subtle">not seen there</span>
                      ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
