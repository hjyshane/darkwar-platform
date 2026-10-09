import { type MapMarker, formatCoordinate } from '@dw/ui';
import { useState } from 'react';
import { StatTile } from '../../components/StatTile';
import { MapCanvas } from './MapCanvas';
import {
  QUALITY_NAMES,
  type Truck,
  huntStrip,
  isWorthTaking,
  lootsLeft,
  missionIsOpen,
  timeLeft,
  truckPosition,
  useMissions,
  useTrucks,
} from './hunt';

const who = (name: string | null, abbr: string | null) =>
  `${abbr ? `[${abbr}] ` : ''}${name ?? 'unknown'}`;

/** Trucks carrying hero fragments and gold missions paying Orange Skill Books,
 * on one server's map (0254).
 *
 * WHAT THE MAP CAN AND CANNOT SAY. A truck's position comes from its march
 * push, which only arrives for marches the collector's account was told about;
 * its cargo comes from the interception list. A truck in the list with no march
 * is still listed — it just has no pin — and every row says how old its
 * reading is. A mission's pin is exact: it is a tile, and the game gives its
 * start and finish.
 */
export function HuntPanel({ serverId }: { serverId: number }) {
  const trucks = useTrucks(serverId);
  const missions = useMissions(serverId);
  const [picked, setPicked] = useState<string | null>(null);
  const now = new Date();

  const worth = (trucks.data ?? []).filter((truck) => isWorthTaking(truck, now));
  const open = (missions.data ?? []).filter((mission) => missionIsOpen(mission, now));
  const placed = worth.flatMap((truck) => {
    const position = truckPosition(truck, now);
    return position === null ? [] : [{ truck, position }];
  });

  const markers: MapMarker[] = [
    ...placed.map(({ truck, position }) => ({
      at: position.at,
      label: `${who(truck.ownerName, truck.allianceAbbr)} · ${truck.heroFragments} shard`,
      kind: 'truck' as const,
      faded: !position.live,
      highlighted: truck.truckUuid === picked,
    })),
    ...open.map((mission) => ({
      at: mission.at,
      label: `${who(mission.ownerName, mission.allianceAbbr)} · ${mission.orangeBooks} books`,
      kind: 'mission' as const,
      highlighted: mission.missionUuid === picked,
    })),
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

      {!loading && (
        <MapCanvas
          caption="Gold diamond: a truck with a hero fragment. Orange square: a gold mission paying Orange Skill Books. A faded diamond is where the truck was last known to be."
          markers={markers}
          onSelect={(marker) => {
            const truck = placed.find(({ position }) => position.at === marker.at)?.truck;
            const mission = open.find((m) => m.at === marker.at);
            setPicked(truck?.truckUuid ?? mission?.missionUuid ?? null);
          }}
        />
      )}

      <h3>Trucks with hero fragments</h3>
      {trucks.data && worth.length === 0 && (
        <p className="empty">
          None known on server {serverId} right now. A truck only appears once the collector has
          read the interception list while it was on the road.
        </p>
      )}
      <ul className="map-results">
        {worth.map((truck) => (
          <li key={truck.truckUuid}>
            <button
              className={truck.truckUuid === picked ? 'map-result--on' : undefined}
              onClick={() => setPicked(truck.truckUuid === picked ? null : truck.truckUuid)}
              type="button"
            >
              <strong>{who(truck.ownerName, truck.allianceAbbr)}</strong>
              <span className="subtle">{truckLine(truck, now)}</span>
            </button>
          </li>
        ))}
      </ul>

      <h3>Missions to plunder</h3>
      {missions.data && open.length === 0 && (
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
              onClick={() => setPicked(mission.missionUuid === picked ? null : mission.missionUuid)}
              type="button"
            >
              <strong>{who(mission.ownerName, mission.allianceAbbr)}</strong>
              <span className="subtle">
                {formatCoordinate(mission.at)} · {mission.orangeBooks} Orange Skill Books per steal
                {mission.stealMax !== null && ` · up to ${mission.stealMax} steals`} · ends in{' '}
                {timeLeft(mission.endsAt, now)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function truckLine(truck: Truck, now: Date): string {
  const position = truckPosition(truck, now);
  const where =
    position === null
      ? 'no position seen'
      : `${formatCoordinate(position.at)}${position.live ? '' : ' (last known)'}`;
  const left = lootsLeft(truck);
  return [
    `${QUALITY_NAMES[truck.quality] ?? `Q${truck.quality}`}`,
    `${truck.heroFragments} hero shard${truck.heroFragments === 1 ? '' : 's'}`,
    `${left} loot${left === 1 ? '' : 's'} left`,
    where,
    `arrives in ${timeLeft(truck.arriveAt, now)}`,
  ].join(' · ');
}
