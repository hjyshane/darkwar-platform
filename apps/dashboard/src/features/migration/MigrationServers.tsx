import { useQuery } from '@tanstack/react-query';
import { StatTile } from '../../components/StatTile';
import { serverHash } from '../../lib/route';
import {
  type MigrationFlow,
  delta,
  fetchMigrationFlows,
  fetchMigrationServers,
  flowMatrix,
  totals,
} from './data';
import { num, power, signed, trend } from './format';

const STALE_TIME = 5 * 60_000;

function FlowMatrix({ flows }: { flows: MigrationFlow[] }) {
  const { servers, cell } = flowMatrix(flows);
  if (servers.length === 0) {
    return <p className="empty">Nobody has been seen on a new server yet.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="compact migration-matrix">
        <caption>
          People who moved, from (row) to (column). <span className="muted">★ top 150</span>
        </caption>
        <thead>
          <tr>
            <th scope="col">From \ To</th>
            {servers.map((s) => (
              <th key={s} scope="col" className="numeric">
                {s}
              </th>
            ))}
            <th scope="col" className="numeric">
              Out
            </th>
          </tr>
        </thead>
        <tbody>
          {servers.map((from) => {
            const out = flows.filter((f) => f.from_server_id === from);
            return (
              <tr key={from}>
                <th scope="row">{from}</th>
                {servers.map((to) => {
                  const f = cell(from, to);
                  return (
                    <td
                      key={to}
                      className="numeric"
                      title={f ? `${num(f.movers)} people, ${power(f.power)} power` : undefined}
                    >
                      {f ? num(f.movers) : from === to ? '·' : ''}
                      {f && f.top_movers > 0 && <span className="subtle"> ★{f.top_movers}</span>}
                    </td>
                  );
                })}
                <td className="numeric">
                  <strong>{num(out.reduce((a, f) => a + f.movers, 0))}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MigrationServers({ eventId }: { eventId: string }) {
  const servers = useQuery({
    queryKey: ['migration', 'servers', eventId],
    queryFn: () => fetchMigrationServers(eventId),
    staleTime: STALE_TIME,
  });
  const flows = useQuery({
    queryKey: ['migration', 'flows', eventId],
    queryFn: () => fetchMigrationFlows(eventId),
    staleTime: STALE_TIME,
  });

  if (servers.isPending || flows.isPending) return <p className="empty loading">Loading…</p>;
  if (servers.error) return <p className="error">{servers.error.message}</p>;
  if (flows.error) return <p className="error">{flows.error.message}</p>;
  if (servers.data.length === 0) {
    return (
      <p className="empty">
        Nothing captured on either side yet. The before side needs a cross-server power board or an
        alliance roster within 14 days before the baseline.
      </p>
    );
  }

  const t = totals(servers.data);
  return (
    <>
      <div className="stats">
        <StatTile
          hero
          label="Moved"
          value={num(t.moved)}
          note={`carrying ${power(t.powerMoved)} power`}
        />
        <StatTile label="Stayed" value={num(t.stayed)} />
        <StatTile label="Not seen since" value={num(t.unseen)} note="not re-captured yet" />
        <StatTile label="New on board" value={num(t.appeared)} note="no reading before" />
      </div>

      <div className="table-wrap">
        <table className="compact migration-servers">
          <thead>
            <tr>
              <th scope="col" rowSpan={2}>
                Server
              </th>
              <th scope="colgroup" colSpan={3}>
                Top 150 places
              </th>
              <th scope="colgroup" colSpan={3}>
                Top 150 power
              </th>
              <th scope="colgroup" colSpan={4}>
                Tracked people
              </th>
            </tr>
            <tr>
              <th scope="col" className="numeric">
                Before
              </th>
              <th scope="col" className="numeric">
                After
              </th>
              <th scope="col" className="numeric">
                Δ
              </th>
              <th scope="col" className="numeric">
                Before
              </th>
              <th scope="col" className="numeric">
                After
              </th>
              <th scope="col" className="numeric">
                Δ
              </th>
              <th scope="col" className="numeric">
                Before
              </th>
              <th scope="col" className="numeric">
                In
              </th>
              <th scope="col" className="numeric">
                Out
              </th>
              <th scope="col" className="numeric">
                After
              </th>
            </tr>
          </thead>
          <tbody>
            {servers.data.map((s) => {
              const dTop = delta(s.top_before, s.top_after);
              const dPower = delta(s.top_power_before, s.top_power_after);
              return (
                <tr key={s.server_id}>
                  <th scope="row">
                    <a href={serverHash(s.server_id)}>{s.server_id}</a>
                  </th>
                  <td className="numeric">{num(s.top_before)}</td>
                  <td className="numeric">{num(s.top_after)}</td>
                  <td className={`numeric ${trend(dTop)}`}>{signed(dTop)}</td>
                  <td className="numeric">{power(s.top_power_before)}</td>
                  <td className="numeric">{power(s.top_power_after)}</td>
                  <td className={`numeric ${trend(dPower)}`}>{signed(dPower, power)}</td>
                  <td className="numeric">{num(s.tracked_before)}</td>
                  <td className="numeric" title={`${power(s.power_in)} power`}>
                    {s.moved_in > 0 ? `+${num(s.moved_in)}` : '0'}
                  </td>
                  <td className="numeric" title={`${power(s.power_out)} power`}>
                    {s.moved_out > 0 ? `−${num(s.moved_out)}` : '0'}
                  </td>
                  <td className="numeric">{num(s.tracked_after)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <FlowMatrix flows={flows.data} />

      <p className="note">
        Top 150 is the cross-server power board, captured whole on each side: its columns compare
        like with like. Tracked people also counts the rosters of alliances somebody opened, so a
        server looks bigger or smaller partly by how often we looked at it. Somebody not captured
        after the baseline is “not seen since”, not gone.
      </p>
    </>
  );
}
