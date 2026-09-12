// Turning a game coordinate into a position on a picture of the map.
//
// THE Y AXIS IS UPSIDE DOWN relative to the screen. The map's top-left
// corner is (0, 999) and its bottom-right is (999, 0), so x runs left to
// right the way a screen does but y counts UPWARDS from the bottom. Every
// browser API — CSS `top`, `getBoundingClientRect`, pointer events — counts
// downwards from the top. Getting that backwards does not throw and does not
// look obviously wrong; it silently mirrors the whole map, and a base at the
// top of the world renders at the bottom.
//
// This file is the only place that flip happens. Components take fractions.

/** Coordinates run 0..999 on both axes, one tile each. */
export const MAP_MIN = 0;
export const MAP_MAX = 999;
/** Tiles per side. One more than MAP_MAX, which is what makes a tile a
 * thousandth of the picture rather than a 999th. */
export const MAP_TILES = MAP_MAX - MAP_MIN + 1;

export interface Coordinate {
  x: number;
  y: number;
}

/** Where a coordinate sits in the picture, as fractions of its width and
 * height, both counted from the TOP-LEFT the way CSS does.
 *
 * The centre of the tile, not its corner: a marker pinned to the corner sits
 * a tile up and to the left of the square it names, which at this zoom is the
 * difference between two neighbouring bases.
 */
export interface Fraction {
  /** 0 at the left edge, 1 at the right. */
  left: number;
  /** 0 at the TOP edge, 1 at the bottom — already flipped. */
  top: number;
}

export function toFraction(at: Coordinate): Fraction {
  return {
    left: (at.x + 0.5) / MAP_TILES,
    // 999 - y flips it; the extra half lands on the tile's centre.
    top: (MAP_MAX - at.y + 0.5) / MAP_TILES,
  };
}

/** The tile under a point in the picture. The inverse of `toFraction`,
 * for reading a coordinate off a click.
 *
 * Floors rather than rounds: a tile OWNS the band of the picture it covers,
 * so a click anywhere inside it names it. Rounding would make each tile's
 * outer half belong to its neighbour.
 */
export function fromFraction(at: Fraction): Coordinate {
  return {
    x: clamp(Math.floor(at.left * MAP_TILES)),
    y: clamp(MAP_MAX - Math.floor(at.top * MAP_TILES)),
  };
}

/** Inside the map, or not. A tile from another server's sighting, or a
 * malformed row, must not be drawn somewhere misleading. */
export function isOnMap(at: Coordinate): boolean {
  return (
    Number.isInteger(at.x) &&
    Number.isInteger(at.y) &&
    at.x >= MAP_MIN &&
    at.x <= MAP_MAX &&
    at.y >= MAP_MIN &&
    at.y <= MAP_MAX
  );
}

/** `491, 444` — the coordinate the way the game writes it. */
export function formatCoordinate(at: Coordinate): string {
  return `${at.x}, ${at.y}`;
}

function clamp(value: number): number {
  return Math.min(MAP_MAX, Math.max(MAP_MIN, value));
}
