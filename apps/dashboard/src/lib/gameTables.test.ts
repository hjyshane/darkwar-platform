import { describe, expect, it } from 'vitest';
import {
  cellText,
  emptyColumns,
  refTarget,
  sizeLabel,
  viewerHash,
  viewerStateFromHash,
} from './gameTables';
import { adminGroupFromHash, adminSectionFromHash } from './route';

const TABLES = new Set(['goods', 'skill', 'gift', 'building', 'activity_panel', 'aps_science']);

describe('game data browser (0343)', () => {
  it('follows an id column to the table its name spells', () => {
    expect(refTarget('skill_id', TABLES)).toBe('skill');
    expect(refTarget('skillid', TABLES)).toBe('skill');
    expect(refTarget('gift_id', TABLES)).toBe('gift');
  });

  it("knows the client's own names for things", () => {
    expect(refTarget('good_id', TABLES)).toBe('goods');
    expect(refTarget('item_id', TABLES)).toBe('goods');
    expect(refTarget('activity_id', TABLES)).toBe('activity_panel');
    expect(refTarget('science_id', TABLES)).toBe('aps_science');
  });

  it('links nothing it cannot name, and never the row id itself', () => {
    expect(refTarget('id', TABLES)).toBeNull();
    expect(refTarget('hero_id', TABLES)).toBeNull();
    expect(refTarget('quality', TABLES)).toBeNull();
    expect(refTarget('_id', TABLES)).toBeNull();
  });

  it('shows a localised cell through the dictionary, or the key when asked or unknown', () => {
    const strings = { '300001': 'Precision Part' };
    expect(cellText('300001', true, 'en', strings)).toBe('Precision Part');
    expect(cellText(300001, true, 'en', strings)).toBe('Precision Part');
    expect(cellText('300001', true, 'raw', strings)).toBe('300001');
    expect(cellText('300009', true, 'en', strings)).toBe('300009');
    expect(cellText('300001', false, 'en', strings)).toBe('300001');
  });

  it('shows nothing for null and compact JSON for a nested table', () => {
    expect(cellText(null, false, 'en', {})).toBe('');
    expect(cellText(undefined, false, 'en', {})).toBe('');
    expect(cellText([1, { a: 2 }], false, 'en', {})).toBe('[1,{"a":2}]');
    expect(cellText(0, false, 'en', {})).toBe('0');
  });

  it('calls a column empty only when every row has null or nothing in it', () => {
    const rows = [
      { id: '1', values: { a: null, b: '', c: 0, d: 'x' } },
      { id: '2', values: { a: '', b: null, c: null, d: null } },
    ];
    expect([...emptyColumns(['a', 'b', 'c', 'd'], rows)]).toEqual(['a', 'b']);
  });

  it('reads and writes its own part of the address', () => {
    expect(viewerStateFromHash('#/admin/catalogue/game-data')).toEqual({
      table: null,
      row: null,
      mode: 'en',
    });
    expect(viewerStateFromHash('#/admin/catalogue/game-data?t=goods&r=230101&l=ko')).toEqual({
      table: 'goods',
      row: '230101',
      mode: 'ko',
    });
    expect(viewerStateFromHash('#/admin/catalogue/game-data?l=zz').mode).toBe('en');
    expect(viewerHash({ table: 'goods', row: '230101', mode: 'raw' })).toBe(
      '#/admin/catalogue/game-data?t=goods&r=230101&l=raw',
    );
    expect(viewerHash({ table: null, row: null, mode: 'en' })).toBe('#/admin/catalogue/game-data');
  });

  it('keeps the route reading the group and section past the query', () => {
    const hash = '#/admin/catalogue/game-data?t=goods&r=1';
    expect(adminGroupFromHash(hash)).toBe('catalogue');
    expect(adminSectionFromHash(hash)).toBe('game-data');
    // An invented address still falls through, query or not.
    expect(adminGroupFromHash('#/admin/nowhere?t=goods')).toBeNull();
    expect(adminGroupFromHash('#/arena?t=goods')).toBeNull();
  });

  it('labels sizes the way the strip reads them', () => {
    expect(sizeLabel(14_460_000)).toBe('14.5 MB');
    expect(sizeLabel(120_400)).toBe('120 kB');
  });
});
