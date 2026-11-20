import { describe, expect, it } from 'vitest';
import {
  type Structure,
  TRADE_SHOP,
  coordinateList,
  openSlots,
  packedExtra,
  refusal,
  ringFor,
  squareAt,
  validSide,
} from './placement';

const shop: Structure = { id: 's', name: 'Trade Shop', x: 377, y: 436, ...TRADE_SHOP };

describe('squares', () => {
  it('centres an odd side on its cell', () => {
    expect(squareAt({ x: 377, y: 436 }, 5)).toEqual({ x0: 375, y0: 434, x1: 379, y1: 438 });
    expect(squareAt({ x: 377, y: 436 }, 17)).toEqual({ x0: 369, y0: 428, x1: 385, y1: 444 });
  });
  it('accepts only odd sides', () => {
    expect([1, 3, 17].map(validSide)).toEqual([true, true, true]);
    expect([0, 2, 26, -3, 2.5].map(validSide)).toEqual([false, false, false, false, false]);
  });
});

describe('refusal', () => {
  it('lets a base stand inside the territory, outside the footprint', () => {
    expect(refusal({ x: 372, y: 436 }, [], [shop])).toBeNull();
  });
  it('refuses a base on the footprint, however little it touches', () => {
    expect(refusal({ x: 373, y: 436 }, [], [shop])).toBeNull(); // 372..374 against 375..379: clear
    expect(refusal({ x: 374, y: 436 }, [], [shop])).toBe('overlaps-structure'); // 373..375 touches 375
  });
  it('refuses two bases sharing a tile, allows them edge to edge', () => {
    const placed = [{ x: 370, y: 430 }];
    expect(refusal({ x: 372, y: 430 }, placed, [shop])).toBe('overlaps-base');
    expect(refusal({ x: 373, y: 430 }, placed, [shop])).toBeNull();
  });
  it('lets structures overlap each other: only bases are checked against each other', () => {
    const second: Structure = { ...shop, id: 't', x: 380, y: 436 };
    // Nothing in `refusal` looks at structure-versus-structure.
    expect(refusal({ x: 360, y: 400 }, [], [shop, second])).toBeNull();
  });
});

describe('sealing the Trade Shop', () => {
  it('has room for many bases when nothing is placed', () => {
    expect(openSlots([], [shop]).length).toBeGreaterThan(100);
    expect(packedExtra([], [shop])).toBeGreaterThan(20);
  });
  it('is sealed by the eight-base ring: no open slot, none to add', () => {
    const ring = ringFor(shop);
    expect(ring).not.toBeNull();
    const bases = ring ?? [];
    expect(bases).toHaveLength(8);
    // Every ring base is itself legal against the others and the building.
    for (const [i, base] of bases.entries()) {
      const others = bases.filter((_, j) => j !== i);
      expect(refusal(base, others, [shop])).toBeNull();
    }
    expect(openSlots(bases, [shop])).toEqual([]);
    expect(packedExtra(bases, [shop])).toBe(0);
  });
  it('is not sealed by seven of the eight', () => {
    const ring = ringFor(shop) ?? [];
    expect(openSlots(ring.slice(1), [shop]).length).toBeGreaterThan(0);
  });
  it('has no ring for a shape nobody searched', () => {
    expect(ringFor({ ...shop, area: 15 })).toBeNull();
    expect(ringFor({ ...shop, area: null })).toBeNull();
  });
  it('moves the ring with the building', () => {
    const moved = { ...shop, x: 100, y: 200 };
    expect(openSlots(ringFor(moved) ?? [], [moved])).toEqual([]);
  });
});

describe('a structure with no territory', () => {
  it('has nothing to seal', () => {
    expect(openSlots([], [{ ...shop, area: null }])).toEqual([]);
  });
});

describe('overlapping territories', () => {
  it('lists a slot once even when two areas hold it', () => {
    const second: Structure = { ...shop, id: 't', x: 380, y: 436 };
    const slots = openSlots([], [shop, second]);
    const keys = slots.map((c) => `${c.x},${c.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('coordinateList', () => {
  it('sorts top to bottom, left to right', () => {
    expect(
      coordinateList([
        { x: 5, y: 2 },
        { x: 3, y: 2 },
        { x: 9, y: 1 },
      ]),
    ).toBe('9,1\n3,2\n5,2');
  });
});
