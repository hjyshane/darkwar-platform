import { toFraction } from '@dw/ui';
import { useEffect, useRef, useState } from 'react';
import { useIcons } from '../../lib/gameIcons';
import { who } from './HuntLists';
import { useMapZoom } from './PannableMap';
import { type Mission, type Truck, timeLeft, truckHeading, truckSpot } from './hunt';

/** A clock that ticks every second, so a truck moves along its road and its
 * countdown runs without anything being refetched. */
function useTick(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** The dashed roads of the trucks, drawn in the plot's own layout pixels so the
 * stroke can be divided by the zoom and stay a hairline at any scale. */
function Routes({
  trucks,
  now,
  picked,
}: { trucks: readonly Truck[]; now: Date; picked: string | null }) {
  const ref = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <svg
      aria-hidden="true"
      className="atlas-routes"
      ref={ref}
      viewBox={`0 0 ${box.w || 1} ${box.h || 1}`}
    >
      {trucks.flatMap((truck) => {
        const leg = truck.leg;
        if (leg === null || leg.endAt.getTime() <= now.getTime()) return [];
        const a = toFraction(leg.from);
        const b = toFraction(leg.to);
        return [
          <line
            className={truck.truckUuid === picked ? 'atlas-route atlas-route--on' : 'atlas-route'}
            key={truck.truckUuid}
            x1={a.left * box.w}
            x2={b.left * box.w}
            y1={a.top * box.h}
            y2={b.top * box.h}
          />,
        ];
      })}
    </svg>
  );
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
  trucks: readonly Truck[];
  missions: readonly Mission[];
  picked: string | null;
  onChoose: (id: string, at: { x: number; y: number }) => void;
}) {
  const now = useTick(trucks.length > 0 || missions.length > 0);
  const zoom = useMapZoom();
  // The client's own truck pictures (0268): colour by quality, facing by heading.
  const sprites = useIcons('truck').data;
  const placed = trucks.flatMap((truck) => {
    const spot = truckSpot(truck, now);
    return spot === null ? [] : [{ truck, spot }];
  });
  const place = (at: { x: number; y: number }) => {
    const f = toFraction(at);
    return { left: `${f.left * 100}%`, top: `${f.top * 100}%` };
  };
  return (
    <>
      <Routes now={now} picked={picked} trucks={trucks} />
      {placed.map(({ truck, spot }) => (
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
          {sprites?.get(`${truck.quality}-${truckHeading(truck.leg)}`) ? (
            <img
              alt=""
              className="atlas-truck"
              draggable={false}
              src={sprites.get(`${truck.quality}-${truckHeading(truck.leg)}`)}
            />
          ) : (
            <span className="map-pin__dot" />
          )}
          {(truck.truckUuid === picked || zoom >= 6) && (
            <span className="atlas-truck-tag">
              {truck.allianceAbbr ? `[${truck.allianceAbbr}] ` : ''}
              {truck.ownerName ?? 'unknown'} · {truck.heroFragments} shard ·{' '}
              {timeLeft(truck.arriveAt, now)}
            </span>
          )}
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
