import { type Coordinate, MAP_MAX, MAP_MIN, formatCoordinate } from '@dw/ui';
import type { CSSProperties } from 'react';
import { BASE_SPAN } from '../../lib/hiveFormation';

// A few dozen tiles, close enough to click one.
//
// THE WORLD MAP CANNOT DO THIS AND NEVER WILL. `MapCanvas` draws all 1,000
// tiles a side across about 900 pixels, which is nine tenths of a pixel per
// tile — fine for saying roughly where a base is, useless for saying WHICH
// SQUARE. A formation is decided one tile at a time, so this is a window onto
// a few dozen of them instead, and the window is what makes a click mean a
// coordinate.
//
// NO TILE IS AN ELEMENT. A 41x41 window is 1,681 squares, and drawing each as
// a node makes panning cost a thousand-node re-render for a picture that is
// only ever lines. The grid is a repeating background gradient, and the only
// elements are the things that carry information: the bases, the anchor, and
// the sightings underneath. Which is also why the click has to be projected
// rather than read off an element's identity — the helpers below are that
// projection, and they are exported because getting the y flip wrong is
// silent and would mirror every placement.

/** The rectangle of tiles on screen. Inclusive on all four sides. */
export interface GridWindow {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Tiles along one side. */
  across: number;
}

/** The window of `radius` tiles either side of a centre, clamped to the map.
 *
 * CLAMPED BY SLIDING, NOT BY SHRINKING. A window that got smaller near the
 * edge would change the size of every tile on screen as you pan, so a hive
 * being drawn at 20,20 would be at a different zoom to the same hive at
 * 500,500. Sliding keeps the tile size fixed and the picture honest.
 */
export function windowAround(centre: Coordinate, radius: number): GridWindow {
  const across = radius * 2 + 1;
  const slide = (value: number) =>
    Math.min(MAP_MAX - across + 1, Math.max(MAP_MIN, value - radius));
  const xMin = slide(centre.x);
  const yMin = slide(centre.y);
  return { xMin, xMax: xMin + across - 1, yMin, yMax: yMin + across - 1, across };
}

/** Where a tile's top-left corner sits, as fractions of the grid.
 *
 * The y flip lives here and in `tileAtFraction`, and nowhere else: the map
 * counts y UPWARD from the bottom and every browser API counts downward from
 * the top. Getting it backwards does not throw — it mirrors the formation.
 */
export function tileCorner(window: GridWindow, at: Coordinate): { left: number; top: number } {
  return {
    left: (at.x - window.xMin) / window.across,
    top: (window.yMax - at.y) / window.across,
  };
}

/** The tile under a point given as fractions of the grid.
 *
 * Floors rather than rounds, for `fromFraction`'s reason: a tile OWNS the
 * band it covers, so a click anywhere inside names it. Rounding would give
 * each tile's outer half to its neighbour, which at this zoom is a base
 * placed one square from where the officer pointed.
 */
export function tileAtFraction(window: GridWindow, left: number, top: number): Coordinate {
  const column = Math.floor(left * window.across);
  const row = Math.floor(top * window.across);
  return {
    x: Math.min(window.xMax, Math.max(window.xMin, window.xMin + column)),
    y: Math.min(window.yMax, Math.max(window.yMin, window.yMax - row)),
  };
}

/** A base drawn on the grid. */
export interface GridBase {
  key: string;
  at: Coordinate;
  /** Shown inside the footprint when there is room — a number, or a name. */
  caption?: string;
  selected?: boolean;
  /** The reader's own tile, picked out from everybody else's. */
  own?: boolean;
  /** Drawn as a warning: an assignment for somebody off the roster. */
  stale?: boolean;
}

/** Somebody already standing here, from the map's own sightings. */
export interface GridSighting {
  key: string;
  at: Coordinate;
  name: string | null;
  /** True when this base belongs to a member of our own alliance — one of
   * ours standing on the ground is a very different thing to a stranger. */
  ours?: boolean;
}

function boxStyle(window: GridWindow, at: Coordinate, span: number) {
  const size = span / window.across;
  const corner = tileCorner(window, {
    x: at.x - (span - 1) / 2,
    y: at.y + (span - 1) / 2,
  });
  return {
    left: `${corner.left * 100}%`,
    top: `${corner.top * 100}%`,
    width: `${size * 100}%`,
    height: `${size * 100}%`,
  };
}

export function TileGrid({
  window: view,
  anchor,
  bases,
  sightings = [],
  onPick,
  busy = false,
}: {
  window: GridWindow;
  /** The formation's origin. Drawn because every offset is measured from it,
   * so an officer who cannot see it cannot read the shape. */
  anchor: Coordinate;
  bases: readonly GridBase[];
  sightings?: readonly GridSighting[];
  /** Given, clicking a tile reports it. Absent, the grid is a picture. */
  onPick?: (tile: Coordinate) => void;
  busy?: boolean;
}) {
  // Captions are dropped once a tile is too small to hold one. The same rule
  // MapCanvas follows with its labels: text that overlaps into a grey mass
  // hides the squares underneath, which are the part carrying the answer.
  const roomForCaptions = view.across <= 45;

  const surface = (
    <>
      {sightings.map((sighting) => (
        <span
          className={sighting.ours ? 'tile-grid__seen tile-grid__seen--ours' : 'tile-grid__seen'}
          key={sighting.key}
          style={boxStyle(view, sighting.at, BASE_SPAN)}
          title={`${sighting.name ?? 'unnamed'} was last seen at ${formatCoordinate(sighting.at)}`}
        />
      ))}
      <span
        className="tile-grid__anchor"
        style={boxStyle(view, anchor, 1)}
        title={`Anchor — ${formatCoordinate(anchor)}`}
      />
      {bases.map((base) => {
        const className = [
          'tile-grid__base',
          base.selected ? 'tile-grid__base--on' : '',
          base.own ? 'tile-grid__base--own' : '',
          base.stale ? 'tile-grid__base--stale' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <span
            className={className}
            key={base.key}
            style={boxStyle(view, base.at, BASE_SPAN)}
            title={`${base.caption ?? ''} ${formatCoordinate(base.at)}`.trim()}
          >
            {roomForCaptions && base.caption !== undefined && (
              <span className="tile-grid__caption">{base.caption}</span>
            )}
          </span>
        );
      })}
    </>
  );

  if (onPick === undefined) {
    return (
      <div className="tile-grid" style={{ '--tiles': view.across } as CSSProperties}>
        {surface}
      </div>
    );
  }

  return (
    // A BUTTON, NOT A DIV WITH A CLICK. The whole surface is one target and
    // what happens depends on which tile the pointer was over, so there is
    // nothing smaller to make focusable. Keyboard use is not served by
    // pressing this — Enter has no pointer position — which is why the page
    // carries a coordinate box beside the grid that does the same job. Those
    // presses arrive with `detail === 0` and are ignored rather than
    // silently placing a base in the middle.
    <button
      aria-label="Pick a tile. The coordinate boxes beside the map do the same without a pointer."
      className={busy ? 'tile-grid tile-grid--busy' : 'tile-grid'}
      onClick={(event) => {
        if (event.detail === 0) {
          return;
        }
        const box = event.currentTarget.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) {
          return;
        }
        onPick(
          tileAtFraction(
            view,
            (event.clientX - box.left) / box.width,
            (event.clientY - box.top) / box.height,
          ),
        );
      }}
      style={{ '--tiles': view.across } as CSSProperties}
      type="button"
    >
      {surface}
    </button>
  );
}
