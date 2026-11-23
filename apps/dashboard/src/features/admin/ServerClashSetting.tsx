import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { compactNumber } from '../../lib/compactNumber';
import {
  type ClashAlliance,
  type ClashPlayer,
  DEFAULT_OPPONENT,
  OUR_SERVER,
  type ServerClashData,
  type ServerSide,
  WINDOWS,
  type Window,
  coverageWarning,
  fetchServerClash,
  fetchServerIds,
  leader,
  sideOf,
} from '../../lib/serverClash';
import { useActiveAlliance } from '../../lib/useMyAlliances';

const compact = compactNumber(2);
const PLAYERS_SHOWN = 15;

function big(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : compact.format(value);
}

function whole(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString('en');
}

interface Metric {
  label: string;
  note?: string;
  mine: number | null;
  theirs: number | null;
  format: (value: number | null) => string;
  /** A figure where more is not better (people with no power reading). */
  neutral?: boolean;
}

function metricsFor(ours: ServerSide, theirs: ServerSide): Metric[] {
  return [
    {
      label: 'Alliances on the board',
      note: 'of each server’s top 3',
      mine: ours.alliances_on_board,
      theirs: theirs.alliances_on_board,
      format: whole,
    },
    {
      label: 'Moving players',
      note: 'power, kills or HQ up, or the base or a truck moved',
      mine: ours.active_players,
      theirs: theirs.active_players,
      format: whole,
    },
    {
      label: 'Their power, together',
      note: 'latest reading of the moving players',
      mine: ours.total_power,
      theirs: theirs.total_power,
      format: big,
    },
    {
      label: 'Median power',
      mine: ours.median_power,
      theirs: theirs.median_power,
      format: big,
    },
    {
      label: 'Strongest player',
      mine: ours.top_power,
      theirs: theirs.top_power,
      format: big,
    },
    {
      label: 'Power gained in the window',
      mine: ours.power_gained,
      theirs: theirs.power_gained,
      format: big,
    },
    {
      label: 'Growing',
      note: 'power went up',
      mine: ours.growing,
      theirs: theirs.growing,
      format: whole,
    },
    {
      label: 'Active on the map',
      note: 'moved, shield changed, or sent a truck',
      mine: ours.map_active,
      theirs: theirs.map_active,
      format: whole,
    },
    {
      label: 'Power not known',
      note: 'moving, but never on the power board',
      mine: ours.no_power_reading,
      theirs: theirs.no_power_reading,
      format: whole,
      neutral: true,
    },
  ];
}

/** Server Clash: our server against the opponent's, by the people who are
 * actually moving (0345).
 *
 * Nothing in the data says how strong a whole server is - the collector reads
 * the group's boards and the map, not every player. So this compares the top 3
 * alliances of each side and, inside them, whoever showed movement in the
 * window. A player who never reaches the power board still counts as moving
 * but has no power here; "Power not known" says how many, because a side with
 * many of them is stronger than its total.
 *
 * Admin-only: the function raises for anyone else, and this screen reports
 * that rather than drawing two empty servers. */
