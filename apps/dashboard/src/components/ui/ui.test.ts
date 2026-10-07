import { describe, expect, it } from 'vitest';
import { barRatio } from './BarCell';
import { sparklinePaths } from './Sparkline';

describe('barRatio', () => {
  it('scales to the max and clamps', () => {
    expect(barRatio(50, 100)).toBe(0.5);
    expect(barRatio(150, 100)).toBe(1);
  });
  it('draws nothing for unknown, zero, negative or an empty column', () => {
    expect(barRatio(null, 100)).toBe(0);
    expect(barRatio(0, 100)).toBe(0);
    expect(barRatio(-5, 100)).toBe(0);
    expect(barRatio(5, 0)).toBe(0);
    expect(barRatio(Number.NaN, 100)).toBe(0);
  });
});

describe('sparklinePaths', () => {
  it('needs two observed points', () => {
    expect(sparklinePaths([], 100, 24)).toEqual([]);
    expect(sparklinePaths([1], 100, 24)).toEqual([]);
    expect(sparklinePaths([null, 3, null], 100, 24)).toEqual([]);
  });
  it('draws one path for a continuous series', () => {
    expect(sparklinePaths([1, 2, 3], 100, 24)).toHaveLength(1);
  });
  it('breaks the line at a gap instead of bridging it', () => {
    expect(sparklinePaths([1, 2, null, 3, 4], 100, 24)).toHaveLength(2);
  });
  it('handles a flat series without dividing by zero', () => {
    const [d] = sparklinePaths([5, 5, 5], 100, 24);
    expect(d).not.toContain('NaN');
  });
});
