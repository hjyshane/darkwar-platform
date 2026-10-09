import { type Coordinate, type MapMarker, formatCoordinate } from '@dw/ui';
import { useState } from 'react';
import { StatTile } from '../../components/StatTile';
import { MapCanvas } from './MapCanvas';
import { PannableMap } from './PannableMap';
import {
  NO_FILTER,
  QUALITY_NAMES,
  type Truck,
  type TruckFilter,
  type TruckSort,
  countByServer,
  filterTrucks,
  huntStrip,
  isWorthTaking,
  lootsLeft,
  missionIsOpen,
  sortTrucks,
  timeLeft,
  truckSpot,
  useMissions,
  useTrucks,
} from './hunt';

const who = (name: string | null, abbr: string | null) =>
  `${abbr ? `[${abbr}] ` : ''}${name ?? 'unknown'}`;

/** Trucks carrying hero fragments and gold missions paying Orange Skill Books
 * (0254, 0257).
 *
 * TWO DIFFERENT THINGS, KEPT APART. A truck is a Dark Syndicate cargo run
 * that moves and belongs to some server in the group; a plunder mission is a
 * tile on its owner's map that stays put until it ends. They have their own
 * pin (gold diamond / orange square), their own list, and their own switch.
 *
 * WHAT THE MAP CAN AND CANNOT SAY. Trucks come from every server's
 * interception list, so they are listed for all of them. A truck's POSITION
 * comes from a march push, which only arrives for the collector's own server;
 * every other truck has only the point it set off from, drawn faded and
 * labelled as that. A mission's pin is exact: it is a tile, and the game gives
 * its start and finish.
 */
