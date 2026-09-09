// Loading a saved shape back into the editor.
//
// The two things that can go wrong here are silent. A template that came back
// carrying members would put last month's roster on this month's ground and
// look correct; a shape loaded onto an anchor near the map's edge would be
// drawn, look fine, and be refused only at the moment the officer pressed
// save — by a message naming one tile out of thirty.

import { describe, expect, test } from 'vitest';
import { draftFromTiles, tilesOffMap } from './FormationEditor';
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
    expect([...draft.values()].every((slot) => slot.playerId === null)).toBe(true);
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
