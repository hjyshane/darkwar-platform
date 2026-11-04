import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { StatTile } from '../../components/StatTile';
import { serverHash } from '../../lib/route';
import { RouteFlow, SeatDumbbells, ServerScoreboard, TierPyramid } from './MigrationInfographic';
import { TierBadge } from './TierBadge';
import {
  type AllianceMovers,
  type BoardShift,
  TIER_SIZE,
  allianceMovers,
  alliancePowerChange,
  boardShift,
  extremes,
  personPowerChange,
  personRankClimb,
  routes,
  scale,
  serverFlows,
  serverPowerChange,
  tierMobility,
} from './analytics';
import { TIERS_TOP_DOWN, TIER_LABELS, fetchBoardInfo, fetchTierBoard } from './candidates';
import {
  type MigrationAlliance,
  type MigrationPerson,
  fetchMigrationAlliances,
  fetchMigrationServers,
  fetchMigrationTopBoard,
} from './data';
import { num, power, signed, trend } from './format';
import { fetchMovers } from './movers';

const STALE_TIME = 60_000;

interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  /** What is printed beside the bar; the bar itself is decoration. */
  text: string;
}

/** Bars growing right from a centre line for a gain and left for a loss, each with its
 * figure printed beside it so the colour and the length are never the only carriers. */