export function ServerClashSetting() {
  const { active } = useActiveAlliance();
  const [ours, setOurs] = useState<number | null>(null);
  const [opponent, setOpponent] = useState<number>(DEFAULT_OPPONENT);
  const [days, setDays] = useState<Window>(7);
  const mine = ours ?? active?.server_id ?? OUR_SERVER;

  const servers = useQuery({ queryKey: ['server-clash', 'servers'], queryFn: fetchServerIds });
  const clash = useQuery({
    queryKey: ['server-clash', mine, opponent, days],
    queryFn: () => fetchServerClash(mine, opponent, days),
    enabled: mine !== opponent,
    // The boards move by the minute but nobody decides on a minute.
    staleTime: 5 * 60 * 1000,
  });

  const ids = servers.data ?? [];

  return (
    <div className="server-clash">
      <p className="note">
        Each server is read through its top 3 alliances (by the alliance board) and the members of
        those who showed movement in the last {days} days. It sees what the collector sees: the
        boards and the map, not every player on a server.
      </p>

      <div className="server-clash-controls">
        <label>
          <span className="subtle">Our server</span>
          <select value={mine} onChange={(event) => setOurs(Number(event.target.value))}>
            {pickable(ids, mine).map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="subtle">Opponent</span>
          <select value={opponent} onChange={(event) => setOpponent(Number(event.target.value))}>
            {pickable(ids, opponent).map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="subtle">Moved within</span>
          <select value={days} onChange={(event) => setDays(Number(event.target.value) as Window)}>
            {WINDOWS.map((count) => (
              <option key={count} value={count}>
                {count} days
              </option>
            ))}
          </select>
        </label>
      </div>

      {mine === opponent && <p className="empty">Pick two different servers.</p>}
      {mine !== opponent && clash.isPending && <p className="empty">Comparing the servers…</p>}
      {mine !== opponent && clash.error && <p className="error">{clash.error.message}</p>}
      {mine !== opponent && clash.data !== undefined && (
        <Comparison data={clash.data} ours={mine} opponent={opponent} />
      )}
    </div>
  );
}

/** The ids on offer, always including the one currently chosen so a server the
 * list has not loaded yet still shows in its own picker. */
function pickable(ids: readonly number[], chosen: number): number[] {
  return ids.includes(chosen) ? [...ids] : [...ids, chosen].sort((a, b) => a - b);
}

function Comparison({
  data,
  ours,
  opponent,
}: {
  data: ServerClashData;
  ours: number;
  opponent: number;
}) {
  const a = sideOf(data, ours);
  const b = sideOf(data, opponent);
  const warning = coverageWarning(a, b);
  const empty = a.members_seen === 0 && b.members_seen === 0;

  if (empty) {
    return (
      <p className="empty">
        No alliance of either server reached the alliance board in the last {data.days} days, or
        none of their bases were seen on the map naming an alliance. Nothing to compare yet.
      </p>
    );
  }

  return (
    <>
      <div className="table-scroll">
        <table className="server-clash-table">
          <thead>
            <tr>
              <th scope="col">Last {data.days} days</th>
              <th scope="col" className="num">
                {ours}
              </th>
              <th scope="col" className="num">
                {opponent}
              </th>
            </tr>
          </thead>
          <tbody>
            {metricsFor(a, b).map((metric) => {
              const lead =
                metric.neutral === true || metric.mine === null || metric.theirs === null
                  ? 'tie'
                  : leader(metric.mine, metric.theirs);
              return (
                <tr key={metric.label}>
                  <th scope="row">
                    {metric.label}
                    {metric.note !== undefined && <span className="subtle"> · {metric.note}</span>}
                  </th>
                  <td className={`num${lead === 'ours' ? ' lead' : ''}`}>
                    {metric.format(metric.mine)}
                  </td>
                  <td className={`num${lead === 'theirs' ? ' lead' : ''}`}>
                    {metric.format(metric.theirs)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {warning !== null && <p className="note">{warning}</p>}

      <h4>Top alliances</h4>
      <AllianceTable rows={data.alliances} />

      {[ours, opponent].map((server) => (
        <section key={server}>
          <h4>Moving players on {server}</h4>
          <PlayerTable rows={data.players.filter((row) => row.server_id === server)} />
        </section>
      ))}
    </>
  );
}

function AllianceTable({ rows }: { rows: ClashAlliance[] }) {
  if (rows.length === 0) {
    return <p className="empty">No alliance on the board.</p>;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Server</th>
            <th scope="col">Alliance</th>
            <th scope="col" className="num">
              Power
            </th>
            <th scope="col" className="num">
              Members
            </th>
            <th scope="col" className="num">
              Seen on the map
            </th>
            <th scope="col" className="num">
              Moving
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.server_id}-${row.rn}`}>
              <td>{row.server_id}</td>
              <td>
                {row.code !== null && `[${row.code}] `}
                {row.name ?? '—'}
              </td>
              <td className="num">{big(row.power)}</td>
              <td className="num">{whole(row.member_count)}</td>
              <td className="num">{whole(row.members_seen)}</td>
              <td className="num">{whole(row.active_players)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function movement(row: ClashPlayer): string {
  const parts: string[] = [];
  if (row.power_gain !== null && row.power_gain > 0) parts.push(`power +${big(row.power_gain)}`);
  if (row.kills_gain > 0) parts.push(`kills +${big(row.kills_gain)}`);
  if (row.hq_gain > 0) parts.push(`HQ +${row.hq_gain}`);
  if (row.moved) parts.push('moved base');
  if (row.shield_changed) parts.push('shield');
  if (row.trucked) parts.push('truck');
  return parts.join(' · ');
}

function PlayerTable({ rows }: { rows: ClashPlayer[] }) {
  if (rows.length === 0) {
    return <p className="empty">Nobody moved.</p>;
  }
  const shown = rows.slice(0, PLAYERS_SHOWN);
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">Alliance</th>
              <th scope="col" className="num">
                Power
              </th>
              <th scope="col">Movement</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.game_uid}>
                <td>{row.name ?? row.game_uid}</td>
                <td>{row.alliance_code ?? '—'}</td>
                <td className="num">{big(row.power)}</td>
                <td>{movement(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length && (
        <p className="subtle">
          The strongest {shown.length} of {rows.length}.
        </p>
      )}
    </>
  );
}