export function HuntPanel({ serverId }: { serverId: number }) {
  const trucks = useTrucks();
  const missions = useMissions(serverId);
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState<TruckFilter>(NO_FILTER);
  const [sort, setSort] = useState<TruckSort>('time');
  const [showTrucks, setShowTrucks] = useState(true);
  const [showPlunder, setShowPlunder] = useState(true);
  const [focus, setFocus] = useState<{ at: Coordinate; nonce: number } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const now = new Date();

  // One click does three things: picks the row and its pin, sends the map there,
  // and puts the coordinate on the clipboard, written the way the game's own
  // search box takes it.
  function choose(id: string, at: Coordinate) {
    setPicked(id);
    setFocus((previous) => ({ at, nonce: (previous?.nonce ?? 0) + 1 }));
    const text = formatCoordinate(at);
    navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(text))
      .catch(() => setCopied(null));
  }

  const worth = (trucks.data ?? []).filter((truck) => isWorthTaking(truck, now));
  const servers = countByServer(worth);
  const shown = sortTrucks(filterTrucks(worth, filter), sort);
  const open = (missions.data ?? []).filter((mission) => missionIsOpen(mission, now));

  // A pin only on the map of the server the truck belongs to: its coordinates
  // are on that map, and nobody has shown that a foreign truck's are the same.
  const placed = shown.flatMap((truck) => {
    const spot = truck.serverId === serverId ? truckSpot(truck, now) : null;
    return spot === null ? [] : [{ truck, spot }];
  });
  const onThisMap = worth.filter((truck) => truck.serverId === serverId).length;

  const markers: MapMarker[] = [
    ...(showTrucks
      ? placed.map(({ truck, spot }) => ({
          at: spot.at,
          label: `Truck${spot.origin ? ' (left from here)' : ''} · ${who(truck.ownerName, truck.allianceAbbr)} · ${truck.heroFragments} shard`,
          kind: 'truck' as const,
          faded: !spot.live,
          highlighted: truck.truckUuid === picked,
        }))
      : []),
    ...(showPlunder
      ? open.map((mission) => ({
          at: mission.at,
          label: `Plunder · ${who(mission.ownerName, mission.allianceAbbr)} · ${mission.orangeBooks} books`,
          kind: 'mission' as const,
          highlighted: mission.missionUuid === picked,
        }))
      : []),
  ];

  const loading = trucks.isPending || missions.isPending;

  return (
    <div className="hunt">
      <div className="strip">
        {huntStrip({
          serverId,
          trucks: trucks.data ? worth.length : null,
          placed: placed.length,
          missions: missions.data ? open.length : null,
        }).map((cell, index) => (
          <StatTile
            hero={index === 0}
            key={cell.label}
            label={cell.label}
            note={cell.note}
            value={cell.value}
          />
        ))}
      </div>

      {trucks.error && (
        <p className="error">Could not load trucks: {(trucks.error as Error).message}</p>
      )}
      {missions.error && (
        <p className="error">Could not load missions: {(missions.error as Error).message}</p>
      )}
      {loading && <p className="empty loading">Loading…</p>}

      <div className="hunt-body">
        <div className="hunt-map">
          {!loading && (
            <PannableMap focus={focus}>
              <MapCanvas
                markers={markers}
                onSelect={(marker) => {
                  const truck = placed.find(({ spot }) => spot.at === marker.at)?.truck;
                  const mission = open.find((m) => m.at === marker.at);
                  if (truck) choose(truck.truckUuid, marker.at);
                  else if (mission) choose(mission.missionUuid, marker.at);
                }}
              />
            </PannableMap>
          )}
          <p className="subtle">
            ◆ gold: a truck with a hero fragment (faded: only where it set off from or was last
            known). ■ orange: a gold mission paying Orange Skill Books. Drag to move, wheel or +/−
            to zoom; clicking copies the coordinate.
          </p>
          {copied && <output className="subtle">Copied {copied}</output>}
        </div>
        <div className="hunt-side">
          <fieldset className="map-range">
            <legend>Layers</legend>
            <label>
              <input
                checked={showTrucks}
                onChange={(event) => setShowTrucks(event.target.checked)}
                type="checkbox"
              />
              <span>
                ◆ Trucks — {onThisMap} on server {serverId}’s map
              </span>
            </label>
            <label>
              <input
                checked={showPlunder}
                onChange={(event) => setShowPlunder(event.target.checked)}
                type="checkbox"
              />
              <span>■ Plunder missions — {open.length}</span>
            </label>
          </fieldset>

          <h3>Trucks with hero fragments</h3>
          {servers.length > 0 && (
            <ul className="map-results" aria-label="Trucks by server">
              <li>
                <button
                  className={filter.serverId === null ? 'map-result--on' : undefined}
                  onClick={() => setFilter({ ...filter, serverId: null })}
                  type="button"
                >
                  <strong>All servers</strong>
                  <span className="subtle">
                    {worth.length} truck{worth.length === 1 ? '' : 's'} ·{' '}
                    {worth.reduce((sum, truck) => sum + truck.heroFragments, 0)} shards
                  </span>
                </button>
              </li>
              {servers.map((entry) => (
                <li key={entry.serverId}>
                  <button
                    className={filter.serverId === entry.serverId ? 'map-result--on' : undefined}
                    onClick={() =>
                      setFilter({
                        ...filter,
                        serverId: filter.serverId === entry.serverId ? null : entry.serverId,
                      })
                    }
                    type="button"
                  >
                    <strong>Server {entry.serverId}</strong>
                    <span className="subtle">
                      {entry.trucks} truck{entry.trucks === 1 ? '' : 's'} · {entry.shards} shards
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <fieldset className="map-range">
            <legend>Filter and sort</legend>
            <label>
              <span>Loots left</span>
              <select
                onChange={(event) => setFilter({ ...filter, minLoots: Number(event.target.value) })}
                value={filter.minLoots}
              >
                <option value={0}>Any</option>
                <option value={1}>At least 1</option>
                <option value={2}>2 (untouched)</option>
              </select>
            </label>
            <label>
              <span>Hero shards</span>
              <select
                onChange={(event) =>
                  setFilter({ ...filter, minShards: Number(event.target.value) })
                }
                value={filter.minShards}
              >
                <option value={0}>Any</option>
                <option value={1}>At least 1</option>
                <option value={2}>At least 2</option>
                <option value={3}>At least 3</option>
              </select>
            </label>
            <label>
              <span>Sort by</span>
              <select onChange={(event) => setSort(event.target.value as TruckSort)} value={sort}>
                <option value="time">Arrives soonest</option>
                <option value="shards">Most hero shards</option>
                <option value="loots">Most loots left</option>
              </select>
            </label>
          </fieldset>

          {trucks.data && worth.length === 0 && (
            <p className="empty">
              None known right now. A truck only appears once the collector has read the
              interception list while it was on the road.
            </p>
          )}
          {worth.length > 0 && shown.length === 0 && (
            <p className="empty">No truck matches that filter.</p>
          )}
          <ul className="map-results">
            {shown.map((truck) => (
              <li key={truck.truckUuid}>
                <button
                  className={truck.truckUuid === picked ? 'map-result--on' : undefined}
                  onClick={() => {
                    const spot = truckSpot(truck, now);
                    if (spot) choose(truck.truckUuid, spot.at);
                    else setPicked(truck.truckUuid === picked ? null : truck.truckUuid);
                  }}
                  type="button"
                >
                  <strong>◆ {who(truck.ownerName, truck.allianceAbbr)}</strong>
                  <span className="subtle">{truckLine(truck, serverId, now)}</span>
                </button>
              </li>
            ))}
          </ul>

          <h3>Plunder missions on server {serverId}</h3>
          {missions.data && open.length === 0 && (
            <p className="empty">
              No gold mission paying Orange Skill Books is open on server {serverId} as far as the
              map has seen. A mission shows up once a sweep passes its tile after it was started.
            </p>
          )}
          <ul className="map-results">
            {open.map((mission) => (
              <li key={mission.missionUuid}>
                <button
                  className={mission.missionUuid === picked ? 'map-result--on' : undefined}
                  onClick={() => choose(mission.missionUuid, mission.at)}
                  type="button"
                >
                  <strong>■ {who(mission.ownerName, mission.allianceAbbr)}</strong>
                  <span className="subtle">
                    {formatCoordinate(mission.at)} · {mission.orangeBooks} Orange Skill Books per
                    steal
                    {mission.stealMax !== null && ` · up to ${mission.stealMax} steals`} · ends in{' '}
                    {timeLeft(mission.endsAt, now)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function truckLine(truck: Truck, mapServer: number, now: Date): string {
  const spot = truckSpot(truck, now);
  let where = 'no position seen';
  if (spot !== null) {
    const base = formatCoordinate(spot.at);
    if (spot.origin) where = `set off from ${base}`;
    else where = spot.live ? base : `${base} (last known)`;
  }
  if (spot !== null && truck.serverId !== mapServer) {
    where += ` (on server ${truck.serverId}’s map)`;
  }
  const left = lootsLeft(truck);
  return [
    `server ${truck.serverId}`,
    `${QUALITY_NAMES[truck.quality] ?? `Q${truck.quality}`}`,
    `${truck.heroFragments} hero shard${truck.heroFragments === 1 ? '' : 's'}`,
    `${left} loot${left === 1 ? '' : 's'} left`,
    where,
    `arrives in ${timeLeft(truck.arriveAt, now)}`,
  ].join(' · ');
}
