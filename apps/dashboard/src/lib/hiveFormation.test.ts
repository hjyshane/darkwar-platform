import { expect, test } from 'vitest';
import {
  type AssignableMember,
  type AssignableSlot,
  BASE_SPAN,
  CENTRE_MAX,
  CENTRE_MIN,
  CENTRE_SPAN,
  autoAssign,
  basesOverlap,
  blockOffsets,
  canPlace,
  centreFitsOnMap,
  centreFootprint,
  coversTile,
  firstOverlap,
  footprintOf,
  overlapsCentre,
  ringOf,
  ringOffsets,
  ringOrder,
  sortMembers,
} from './hiveFormation';

test('a base covers the eight tiles around its centre', () => {
  expect(footprintOf({ x: 500, y: 500 })).toEqual({ x0: 499, x1: 501, y0: 499, y1: 501 });
});

test('two centres one tile apart are the same ground', () => {
  // The mistake the whole feature exists to prevent. Told 500,500 and
  // 501,500, two members cannot both land — and the second one finds out in
  // game rather than here.
  expect(basesOverlap({ x: 500, y: 500 }, { x: 501, y: 500 })).toBe(true);
});

test('three tiles apart is a packed neighbour, not an overlap', () => {
  expect(basesOverlap({ x: 500, y: 500 }, { x: 503, y: 500 })).toBe(false);
  expect(BASE_SPAN).toBe(3);
});

test('closeness on one axis alone is not an overlap', () => {
  // Two apart on x, three apart on y. Refusing this would scatter a hive for
  // no reason: the y separation already keeps the footprints clear.
  expect(basesOverlap({ x: 500, y: 500 }, { x: 502, y: 503 })).toBe(false);
  expect(basesOverlap({ x: 500, y: 500 }, { x: 502, y: 502 })).toBe(true);
});

test('a base needs room for its footprint, so the edge tiles are not centres', () => {
  expect(CENTRE_MIN).toBe(1);
  expect(CENTRE_MAX).toBe(998);
  expect(centreFitsOnMap({ x: 0, y: 500 })).toBe(false);
  expect(centreFitsOnMap({ x: 999, y: 500 })).toBe(false);
  expect(centreFitsOnMap({ x: 1, y: 998 })).toBe(true);
  expect(centreFitsOnMap({ x: 500.5, y: 500 })).toBe(false);
});

test('a tile is under a base if it is within one of the centre', () => {
  expect(coversTile({ x: 500, y: 500 }, { x: 501, y: 499 })).toBe(true);
  expect(coversTile({ x: 500, y: 500 }, { x: 502, y: 500 })).toBe(false);
});

test('a block is packed on a three-tile pitch and centred on the anchor', () => {
  const offsets = blockOffsets(3, 3);

  expect(offsets).toHaveLength(9);
  expect(offsets).toContainEqual({ dx: 0, dy: 0 });
  expect(offsets).toContainEqual({ dx: -3, dy: 3 });
  expect(offsets).toContainEqual({ dx: 3, dy: -3 });
  // The property that matters more than any particular offset: a generated
  // block must never contain a pair that shares ground.
  expect(firstOverlap(offsets)).toBeNull();
});

test('a block big enough for a real hive still has no overlap in it', () => {
  // Eighty-one bases is the size this is actually used at, and a pitch that
  // was wrong by one would only show up somewhere in the middle of it.
  expect(firstOverlap(blockOffsets(9, 9))).toBeNull();
  expect(blockOffsets(9, 9)).toHaveLength(81);
});

test('a ring is a block with the middle left clear', () => {
  const ring = ringOffsets(3, 3);

  expect(ring).toHaveLength(8);
  expect(ring).not.toContainEqual({ dx: 0, dy: 0 });
  expect(firstOverlap(ring)).toBeNull();
});

test('a ring too small to be hollow falls back to a block', () => {
  expect(ringOffsets(2, 2)).toEqual(blockOffsets(2, 2));
});