function DivergingBars({ rows, caption }: { rows: readonly BarRow[]; caption: string }) {
  const max = Math.max(0, ...rows.map((r) => Math.abs(r.value)));
  return (
    <figure className="viz">
      <figcaption>{caption}</figcaption>
      <ul className="viz-rows">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="viz-label">{r.label}</span>
            <span className="viz-track" aria-hidden="true">
              <i
                className={r.value < 0 ? 'viz-down' : 'viz-up'}
                style={{ width: `${scale(r.value, max) * 50}%` }}
              />
            </span>
            <span className={`viz-text ${trend(r.value)}`}>{r.text}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function TierLegend() {
  return (
    <span className="viz-legend">
      {TIERS_TOP_DOWN.map((t) => (
        <TierBadge key={t} tier={t} />
      ))}
    </span>
  );
}

/** Where the movers on the lists and in the rosters went, who gained and lost, what they
 * carried, and which tiers they came from — everything read off one set of readings. */
function Observed() {
  const movers = useQuery({
    queryKey: ['migration', 'movers'],
    queryFn: fetchMovers,
    staleTime: STALE_TIME,
  });
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

  if (movers.isPending || board.isPending) return <p className="empty loading">Loading…</p>;
  if (movers.error) return <p className="error">{movers.error.message}</p>;
  if (board.error) return <p className="error">{board.error.message}</p>;

  const flows = serverFlows(movers.data);
  const shift = boardShift(board.data);
  const tiers = tierMobility(movers.data);
  const topRoutes = routes(movers.data).slice(0, 12);
  const missing = info.data?.missing_servers ?? [];

  const moved = movers.data.length;
  const carried = movers.data.reduce((acc, m) => acc + m.power, 0);
  const onBoard = board.data.filter((r) =>
    movers.data.some((m) => m.game_uid === r.game_uid),
  ).length;
  const biggest = [...flows].sort((a, b) => b.net - a.net)[0];
  const smallest = [...flows].sort((a, b) => a.net - b.net)[0];
  const maxRoute = Math.max(1, ...topRoutes.map((r) => r.count));

  return (
    <>
      <div className="stats">
        <StatTile hero label="Moved" value={num(moved)} note={`carrying ${power(carried)} power`} />
        <StatTile
          label="Top 226 who moved"
          value={`${num(onBoard)} of ${num(board.data.length)}`}
          note="Commander, Elite and Advanced"
        />
        <StatTile
          label="Biggest net gain"
          tone={biggest && biggest.net > 0 ? 'up' : undefined}
          value={biggest && biggest.net > 0 ? `${biggest.server}  ${signed(biggest.net)}` : '—'}
          note={biggest && biggest.net > 0 ? `${power(biggest.powerNet)} power net` : undefined}
        />
        <StatTile
          label="Biggest net loss"
          tone={smallest && smallest.net < 0 ? 'down' : undefined}
          value={smallest && smallest.net < 0 ? `${smallest.server}  ${signed(smallest.net)}` : '—'}
          note={
            smallest && smallest.net < 0
              ? `${signed(smallest.powerNet, power)} power net`
              : undefined
          }
        />
      </div>

      {missing.length > 0 && (
        <p className="note">
          <strong>
            Missing lists: {missing.join(', ')}. Their servers look emptier than they are until the
            lists are read again.
          </strong>
        </p>
      )}

      {moved === 0 ? (
        <p className="empty">No mover on any list yet — nothing to chart.</p>
      ) : (
        <>
          <h4>At a glance</h4>
          <ServerScoreboard flows={flows} />
          <div className="viz-pair">
            <RouteFlow routes={routes(movers.data)} flows={flows} />
            <TierPyramid tiers={tiers} />
          </div>
          <SeatDumbbells shift={shift} />

          <div className="viz-pair">
            <DivergingBars
              caption="Net players per server (arrived − left), all tiers"
              rows={flows.map((f) => ({
                key: String(f.server),
                label: <a href={serverHash(f.server)}>{f.server}</a>,
                value: f.net,
                text: `${signed(f.net)}  (+${f.arrived} / −${f.left})`,
              }))}
            />
            <DivergingBars
              caption="Net power per server carried by movers"
              rows={flows.map((f) => ({
                key: String(f.server),
                label: <a href={serverHash(f.server)}>{f.server}</a>,
                value: f.powerNet,
                text: signed(f.powerNet, power),
              }))}
            />
          </div>

          <TopShift shift={shift} />

          <AllianceBoard rows={allianceMovers(movers.data)} />

          <div className="table-wrap">
            <table className="compact">
              <caption>How many of each tier moved</caption>
              <thead>
                <tr>
                  <th scope="col">Tier</th>
                  <th scope="col" className="numeric">
                    Places
                  </th>
                  <th scope="col" className="numeric">
                    Moved
                  </th>
                  <th scope="col">Share of the tier</th>
                  <th scope="col" className="numeric">
                    Power moved
                  </th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((t) => (
                  <tr key={t.tier}>
                    <th scope="row">
                      <TierBadge tier={t.tier} />
                    </th>
                    <td className="numeric">{TIER_SIZE[t.tier] === null ? '227+' : num(t.size)}</td>
                    <td className="numeric">{num(t.moved)}</td>
                    <td>
                      {t.share === null ? (
                        <span className="subtle">seen only — no denominator</span>
                      ) : (
                        <span className="viz-share">
                          <span className="viz-track viz-track-one" aria-hidden="true">
                            <i
                              className={`viz-fill viz-${t.tier}`}
                              style={{ width: `${t.share * 100}%` }}
                            />
                          </span>
                          {Math.round(t.share * 100)}%
                        </span>
                      )}
                    </td>
                    <td className="numeric" title={num(t.power)}>
                      {power(t.power)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <figure className="viz">
            <figcaption>
              Busiest routes, split by tier <TierLegend />
            </figcaption>
            <ul className="viz-rows">
              {topRoutes.map((r) => (
                <li key={`${r.from}>${r.to}`}>
                  <span className="viz-label">
                    {r.from} → <strong>{r.to}</strong>
                  </span>
                  <span className="viz-track viz-track-one" aria-hidden="true">
                    {TIERS_TOP_DOWN.map((t) => (
                      <i
                        key={t}
                        className={`viz-fill viz-${t}`}
                        style={{ width: `${(r.byTier[t] / maxRoute) * 100}%` }}
                      />
                    ))}
                  </span>
                  <span className="viz-text">
                    {num(r.count)} · {power(r.power)}
                  </span>
                </li>
              ))}
            </ul>
          </figure>
        </>
      )}

      <p className="note">
        Built from the newest state list per server and the alliance rosters opened since the window
        began. A mover who sits on a list or roster that has not been read again is not counted, so
        “left” undercounts where its destination list is old. Backbone has no end: the count is the
        movers seen, not a share of the tier.
      </p>
    </>
  );
}

/** Alliances by their movers, from the same lists and rosters as everything above, so it
 * covers every server whether or not an alliance's member list was opened. */
function AllianceBoard({ rows }: { rows: AllianceMovers[] }) {
  if (rows.length === 0) {
    return (
      <p className="empty">
        No mover carries an alliance name — names show for officers and admins only.
      </p>
    );
  }
  const shown = rows.slice(0, 25);
  const max = Math.max(1, ...shown.map((r) => r.movers));
  return (
    <>
      <figure className="viz">
        <figcaption>
          Alliances that took in the most movers <TierLegend />
        </figcaption>
        <ul className="viz-rows">
          {shown.slice(0, 15).map((r) => (
            <li key={r.name}>
              <span className="viz-label" title={r.name}>
                {r.name}
              </span>
              <span className="viz-track viz-track-one" aria-hidden="true">
                {TIERS_TOP_DOWN.map((t) => (
                  <i
                    key={t}
                    className={`viz-fill viz-${t}`}
                    style={{ width: `${(r.byTier[t] / max) * 100}%` }}
                  />
                ))}
              </span>
              <span className="viz-text">
                {num(r.movers)} · {power(r.power)}
              </span>
            </li>
          ))}
        </ul>
      </figure>
      <div className="table-wrap">
        <table className="compact">
          <caption>Alliances with movers, from any server's list or opened roster</caption>
          <thead>
            <tr>
              <th scope="col">Alliance</th>
              <th scope="col">Server</th>
              <th scope="col" className="numeric">
                Movers
              </th>
              <th scope="col" className="numeric">
                Power
              </th>
              <th scope="col">Came from</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.name}>
                <th scope="row">{r.name}</th>
                <td>
                  <a href={serverHash(r.server)}>{r.server}</a>
                </td>
                <td className="numeric">{num(r.movers)}</td>
                <td className="numeric" title={num(r.power)}>
                  {power(r.power)}
                </td>
                <td>
                  {r.from.map(([server, n], i) => (
                    <span key={server}>
                      {i > 0 && ' · '}
                      {server} <span className="subtle">{n}</span>
                    </span>
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

/** The top 226 counted by where each player started against where they stand now. */
function TopShift({ shift }: { shift: BoardShift[] }) {
  return (
    <>
      <DivergingBars
        caption="Top 226 places gained or lost per server (now − started there)"
        rows={shift.map((s) => ({
          key: String(s.server),
          label: <a href={serverHash(s.server)}>{s.server}</a>,
          value: s.net,
          text: `${signed(s.net)}  (${s.home} → ${s.now})`,
        }))}
      />
      <div className="table-wrap">
        <table className="compact migration-matrix">
          <caption>
            Top 226 by server: started there → stand there now, and the change in each tier
          </caption>
          <thead>
            <tr>
              <th scope="col">Server</th>
              <th scope="col" className="numeric">
                Started
              </th>
              <th scope="col" className="numeric">
                Now
              </th>
              <th scope="col" className="numeric">
                Δ
              </th>
              {TIERS_TOP_DOWN.slice(0, 3).map((t) => (
                <th key={t} scope="col" className="numeric">
                  {TIER_LABELS[t]} Δ
                </th>
              ))}
              <th scope="col" className="numeric">
                Power started
              </th>
              <th scope="col" className="numeric">
                Power now
              </th>
              <th scope="col" className="numeric">
                Δ
              </th>
            </tr>
          </thead>
          <tbody>
            {shift.map((s) => (
              <tr key={s.server}>
                <th scope="row">
                  <a href={serverHash(s.server)}>{s.server}</a>
                </th>
                <td className="numeric">{num(s.home)}</td>
                <td className="numeric">{num(s.now)}</td>
                <td className={`numeric ${trend(s.net)}`}>{signed(s.net)}</td>
                {TIERS_TOP_DOWN.slice(0, 3).map((t) => (
                  <td key={t} className={`numeric ${trend(s.byTier[t])}`}>
                    {signed(s.byTier[t])}
                  </td>
                ))}
                <td className="numeric">{power(s.powerHome)}</td>
                <td className="numeric">{power(s.powerNow)}</td>
                <td className={`numeric ${trend(s.powerNow - s.powerHome)}`}>
                  {signed(s.powerNow - s.powerHome, power)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function allianceLabel(a: MigrationAlliance): string {
  if (a.code && a.name) return `[${a.code}] ${a.name}`;
  return a.name ?? a.code ?? a.external_id.slice(0, 8);
}

function personLabel(p: MigrationPerson): string {
  return p.name ?? String(p.game_uid);
}

/** What the baseline comparison adds: the same cross-server boards read on both sides, so
 * power and place can be compared, for servers, alliances and people. */
function BeforeAfter({ eventId }: { eventId: string }) {
  const servers = useQuery({
    queryKey: ['migration', 'servers', eventId],
    queryFn: () => fetchMigrationServers(eventId),
    staleTime: STALE_TIME,
  });
  const alliances = useQuery({
    queryKey: ['migration', 'alliances', eventId],
    queryFn: () => fetchMigrationAlliances(eventId),
    staleTime: STALE_TIME,
  });
  const people = useQuery({
    queryKey: ['migration', 'top', eventId],
    queryFn: () => fetchMigrationTopBoard(eventId),
    staleTime: STALE_TIME,
  });

  if (servers.isPending || alliances.isPending || people.isPending) {
    return <p className="empty loading">Loading…</p>;
  }
  if (servers.error) return <p className="error">{servers.error.message}</p>;
  if (alliances.error) return <p className="error">{alliances.error.message}</p>;
  if (people.error) return <p className="error">{people.error.message}</p>;

  const serverRows = servers.data
    .filter((s) => serverPowerChange(s) !== null)
    .map((s) => ({
      key: String(s.server_id),
      label: <a href={serverHash(s.server_id)}>{s.server_id}</a>,
      value: serverPowerChange(s) ?? 0,
      text: `${signed(serverPowerChange(s), power)}  (${power(s.top_power_before)} → ${power(s.top_power_after)})`,
    }));
  const placeRows = servers.data
    .filter((s) => s.top_before !== null && s.top_after !== null)
    .map((s) => ({
      key: String(s.server_id),
      label: <a href={serverHash(s.server_id)}>{s.server_id}</a>,
      value: s.top_after - s.top_before,
      text: `${signed(s.top_after - s.top_before)}  (${s.top_before} → ${s.top_after})`,
    }));

  const withRoster = alliances.data.filter(
    (a) =>
      a.roster_before_at !== null || a.roster_after_at !== null || alliancePowerChange(a) !== null,
  );
  const allied = extremes(withRoster, alliancePowerChange, 8);
  const alliedRows = (side: typeof allied.up) =>
    side.map((s) => ({
      key: s.item.external_id,
      label: allianceLabel(s.item),
      value: s.change,
      text: `${signed(s.change, power)}${s.item.before_server_id !== null && s.item.after_server_id !== null && s.item.before_server_id !== s.item.after_server_id ? `  ${s.item.before_server_id} → ${s.item.after_server_id}` : ''}`,
    }));

  const kept = people.data.filter((p) => p.status === 'moved' || p.status === 'stayed');
  const powerMoves = extremes(kept, personPowerChange, 8);
  const climbs = extremes(kept, personRankClimb, 8);
  const peopleRows = (side: typeof powerMoves.up) =>
    side.map((s) => ({
      key: String(s.item.game_uid),
      label: `${personLabel(s.item)}${s.item.status === 'moved' ? ` (${s.item.before_server_id} → ${s.item.after_server_id})` : ''}`,
      value: s.change,
      text: signed(s.change, power),
    }));
  const climbRows = (side: typeof climbs.up) =>
    side.map((s) => ({
      key: String(s.item.game_uid),
      label: `${personLabel(s.item)}${s.item.status === 'moved' ? ` (${s.item.before_server_id} → ${s.item.after_server_id})` : ''}`,
      value: s.change,
      text: `${signed(s.change)}  (#${s.item.before_rank} → #${s.item.after_rank})`,
    }));

  if (serverRows.length === 0 && withRoster.length === 0 && kept.length === 0) {
    return (
      <p className="empty">
        Nothing is on both sides of the baseline yet — the comparison needs a cross-server board or
        an alliance roster before it and one after.
      </p>
    );
  }

  return (
    <>
      {serverRows.length > 0 && (
        <div className="viz-pair">
          <DivergingBars caption="Top-150 power per server, after − before" rows={serverRows} />
          <DivergingBars caption="Top-150 places per server, after − before" rows={placeRows} />
        </div>
      )}
      {withRoster.length > 0 && (
        <div className="viz-pair">
          <DivergingBars
            caption="Alliances that grew strongest (power)"
            rows={alliedRows(allied.up)}
          />
          <DivergingBars
            caption="Alliances that weakened most (power)"
            rows={alliedRows(allied.down)}
          />
        </div>
      )}
      {kept.length > 0 && (
        <>
          <div className="viz-pair">
            <DivergingBars
              caption="Players who gained most power"
              rows={peopleRows(powerMoves.up)}
            />
            <DivergingBars
              caption="Players who lost most power"
              rows={peopleRows(powerMoves.down)}
            />
          </div>
          <div className="viz-pair">
            <DivergingBars
              caption="Biggest climbs in the top-150 place"
              rows={climbRows(climbs.up)}
            />
            <DivergingBars
              caption="Biggest drops in the top-150 place"
              rows={climbRows(climbs.down)}
            />
          </div>
        </>
      )}
      <p className="note">
        Compares the cross-server boards read on each side of the baseline, so it needs a migration
        with both. Players only count when they are on the top 150 both before and after; a power
        drop can be a real loss or a player who stopped being captured. Alliance power is the board
        figure where the alliance is on it and the roster total otherwise.
      </p>
    </>
  );
}

/** Charts and numbers that read the migration as a whole: who gained and lost, which tiers
 * moved, where they went, and — when a baseline is set — how power and place shifted. */
export function MigrationAnalytics({ eventId }: { eventId: string | null }) {
  return (
    <>
      <h3>Who moved</h3>
      <Observed />
      <h3>Before and after the baseline</h3>
      {eventId === null ? (
        <p className="empty">Set up a migration with a baseline to compare power and places.</p>
      ) : (
        <BeforeAfter eventId={eventId} />
      )}
    </>
  );
}
