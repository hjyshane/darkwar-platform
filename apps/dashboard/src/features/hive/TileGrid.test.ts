import { MAP_MAX } from '@dw/ui';
import { expect, test } from 'vitest';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  axisTicks,
  centreKeeping,
  pannedCentre,
  rankClass,
  tileAtFraction,
  tileCorner,
  wheelNotches,
  windowAround,
  windowRadius,
  zoomedBy,
} from './TileGrid';

test('unmeasured, an axis falls back to round coordinates and at most ten', () => {
  // Ten is what the frame assumes for its FIRST paint, before the width it
  // budgets from has been measured — deliberately the value that used to be
  // fixed, so a frame rendered early is never denser than what it settles on.

  expect(axisTicks(492, 508)).toEqual([492, 494, 496, 498, 500, 502, 504, 506, 508]);
  expect(axisTicks(466, 534)).toEqual([470, 480, 490, 500, 510, 520, 530]);
  for (const radius of [ZOOM_MIN, 8, 14, 22, 34, 60, ZOOM_MAX]) {
    const view = windowAround({ x: 500, y: 500 }, radius);
    const ticks = axisTicks(view.xMin, view.xMax);
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks.length).toBeLessThanOrEqual(10);
  }
});

test('panning one tile does not relabel the axis', () => {
  // Multiples of the step, not every nth tile from the edge: the same ground
  // keeps the same label as it slides.
  expect(axisTicks(467, 535)).toEqual(axisTicks(466, 534));
});

test('axis labels stay inside the window at the map edge', () => {
  const view = windowAround({ x: MAP_MAX, y: 0 }, 8);
  for (const tick of axisTicks(view.xMin, view.xMax)) {
    expect(tick).toBeGreaterThanOrEqual(view.xMin);
    expect(tick).toBeLessThanOrEqual(view.xMax);
  }
});

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
  // Closer is a smaller radius. Backwards here makes the wheel do the
  // opposite of every other map and throws nothing.
  expect(zoomedBy(14, 1)).toBeLessThan(14);
  expect(zoomedBy(14, -1)).toBeGreaterThan(14);
});

test('zoom stops at both ends rather than wrapping', () => {
  expect(zoomedBy(ZOOM_MIN, 1)).toBe(ZOOM_MIN);
  expect(zoomedBy(ZOOM_MAX, -1)).toBe(ZOOM_MAX);
  expect(zoomedBy(ZOOM_MIN, 50)).toBe(ZOOM_MIN);
  expect(zoomedBy(ZOOM_MAX, -50)).toBe(ZOOM_MAX);
});

test('one notch always moves the window, even at the closest end', () => {
  // The whole point of leaving the four-step ladder: every notch changes what
  // is on screen, and none of them is a jump.
  // Bounded by the window drawn rather than the raw zoom: a zoom of 3.3 IS the
  // closest window, and asking it for closer still is the end, not a failure.
  let steps = 0;
  for (let zoom = ZOOM_MIN; windowRadius(zoom) < ZOOM_MAX; zoom = zoomedBy(zoom, -1)) {
    const wider = zoomedBy(zoom, -1);
    expect(windowRadius(wider)).toBeGreaterThan(windowRadius(zoom));
    expect(windowRadius(wider)).toBeLessThanOrEqual(Math.ceil(windowRadius(zoom) * 1.3));
    steps += 1;
  }
  // End to end in a couple of dozen notches: fine enough to frame a hive,
  // short enough to cross the whole range with one spin of the wheel.
  expect(steps).toBeGreaterThan(12);
  expect(steps).toBeLessThan(30);
  for (let zoom = ZOOM_MAX; windowRadius(zoom) > ZOOM_MIN; zoom = zoomedBy(zoom, 1)) {
    expect(windowRadius(zoomedBy(zoom, 1))).toBeLessThan(windowRadius(zoom));
  }
  // Including from a fraction a pinch left behind, where a fifth of the
  // radius is less than a tile.
  for (const zoom of [3.6, 4.32, 4.4, 5.2]) {
    expect(windowRadius(zoomedBy(zoom, -1))).toBeGreaterThan(windowRadius(zoom));
    expect(windowRadius(zoomedBy(zoom, 1))).toBeLessThanOrEqual(
      Math.max(ZOOM_MIN, windowRadius(zoom) - 1),
    );
  }
});

