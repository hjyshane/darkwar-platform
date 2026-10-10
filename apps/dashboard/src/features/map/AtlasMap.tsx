import { MAP_IMAGE_URL, MAP_INSET, toFraction } from '@dw/ui';
import { type CSSProperties, type ReactNode, useMemo, useState } from 'react';
import { useIcons } from '../../lib/gameIcons';
import { AtlasHover } from './AtlasHover';
import { useMapZoom } from './PannableMap';
import {
  type Atlas,
  type AtlasBase,
  CLUMP_NAME_HIDE_ZOOM,
  NAME_ZOOM,
  TOWER_ZOOM,
  allianceColor,
  clusters,
  formatPower,
  isShielded,
  isStale,
  shieldLeft,
  visibleLabels,
  visibleNames,
} from './atlas';
import type { PlanTile } from './plan';

/** Zoom from which the shield timers are named in the Shield filter. */
const SHIELD_NAME_ZOOM = 4;

/** Every swept base as a dot on the map picture, coloured by alliance.
 *
 * Dots are positioned boxes rather than SVG circles: the plot is not square
 * (3,054 x 2,554 px for a 1,000 x 1,000 tile map), so an SVG stretched over it
 * would draw ovals. They keep their pixel size while the window zooms: the
 * stylesheet divides by `--map-zoom`, which PannableMap sets.
 *
 * `lit` is the set of bases to keep bright; everything else is dimmed, which is
 * how a picked alliance or a search result stands out of two thousand dots.
 */
