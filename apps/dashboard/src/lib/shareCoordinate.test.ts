import { describe, expect, it } from 'vitest';
import { shareCoordinate } from './shareCoordinate';

describe('shareCoordinate', () => {
  it('writes the game share form with the server in front', () => {
    expect(shareCoordinate(580, { x: 512, y: 300 })).toBe('#580[X:512 Y:300]');
  });

  it('passes small and edge coordinates through unchanged', () => {
    expect(shareCoordinate(577, { x: 7, y: 0 })).toBe('#577[X:7 Y:0]');
    expect(shareCoordinate(584, { x: 999, y: 999 })).toBe('#584[X:999 Y:999]');
  });
});