test('firstOverlap names the pair rather than answering yes', () => {
  // The editor has to be able to point at something. "This layout is
  // invalid" sends an officer hunting through eighty tiles.
  const clash = firstOverlap([
    { dx: 0, dy: 0 },
    { dx: 6, dy: 0 },
    { dx: 5, dy: 1 },
  ]);

  expect(clash).toEqual([
    { dx: 6, dy: 0 },
    { dx: 5, dy: 1 },
  ]);
});

test('canPlace refuses a tile that would touch an existing base', () => {
  const drawn = [{ dx: 0, dy: 0 }];

  expect(canPlace(drawn, { dx: 2, dy: 2 })).toBe(false);
  expect(canPlace(drawn, { dx: 3, dy: 0 })).toBe(true);
});

const SLOTS: AssignableSlot[] = [
  { slotId: 'a', ordinal: 1, dx: 0, dy: 0 },
  { slotId: 'b', ordinal: 2, dx: 3, dy: 0 },
  { slotId: 'c', ordinal: 3, dx: 6, dy: 0 },
];

const MEMBERS: AssignableMember[] = [
  { playerId: 'p-weak', name: 'Weak', power: 10, hqLevel: 20, memberRank: 1 },
  { playerId: 'p-strong', name: 'Strong', power: 90, hqLevel: 30, memberRank: 3 },
  { playerId: 'p-mid', name: 'Mid', power: 50, hqLevel: 25, memberRank: 5 },
];

test('auto-assignment fills the numbered slots strongest first', () => {
  const result = autoAssign(SLOTS, MEMBERS, { order: 'power' });

  expect(result.assignments.get('a')).toBe('p-strong');
  expect(result.assignments.get('b')).toBe('p-mid');
  expect(result.assignments.get('c')).toBe('p-weak');
  expect(result.unplaced).toEqual([]);
  expect(result.empty).toEqual([]);
});

test('alliance rank orders R5 first, which is not the power order', () => {
  const result = autoAssign(SLOTS, MEMBERS, { order: 'rank' });

  expect(result.assignments.get('a')).toBe('p-mid');
});

test('a missing figure sorts last rather than first', () => {
  // A member the collector has not read yet has no power. Sorting null high
  // would hand the front line to whoever we know least about.
  const withGap: AssignableMember[] = [
    { playerId: 'p-unknown', name: 'Unread', power: null, hqLevel: null, memberRank: null },
    ...MEMBERS,
  ];

  expect(sortMembers(withGap, 'power').at(-1)?.playerId).toBe('p-unknown');
  expect(sortMembers(withGap, 'hq').at(-1)?.playerId).toBe('p-unknown');
});

test('equal members keep a stable order so two runs can be compared', () => {
  const tied: AssignableMember[] = [
    { playerId: 'p-2', name: 'Bravo', power: 50, hqLevel: 25, memberRank: 2 },
    { playerId: 'p-1', name: 'Alpha', power: 50, hqLevel: 25, memberRank: 2 },
  ];

  expect(sortMembers(tied, 'power').map((m) => m.playerId)).toEqual(['p-1', 'p-2']);
});

test('more members than tiles reports who is left standing', () => {
  const result = autoAssign(SLOTS.slice(0, 2), MEMBERS, { order: 'power' });

  expect(result.unplaced.map((m) => m.playerId)).toEqual(['p-weak']);
});

test('more tiles than members reports the empty ground', () => {
  const result = autoAssign(SLOTS, MEMBERS.slice(0, 1), { order: 'power' });

  expect(result.empty.map((s) => s.slotId)).toEqual(['b', 'c']);
});

test('a pinned member keeps their tile and leaves the pool', () => {
  // Manual and automatic are the same act: pin the four whose position
  // matters, let the rest fall in around them.
  const result = autoAssign(SLOTS, MEMBERS, {
    order: 'power',
    pinned: new Map([['c', 'p-strong']]),
  });

  expect(result.assignments.get('c')).toBe('p-strong');
  expect(result.assignments.get('a')).toBe('p-mid');
  expect(result.assignments.get('b')).toBe('p-weak');
});

test('a pin for somebody who has left the roster is dropped', () => {
  const result = autoAssign(SLOTS, MEMBERS, {
    order: 'power',
    pinned: new Map([['a', 'p-departed']]),
  });

  expect(result.assignments.get('a')).toBe('p-strong');
  expect([...result.assignments.values()]).not.toContain('p-departed');
});

