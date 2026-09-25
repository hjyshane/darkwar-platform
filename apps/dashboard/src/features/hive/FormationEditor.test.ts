// Loading a saved shape back into the editor.
//
// The two things that can go wrong here are silent. A template that came back
// carrying members would put last month's roster on this month's ground and
// look correct; a shape loaded onto an anchor near the map's edge would be
// drawn, look fine, and be refused only at the moment the officer pressed
// save — by a message naming one tile out of thirty.

import { describe, expect, test } from 'vitest';
import {
  type DraftSlot,
  draftFromTiles,
  dropTarget,
  paintedTiles,
  placementsOf,
  survivingPins,
  tilesOffMap,
} from './FormationEditor';
import type { LayoutTile } from './hiveFormations';

function tile(over: Partial<LayoutTile> = {}): LayoutTile {
  return {
    dx: 0,
    dy: 0,
    ordinal: 1,
    label: '',
    span_x: 3,
    span_y: 3,
    kind: 'base',
    colour: null,
    ...over,
  };
}

describe('draftFromTiles', () => {
  test('every tile of a saved shape lands empty', () => {
    const draft = draftFromTiles([
      tile({ dx: 0, dy: 0 }),
      tile({ dx: 3, dy: 0, kind: 'structure', colour: 'amber' }),
    ]);
    expect(draft.size).toBe(2);
    // No slot behind any of them, so there is nobody for them to carry.
    expect([...draft.values()].every((slot) => slot.slotId === null)).toBe(true);
  });

  test('the size, kind, colour and caption come back with it', () => {
    const draft = draftFromTiles([
      tile({
        dx: -4,
        dy: 2,
        span_x: 6,
        span_y: 4,
        kind: 'structure',
        colour: 'teal',
        label: 'Depot',
      }),
    ]);
    const slot = [...draft.values()][0];
    expect(slot).toMatchObject({
      dx: -4,
      dy: 2,
      spanX: 6,
      spanY: 4,
      kind: 'structure',
      colour: 'teal',
      label: 'Depot',
    });
  });

  test('two tiles at one offset collapse rather than both being drawn', () => {
    // The database cannot store this — the exclusion constraint refuses it —
    // so a draft that held both would be a shape that could never be saved.
    const draft = draftFromTiles([tile({ dx: 1, dy: 1 }), tile({ dx: 1, dy: 1, label: 'second' })]);
    expect(draft.size).toBe(1);
  });
});

describe('tilesOffMap', () => {
  const shape = [tile({ dx: 0, dy: 0 }), tile({ dx: -4, dy: 0 }), tile({ dx: 4, dy: 0 })];

  test('nothing hangs off the edge in the middle of the map', () => {
    expect(tilesOffMap({ x: 500, y: 500 }, shape)).toBe(0);
  });

  test('the same shape on a corner counts what would be refused', () => {
    // A 3x3 centred on 1,1 covers 0..2 and fits; the one four tiles west of
    // it is centred on -3 and does not exist at all.
    expect(tilesOffMap({ x: 1, y: 1 }, shape)).toBe(1);
  });

  test('a bigger tile runs out of map sooner than a small one', () => {
    // The east edge: a 1x1 on 999 is on the map, a 4-wide one needs 999..1002.
    expect(tilesOffMap({ x: 999, y: 500 }, [tile({ span_x: 1, span_y: 1 })])).toBe(0);
    expect(tilesOffMap({ x: 999, y: 500 }, [tile({ span_x: 4, span_y: 3 })])).toBe(1);
  });
});

// Pins across a save.

const slot = (slotId: string, playerId: string | null) => ({ slotId, playerId });

describe('survivingPins', () => {
  test('a pin on an unchanged tile survives the re-read', () => {
    // The bug: every save re-reads the board, and every pin was dropped at
    // that moment — so pinning twenty people and pressing Save lost all twenty.
    const kept = survivingPins(new Map([['a', 'shane']]), [slot('a', 'shane')]);

    expect([...kept]).toEqual([['a', 'shane']]);
  });

  test('a pin on a tile that no longer exists is dropped', () => {
    // A moved tile is deleted and reinserted under a new id, so its pin has
    // nothing to point at.
    expect(survivingPins(new Map([['gone', 'shane']]), [slot('a', 'shane')]).size).toBe(0);
  });

  test('a pin is dropped when somebody else is standing there now', () => {
    // The pin named a placement, not a tile. Keeping it would hold the tile
    // for a person who is no longer on it.
    expect(survivingPins(new Map([['a', 'shane']]), [slot('a', 'mira')]).size).toBe(0);
  });

  test('a pin is dropped when the tile has been emptied', () => {
    expect(survivingPins(new Map([['a', 'shane']]), [slot('a', null)]).size).toBe(0);
  });

  test('the surviving pins are the intersection, not all or nothing', () => {
    const kept = survivingPins(
      new Map([
        ['a', 'shane'],
        ['b', 'mira'],
        ['c', 'kova'],
      ]),
      [slot('a', 'shane'), slot('b', 'dex'), slot('c', 'kova')],
    );

    expect([...kept.keys()].sort()).toEqual(['a', 'c']);
  });
});

// Who stands where once a draft is written out.

