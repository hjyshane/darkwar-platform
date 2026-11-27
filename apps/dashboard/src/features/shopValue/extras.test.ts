import { describe, expect, test } from 'vitest';
import { type PackExtra, extraRubies, extrasOf } from './extras';

const extra = (over: Partial<PackExtra>): PackExtra => ({
  extra_id: 1,
  match_kind: 'pack_id',
  match_value: '9007',
  item_id: '222027',
  qty: 1,
  repeat: 1,
  note: null,
  ...over,
});

describe('extrasOf', () => {
  test('reaches a pack by its id and by its name key, not by another name', () => {
    const rows = [
      extra({ extra_id: 1, match_kind: 'pack_id', match_value: '9007' }),
      extra({ extra_id: 2, match_kind: 'name_key', match_value: '321400' }),
      extra({ extra_id: 3, match_kind: 'name_key', match_value: '999999' }),
      extra({ extra_id: 4, match_kind: 'pack_id', match_value: '9009' }),
    ];

    expect(extrasOf(rows, { pack_id: '9007', name_key: '321400' }).map((x) => x.extra_id)).toEqual([
      1, 2,
    ]);
    expect(extrasOf(rows, { pack_id: '9009', name_key: null }).map((x) => x.extra_id)).toEqual([4]);
  });
});

describe('extraRubies', () => {
  test('rubies are qty x repeat; an item needs a unit value', () => {
    expect(extraRubies({ item_id: null, qty: 100, repeat: 30 }, null)).toBe(3000);
    expect(extraRubies({ item_id: '230104', qty: 1000, repeat: 1 }, 0.5)).toBe(500);
    expect(extraRubies({ item_id: '230104', qty: 1000, repeat: 1 }, null)).toBeNull();
  });
});