test('the same member pinned twice is placed once, not saved twice', () => {
  // The save would be refused outright by the one-tile-per-member index, so
  // the second pin has to lose here rather than at the database.
  const result = autoAssign(SLOTS, MEMBERS, {
    order: 'power',
    pinned: new Map([
      ['a', 'p-strong'],
      ['b', 'p-strong'],
    ]),
  });

  const placed = [...result.assignments.values()];

  expect(placed.filter((id) => id === 'p-strong')).toHaveLength(1);
  expect(new Set(placed).size).toBe(placed.length);
});

test('Frankie is four tiles east-west and three north-south', () => {
  // Not 3x3. The centre of the hive is a different structure to a member's
  // base, and the difference is a whole column.
  expect(CENTRE_SPAN).toEqual({ x: 4, y: 3 });

  const box = centreFootprint({ x: 500, y: 500 });

  expect(box.x1 - box.x0 + 1).toBe(4);
  expect(box.y1 - box.y0 + 1).toBe(3);
});

test('a base on the anchor stands on Frankie', () => {
  expect(overlapsCentre({ dx: 0, dy: 0 })).toBe(true);
});

test('the reserved ground is wider to the east than a 3x3 centre would be', () => {
  // The asymmetry IS the point: four is even, so the anchor is not in the
  // middle of it, and a formation drawn for a 3x3 centre leaves one of these
  // columns occupied.
  expect(overlapsCentre({ dx: 3, dy: 0 })).toBe(true);
  expect(overlapsCentre({ dx: -3, dy: 0 })).toBe(false);
  expect(overlapsCentre({ dx: 4, dy: 0 })).toBe(false);
});

test('clear of Frankie on either axis is clear', () => {
  expect(overlapsCentre({ dx: 0, dy: 3 })).toBe(false);
  expect(overlapsCentre({ dx: 0, dy: -3 })).toBe(false);
  expect(overlapsCentre({ dx: 0, dy: 2 })).toBe(true);
});

test('a packed block still has bases that would stand on Frankie', () => {
  // Which is why the editor filters the generated shape rather than trusting
  // it: a 5x5 block centred on the anchor puts its middle base right on top.
  const clashing = blockOffsets(5, 5).filter(overlapsCentre);

  expect(clashing.length).toBeGreaterThan(0);
  expect(clashing).toContainEqual({ dx: 0, dy: 0 });
});

test('a ring is a ring of bases, counted out from Frankie', () => {
  // Packed against the footprint is ring 1; the row behind it is ring 2.
  expect(ringOf({ dx: 4, dy: 0 })).toBe(1);
  expect(ringOf({ dx: 7, dy: 0 })).toBe(2);
  expect(ringOf({ dx: 0, dy: 3 })).toBe(1);
  expect(ringOf({ dx: 0, dy: 6 })).toBe(2);
});

test('the ring is measured from the footprint, not from the anchor', () => {
  // Frankie is four wide and the anchor is not its middle, so east and west
  // are NOT symmetric about the anchor — and the ring must follow the
  // structure rather than the printed coordinate.
  expect(ringOf({ dx: 4, dy: 0 })).toBe(ringOf({ dx: -3, dy: 0 }));
});

test('filling runs innermost ring first', () => {
  const outer = { dx: 0, dy: 6 };
  const inner = { dx: 0, dy: 3 };

  expect(ringOrder(inner, outer)).toBeLessThan(0);
});

test('auto-assignment gives the inner ring to the strongest', () => {
  // The whole reason the order matters: whoever is handed a tile first is
  // standing against Frankie.
  const slots: AssignableSlot[] = [
    { slotId: 'outer', ordinal: 0, dx: 0, dy: 6 },
    { slotId: 'inner', ordinal: 0, dx: 0, dy: 3 },
  ];
  const result = autoAssign(slots, MEMBERS, { order: 'power' });

  expect(result.assignments.get('inner')).toBe('p-strong');
  expect(result.assignments.get('outer')).toBe('p-mid');
});
