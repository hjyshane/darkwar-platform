// The behaviour worth pinning is what happens to unknown values: a null
// power means nobody looked, not a player with none.
import { expect, test } from 'vitest';
import {
  type SortState,
  ariaSort,
  nextSort,
  nextSortKeys,
  searchRows,
  sortLevel,
  sortRows,
} from '../src/lib/tableControls';

const ROWS = [
  { name: 'ShaneKim', power: 88_452_100, alliance: 'CBFW' },
  { name: '전투광', power: 71_204_800, alliance: 'LovE' },
  { name: 'Nightfall', power: null, alliance: null },
  { name: 'Meridian', power: 44_800_250, alliance: 'CBFW' },
];

const names = (rows: { name: string }[]) => rows.map((r) => r.name);

test('descending puts the biggest first', () => {
  const sorted = sortRows(ROWS, { key: 'power', direction: 'desc' });
  expect(names(sorted).slice(0, 3)).toEqual(['ShaneKim', '전투광', 'Meridian']);
});

test('unknown values stay last in both directions', () => {
  // The whole point: flipping the sort must not promote a player nobody has
  // measured to the top of a power ranking.
  expect(names(sortRows(ROWS, { key: 'power', direction: 'desc' })).at(-1)).toBe('Nightfall');
  expect(names(sortRows(ROWS, { key: 'power', direction: 'asc' })).at(-1)).toBe('Nightfall');
});

test('ascending is the reverse of descending, ignoring the unknowns', () => {
  const asc = names(sortRows(ROWS, { key: 'power', direction: 'asc' })).slice(0, 3);
  const desc = names(sortRows(ROWS, { key: 'power', direction: 'desc' })).slice(0, 3);
  expect(asc).toEqual([...desc].reverse());
});

test('text sorts across scripts without throwing', () => {
  const sorted = names(sortRows(ROWS, { key: 'name', direction: 'asc' }));
  expect(sorted).toHaveLength(4);
  expect(new Set(sorted)).toEqual(new Set(names([...ROWS])));
});

test('numbers inside names order numerically, not as text', () => {
  const rows = [{ name: 'Member10' }, { name: 'Member2' }, { name: 'Member1' }];
  expect(names(sortRows(rows, { key: 'name', direction: 'asc' }))).toEqual([
    'Member1',
    'Member2',
    'Member10',
  ]);
});

test('sorting does not mutate the input', () => {
  const original = [...ROWS];
  sortRows(ROWS, { key: 'power', direction: 'asc' });
  expect(ROWS).toEqual(original);
});

test('no sort returns a copy, in the original order', () => {
  const result = sortRows(ROWS, null);
  expect(names(result)).toEqual(names([...ROWS]));
  expect(result).not.toBe(ROWS);
});

test('search matches part of a name, ignoring case', () => {
  expect(names(searchRows(ROWS, 'shane', ['name']))).toEqual(['ShaneKim']);
  expect(names(searchRows(ROWS, 'MERI', ['name']))).toEqual(['Meridian']);
});

test('search works on Korean', () => {
  expect(names(searchRows(ROWS, '전투', ['name']))).toEqual(['전투광']);
});

test('search can look at more than one field', () => {
  expect(names(searchRows(ROWS, 'cbfw', ['name', 'alliance']))).toEqual(['ShaneKim', 'Meridian']);
});

test('a row with nothing in the searched field is skipped, not matched', () => {
  expect(names(searchRows(ROWS, 'cbfw', ['alliance']))).not.toContain('Nightfall');
});

test('an empty query returns everything', () => {
  expect(searchRows(ROWS, '   ', ['name'])).toHaveLength(ROWS.length);
});

test('a first click sorts descending, because these are rankings', () => {
  expect(nextSort(null, 'power')).toEqual({ key: 'power', direction: 'desc' });
});

test('clicking the same column again flips it', () => {
  const first = nextSort(null, 'power');
  expect(nextSort(first, 'power')).toEqual({ key: 'power', direction: 'asc' });
  expect(nextSort({ key: 'power', direction: 'asc' }, 'power')).toEqual({
    key: 'power',
    direction: 'desc',
  });
});

test('clicking a different column starts it descending', () => {
  expect(nextSort({ key: 'power', direction: 'asc' }, 'kills')).toEqual({
    key: 'kills',
    direction: 'desc',
  });
});

test('aria-sort is only set on the column actually sorted', () => {
  const state = { key: 'power', direction: 'desc' } as const;
  expect(ariaSort(state, 'power')).toBe('descending');
  expect(ariaSort(state, 'kills')).toBeUndefined();
  expect(ariaSort(null, 'power')).toBeUndefined();
  expect(ariaSort({ key: 'power', direction: 'asc' }, 'power')).toBe('ascending');
});

