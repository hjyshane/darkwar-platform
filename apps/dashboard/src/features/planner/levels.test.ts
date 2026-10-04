import { describe, expect, it } from 'vitest';
import { levelLabel, levelText, tiersFrom } from './levels';

const TIERS = tiersFrom([
  { subject_id: '400000', level: 35, tier: 1 },
  { subject_id: '400000', level: 39, tier: 1 },
  { subject_id: '400000', level: 80, tier: 10 },
]);

describe('levelLabel', () => {
  it('shows a tiered level as its tier, with the level beside it', () => {
    expect(levelLabel(TIERS, '400000', 35)).toEqual({ main: 'i1', sub: '35' });
    expect(levelText(TIERS, '400000', 80)).toBe('i10 · 80');
  });

  it('leaves untiered levels and buildings as numbers', () => {
    expect(levelText(TIERS, '400000', 34)).toBe('34');
    expect(levelText(TIERS, '402000', 35)).toBe('35');
  });
});
