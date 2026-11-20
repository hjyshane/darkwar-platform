// Shapes as stamps: put down where somebody clicks, as often as they like.
//
// What can go wrong here is silent. A stamp that pushed through what was drawn
// would eat bases without a word; one that let a tile hang off the map would
// look fine and be refused only at save, by a message naming one tile of
// thirty; and a saved shape that came back carrying members would put last
// month's roster on this month's ground.

import { describe, expect, test } from 'vitest';
import type { LayoutTile } from './hiveFormations';
import {
  BUILT_IN_SHAPES,
  type ShapeTile,
  shapeFromTemplate,
  stampPlan,
  stampSummary,
} from './shapeStamp';

function base(dx: number, dy: number, over: Partial<ShapeTile> = {}): ShapeTile {
  return { dx, dy, spanX: 3, spanY: 3, kind: 'base', colour: null, label: '', ...over };
}

function layoutTile(over: Partial<LayoutTile> = {}): LayoutTile {
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

const anchor = { x: 500, y: 500 };

describe('the shapes on offer', () => {
  test('blocks and rings are bases only, and Frankie is a shape of his own', () => {
    const block = BUILT_IN_SHAPES.find((shape) => shape.key === 'block-3');
    expect(block?.tiles).toHaveLength(9);
    expect(block?.tiles.every((tile) => tile.kind === 'base')).toBe(true);
    const ring = BUILT_IN_SHAPES.find((shape) => shape.key === 'ring-5');
    expect(ring?.tiles).toHaveLength(16);
    const frankie = BUILT_IN_SHAPES.find((shape) => shape.key === 'frankie');
    expect(frankie?.tiles).toEqual([
      { dx: 0, dy: 0, spanX: 4, spanY: 3, kind: 'structure', colour: 'amber', label: 'Frankie' },
    ]);
  });

  test('every shape has its own key, so only the one held reads as pressed', () => {
    const keys = BUILT_IN_SHAPES.map((shape) => shape.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('putting a shape down', () => {
  test('it lands centred on the square clicked, as offsets from the anchor', () => {
    const plan = stampPlan([base(0, 0), base(3, 0)], { x: 520, y: 490 }, anchor, []);
    expect(plan.map((tile) => [tile.dx, tile.dy, tile.at, tile.fate])).toEqual([
      [20, -10, { x: 520, y: 490 }, 'placed'],
      [23, -10, { x: 523, y: 490 }, 'placed'],
    ]);
  });

  test('a tile that would land on something already drawn is left out, not pushed through', () => {
    // A base already at offset 23,-10: the stamp's second tile lands on it.
    const plan = stampPlan([base(0, 0), base(3, 0)], { x: 520, y: 490 }, anchor, [base(23, -10)]);
    expect(plan.map((tile) => tile.fate)).toEqual(['placed', 'taken']);
  });

  test('the same shape twice side by side: both go down whole', () => {
    const shape = BUILT_IN_SHAPES.find((candidate) => candidate.key === 'block-3')?.tiles ?? [];
    const first = stampPlan(shape, { x: 500, y: 500 }, anchor, []);
    const drawn = first.filter((tile) => tile.fate === 'placed');
    // Nine tiles wide is 9 squares; the next block starts 9 to the east.
    const second = stampPlan(shape, { x: 509, y: 500 }, anchor, drawn);
    expect(second.every((tile) => tile.fate === 'placed')).toBe(true);
  });

  test('a stamp checks its own tiles against each other', () => {
    // Two tiles of one saved shape on the same ground: the second is refused.
    const plan = stampPlan([base(0, 0), base(1, 0)], { x: 500, y: 500 }, anchor, []);
    expect(plan.map((tile) => tile.fate)).toEqual(['placed', 'taken']);
  });

  test('a tile that would run off the map is counted, not drawn', () => {
    // A 3x3 centred on 1,1 covers 0..2 and fits; the one four tiles west of it
    // is centred on -3 and does not exist at all.
    const plan = stampPlan([base(0, 0), base(-4, 0)], { x: 1, y: 1 }, anchor, []);
    expect(plan.map((tile) => tile.fate)).toEqual(['placed', 'off-map']);
  });

  test('a bigger tile runs out of map sooner than a small one', () => {
    // The east edge: a 1x1 on 999 is on the map, a 4-wide one needs 999..1002.
    const small = stampPlan([base(0, 0, { spanX: 1, spanY: 1 })], { x: 999, y: 500 }, anchor, []);
    const wide = stampPlan([base(0, 0, { spanX: 4, spanY: 3 })], { x: 999, y: 500 }, anchor, []);
    expect(small[0]?.fate).toBe('placed');
    expect(wide[0]?.fate).toBe('off-map');
  });
});

describe('what a stamp says', () => {
  test('nothing, when everything went down', () => {
    expect(stampSummary(stampPlan([base(0, 0)], anchor, anchor, []))).toBeNull();
  });

  test('how many went down and why the rest did not', () => {
    const plan = stampPlan([base(0, 0), base(3, 0), base(-4, 0)], { x: 4, y: 500 }, anchor, [
      base(-493, 0),
    ]);
    expect(stampSummary(plan)).toBe(
      'Put down 1 of 3 tiles; 1 would land on tiles already drawn and 1 would run off the map, so they were left out.',
    );
  });

  test('a stamp that put nothing down says so', () => {
    const plan = stampPlan([base(0, 0)], anchor, anchor, [base(0, 0)]);
    expect(stampSummary(plan)).toBe('Nothing put down: 1 would land on tiles already drawn.');
  });
});

describe('a saved shape as a stamp', () => {
  test('the size, kind, colour and caption come back with it, and nobody on it', () => {
    const tiles = shapeFromTemplate([
      layoutTile({
        dx: -4,
        dy: 2,
        span_x: 6,
        span_y: 4,
        kind: 'structure',
        colour: 'teal',
        label: 'Depot',
      }),
    ]);
    // Exactly these keys: a template carries nobody (0172), and a stamp has no
    // slot behind it for anybody to come along on.
    expect(tiles).toEqual([
      { dx: -4, dy: 2, spanX: 6, spanY: 4, kind: 'structure', colour: 'teal', label: 'Depot' },
    ]);
  });
});
