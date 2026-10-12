import { describe, expect, it } from 'vitest';
import { compactNumber } from './compactNumber';

describe('compactNumber', () => {
  it('writes a billion as G, as the game does', () => {
    const f = compactNumber(2);
    expect(f.format(1_000_000_000)).toBe('1G');
    expect(f.format(999_000_000)).toBe('999M');
    expect(f.format(17_400_000_000)).toBe('17.4G');
    expect(f.format(2_000_000_000_000)).toBe('2T');
    expect(f.format(1_500)).toBe('1.5K');
  });
});
