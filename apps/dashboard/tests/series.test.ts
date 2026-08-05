import { describe, expect, test } from 'vitest';
import {
  type Box,
  type Series,
  extents,
  linePath,
  mergedTimes,
  nearestIndex,
  scaleX,
  scaleY,
  thin,
  ticks,
} from '../src/lib/series';

const box: Box = {
  width: 100,
  height: 100,
  padLeft: 0,
  padRight: 0,
  padTop: 0,
  padBottom: 0,
};

function line(name: string, points: [number, number | null][]): Series {
  return { name, slot: 0, points: points.map(([t, v]) => ({ t, v })) };
}

describe('extents', () => {
  test('covers every point of every series', () => {
    const range = extents([
      line('a', [
        [10, 5],
        [20, 15],
      ]),
      line('b', [
        [5, 8],
        [30, 12],
      ]),
    ]);
    expect(range).toEqual({ x: { min: 5, max: 30 }, y: { min: 5, max: 15 } });
  });

  // A reading whose value is missing still happened. It belongs on the time
  // axis; stretching the value axis to it would be inventing a value of zero,
  // which is the FR-UI-008 mistake in chart form.
  test('a missing value widens the time axis and not the value axis', () => {
    const range = extents([
      line('a', [
        [10, 100],
        [50, null],
      ]),
    ]);
    expect(range?.x).toEqual({ min: 10, max: 50 });
    expect(range?.y.min).toBeLessThan(100);
    expect(range?.y.max).toBeGreaterThan(100);
  });

  test('nothing measured at all has no extent', () => {
    expect(extents([line('a', [[10, null]])])).toBeNull();
    expect(extents([])).toBeNull();
  });

  // Readings that all agree have no span. Dividing by it would put every point
  // at NaN and draw nothing at all, which looks like a query that failed.
  test('a flat series gets a padded axis rather than a zero-width one', () => {
    const range = extents([
      line('a', [
        [10, 7],
        [20, 7],
      ]),
    ]);
    expect(range?.y.min).toBeLessThan(7);
    expect(range?.y.max).toBeGreaterThan(7);
  });
});

describe('scales', () => {
  test('time runs left to right and value runs bottom to top', () => {
    const x = { min: 0, max: 10 };
    const y = { min: 0, max: 10 };
    expect(scaleX(0, x, box)).toBe(0);
    expect(scaleX(10, x, box)).toBe(100);
    // The largest value sits at the TOP, which in SVG is y=0. Getting this
    // backwards draws a chart that is upside down and entirely plausible.
    expect(scaleY(10, y, box)).toBe(0);
    expect(scaleY(0, y, box)).toBe(100);
  });
});

describe('linePath', () => {
  test('one run of readings is one move and then lines', () => {
    const path = linePath(
      [
        { t: 0, v: 0 },
        { t: 5, v: 5 },
        { t: 10, v: 10 },
      ],
      { min: 0, max: 10 },
      { min: 0, max: 10 },
      box,
    );
    expect(path).toBe('M0.00 100.00 L50.00 50.00 L100.00 0.00');
  });

  // THE assertion in this file. A gap has to look like a gap: joining across a
  // capture we do not have draws a straight line through days nobody observed,
  // and it reads as steady growth.
  test('a missing reading breaks the line instead of being skipped over', () => {
    const path = linePath(
      [
        { t: 0, v: 0 },
        { t: 5, v: null },
        { t: 10, v: 10 },
      ],
      { min: 0, max: 10 },
      { min: 0, max: 10 },
      box,
    );
    expect(path).toBe('M0.00 100.00 M100.00 0.00');
    expect(path.split('M')).toHaveLength(3);
  });
});

describe('ticks', () => {
  test('round numbers, not divisions of the extent', () => {
    expect(ticks({ min: 0, max: 1000 }, 4)).toEqual([0, 500, 1000]);
  });

  // `count` is an upper bound on the intervals, so the ladder takes the smallest
  // rung at or above what was asked for. It used to stop at 5, which turned an
  // extent of 0..3 into steps of 0.5 — a legal round number, and twice as many
  // gridlines as requested.
  test('the ladder includes 10, so 0..3 steps by 1 and not by a half', () => {
    expect(ticks({ min: 0, max: 3 }, 4)).toEqual([0, 1, 2, 3]);
    expect(ticks({ min: 0, max: 30_000_000 }, 3)).toEqual([0, 10_000_000, 20_000_000, 30_000_000]);
  });

  // Binary floating point drifts, and a gridline labelled 0.6000000000000001 is
  // the kind of thing that ships. Snapping by `round(v / step) * step` does NOT
  // fix it — 3 * 0.2 is 0.6000000000000001 — so this pins the outputs exactly
  // rather than asserting a property the broken version also satisfied.
  test('labels carry no float drift', () => {
    expect(ticks({ min: 0, max: 1 }, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  test('an extent with no span still yields something to label', () => {
    expect(ticks({ min: 5, max: 5 })).toEqual([5]);
  });
});

describe('the hover index', () => {
  // Nearest, not "the one to the left". Captures come in clusters minutes apart
  // and then days apart, so snapping one direction makes the readout disagree
  // with the dot the cursor is sitting on.
  test('picks the closest reading in either direction', () => {
    const points = [
      { t: 0, v: 1 },
      { t: 100, v: 2 },
      { t: 1000, v: 3 },
    ];
    expect(nearestIndex(points, 90)).toBe(1);
    expect(nearestIndex(points, 400)).toBe(1);
    expect(nearestIndex(points, 600)).toBe(2);
    expect(nearestIndex(points, -50)).toBe(0);
  });

  test('nothing to pick from picks nothing', () => {
    expect(nearestIndex([], 5)).toBeNull();
  });

  // The series do not share timestamps: two alliances are captured seconds
  // apart, and a crosshair pinned to one series sits beside the other's dot.
  test('the timeline is the union of every series, sorted and deduplicated', () => {
    expect(
      mergedTimes([
        line('a', [
          [30, 1],
          [10, 1],
        ]),
        line('b', [
          [20, 1],
          [10, 1],
        ]),
      ]),
    ).toEqual([10, 20, 30]);
  });
});

describe('thin', () => {
  test('a series that already fits is untouched', () => {
    const points = [
      { t: 1, v: 1 },
      { t: 2, v: 2 },
    ];
    expect(thin(points, 10)).toEqual(points);
  });

  // Every-nth, not an average: each drawn point must still be a reading that
  // happened, or the tooltip shows a figure the game never reported.
  test('thinning keeps real readings, including the last one', () => {
    const points = Array.from({ length: 100 }, (_, index) => ({ t: index, v: index }));
    const thinned = thin(points, 10);
    expect(thinned.length).toBeLessThanOrEqual(11);
    expect(thinned[0]).toEqual({ t: 0, v: 0 });
    expect(thinned[thinned.length - 1]).toEqual({ t: 99, v: 99 });
    for (const point of thinned) {
      expect(point.t).toBe(point.v);
    }
  });
});
