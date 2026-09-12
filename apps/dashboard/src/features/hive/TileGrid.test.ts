import { MAP_MAX } from '@dw/ui';
import { expect, test } from 'vitest';
import {
  ZOOM_STEPS,
  pannedCentre,
  tileAtFraction,
  tileCorner,
  windowAround,
  zoomStep,
} from './TileGrid';

test('a window is centred on the tile it was given', () => {
  const view = windowAround({ x: 500, y: 500 }, 10);

  expect(view).toEqual({ xMin: 490, xMax: 510, yMin: 490, yMax: 510, across: 21 });
});

test('a window near the edge slides instead of shrinking', () => {
  // A window that got smaller would change the size of every tile on screen
  // as you pan, so the same hive would be at a different zoom at 5,5 and at
  // 500,500.
  const view = windowAround({ x: 5, y: MAP_MAX - 2 }, 10);

  expect(view.across).toBe(21);
  expect(view.xMin).toBe(0);
  expect(view.yMax).toBe(MAP_MAX);
});

test('the top row of the picture is the highest y on the map', () => {
  // The flip. Getting it backwards does not throw and does not look broken —
  // it mirrors the whole formation, and a plan drawn north comes out south.
  const view = windowAround({ x: 500, y: 500 }, 10);

  expect(tileCorner(view, { x: 490, y: 510 })).toEqual({ left: 0, top: 0 });
  expect(tileCorner(view, { x: 510, y: 490 }).top).toBeCloseTo(20 / 21, 6);
});

test('a click anywhere inside a tile names that tile', () => {
  const view = windowAround({ x: 500, y: 500 }, 10);
  const tile = 1 / 21;

  // Just inside the top-left square, and just inside its bottom-right
  // corner: a tile owns the whole band it covers.
  expect(tileAtFraction(view, 0.001, 0.001)).toEqual({ x: 490, y: 510 });
  expect(tileAtFraction(view, tile * 0.99, tile * 0.99)).toEqual({ x: 490, y: 510 });
  expect(tileAtFraction(view, tile * 1.01, tile * 0.99)).toEqual({ x: 491, y: 510 });
});

test('a click and the corner it lands in agree with each other', () => {
  // The two halves of the projection are inverses, which is the property
  // that keeps a placed base under the pointer that placed it.
  const view = windowAround({ x: 321, y: 654 }, 15);
  for (const at of [
    { x: 321, y: 654 },
    { x: 310, y: 668 },
    { x: 336, y: 640 },
  ]) {
    const corner = tileCorner(view, at);
    const half = 0.5 / view.across;

    expect(tileAtFraction(view, corner.left + half, corner.top + half)).toEqual(at);
  }
});

test('a click outside the grid is clamped rather than invented', () => {
  const view = windowAround({ x: 500, y: 500 }, 10);

  expect(tileAtFraction(view, -0.5, -0.5)).toEqual({ x: 490, y: 510 });
  expect(tileAtFraction(view, 1.5, 1.5)).toEqual({ x: 510, y: 490 });
});

test('wheeling in gets closer, which is fewer tiles', () => {
  // The list runs outward, so "closer" is a lower index. Backwards here makes
  // the wheel do the opposite of every other map and throws nothing.
  expect(zoomStep(14, 1)).toBeLessThan(14);
  expect(zoomStep(14, -1)).toBeGreaterThan(14);
});

test('zoom stops at both ends rather than wrapping', () => {
  const closest = ZOOM_STEPS.at(0) ?? 0;
  const widest = ZOOM_STEPS.at(-1) ?? 0;

  expect(zoomStep(closest, 1)).toBe(closest);
  expect(zoomStep(widest, -1)).toBe(widest);
});

// Sliding the view with ctrl held.

test('a pan step moves the centre by that many tiles', () => {
  expect(pannedCentre({ x: 500, y: 500 }, -3, 2)).toEqual({ x: 497, y: 502 });
});

test('a pan stops at the map rather than counting past it', () => {
  // Unclamped, the centre would go on climbing while `windowAround` slid the
  // window against the edge and the picture stopped moving — so the officer
  // would have to drag all the way back before anything happened again.
  expect(pannedCentre({ x: 2, y: MAP_MAX - 1 }, -40, 40)).toEqual({ x: 0, y: MAP_MAX });
});

test('panning to a corner and back again lands where it started', () => {
  const corner = pannedCentre({ x: 500, y: 500 }, -500, -500);
  expect(corner).toEqual({ x: 0, y: 0 });
  expect(pannedCentre(corner, 500, 500)).toEqual({ x: 500, y: 500 });
});