describe('placementsOf', () => {
  test('a dragged base keeps a member handed to it since the last save', () => {
    // The bug: the draft carried the SAVED occupant, so a member put on a tile
    // by Fill or the dropdown was not on it. Dragging the base left a bare
    // number at the new spot, and saving put nobody there.
    const moved = [{ dx: 6, dy: 0, slotId: 'a' }];
    const placed = placementsOf(moved, new Map([['a', 'shane']]), new Map());

    expect([...placed]).toEqual([['6,0', { playerId: 'shane', pinned: false }]]);
  });

  test('the pin moves with the member', () => {
    const moved = [{ dx: 6, dy: 0, slotId: 'a' }];
    const placed = placementsOf(moved, new Map([['a', 'shane']]), new Map([['a', 'shane']]));

    expect(placed.get('6,0')).toEqual({ playerId: 'shane', pinned: true });
  });

  test('two bases swapped keep their own people', () => {
    // Keyed by position this is exactly the case that goes wrong: each tile
    // now stands where the other's slot used to be.
    const swapped = [
      { dx: 3, dy: 0, slotId: 'a' },
      { dx: 0, dy: 0, slotId: 'b' },
    ];
    const placed = placementsOf(
      swapped,
      new Map([
        ['a', 'shane'],
        ['b', 'mira'],
      ]),
      new Map(),
    );

    expect(placed.get('3,0')?.playerId).toBe('shane');
    expect(placed.get('0,0')?.playerId).toBe('mira');
  });

  test('a tile drawn since the last save has nobody on it', () => {
    expect(placementsOf([{ dx: 0, dy: 0, slotId: null }], new Map(), new Map()).size).toBe(0);
  });

  test('a stale pin for somebody who has since been moved off is not carried', () => {
    const placed = placementsOf(
      [{ dx: 0, dy: 0, slotId: 'a' }],
      new Map([['a', 'mira']]),
      new Map([['a', 'shane']]),
    );

    expect(placed.get('0,0')).toEqual({ playerId: 'mira', pinned: false });
  });
});

// Dropping a member from the list onto the map.

function drafted(over: Partial<DraftSlot> = {}): DraftSlot {
  return {
    dx: 0,
    dy: 0,
    spanX: 3,
    spanY: 3,
    ordinal: 1,
    label: '',
    kind: 'base',
    colour: null,
    slotId: 'a',
    ...over,
  };
}

describe('paintedTiles', () => {
  const draft = new Map([
    ['0,0', drafted({ slotId: 'a', colour: null })],
    ['3,0', drafted({ dx: 3, slotId: 'b', colour: 'amber' })],
    ['6,0', drafted({ dx: 6, slotId: 'c', colour: null })],
  ]);

  test('a selected tile keeps its identity and changes only its colour', () => {
    // THE POINT OF THE WHOLE FEATURE. Recolouring used to mean deleting the
    // base and drawing a new one, which loses the slot id — and with it the
    // member on that tile and their pin.
    const painted = paintedTiles(draft, new Set(['0,0']), 'red');
    const tile = painted.get('0,0');

    expect(tile?.colour).toBe('red');
    expect(tile?.slotId).toBe('a');
    expect(tile?.dx).toBe(0);
    expect(painted.size).toBe(3);
  });

  test('every selected tile is painted, whatever colour it was', () => {
    const painted = paintedTiles(draft, new Set(['0,0', '3,0']), 'teal');

    expect(painted.get('0,0')?.colour).toBe('teal');
    expect(painted.get('3,0')?.colour).toBe('teal');
  });

  test('an unselected tile is left alone', () => {
    const painted = paintedTiles(draft, new Set(['0,0']), 'red');

    expect(painted.get('3,0')?.colour).toBe('amber');
    expect(painted.get('6,0')?.colour).toBe(null);
  });

  test('null paints back to the default', () => {
    expect(paintedTiles(draft, new Set(['3,0']), null).get('3,0')?.colour).toBe(null);
  });

  test('a key that is not in the draft paints nothing', () => {
    // The selection is kept across a paint so it can be tried in three
    // colours, which means it can outlive a tile the officer then deletes.
    expect(paintedTiles(draft, new Set(['99,99']), 'red').size).toBe(3);
  });
});

describe('dropTarget', () => {
  const anchor = { x: 500, y: 500 };

  test('onto a member base, anywhere in its footprint, hands them that base', () => {
    // The base at 500,500 covers 499..501; the corner is still that base.
    expect(dropTarget([drafted()], anchor, { x: 501, y: 499 })).toEqual({
      kind: 'onto',
      key: '0,0',
    });
  });

  test('on free ground it draws a new 3x3 centred where it was dropped', () => {
    expect(dropTarget([drafted()], anchor, { x: 506, y: 500 })).toEqual({
      kind: 'new',
      tile: { dx: 6, dy: 0, spanX: 3, spanY: 3 },
    });
  });

  test('a new base may touch its neighbour but not share ground with it', () => {
    // 503 covers 502..504, flush against 499..501: a packed hive.
    expect(dropTarget([drafted()], anchor, { x: 503, y: 500 }).kind).toBe('new');
    // 502 would cover 501..503 and overlap it.
    expect(dropTarget([drafted()], anchor, { x: 502, y: 500 }).kind).toBe('refused');
  });

  test('nobody can be dropped on a structure', () => {
    const frankie = drafted({ kind: 'structure', spanX: 4, label: 'Frankie' });
    const target = dropTarget([frankie], anchor, { x: 500, y: 500 });
    expect(target.kind).toBe('refused');
    expect(target.kind === 'refused' && target.reason).toContain('Frankie');
  });

  test('nor on a base-kind tile that is not a 3x3 member base', () => {
    // A 1x1 drawn with the base brush is a drawing, not a place to send anybody.
    expect(dropTarget([drafted({ spanX: 1, spanY: 1 })], anchor, anchor).kind).toBe('refused');
  });

  test('nor where the new base would hang off the map', () => {
    expect(dropTarget([], anchor, { x: 0, y: 500 }).kind).toBe('refused');
  });
});
