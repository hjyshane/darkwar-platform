import { describe, expect, it } from 'vitest';
import { type Box, areaPaths } from './series';

const box: Box = { width: 100, height: 100, padLeft: 0, padRight: 0, padTop: 0, padBottom: 0 };
const x = { min: 0, max: 10 };
const y = { min: 0, max: 10 };

describe('areaPaths', () => {
  it('closes one run down to the base of the plot', () => {
    const [d] = areaPaths(
      [
        { t: 0, v: 0 },
        { t: 10, v: 10 },
      ],
      x,
      y,
      box,
    );
    expect(d).toBe('M0.00 100.00 L100.00 0.00 L100.00 100.00 L0.00 100.00 Z');
  });
  it('breaks at a gap instead of bridging it', () => {
    const paths = areaPaths(
      [
        { t: 0, v: 1 },
        { t: 2, v: 2 },
        { t: 4, v: null },
        { t: 6, v: 3 },
        { t: 8, v: 4 },
      ],
      x,
      y,
      box,
    );
    expect(paths).toHaveLength(2);
  });
  it('draws nothing for a lone reading', () => {
    expect(
      areaPaths(
        [
          { t: 0, v: 1 },
          { t: 2, v: null },
          { t: 4, v: 3 },
        ],
        x,
        y,
        box,
      ),
    ).toEqual([]);
  });
});