export function AtlasMap({
  atlas,
  oursIndex,
  lit,
  selectedUid,
  pickedAlliance = null,
  shieldMode = false,
  territory = false,
  planTiles = null,
  onSelect,
  children,
}: {
  atlas: Atlas;
  /** Index of our own alliance in `atlas.alliances`, or -1. */
  oursIndex: number;
  lit: ReadonlySet<number> | null;
  selectedUid: number | null;
  /** The alliance picked in the ranking, or null: only its glow and name stay. */
  pickedAlliance?: number | null;
  /** The Shield filter is on: names, and the time each shield has left, show from
   * further out so the timers can be read across the map. */
  shieldMode?: boolean;
  /** Territory mode: alliance names at every zoom, no player names or towers. */
  territory?: boolean;
  /** The hive plan laid over the map (Plan mode), or null. */
  planTiles?: readonly PlanTile[] | null;
  onSelect: (base: AtlasBase) => void;
  /** Extra layers drawn over the dots (trucks and plunder missions). */
  children?: ReactNode;
}) {
  const [hasImage, setHasImage] = useState(true);
  const now = new Date();
  const clumps = useMemo(() => clusters(atlas), [atlas]);
  const zoom = useMapZoom();
  // The tower picture per HQ level (0268); nothing for a visitor, who gets rings.
  const towers = useIcons('tower').data;
  // The alliance names give way to the base names once zoomed in.
  const named = useMemo(
    () =>
      (zoom >= CLUMP_NAME_HIDE_ZOOM && !territory ? [] : visibleLabels(clumps, atlas, zoom)).filter(
        (clump) => pickedAlliance === null || clump.alliance === pickedAlliance,
      ),
    [clumps, atlas, zoom, pickedAlliance, territory],
  );
  // Base names that fit without overlapping: the picked base and the lit ones
  // first. Everything else is dropped when it would sit on a name already placed.
  const baseNames = useMemo(() => {
    if (territory) return new Set<number>();
    const first = new Set<number>(lit ?? []);
    if (selectedUid !== null) first.add(selectedUid);
    return visibleNames(
      atlas,
      zoom,
      first,
      lit,
      selectedUid,
      shieldMode ? SHIELD_NAME_ZOOM : NAME_ZOOM,
    );
  }, [atlas, zoom, lit, selectedUid, shieldMode, territory]);

  const dots = useMemo(
    () =>
      atlas.bases.map((base) => {
        const f = toFraction(base.at);
        const alliance = base.alliance >= 0 ? atlas.alliances[base.alliance] : undefined;
        return {
          base,
          left: `${f.left * 100}%`,
          top: `${f.top * 100}%`,
          color: allianceColor(alliance?.id ?? null, base.alliance === oursIndex && oursIndex >= 0),
        };
      }),
    [atlas, oursIndex],
  );

  const plotStyle = {
    left: `${MAP_INSET.left * 100}%`,
    top: `${MAP_INSET.top * 100}%`,
    right: `${MAP_INSET.right * 100}%`,
    bottom: `${MAP_INSET.bottom * 100}%`,
  };

  return (
    <figure className="map-canvas">
      <div className={hasImage ? 'map-frame' : 'map-frame map-frame--empty'}>
        {hasImage && (
          <img
            alt="World map"
            className="map-frame__image"
            draggable={false}
            onError={() => setHasImage(false)}
            src={MAP_IMAGE_URL}
          />
        )}
        <div className="map-plot" style={plotStyle}>
          {/* A soft glow behind each sizeable alliance, so a clump reads as one
              colour from across the map before any dot can be told apart. */}
          {clumps
            .filter((clump) => pickedAlliance === null || clump.alliance === pickedAlliance)
            .map((clump) => {
              const alliance = atlas.alliances[clump.alliance];
              const color = allianceColor(alliance?.id ?? null, clump.alliance === oursIndex);
              const f = toFraction(clump.at);
              return (
                <span
                  aria-hidden="true"
                  className="atlas-halo"
                  key={`halo-${alliance?.id}`}
                  style={
                    {
                      left: `${f.left * 100}%`,
                      top: `${f.top * 100}%`,
                      width: `${((clump.radius * 2.6) / 1000) * 100}%`,
                      height: `${((clump.radius * 2.6) / 1000) * 100}%`,
                      '--halo': color,
                    } as CSSProperties
                  }
                />
              );
            })}
          {dots.map(({ base, left, top, color }) => {
            const classes = ['atlas-dot'];
            if (lit !== null && !lit.has(base.gameUid)) classes.push('atlas-dot--dim');
            else if (isStale(base, now)) classes.push('atlas-dot--stale');
            if (isShielded(base, now)) classes.push('atlas-dot--shield');
            if (base.gameUid === selectedUid) classes.push('atlas-dot--on');
            const sprite =
              zoom >= TOWER_ZOOM && !territory && base.hq !== null
                ? towers?.get(String(base.hq))
                : undefined;
            if (zoom >= TOWER_ZOOM) classes.push('atlas-dot--tower');
            if (sprite) classes.push('atlas-dot--sprite');
            return (
              <button
                aria-label={base.name ?? 'unnamed'}
                className={classes.join(' ')}
                data-uid={base.gameUid}
                key={base.gameUid}
                onClick={() => onSelect(base)}
                style={
                  {
                    left,
                    top,
                    '--dot': color,
                    // Lower on the map stands in front, as towers in the client do.
                    zIndex: sprite ? 10 + base.at.y : undefined,
                  } as CSSProperties
                }
                tabIndex={-1}
                title={`${base.name ?? 'unnamed'} — ${base.at.x}, ${base.at.y}`}
                type="button"
              >
                {sprite && (
                  <img alt="" className="atlas-dot__tower" draggable={false} src={sprite} />
                )}
                {baseNames.has(base.gameUid) && (
                  <span className="atlas-dot__name">
                    {base.name}
                    <NameChip base={base} now={now} />
                  </span>
                )}
              </button>
            );
          })}
          {/* The alliance's name over its clump, kept the same size on screen. */}
          {named.map((clump) => {
            const alliance = atlas.alliances[clump.alliance];
            const f = toFraction(clump.at);
            return (
              <span
                className="atlas-label"
                key={`label-${alliance?.id}`}
                style={
                  {
                    left: `${f.left * 100}%`,
                    top: `${f.top * 100}%`,
                    '--dot': allianceColor(alliance?.id ?? null, clump.alliance === oursIndex),
                  } as CSSProperties
                }
              >
                {alliance?.code ?? '?'}
              </span>
            );
          })}
          {planTiles?.map(({ slot, base }) => {
            const f = toFraction({ x: slot.x, y: slot.y });
            return (
              <span
                className={base ? 'atlas-plan atlas-plan--ok' : 'atlas-plan atlas-plan--miss'}
                key={slot.slotId}
                style={{ left: `${f.left * 100}%`, top: `${f.top * 100}%` }}
                title={`${slot.playerName ?? 'Open tile'} · X:${slot.x} Y:${slot.y} · ${
                  base ? 'in place' : 'not on its tile'
                }`}
              >
                {zoom >= NAME_ZOOM && slot.playerName && (
                  <span className="atlas-plan__name">{slot.playerName}</span>
                )}
              </span>
            );
          })}
          <AtlasHover atlas={atlas} oursIndex={oursIndex} />
          {children}
        </div>
      </div>
    </figure>
  );
}

/** The tag after a base's name: the shield time left when it has one, the real
 * power otherwise, and the HQ level when neither is known. */
function NameChip({ base, now }: { base: AtlasBase; now: Date }) {
  const left = isShielded(base, now) && base.shieldEnd ? shieldLeft(base.shieldEnd, now) : null;
  if (left) return <em className="atlas-dot__shield">{left}</em>;
  if (base.power !== null) return <em>{formatPower(base.power)}</em>;
  return base.hq !== null ? <em>HQ{base.hq}</em> : null;
}
