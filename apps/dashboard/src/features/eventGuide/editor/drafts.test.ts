import { describe, expect, it } from 'vitest';
import { SECTION_KINDS } from '../sections/index';
import {
  emptyPayload,
  moveAt,
  numberOrUndefined,
  removeAt,
  searchFilter,
  setAt,
  validateDraft,
} from './drafts';

describe('emptyPayload', () => {
  it('starts every structured kind from something that saves', () => {
    for (const kind of SECTION_KINDS) {
      if (kind === 'notes') continue;
      expect(validateDraft(kind, emptyPayload(kind)).ok, kind).toBe(true);
    }
  });
  it('starts notes empty, which does not save until something is typed', () => {
    expect(emptyPayload('notes')).toEqual({ text: '', text_ko: null });
    expect(validateDraft('notes', emptyPayload('notes'))).toEqual({
      ok: false,
      reason: 'Notes need some text.',
    });
  });
});

describe('validateDraft', () => {
  it('hands back the typed payload when it parses', () => {
    const result = validateDraft('notes', { text: 'Hold shards.', text_ko: null });
    expect(result).toEqual({
      ok: true,
      section: { kind: 'notes', payload: { text: 'Hold shards.', text_ko: null } },
    });
  });
  it('refuses a points field left blank, with the sentence that says which', () => {
    const result = validateDraft('point_table', {
      day: 2,
      theme: null,
      rows: [{ action: 'Consume a shard', points: undefined }],
    });
    expect(result).toEqual({
      ok: false,
      reason: 'Every row needs an action and a number of points.',
    });
  });
  it('refuses junk in an optional number rather than dropping the field', () => {
    const result = validateDraft('prep', {
      items: [{ item_ref: { kind: 'item', id: '253042' }, unit: 1, cap: Number.NaN }],
    });
    expect(result).toEqual({
      ok: false,
      reason: 'A number field holds something that is not a number.',
    });
  });
  it('has a reason for each kind', () => {
    expect(validateDraft('rewards', { items: [{ label: '', kind: 'skin' }] })).toMatchObject({
      ok: false,
      reason: 'Every reward needs a name and a kind.',
    });
    expect(
      validateDraft('stages', { groups: [{ label: '', stages: [] }], totals: [] }),
    ).toMatchObject({
      ok: false,
      reason: 'Every group needs a name, every stage a number, every drop an item and a quantity.',
    });
    expect(validateDraft('prep', { items: [{ unit: 1 }] })).toMatchObject({
      ok: false,
      reason: 'Every row needs an item, and a unit above zero.',
    });
    expect(validateDraft('sources', { rows: [{ source: '' }] })).toMatchObject({
      ok: false,
      reason: 'Every row needs a source.',
    });
  });
});

describe('list helpers', () => {
  const list = ['a', 'b', 'c'] as const;
  it('replace, remove and move without touching the list given', () => {
    expect(setAt(list, 1, 'x')).toEqual(['a', 'x', 'c']);
    expect(removeAt(list, 0)).toEqual(['b', 'c']);
    expect(moveAt(list, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveAt(list, 2, -1)).toEqual(['a', 'c', 'b']);
    expect(list).toEqual(['a', 'b', 'c']);
  });
  it('a move off either end is no move', () => {
    expect(moveAt(list, 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveAt(list, 2, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('searchFilter', () => {
  it('strips what would be filter syntax in a PostgREST or()', () => {
    const cleaned = searchFilter('or(name.ilike.*,x)%"\\');
    expect(cleaned).not.toMatch(/[(),*%"\\]/);
    expect(cleaned).toBe('or name.ilike. x');
  });
  it('asks for at least two characters', () => {
    expect(searchFilter(' a ')).toBeNull();
    expect(searchFilter('')).toBeNull();
    expect(searchFilter('  hero   shard ')).toBe('hero shard');
  });
  it('keeps Korean, which the catalogue is also searched in', () => {
    expect(searchFilter('영웅 조각')).toBe('영웅 조각');
  });
});

describe('numberOrUndefined', () => {
  it('reads an empty field as absent and junk as not-a-number', () => {
    expect(numberOrUndefined('')).toBeUndefined();
    expect(numberOrUndefined('  ')).toBeUndefined();
    expect(numberOrUndefined('412')).toBe(412);
    expect(numberOrUndefined('1.5')).toBe(1.5);
    expect(Number.isNaN(numberOrUndefined('lots'))).toBe(true);
  });
});