// --- two sort keys ---------------------------------------------------------
//
// The question that needed this: "the R3s, weakest first". One key cannot ask
// it, and the roster exists to answer exactly that kind of thing.

const RANKED = [
  { name: 'a', rank: 'R3', power: 10 },
  { name: 'b', rank: 'R2', power: 30 },
  { name: 'c', rank: 'R3', power: 40 },
  { name: 'd', rank: 'R2', power: 20 },
  { name: 'e', rank: null, power: 50 },
];

test('the second key only speaks where the first ties', () => {
  const sorted = sortRows(RANKED, [
    { key: 'rank', direction: 'desc' },
    { key: 'power', direction: 'asc' },
  ]);
  // R3s first (desc on rank), and within each rank the weakest first.
  expect(names(sorted)).toEqual(['a', 'c', 'd', 'b', 'e']);
});

// Unknowns stay last on the FIRST key regardless of what the second says —
// otherwise a tiebreaker could pull an unmeasured row up into the ranked ones.
test('an unknown primary value is last whatever the tiebreaker is', () => {
  for (const direction of ['asc', 'desc'] as const) {
    const sorted = sortRows(RANKED, [
      { key: 'rank', direction },
      { key: 'power', direction: 'desc' },
    ]);
    expect(names(sorted).at(-1)).toBe('e');
  }
});

test('one key still works when handed as a bare state', () => {
  expect(names(sortRows(RANKED, { key: 'power', direction: 'desc' }))).toEqual([
    'e',
    'c',
    'b',
    'd',
    'a',
  ]);
});

test('a plain click replaces the whole sort, tiebreaker included', () => {
  const two: SortState[] = [
    { key: 'rank', direction: 'desc' },
    { key: 'power', direction: 'asc' },
  ];
  // Not "keep rank and change power" — a reader who plain-clicks a column is
  // asking for that column, and silently keeping a second key they may have
  // forgotten setting is how a table starts looking wrong.
  expect(nextSortKeys(two, 'kills', false)).toEqual([{ key: 'kills', direction: 'desc' }]);
});

test('a plain click on the primary key flips it; on the tiebreaker it promotes', () => {
  const two: SortState[] = [
    { key: 'rank', direction: 'desc' },
    { key: 'power', direction: 'asc' },
  ];
  expect(nextSortKeys(two, 'rank', false)).toEqual([{ key: 'rank', direction: 'asc' }]);
  // Descending, like any fresh column — it is being asked for as the primary
  // now, and its old direction was chosen as a tiebreaker.
  expect(nextSortKeys(two, 'power', false)).toEqual([{ key: 'power', direction: 'desc' }]);
});

test('shift-click adds a tiebreaker, and flips it if it is already there', () => {
  const one: SortState[] = [{ key: 'rank', direction: 'desc' }];
  const two = nextSortKeys(one, 'power', true);
  expect(two).toEqual([
    { key: 'rank', direction: 'desc' },
    { key: 'power', direction: 'desc' },
  ]);
  expect(nextSortKeys(two, 'power', true)).toEqual([
    { key: 'rank', direction: 'desc' },
    { key: 'power', direction: 'asc' },
  ]);
});

// At the cap, the new key displaces the LAST one. The primary is what the
// reader is thinking about; the tiebreaker is what they are still adjusting.
test('a third key replaces the tiebreaker, not the primary', () => {
  const two: SortState[] = [
    { key: 'rank', direction: 'desc' },
    { key: 'power', direction: 'asc' },
  ];
  expect(nextSortKeys(two, 'kills', true)).toEqual([
    { key: 'rank', direction: 'desc' },
    { key: 'kills', direction: 'desc' },
  ]);
});

test('the level marker appears only when there are two keys to tell apart', () => {
  const one: SortState[] = [{ key: 'rank', direction: 'desc' }];
  expect(sortLevel(one, 'rank')).toBeNull();
  const two: SortState[] = [...one, { key: 'power', direction: 'asc' }];
  expect(sortLevel(two, 'rank')).toBe(1);
  expect(sortLevel(two, 'power')).toBe(2);
  expect(sortLevel(two, 'kills')).toBeNull();
});

// aria-sort has no way to say "second", so both sorted columns announce as
// sorted. That is true, and less misleading than calling one of them unsorted.
test('aria-sort reports the tiebreaker as well as the primary', () => {
  const two: SortState[] = [
    { key: 'rank', direction: 'desc' },
    { key: 'power', direction: 'asc' },
  ];
  expect(ariaSort(two, 'rank')).toBe('descending');
  expect(ariaSort(two, 'power')).toBe('ascending');
  expect(ariaSort(two, 'kills')).toBeUndefined();
});