test('a pinch is many small steps that add up, not one that rounds away', () => {
  // Forty events of a fortieth of a notch each land where one whole notch
  // does — rounding each step to whole tiles would have left the map still.
  let zoom = 20;
  for (let step = 0; step < 40; step += 1) {
    zoom = zoomedBy(zoom, 1 / 40);
  }
  expect(zoom).toBeCloseTo(zoomedBy(20, 1), 6);
  expect(windowRadius(zoom)).toBeLessThan(20);
});

test('a mouse notch is one step and a pinch follows its deltas', () => {
  // Chrome on Windows sends 100px a notch, Firefox three lines.
  expect(wheelNotches(100, 0)).toBe(-1);
  expect(wheelNotches(-100, 0)).toBe(1);
  expect(wheelNotches(3, 1)).toBe(-1);
  expect(wheelNotches(-120, 0)).toBe(1);
  // A pinch: small pixel deltas, read in proportion.
  expect(wheelNotches(-4, 0)).toBeCloseTo(0.2, 6);
  expect(wheelNotches(10, 0)).toBeCloseTo(-0.5, 6);
  expect(wheelNotches(0, 0)).toBe(0);
});

test('zooming keeps the ground under the pointer where it is', () => {
  // The tile under the cursor before a zoom is the tile under it after — the
  // pointer's spot holds still and everything else grows or shrinks round it.
  const view = windowAround({ x: 500, y: 500 }, 20);
  for (const at of [
    { left: 0.5, top: 0.5 },
    { left: 0.1, top: 0.85 },
    { left: 0.9, top: 0.2 },
    { left: 0, top: 1 },
  ]) {
    for (const radius of [6, 13, 35, 80]) {
      const before = tileAtFraction(view, at.left, at.top);
      const after = tileAtFraction(
        windowAround(centreKeeping(view, radius, at), radius),
        at.left,
        at.top,
      );
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    }
  }
});

test('zooming about the middle keeps the middle', () => {
  const view = windowAround({ x: 321, y: 654 }, 15);
  expect(centreKeeping(view, 40, { left: 0.5, top: 0.5 })).toEqual({ x: 321, y: 654 });
  expect(centreKeeping(view, 5, { left: 0.5, top: 0.5 })).toEqual({ x: 321, y: 654 });
});

test('zooming out against the map edge stays on the map', () => {
  const view = windowAround({ x: 2, y: MAP_MAX - 2 }, 10);
  const centre = centreKeeping(view, ZOOM_MAX, { left: 0, top: 0 });
  expect(centre.x).toBeGreaterThanOrEqual(0);
  expect(centre.y).toBeLessThanOrEqual(MAP_MAX);
});

test('a rank colours by R1 to R5 and anything else is unknown', () => {
  expect([1, 2, 3, 4, 5].map(rankClass)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
  // Null is a member the roster has no rank for; the others are a column gone
  // wrong, and must not invent a sixth colour.
  expect(rankClass(null)).toBe('r0');
  expect(rankClass(0)).toBe('r0');
  expect(rankClass(6)).toBe('r0');
  expect(rankClass(2.5)).toBe('r0');
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

// How many labels an axis is allowed, which the frame works out from its own
// measured width rather than from a constant.

test('a wider axis is labelled more finely, and a narrow one stays readable', () => {
  // The same 45-tile window. A 720px grid affords 24 labels and gets every
  // second tile; a 322px phone affords 10 and falls back to every fifth.
  const wide = axisTicks(478, 522, 24);
  const narrow = axisTicks(478, 522, 10);

  expect(wide.length).toBeGreaterThan(narrow.length);
  expect(wide.every((tick) => tick % 2 === 0)).toBe(true);
  expect(narrow.every((tick) => tick % 5 === 0)).toBe(true);
});

test('the budget is a ceiling, never a target', () => {
  // Seventeen tiles and room for 24 labels: every tile gets one, and the axis
  // does not invent ticks between them to use the budget up.
  expect(axisTicks(492, 508, 24)).toEqual([
    492, 493, 494, 495, 496, 497, 498, 499, 500, 501, 502, 503, 504, 505, 506, 507, 508,
  ]);
});

test('a budget of two still yields round numbers rather than the two edges', () => {
  // The floor the frame clamps to. Labels stay multiples of a step, so they
  // read as coordinates to type rather than as wherever the window happens to
  // start.
  const ticks = axisTicks(466, 534, 2);

  expect(ticks.length).toBeGreaterThan(0);
  expect(ticks.every((tick) => tick % 50 === 0)).toBe(true);
});
