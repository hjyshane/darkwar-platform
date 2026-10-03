import { describe, expect, it } from 'vitest';
import { type PackItem, byValue, dollarsOf, estimatedShare, isLive, ratioLabel } from './data';

const NOW = new Date('2026-10-03T12:00:00Z');

function item(
  id: string,
  qty: number,
  rubies: number | null,
  source: PackItem['source'],
): PackItem {
  return { id, qty, name: null, name_ko: null, rubies, source };
}

describe('isLive', () => {
  it('is on sale between its start and its end', () => {
    expect(
      isLive({ starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-10-05T00:00:00Z' }, NOW),
    ).toBe(true);
    expect(isLive({ starts_at: '2026-10-04T00:00:00Z', ends_at: null }, NOW)).toBe(false);
    expect(isLive({ starts_at: null, ends_at: '2026-10-02T00:00:00Z' }, NOW)).toBe(false);
  });

  it('treats a missing end as open', () => {
    expect(isLive({ starts_at: '2026-01-01T00:00:00Z', ends_at: null }, NOW)).toBe(true);
  });
});

describe('value', () => {
  it('puts the best value first and free packs last', () => {
    const out = byValue([
      { id: 'a', value_ratio: 2 },
      { id: 'free', value_ratio: null },
      { id: 'b', value_ratio: 9.5 },
    ]);
    expect(out.map((row) => row.id)).toEqual(['b', 'a', 'free']);
  });

  it('prices rubies at $0.0099', () => {
    expect(dollarsOf(100)).toBe(0.99);
    expect(dollarsOf(1500)).toBe(14.85);
  });

  it('labels a ratio and its absence', () => {
    expect(ratioLabel(3.04)).toBe('×3.0');
    expect(ratioLabel(null)).toBe('—');
  });

  it('says how much of a pack rests on estimates', () => {
    // 500 rubies + 10 x 100 (game) + 5 x 100 (estimated) = 2,000; 500 estimated.
    const share = estimatedShare({
      rubies: 500,
      contents: [
        item('1', 10, 100, 'game'),
        item('2', 5, 100, 'estimated'),
        item('3', 9, null, null),
      ],
    });
    expect(share).toBe(0.25);
  });
});
