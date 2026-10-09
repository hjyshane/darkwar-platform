import { formatCoordinate } from '@dw/ui';
import {
  type Mission,
  QUALITY_NAMES,
  type Truck,
  type TruckFilter,
  type TruckSort,
  countByServer,
  lootsLeft,
  timeLeft,
  truckSpot,
} from './hunt';

export const who = (name: string | null, abbr: string | null) =>
  `${abbr ? `[${abbr}] ` : ''}${name ?? 'unknown'}`;

/** Trucks carrying hero fragments: a server chooser, filters, and the list.
 *
 * The list holds every server's trucks, because the interception list covers the
 * whole group; the map only has a pin for those that belong to the server on
 * screen (see the pins). `shown` is what survived the filter, so the list and
 * the pins always agree.
 */
export function TrucksList({
  worth,
  shown,
  filter,
  onFilter,
  sort,
  onSort,
  picked,
  onChoose,
  mapServer,
  loaded,
  now,
}: {
  worth: readonly Truck[];
  shown: readonly Truck[];
  filter: TruckFilter;
  onFilter: (next: TruckFilter) => void;
  sort: TruckSort;
  onSort: (next: TruckSort) => void;
  picked: string | null;
  onChoose: (truck: Truck) => void;
  mapServer: number;
  loaded: boolean;
  now: Date;
}) {
  const servers = countByServer(worth);
  return (
    <>
      {servers.length > 0 && (
        <ul aria-label="Trucks by server" className="map-results">
          <li>
            <button
              className={filter.serverId === null ? 'map-result--on' : undefined}
              onClick={() => onFilter({ ...filter, serverId: null })}
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
                  onFilter({
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
        <legend>Filter and sort trucks</legend>
        <label>
          <span>Loots left</span>
          <select
            onChange={(event) => onFilter({ ...filter, minLoots: Number(event.target.value) })}
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
            onChange={(event) => onFilter({ ...filter, minShards: Number(event.target.value) })}
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
          <select onChange={(event) => onSort(event.target.value as TruckSort)} value={sort}>
            <option value="time">Arrives soonest</option>
            <option value="shards">Most hero shards</option>
            <option value="loots">Most loots left</option>
          </select>
        </label>
      </fieldset>

      {loaded && worth.length === 0 && (
        <p className="empty">
          None known right now. A truck only appears once the collector has read the interception
          list while it was on the road.
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
              onClick={() => onChoose(truck)}
              type="button"
            >
              <strong>◆ {who(truck.ownerName, truck.allianceAbbr)}</strong>
              <span className="subtle">{truckLine(truck, mapServer, now)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Gold missions paying Orange Skill Books on the server on screen. */
export function PlunderList({
  open,
  serverId,
  picked,
  onChoose,
  loaded,
  now,
}: {
  open: readonly Mission[];
  serverId: number;
  picked: string | null;
  onChoose: (mission: Mission) => void;
  loaded: boolean;
  now: Date;
}) {
  return (
    <>
      {loaded && open.length === 0 && (
        <p className="empty">
          No gold mission paying Orange Skill Books is open on server {serverId} as far as the map
          has seen. A mission shows up once a sweep passes its tile after it was started.
        </p>
      )}
      <ul className="map-results">
        {open.map((mission) => (
          <li key={mission.missionUuid}>
            <button
              className={mission.missionUuid === picked ? 'map-result--on' : undefined}
              onClick={() => onChoose(mission)}
              type="button"
            >
              <strong>■ {who(mission.ownerName, mission.allianceAbbr)}</strong>
              <span className="subtle">
                {formatCoordinate(mission.at)} · {mission.orangeBooks} Orange Skill Books per steal
                {mission.stealMax !== null && ` · up to ${mission.stealMax} steals`} · ends in{' '}
                {timeLeft(mission.endsAt, now)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
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
