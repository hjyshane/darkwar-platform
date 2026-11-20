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
  reanchoredDraft,
  sameOccupancy,
  sameSavedShape,
  tileUnderPointer,
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

  test('a press on its square picks up the anchor, whatever is drawn over it', () => {
    // Frankie, somebody's base or nothing at all: the anchor is drawn on top
    // and its one square is always the anchor's.
    expect(grabsAnchor(anchor, anchor)).toBe(true);
  });

  test('the square beside it is not the anchor', () => {
    // A base standing on the anchor is still carried from its other squares.
    expect(grabsAnchor({ x: 513, y: 388 }, anchor)).toBe(false);
    expect(grabsAnchor({ x: 512, y: 387 }, anchor)).toBe(false);
  });

  test('every tile moves by exactly what the anchor did', () => {
    expect(shiftedAt({ x: 509, y: 391 }, anchor, { x: 600, y: 380 })).toEqual({ x: 597, y: 383 });
  });
});

describe('setting the anchor somewhere else (0339)', () => {
  const from = { x: 500, y: 500 };

  test('every tile stays where it stood; only its offset changes', () => {
    const draft = new Map([draftSlot(0, 0), draftSlot(3, 0), draftSlot(0, -3)]);
    const to = { x: 503, y: 500 };
    const moved = reanchoredDraft(draft, from, to);
    const ground = (map: Map<string, DraftSlot>, anchor: { x: number; y: number }) =>
      [...map.values()].map((slot) => `${anchor.x + slot.dx},${anchor.y + slot.dy}`).sort();
    expect(ground(moved, to)).toEqual(ground(draft, from));
    expect([...moved.keys()].sort()).toEqual(['-3,-3', '-3,0', '0,0']);
  });

  test('each tile keeps its slot, so whoever stands on it stays on it', () => {
    const draft = new Map([draftSlot(3, 0, { slotId: 'kept' })]);
    expect(reanchoredDraft(draft, from, { x: 503, y: 500 }).get('0,0')?.slotId).toBe('kept');
  });

  test('a click anywhere on a base or structure finds it, and only on it', () => {
    const [, base] = draftSlot(3, 0);
    const [, frankie] = draftSlot(0, -3, { spanX: 4, spanY: 3, kind: 'structure' });
    const drawn = [base, frankie];
    // The base centred on 503,500 covers 502..504; Frankie, 4 wide, 499..502.
    expect(tileUnderPointer(drawn, from, { x: 504, y: 501 })).toBe(base);
    expect(tileUnderPointer(drawn, from, { x: 499, y: 497 })).toBe(frankie);
    expect(tileUnderPointer(drawn, from, { x: 510, y: 510 })).toBeUndefined();
  });
});
