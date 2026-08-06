import { describe, expect, test } from 'vitest';
import {
  type Box,
  type Series,
  axisInverted,
  extents,
  forwardFill,
  linePath,
  mergedTimes,
  nearestIndex,
  onAxis,
  scaleX,
  scaleY,
  thin,
  ticks,
  wholeNumbers,
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
  // The time axis is exactly the data. The value axis is the data plus a tenth
  // of its range at each end: without that the lowest line is drawn along the
  // very bottom of the frame, where it reads as a floor rather than a value.
  test('covers every point of every series, with headroom on the value axis', () => {
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
    expect(range?.x).toEqual({ min: 5, max: 30 });
    expect(range?.y).toEqual({ min: 4, max: 16 });
  });

  test('no line ever touches the top or bottom edge', () => {
    const range = extents([
      line('a', [
        [1, 100],
        [2, 200],
      ]),
    ]);
    expect(range?.y.min).toBeLessThan(100);
    expect(range?.y.max).toBeGreaterThan(200);
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

  // For rank. Rank 1 beats rank 40, so an ordinary axis makes improvement point
  // downwards — which every reader misinterprets exactly once. Inverting the
  // SCALE rather than negating the data keeps the readout showing 6, not −6.
  test('an inverted axis puts the smallest value at the top', () => {
    const y = { min: 0, max: 10 };
    expect(scaleY(0, y, box, true)).toBe(0);
    expect(scaleY(10, y, box, true)).toBe(100);
  });
});

describe('axes', () => {
  test('series are split by the axis they name, defaulting to the left', () => {
    const total = line('total', [[1, 1000]]);
    const mean = { ...line('mean', [[1, 10]]), axis: 'right' as const };
    expect(onAxis([total, mean], 'left').map((row) => row.name)).toEqual(['total']);
    expect(onAxis([total, mean], 'right').map((row) => row.name)).toEqual(['mean']);
  });

  // An axis has ONE direction. Two lines sharing it and disagreeing cannot both
  // be drawn, so the flag is read off the axis rather than per line — callers put
  // a rank on its own axis for exactly this reason.
  test('an axis is inverted when any line on it asks to be', () => {
    expect(axisInverted([line('a', [[1, 1]])])).toBe(false);
    expect(axisInverted([{ ...line('rank', [[1, 1]]), invert: true }])).toBe(true);
  });
});

describe('forwardFill', () => {
  // For a figure that cannot fall — a tower level. A capture that did not carry
  // it is our gap, not a demolished tower, so holding the last reading is closer
  // to the truth than breaking the line.
  test('a gap holds the last reading', () => {
    expect(
      forwardFill([
        { t: 1, v: 31 },
        { t: 2, v: null },
        { t: 3, v: 32 },
      ]),
    ).toEqual([
      { t: 1, v: 31 },
      { t: 2, v: 31 },
      { t: 3, v: 32 },
    ]);
  });

  // The one thing forward-fill must never do: invent the first value out of the
  // future. Before any reading there is nothing to carry.
  test('leading gaps stay unknown', () => {
    expect(
      forwardFill([
        { t: 1, v: null },
        { t: 2, v: 31 },
      ]),
    ).toEqual([
      { t: 1, v: null },
      { t: 2, v: 31 },
    ]);
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

  // The rank axis, which is what caught this. Ranks 1 to 9, padded to 0.2–9.8,
  // ask for a rough step of 2.4 and take the 5 rung — landing ONE gridline,
  // labelled 5, on an axis nobody can then read a value off. `count` being an
  // upper bound is right; one tick is not a legible axis.
  test('a rung that would leave a single gridline steps down', () => {
    expect(ticks({ min: 0.2, max: 9.8 }, 4)).toEqual([2, 4, 6, 8]);
  });

  test('every extent with a span gets at least two gridlines', () => {
    const spans: [number, number][] = [
      [0.2, 9.8],
      [1, 3],
      [93.5, 94.5],
      [0.9, 2.1],
      [17_500_000_000, 17_860_000_000],
      [-3, 4],
    ];
    for (const [min, max] of spans) {
      expect(ticks({ min, max }, 4).length).toBeGreaterThanOrEqual(2);
    }
  });

  // Stepping down must not undo the rung choice everywhere else: these already
  // produced enough gridlines and have to come out unchanged.
  test('and an extent that was already fine is untouched', () => {
    expect(ticks({ min: 0, max: 1000 }, 4)).toEqual([0, 500, 1000]);
    expect(ticks({ min: 0, max: 3 }, 4)).toEqual([0, 1, 2, 3]);
  });

  // A rank axis spanning 1st to 2nd. Half-steps gave gridlines 1, 1.5, 2, which a
  // whole-number formatter printed as "1", "2", "2" — and there is no rank of 1.5
  // to point at anyway.
  test('a whole-number axis gets no fractional gridlines', () => {
    expect(ticks({ min: 0.9, max: 2.1 }, 4, 1)).toEqual([1, 2]);
    expect(ticks({ min: 0.9, max: 2.1 }, 4)).toContain(1.5);
  });

  // The floor. An axis narrower than two whole numbers cannot have two whole
  // gridlines, and the step-down loop must stop rather than spin.
  test('and stops at one label when a whole number axis is that narrow', () => {
    expect(ticks({ min: 0.9, max: 1.1 }, 4, 1)).toEqual([1]);
    expect(ticks({ min: 1, max: 1 }, 4, 1)).toEqual([1]);
  });
});

describe('wholeNumbers', () => {
  const line = (values: (number | null)[]): Series => ({
    name: 'x',
    slot: 0,
    points: values.map((v, index) => ({ t: index, v })),
  });

  test('true when every reading is an integer', () => {
    expect(wholeNumbers([line([1, 2, 7])])).toBe(true);
  });

  test('false as soon as one is not', () => {
    expect(wholeNumbers([line([1, 2]), line([34.5])])).toBe(false);
  });

  // Gaps are the ordinary case — the boards are captured when somebody opens
  // them — and a missing reading says nothing about whether the figure is whole.
  test('nulls are skipped rather than disqualifying', () => {
    expect(wholeNumbers([line([1, null, 3])])).toBe(true);
  });

  // Not whole, because there is nothing to be whole. Claiming otherwise would
  // constrain an axis that has no data to constrain.
  test('nothing measured is not a whole-number axis', () => {
    expect(wholeNumbers([])).toBe(false);
    expect(wholeNumbers([line([null, null])])).toBe(false);
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
