// The behaviour worth pinning is what happens to unknown values: a null
// power means nobody looked, not a player with none.
import { expect, test } from 'vitest';
import {
  ariaSort,
  emptyViewReason,
  nextSort,
  searchRows,
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

test('an empty table blames the star, not a search nobody typed', () => {
  // The bug: the starred filter runs before the search, so a table emptied
  // by the STAR with the search box untouched printed `No member matches ""`
  // — an empty pair of quotes. Reachable because favourites are counted
  // globally: star a player on a server drill-down, open Members, press the
  // toggle, and none of them is a member of your alliance.
  expect(emptyViewReason('', true)).toBe('starred');
  expect(emptyViewReason('   ', true)).toBe('starred');

  // Both filters on is its own case: naming only the star would leave the
  // reader wondering whether their search was even applied.
  expect(emptyViewReason('mira', true)).toBe('starred-search');

  expect(emptyViewReason('mira', false)).toBe('search');

  // Neither filter is active, so no filter did this. Every caller returns
  // earlier when the table has no rows at all, so this is unreachable there
  // — it is null rather than a sentence so that it cannot be printed as one.
  expect(emptyViewReason('', false)).toBeNull();
});
