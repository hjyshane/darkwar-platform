import { toFraction } from '@dw/ui';
import { who } from './HuntLists';
import type { Mission, Truck, TruckSpot } from './hunt';

export interface PlacedTruck {
  truck: Truck;
  spot: TruckSpot;
}

/** Trucks (gold diamonds) and plunder missions (orange squares) over the atlas.
 *
 * Positioned like the base dots, as percentages of the plot, and drawn above
 * them. A faded diamond is a truck whose spot is only where it set off from, or
 * where it was last known: the leg it was on has ended and the next one is not
 * in the data.
 */
export function HuntPins({
  trucks,
  missions,
  picked,
  onChoose,
}: {
  trucks: readonly PlacedTruck[];
  missions: readonly Mission[];
  picked: string | null;
  onChoose: (id: string, at: { x: number; y: number }) => void;
}) {
  const place = (at: { x: number; y: number }) => {
    const f = toFraction(at);
    return { left: `${f.left * 100}%`, top: `${f.top * 100}%` };
  };
  return (
    <>
      {trucks.map(({ truck, spot }) => (
        <button
          className={[
            'map-pin',
            'map-pin--truck',
            'map-pin--clickable',
            spot.live ? '' : 'map-pin--faded',
            truck.truckUuid === picked ? 'map-pin--on' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          key={truck.truckUuid}
          onClick={() => onChoose(truck.truckUuid, spot.at)}
          style={place(spot.at)}
          title={`Truck${spot.origin ? ' (set off from here)' : ''} · ${who(truck.ownerName, truck.allianceAbbr)} · ${truck.heroFragments} shard`}
          type="button"
        >
          <span className="map-pin__dot" />
        </button>
      ))}
      {missions.map((mission) => (
        <button
          className={[
            'map-pin',
            'map-pin--mission',
            'map-pin--clickable',
            mission.missionUuid === picked ? 'map-pin--on' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          key={mission.missionUuid}
          onClick={() => onChoose(mission.missionUuid, mission.at)}
          style={place(mission.at)}
          title={`Plunder · ${who(mission.ownerName, mission.allianceAbbr)} · ${mission.orangeBooks} books`}
          type="button"
        >
          <span className="map-pin__dot" />
        </button>
      ))}
    </>
  );
}
