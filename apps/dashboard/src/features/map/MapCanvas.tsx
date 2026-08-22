import { useState } from 'react';
import { type Coordinate, isOnMap, toFraction } from '../../lib/mapProjection';

/** The picture of the world, and one marker on it.
 *
 * The image is served from `public/` rather than imported, so replacing it is
 * dropping a file rather than a rebuild — the map changes when the game
 * changes it, and that should not need a release.
 */
// .webp, and named for what it actually is. The file arrived as
// `map.png.webp` — browsers sniff the bytes and would have rendered it
// regardless, which is exactly why a name that lies about its format is
// worth fixing now rather than the next time somebody opens it.
export const MAP_IMAGE_URL = '/map.webp';

/** How much of the picture is FRAME rather than map.
 *
 * THE MAP DOES NOT START AT THE IMAGE'S CORNER. The picture has a green
 * border around it and the playable world is the rectangle inside that
 * border: its top-left is (0, 999) and its bottom-right is (999, 0), not the
 * image's own corners. Stretching the whole image across the plot would put
 * every marker out by the thickness of that frame — a small error at the
 * edge, and a consistent lie everywhere.
 *
 * Fractions of the image's own width and height, so they survive any
 * resolution the picture is saved at. MEASURED FROM THE FILE, not guessed —
 * the calibration outline exists to prove them: turn it on and the drawn
 * rectangle should sit exactly on the inside of the green border.
 */
export interface MapInset {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Measured from `public/map.webp`, which is 3164 x 2664.
 *
 * The frame is 55px on all four sides: 0-47 is the outer olive surround,
 * 49-54 is the dark border line, and the world starts at 55. Read off 41
 * sample lines across the picture rather than from one row, so a road or a
 * label crossing a single scanline could not move it — every one of them
 * agreed on 55.
 *
 * That leaves a 3054 x 2554 interior for a 1000 x 1000 grid, so a tile is
 * 3.05px wide and 2.55px tall. Tiles are NOT square in this picture and are
 * not meant to be; the projection stretches the grid over the interior, which
 * is why `toFraction` returns fractions and never pixels.
 */
export const MAP_INSET: MapInset = {
  left: 55 / 3164,
  right: 55 / 3164,
  top: 55 / 2664,
  bottom: 55 / 2664,
};

export interface MapMarker {
  at: Coordinate;
  label: string;
  /** Drawn dimmer, for a sighting too old to trust. */
  faded?: boolean;
}

export function MapCanvas({
  markers,
  caption,
  calibrate = false,
  inset = MAP_INSET,
}: {
  markers: readonly MapMarker[];
  caption?: string;
  /** Draw the map's own bounds, to check them against the picture. */
  calibrate?: boolean;
  inset?: MapInset;
}) {
  // An absent image is a normal state, not an error: the feature works
  // without it and says so, rather than showing a broken-image glyph over a
  // marker that is in the right place.
  const [hasImage, setHasImage] = useState(true);
  const drawn = markers.filter((marker) => isOnMap(marker.at));

  // The plot is the INNER rectangle. Markers are placed as fractions of it,
  // never of the image, which is what keeps the frame out of the arithmetic.
  const plotStyle = {
    left: `${inset.left * 100}%`,
    top: `${inset.top * 100}%`,
    right: `${inset.right * 100}%`,
    bottom: `${inset.bottom * 100}%`,
  };

  return (
    <figure className="map-canvas">
      <div className={hasImage ? 'map-frame' : 'map-frame map-frame--empty'}>
        {hasImage && (
          <img
            alt="World map"
            className="map-frame__image"
            onError={() => setHasImage(false)}
            src={MAP_IMAGE_URL}
          />
        )}
        <div className={calibrate ? 'map-plot map-plot--calibrate' : 'map-plot'} style={plotStyle}>
          {drawn.map((marker) => {
            const at = toFraction(marker.at);
            return (
              <span
                className={marker.faded ? 'map-pin map-pin--faded' : 'map-pin'}
                key={`${marker.label}:${marker.at.x}:${marker.at.y}`}
                style={{ left: `${at.left * 100}%`, top: `${at.top * 100}%` }}
              >
                <span className="map-pin__dot" />
                <span className="map-pin__label">{marker.label}</span>
              </span>
            );
          })}
          {calibrate && (
            <>
              {/* The two corners the coordinate system is defined by. If
                  these do not land on the inside of the green border, the
                  inset is wrong and every marker is out by the difference. */}
              <span className="map-edge map-edge--tl">0, 999</span>
              <span className="map-edge map-edge--br">999, 0</span>
            </>
          )}
        </div>
      </div>
      {!hasImage && (
        <figcaption className="subtle">
          No map picture yet — positions are drawn on the grid. Drop the image at{' '}
          <code>apps/dashboard/public/map.png</code> and it appears behind them.
        </figcaption>
      )}
      {caption && <figcaption className="subtle">{caption}</figcaption>}
    </figure>
  );
}
