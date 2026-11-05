import { describe, expect, it } from 'vitest';
import { gapsToAbove, inBoardOrder } from './gap';

describe('gapsToAbove', () => {
  it('is the distance to the row above, none for the first', () => {
    expect(gapsToAbove([{ value: 100 }, { value: 90 }, { value: 90 }, { value: 40 }])).toEqual([
      null,
      10,
      0,
      50,
    ]);
  });
  it('is unknown where a figure is unknown, never zero', () => {
    expect(gapsToAbove([{ value: 100 }, { value: null }, { value: 5 }])).toEqual([
      null,
      null,
      null,
    ]);
  });
});

describe('inBoardOrder', () => {
  it('holds for rank ascending and value descending', () => {
    expect(inBoardOrder([{ key: 'rank', direction: 'asc' }], '')).toBe(true);
    expect(inBoardOrder([{ key: 'value', direction: 'desc' }], '')).toBe(true);
  });
  it('fails for another order or any search', () => {
    expect(inBoardOrder([{ key: 'name', direction: 'asc' }], '')).toBe(false);
    expect(inBoardOrder([{ key: 'value', direction: 'asc' }], '')).toBe(false);
    expect(inBoardOrder([{ key: 'rank', direction: 'asc' }], 'ab')).toBe(false);
  });
});
