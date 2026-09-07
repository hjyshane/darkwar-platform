import { expect, test } from 'vitest';
import {
  MAP_MAX,
  MAP_TILES,
  formatCoordinate,
  fromFraction,
  isOnMap,
  toFraction,
} from './mapProjection';

const HALF_TILE = 0.5 / MAP_TILES;

test('the map is a thousand tiles a side', () => {
  expect(MAP_TILES).toBe(1000);
});

test('the top-left corner of the map is 0,999', () => {
  // The corner the alliance names when it describes the map. If this is ever
  // the other way round every marker is mirrored.
  const at = toFraction({ x: 0, y: MAP_MAX });

  expect(at.left).toBeCloseTo(HALF_TILE, 6);
  expect(at.top).toBeCloseTo(HALF_TILE, 6);
});

test('the bottom-right corner of the map is 999,0', () => {
  const at = toFraction({ x: MAP_MAX, y: 0 });

  expect(at.left).toBeCloseTo(1 - HALF_TILE, 6);
  expect(at.top).toBeCloseTo(1 - HALF_TILE, 6);
});

test('y counts upwards, so a high y renders near the top', () => {
  // THE FLIP, stated as a test. Every browser API counts down from the top
  // and the game counts up from the bottom; a mirrored map looks plausible
  // and is wrong everywhere.
  const high = toFraction({ x: 500, y: 900 });
  const low = toFraction({ x: 500, y: 100 });

  expect(high.top).toBeLessThan(low.top);
});

test('x counts rightwards, the same way the screen does', () => {
  expect(toFraction({ x: 100, y: 500 }).left).toBeLessThan(toFraction({ x: 900, y: 500 }).left);
});

test('a marker sits at the centre of its tile, not its corner', () => {
  // A corner-pinned marker points a tile up and left of the square it names,
  // which at this scale is a different base.
  const at = toFraction({ x: 0, y: 0 });

  expect(at.left).toBeGreaterThan(0);
  expect(at.top).toBeLessThan(1);
});

test('reading a coordinate back off the picture returns the same tile', () => {
  for (const tile of [
    { x: 0, y: 0 },
    { x: 0, y: MAP_MAX },
    { x: MAP_MAX, y: 0 },
    { x: MAP_MAX, y: MAP_MAX },
    { x: 491, y: 444 },
    { x: 1, y: 998 },
  ]) {
    expect(fromFraction(toFraction(tile))).toEqual(tile);
  }
});

test('a click anywhere inside a tile names that tile', () => {
  // Floor, not round: the tile owns its whole band of the picture. With
  // rounding each tile's outer half would report its neighbour.
  const tile = { x: 491, y: 444 };
  const centre = toFraction(tile);
  const nudge = 0.4 / MAP_TILES;

  expect(fromFraction({ left: centre.left - nudge, top: centre.top - nudge })).toEqual(tile);
  expect(fromFraction({ left: centre.left + nudge, top: centre.top + nudge })).toEqual(tile);
});

test('a click past the edge is clamped rather than reported off-map', () => {
  // Rounding at the border and a stray pointer event both land here. A
  // coordinate of -1 or 1000 is not a place.
  expect(fromFraction({ left: -0.2, top: -0.2 })).toEqual({ x: 0, y: MAP_MAX });
  expect(fromFraction({ left: 1.2, top: 1.2 })).toEqual({ x: MAP_MAX, y: 0 });
});

test('off-map coordinates are refused rather than drawn somewhere wrong', () => {
  expect(isOnMap({ x: 0, y: 0 })).toBe(true);
  expect(isOnMap({ x: MAP_MAX, y: MAP_MAX })).toBe(true);
  expect(isOnMap({ x: -1, y: 500 })).toBe(false);
  expect(isOnMap({ x: 1000, y: 500 })).toBe(false);
  expect(isOnMap({ x: 500, y: 1000 })).toBe(false);
  // A half-tile is not a tile. This is what a bad parse looks like.
  expect(isOnMap({ x: 12.5, y: 500 })).toBe(false);
  expect(isOnMap({ x: Number.NaN, y: 500 })).toBe(false);
});

test('a coordinate reads the way the game writes it', () => {
  expect(formatCoordinate({ x: 491, y: 444 })).toBe('491, 444');
});
