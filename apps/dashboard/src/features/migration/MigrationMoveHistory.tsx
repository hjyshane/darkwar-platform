import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import { allianceHash, playerHash, serverHash } from '../../lib/route';
import { SERVER_ZONE, zonedDayKey } from '../../lib/timezone';
import { DEFAULT_SERVER, SERVERS } from './boards';
import { num, power, signed } from './format';
import {
  type ServerFlowRow,
  type Since,
  byOtherServer,
  fetchMoveTally,
  fetchServerFlow,
  sinceIso,
  splitFlow,
} from './moveHistory';

const STALE_TIME = 60_000;

function day(iso: string | null): string {
  return iso === null ? '—' : zonedDayKey(iso, SERVER_ZONE);
}

/** One direction of one server's moves: who, from or to where, when first seen. */
function FlowTable({
  caption,
  rows,
  otherLabel,
  server,
}: {
  caption: string;
  rows: ServerFlowRow[];
  otherLabel: string;
  /** The server being read, so a first server that is one end of the move is not repeated. */
  server: number;
}) {
  if (rows.length === 0) {
    return <p className="empty">{caption}: nobody recorded.</p>;
  }
  const others = byOtherServer(rows);
  return (
    <div className="table-wrap">
      <table className="compact">
        <caption>
          {caption} <span className="subtle">{num(rows.length)}</span>{' '}
          <span className="subtle">
            ·{' '}
            {others
              .slice(0, 8)
              .map((o) => `${o.server} ${num(o.count)}`)
              .join(' · ')}
          </span>
        </caption>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Alliance now</th>
            <th scope="col" className="numeric">
              Power now
            </th>
            <th scope="col">{otherLabel}</th>
            <th scope="col">First seen</th>
            <th scope="col">Last seen before</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.move_id}>
              <th scope="row">
                <a href={playerHash(r.player_id)}>{r.player_name ?? `UID ${r.game_uid}`}</a>
                {r.home_server !== r.other_server_id && r.home_server !== server && (
                  <span className="subtle"> · started on {r.home_server}</span>
                )}
              </th>
              <td>
                {r.alliance_id === null ? (
                  '—'
                ) : (
                  <a href={allianceHash(r.alliance_id)}>
                    {r.alliance_code ? `[${r.alliance_code}] ` : ''}
                    {r.alliance_name ?? 'alliance'}
                  </a>
                )}
              </td>
              <td className="numeric" title={r.power === null ? undefined : num(r.power)}>
                {power(r.power)}
              </td>
              <td>
                <a href={serverHash(r.other_server_id)}>{r.other_server_id}</a>
              </td>
              <td>{day(r.seen_at)}</td>
              <td>{day(r.last_seen_from_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The recorded moves (0320), per server: who arrived and who left, across every
 * migration window since recording began, not only the newest reading. */
export function MigrationMoveHistory() {
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [since, setSince] = useState<Since>('all');
  // Fixed per choice, so the query key is stable across renders.
  const [sinceAt, setSinceAt] = useState<string | undefined>(undefined);

  const tally = useQuery({
    queryKey: ['migration', 'move-tally', sinceAt ?? 'all'],
    queryFn: () => fetchMoveTally(sinceAt),
    staleTime: STALE_TIME,
  });
  const flow = useQuery({
    queryKey: ['migration', 'server-flow', server, sinceAt ?? 'all'],
    queryFn: () => fetchServerFlow(server, sinceAt),
    staleTime: STALE_TIME,
  });

  const choose = (value: string) => {
    const next = value as Since;
    setSince(next);
    setSinceAt(sinceIso(next, Date.now()));
  };
  const tallied = new Map((tally.data ?? []).map((t) => [t.server_id, t]));
  const servers = [...new Set([...SERVERS, ...tallied.keys()])].sort((a, b) => a - b);

  return (
    <>
      <p className="note">
        Every server change the collector has seen, kept from one migration window to the next. A
        player is placed on a server when a board or roster that names them is read, so "first seen"
        is when we noticed the move, and "last seen before" when we last saw them where they came
        from. A player's first server is the one their account was made on.
      </p>

      <div className="migration-bar">
        <label>
          Server{' '}
          <Select value={String(server)} onChange={(value) => setServer(Number(value))}>
            {servers.map((s) => (
              <option key={s} value={String(s)}>
                {s}
              </option>
            ))}
          </Select>
        </label>
        <label>
          Since{' '}
          <Select value={since} onChange={choose}>
            <option value="all">All recorded</option>
            <option value="30d">Last 30 days</option>
            <option value="7d">Last 7 days</option>
          </Select>
        </label>
      </div>

      {tally.error ? (
        <p className="error">{tally.error.message}</p>
      ) : tally.isPending ? (
        <p className="empty loading">Loading…</p>
      ) : tally.data.length === 0 ? (
        <p className="empty">No move recorded yet.</p>
      ) : (
        <details>
          <summary>
            <h3>
              Every server <span className="subtle">{num(tally.data.length)} with moves</span>
            </h3>
          </summary>
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th scope="col">Server</th>
                  <th scope="col" className="numeric">
                    Arrived
                  </th>
                  <th scope="col" className="numeric">
                    Left
                  </th>
                  <th scope="col" className="numeric">
                    Net
                  </th>
                  <th scope="col">Newest move</th>
                </tr>
              </thead>
              <tbody>
                {tally.data.map((t) => (
                  <tr key={t.server_id} aria-current={t.server_id === server ? 'true' : undefined}>
                    <th scope="row">
                      <button
                        className="linklike"
                        onClick={() => setServer(t.server_id)}
                        type="button"
                      >
                        {t.server_id}
                      </button>
                    </th>
                    <td className="numeric">{num(t.arrived)}</td>
                    <td className="numeric">{num(t.departed)}</td>
                    <td className="numeric">{signed(t.arrived - t.departed)}</td>
                    <td>{day(t.last_move_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <h3>Server {server}</h3>
      {flow.error ? (
        <p className="error">{flow.error.message}</p>
      ) : flow.isPending ? (
        <p className="empty loading">Loading…</p>
      ) : (
        <>
          <FlowTable
            caption="Arrived"
            otherLabel="From"
            rows={splitFlow(flow.data).arrived}
            server={server}
          />
          <FlowTable
            caption="Left"
            otherLabel="To"
            rows={splitFlow(flow.data).departed}
            server={server}
          />
        </>
      )}
    </>
  );
}
