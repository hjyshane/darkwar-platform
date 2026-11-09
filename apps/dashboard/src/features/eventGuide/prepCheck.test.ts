import { describe, expect, it } from 'vitest';
import { derivePrep } from './prepCheck';
import { HALLOWEEN_PREP } from './sections/fixtures';

const stock = {
  items: { '253042': 412, '300101': 50 },
  resources: { '25': 95_400 },
};

describe('derivePrep', () => {
  const lines = derivePrep(HALLOWEEN_PREP, stock);

  it('412 shards held at 750 a shard, cap 412 → 309,000 points on day 2', () => {
    expect(lines[0]).toMatchObject({ held: 412, counted: 412, points: 309_000, shots: null });
    expect(lines[0]?.item.day).toBe(2);
  });

  it('wood counts in units of 1,000: 95,400 held is 95 units', () => {
    expect(lines[1]).toMatchObject({ held: 95_400, counted: 95, points: 950 });
  });

  it('ammo yields shots, not points', () => {
    expect(lines[2]).toMatchObject({ held: 50, counted: 50, points: null, shots: 50 });
  });

  it('a cap smaller than the stock clamps what counts', () => {
    const [line] = derivePrep(HALLOWEEN_PREP, { items: { '253042': 500 }, resources: {} });
    expect(line).toMatchObject({ held: 500, counted: 412, points: 309_000 });
  });

  it('stock that lacks the item is unknown, not zero', () => {
    const [line] = derivePrep(HALLOWEEN_PREP, { items: {}, resources: {} });
    expect(line).toMatchObject({ held: null, counted: null, points: null, shots: null });
  });

  it('no stock at all (no linked account) leaves every line unknown', () => {
    for (const line of derivePrep(HALLOWEEN_PREP, null)) {
      expect(line.held).toBeNull();
      expect(line.points).toBeNull();
    }
  });

  it('a hero ref has no stock to count', () => {
    const [line] = derivePrep(
      { items: [{ item_ref: { kind: 'hero', id: '7' }, unit: 1, per_unit_points: 10 }] },
      stock,
    );
    expect(line?.held).toBeNull();
  });
});
