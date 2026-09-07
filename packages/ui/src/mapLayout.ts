// Deciding where a pin goes and what it says — the part of drawing the map
// that has nothing to do with JSX, DOM nodes, or React. The dashboard renders
// this as buttons and spans; the desktop app (plain TypeScript, no React)
// will render it some other way. Both apps hand this the same marker list and
// get back the same answer.

import { type Coordinate, formatCoordinate, isOnMap, toFraction } from './mapProjection';

/** The picture of the world.
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
 *
 * Applied once, to the plot container that holds every marker — never
 * per-marker. A marker's own position is a fraction of that plot, produced
 * by `toFraction` alone; nothing here adjusts it a second time for the
 * inset.
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
  /** Picked out of a crowd — the one the reader clicked. */
  highlighted?: boolean;
}

/** Above this many pins the labels are dropped.
 *
 * A hundred name tags on a 900px map overlap into a grey mass and hide the
 * dots underneath, which are the part that carries the information. The list
 * beside the map does the naming instead; clicking a row highlights its pin.
 */
export const LABEL_LIMIT = 8;

export interface LayoutMarkersOptions {
  /** Given, the caller intends to render pins as something clickable (a
   * button, in the dashboard's case) — reflected only in `className`, since
   * this module has no notion of a click handler. */
  clickable?: boolean;
}

/** Everything a renderer needs to draw one marker, computed once so the JSX
 * (or DOM, or canvas) layer never has to re-derive it. */
export interface PositionedMarker {
  /** Stable across renders of the same marker, for use as a list key or a
   * DOM element id. */
  key: string;
  /** The marker this entry was built from, for a click handler that needs
   * the original data back. */
  marker: MapMarker;
  /** Left/top as percentages of the plot, unadjusted for `MapInset` — see
   * `MapInset` for why. Ready to assign to inline style. */
  position: { left: string; top: string };
  /** Space-separated, already includes `map-pin` and every modifier class
   * that applies — nothing further to compute at the call site. */
  className: string;
  /** Whether this marker's label should be shown at all. False past
   * `LABEL_LIMIT` unless the marker is highlighted. */
  showLabel: boolean;
  /** The label text, with the highlighted-marker coordinate suffix already
   * applied. Only meaningful when `showLabel` is true. */
  label: string;
  /** Full name plus coordinate, for a hover title — always present,
   * independent of `showLabel`. */
  title: string;
}

/** Turn a marker list into everything needed to draw it: which markers are
 * even on the map, where each one sits, what its label says, and what
 * classes it carries.
 *
 * Off-map markers (see `isOnMap`) are dropped rather than drawn somewhere
 * misleading, so the returned list may be shorter than `markers`.
 */
export function layoutMarkers(
  markers: readonly MapMarker[],
  options: LayoutMarkersOptions = {},
): PositionedMarker[] {
  const { clickable = false } = options;
  const drawn = markers.filter((marker) => isOnMap(marker.at));
  const withLabels = drawn.length <= LABEL_LIMIT;

  return drawn.map((marker) => {
    const at = toFraction(marker.at);
    const where = formatCoordinate(marker.at);
    const showLabel = withLabels || marker.highlighted === true;
    const className = [
      'map-pin',
      marker.faded ? 'map-pin--faded' : '',
      marker.highlighted ? 'map-pin--on' : '',
      clickable ? 'map-pin--clickable' : '',
    ]
      .filter(Boolean)
      .join(' ');
    // THE COORDINATE IS THE ANSWER, so a picked pin carries it on the map
    // rather than only in the panel above. Reading a name off the map and
    // then hunting for the same name in a list to learn where it is makes
    // the map the slow way round.
    const label = marker.highlighted ? `${marker.label} · ${where}` : marker.label;
    const key = `${marker.label}:${marker.at.x}:${marker.at.y}`;
    const position = { left: `${at.left * 100}%`, top: `${at.top * 100}%` };
    const title = `${marker.label} — ${where}`;

    return { key, marker, position, className, showLabel, label, title };
  });
}
