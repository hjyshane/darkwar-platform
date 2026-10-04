import { describe, expect, it } from 'vitest';
import { short } from './format';

describe('short', () => {
  it('writes big numbers the way the game does', () => {
    expect(short(7162671974)).toBe('7.16B');
    expect(short(240000000)).toBe('240M');
    expect(short(96000000)).toBe('96M');
    expect(short(12500)).toBe('12.5K');
    expect(short(2586)).toBe('2.59K');
    expect(short(999)).toBe('999');
    expect(short(1.5e12)).toBe('1.5T');
  });
});
