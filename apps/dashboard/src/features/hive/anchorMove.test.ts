// Moving the anchor, typed or dragged.
//
// Every failure here was silent. A refetch after the move looked like somebody
// else's save and threw away the unsaved drawing — including a template loaded
// precisely so it could be positioned. The typed box read "51O" as 51. And the
// move button checked only that a 3x3 fitted at the anchor, so it offered moves
// that the database refused for a tile thirty squares away.

import { describe, expect, test } from 'vitest';
import {
  type DraftSlot,
  formationFitsAt,
  parseCoordinate,
  sameOccupancy,
  sameSavedShape,
} from './FormationEditor';
import { grabsAnchor, shiftedAt } from './TileGrid';
import type { BoardSlot } from './hiveFormations';

function draftSlot(dx: number, dy: number, over: Partial<DraftSlot> = {}): [string, DraftSlot] {
  return [
    `${dx},${dy}`,
    {
      dx,
      dy,
      spanX: 3,
      spanY: 3,
      kind: 'base',
      colour: null,
      ordinal: 1,
      label: '',
      slotId: `slot-${dx}-${dy}`,
      ...over,
    },
  ];
}

// Only the fields sameOccupancy reads; the rest of a board row is the view's.
function boardSlot(slotId: string, playerId: string | null, pinned = false): BoardSlot {
  return { slotId, playerId, pinned } as BoardSlot;
}

describe('a refetch after an anchor move keeps the draft', () => {
  test('the same saved tiles under the same ids are the same shape', () => {
    const before = new Map([draftSlot(0, 3), draftSlot(3, 0)]);
    const after = new Map([draftSlot(0, 3), draftSlot(3, 0)]);
    expect(sameSavedShape(before, after)).toBe(true);
  });

  test('a save, which reinserts every row under a new id, is not', () => {
    // Keeping the draft here would hold ids that no longer exist, and the
    // assignment half would put people on tiles the board has never heard of.
    const before = new Map([draftSlot(0, 3)]);
    const after = new Map([draftSlot(0, 3, { slotId: 'slot-new' })]);
    expect(sameSavedShape(before, after)).toBe(false);
  });

  test('somebody else redrawing the shape is not', () => {
    const before = new Map([draftSlot(0, 3)]);
    expect(sameSavedShape(before, new Map([draftSlot(0, 6)]))).toBe(false);
    expect(sameSavedShape(before, new Map([draftSlot(0, 3, { spanX: 4 })]))).toBe(false);
    expect(sameSavedShape(before, new Map())).toBe(false);
  });

  test('the same people on the same tiles is the same occupancy, in any order', () => {
    const before = [boardSlot('a', 'p1'), boardSlot('b', null)];
    expect(sameOccupancy(before, [boardSlot('b', null), boardSlot('a', 'p1')])).toBe(true);
  });

  test('a move, a pin or a new tile is not', () => {
    const before = [boardSlot('a', 'p1'), boardSlot('b', null)];
    expect(sameOccupancy(before, [boardSlot('a', null), boardSlot('b', 'p1')])).toBe(false);
    expect(sameOccupancy(before, [boardSlot('a', 'p1', true), boardSlot('b', null)])).toBe(false);
    expect(sameOccupancy(before, [boardSlot('a', 'p1'), boardSlot('c', null)])).toBe(false);
    expect(sameOccupancy(before, [boardSlot('a', 'p1')])).toBe(false);
  });
});

describe('an anchor is offered only where the whole formation fits', () => {
  const shape = [
    { dx: 0, dy: 0, spanX: 4, spanY: 3 },
    { dx: 30, dy: 0, spanX: 3, spanY: 3 },
  ];

  test('in the open, it fits', () => {
    expect(formationFitsAt({ x: 500, y: 500 }, shape)).toBe(true);
  });

  test('near the east edge the far wing runs off, though the anchor alone fits', () => {
    // 980 is fine for a 3x3 on the anchor — the old check — while the tile at
    // +30 would stand on 1010.
    expect(formationFitsAt({ x: 980, y: 500 }, shape)).toBe(false);
  });

  test('an empty drawing fits anywhere', () => {
    expect(formationFitsAt({ x: 0, y: 0 }, [])).toBe(true);
  });
});

describe('a typed coordinate', () => {
  test('whole numbers, spaces allowed round them', () => {
    expect(parseCoordinate('512', ' 388 ')).toEqual({ x: 512, y: 388 });
  });

  test('anything else is no coordinate at all', () => {
    // parseInt read each of these as a number and moved the formation there.
    expect(parseCoordinate('51O', '388')).toBeNull();
    expect(parseCoordinate('5 12', '388')).toBeNull();
    expect(parseCoordinate('512', '')).toBeNull();
    expect(parseCoordinate('-3', '388')).toBeNull();
    expect(parseCoordinate('51.5', '388')).toBeNull();
  });
});

describe('dragging the anchor', () => {
  const anchor = { x: 512, y: 388 };

  test('a press on its square with Frankie over it picks up the anchor', () => {
    expect(grabsAnchor(anchor, anchor, { structure: true })).toBe(true);
    expect(grabsAnchor(anchor, anchor, undefined)).toBe(true);
  });

  test('a person standing on it keeps their drag', () => {
    expect(grabsAnchor(anchor, anchor, { structure: false })).toBe(false);
    expect(grabsAnchor(anchor, anchor, {})).toBe(false);
  });

  test('anywhere else on Frankie is not the anchor', () => {
    expect(grabsAnchor({ x: 513, y: 388 }, anchor, { structure: true })).toBe(false);
  });

  test('every tile moves by exactly what the anchor did', () => {
    expect(shiftedAt({ x: 509, y: 391 }, anchor, { x: 600, y: 380 })).toEqual({ x: 597, y: 383 });
  });
});
