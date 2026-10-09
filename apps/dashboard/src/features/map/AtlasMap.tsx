import { MAP_IMAGE_URL, MAP_INSET, toFraction } from '@dw/ui';
import { type CSSProperties, type ReactNode, useMemo, useState } from 'react';
import { type Atlas, type AtlasBase, allianceColor, isStale } from './atlas';

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
  onSelect,
  children,
}: {
  atlas: Atlas;
  /** Index of our own alliance in `atlas.alliances`, or -1. */
  oursIndex: number;
  lit: ReadonlySet<number> | null;
  selectedUid: number | null;
  onSelect: (base: AtlasBase) => void;
  /** Extra layers drawn over the dots (trucks and plunder missions). */
  children?: ReactNode;
}) {
  const [hasImage, setHasImage] = useState(true);
  const now = new Date();

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
          {dots.map(({ base, left, top, color }) => {
            const classes = ['atlas-dot'];
            if (lit !== null && !lit.has(base.gameUid)) classes.push('atlas-dot--dim');
            else if (isStale(base, now)) classes.push('atlas-dot--stale');
            if (base.gameUid === selectedUid) classes.push('atlas-dot--on');
            return (
              <button
                aria-label={base.name ?? 'unnamed'}
                className={classes.join(' ')}
                key={base.gameUid}
                onClick={() => onSelect(base)}
                style={{ left, top, '--dot': color } as CSSProperties}
                tabIndex={-1}
                title={`${base.name ?? 'unnamed'} — ${base.at.x}, ${base.at.y}`}
                type="button"
              />
            );
          })}
          {children}
        </div>
      </div>
    </figure>
  );
}
