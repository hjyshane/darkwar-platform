// The arrangement is stored as a PATCH, and the tests are mostly about what that
// buys: a column added to the dashboard after somebody saved a layout must still
// appear. A stored snapshot would swallow it, silently, for everyone.
import { describe, expect, test } from 'vitest';
import {
  type ColumnSpec,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  arrangeColumns,
  columnWidth,
  moveColumn,
  toggleHidden,
} from '../src/lib/tableLayout';

const columns: ColumnSpec[] = [
  { id: 'rank', label: 'Rank' },
  { id: 'name', label: 'Name', fixed: true },
  { id: 'power', label: 'Power' },
  { id: 'kills', label: 'Kills' },
];

describe('arrangeColumns', () => {
  test('no setting at all renders what the table declared', () => {
    expect(arrangeColumns(columns, undefined).map((c) => c.id)).toEqual([
      'rank',
      'name',
      'power',
      'kills',
    ]);
  });

  test('a stored order is honoured', () => {
    const out = arrangeColumns(columns, { order: ['power', 'name', 'rank', 'kills'] });
    expect(out.map((c) => c.id)).toEqual(['power', 'name', 'rank', 'kills']);
  });

  // THE ONE THIS SHAPE EXISTS FOR. A layout saved before `kills` was added must not
  // hide it — it keeps its declared place at the end.
  test('a column the stored order never mentioned still appears', () => {
    const out = arrangeColumns(columns, { order: ['power', 'rank', 'name'] });
    expect(out.map((c) => c.id)).toEqual(['power', 'rank', 'name', 'kills']);
  });

  test('hidden columns are dropped', () => {
    expect(arrangeColumns(columns, { hidden: ['kills'] }).map((c) => c.id)).toEqual([
      'rank',
      'name',
      'power',
    ]);
  });

  // Hiding the name column leaves a grid of figures belonging to nobody. The table
  // refuses it rather than the form, so no stored setting can produce that.
  test('a fixed column cannot be hidden', () => {
    expect(arrangeColumns(columns, { hidden: ['name', 'kills'] }).map((c) => c.id)).toEqual([
      'rank',
      'name',
      'power',
    ]);
  });

  test('an id the table does not declare is ignored rather than rendered', () => {
    const out = arrangeColumns(columns, { order: ['power', 'gone', 'rank'] });
    expect(out.map((c) => c.id)).toEqual(['power', 'rank', 'name', 'kills']);
  });
});

describe('moveColumn', () => {
  test('moves one place and returns the whole order', () => {
    expect(moveColumn(columns, 'power', -1)).toEqual(['rank', 'power', 'name', 'kills']);
    expect(moveColumn(columns, 'power', 1)).toEqual(['rank', 'name', 'kills', 'power']);
  });

  test('moving past either end changes nothing', () => {
    expect(moveColumn(columns, 'rank', -1)).toEqual(['rank', 'name', 'power', 'kills']);
    expect(moveColumn(columns, 'kills', 1)).toEqual(['rank', 'name', 'power', 'kills']);
  });

  test('an unknown id changes nothing', () => {
    expect(moveColumn(columns, 'nope', 1)).toEqual(['rank', 'name', 'power', 'kills']);
  });
});

describe('toggleHidden', () => {
  test('adds and removes', () => {
    expect(toggleHidden([], 'power')).toEqual(['power']);
    expect(toggleHidden(['power'], 'power')).toEqual([]);
  });
});

describe('columnWidth', () => {
  test('absent means the browser decides', () => {
    expect(columnWidth(undefined, 'power')).toBeUndefined();
    expect(columnWidth({ width: {} }, 'power')).toBeUndefined();
  });

  // Both of these are one slip of a number input away, and neither is a layout
  // anybody chose: 8px is unreadable and 4000px pushes every other column off.
  test('a width is clamped rather than trusted', () => {
    expect(columnWidth({ width: { power: 8 } }, 'power')).toBe(MIN_COLUMN_WIDTH);
    expect(columnWidth({ width: { power: 4000 } }, 'power')).toBe(MAX_COLUMN_WIDTH);
  });

  test('a sensible width comes through, rounded', () => {
    expect(columnWidth({ width: { power: 120.4 } }, 'power')).toBe(120);
  });

  test('rubbish is ignored rather than rendered as NaN', () => {
    expect(columnWidth({ width: { power: Number.NaN } }, 'power')).toBeUndefined();
  });
});
