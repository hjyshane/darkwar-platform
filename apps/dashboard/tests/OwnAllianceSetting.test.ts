// The pin setting has two shapes on disk: the single `{alliance_id}` every save
// before 0192 wrote, and the `{alliance_ids: [...]}` list the screen writes
// now. Production holds the old one until somebody saves, so the screen has to
// read both — misreading it as "nothing pinned" would offer to pin CBFW again
// and show no primary at all.
import { expect, test } from 'vitest';
import { readPinned, searchTerm } from '../src/features/admin/OwnAllianceSetting';

test('the list shape reads in order; the first is primary', () => {
  expect(readPinned({ alliance_ids: ['a', 'b'] })).toEqual(['a', 'b']);
});

test('the single shape every earlier save wrote reads as a list of one', () => {
  expect(readPinned({ alliance_id: 'a' })).toEqual(['a']);
});

test('nothing pinned, or something unreadable, is an empty list', () => {
  expect(readPinned(null)).toEqual([]);
  expect(readPinned(undefined)).toEqual([]);
  expect(readPinned({})).toEqual([]);
  expect(readPinned({ alliance_ids: ['a', 7, null] })).toEqual(['a']);
});

test('the search keeps names in any script and drops filter syntax', () => {
  // Alliance names are not ASCII, so letters of any script stay...
  expect(searchTerm('HELLBOUND')).toBe('HELLBOUND');
  expect(searchTerm('  Liên Minh ')).toBe('Liên Minh');
  // ...and what would change a PostgREST or=(...) filter goes.
  expect(searchTerm('CB,FW)')).toBe('CBFW');
  expect(searchTerm('a.ilike.*')).toBe('ailike');
});
