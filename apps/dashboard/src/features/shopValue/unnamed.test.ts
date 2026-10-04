import { describe, expect, it } from 'vitest';
import type { ItemValue, ListingValue, PackValue } from './data';
import { unnamedItems } from './unnamed';

function pack(name: string, server: number, contents: PackValue['contents']): PackValue {
  return {
    server_id: server,
    pack_id: name,
    name_key: null,
    name,
    game_name: name,
    renamed: false,
    name_ko: null,
    dollars: 4.99,
    rubies: 0,
    claimed_percent: null,
    starts_at: null,
    ends_at: null,
    captured_at: '2026-10-04T00:00:00Z',
    item_rubies: 0,
    unvalued_items: 0,
    contents,
    value_dollars: null,
    value_ratio: null,
    contents_listed: true,
  };
}

const UNNAMED = { id: '999', qty: 10, name: null, name_ko: null, rubies: null, source: null };
const NAMED = {
  id: '230110',
  qty: 5,
  name: 'Power Core',
  name_ko: null,
  rubies: 9,
  source: 'game',
};

describe('unnamedItems', () => {
  it('lists an unnamed item once per distinct place it turns up', () => {
    const items = unnamedItems(
      [
        pack('Doomsday Key Pack', 580, [UNNAMED, NAMED as PackValue['contents'][number]]),
        pack('Doomsday Key Pack', 581, [UNNAMED]),
      ],
      [
        {
          server_id: 580,
          shop_type: 1,
          listing_id: 'l1',
          item_id: '999',
          name: null,
          name_ko: null,
          qty: 1,
          price: 300,
          discount: null,
          captured_at: '2026-10-04T00:00:00Z',
          unit_rubies: null,
          value_source: null,
          value_ratio: null,
        } satisfies ListingValue,
      ],
      [],
    );

    expect(items.map((i) => i.item_id)).toEqual(['999']);
    // The same pack on two servers is one sighting; the shop entry another.
    expect(items[0]?.sightings.map((s) => s.where)).toEqual(['pack', 'shop']);
  });

  it('includes a valued item with no name, and its value', () => {
    const value = {
      item_id: '777',
      rubies: 12,
      source: 'estimated',
      note: null,
      updated_at: '',
      name: null,
      game_name: null,
      renamed: false,
      name_ko: null,
    } satisfies ItemValue;
    const [item] = unnamedItems([], [], [value]);
    expect(item).toMatchObject({ item_id: '777', rubies: 12, sightings: [] });
  });
});
