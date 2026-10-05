import { describe, expect, it } from 'vitest';
import {
  type PackItem,
  type PackValue,
  byValue,
  catalogSets,
  dollarsOf,
  estimatedShare,
  groupPacks,
  isLive,
  matchesPack,
  packKey,
  ratioLabel,
} from './data';

const NOW = new Date('2026-10-03T12:00:00Z');

function item(
  id: string,
  qty: number,
  rubies: number | null,
  source: PackItem['source'],
): PackItem {
  return { id, qty, name: null, name_ko: null, rubies, source };
}

describe('isLive', () => {
  it('is gone once the newest catalog leaves it out, whatever its window', () => {
    const window = { starts_at: '2026-10-01T00:00:00Z', ends_at: null };
    expect(isLive({ ...window, listed: false }, NOW)).toBe(false);
    expect(isLive({ ...window, listed: true }, NOW)).toBe(true);
    // No catalog recorded yet for the server: the window decides.
    expect(isLive({ ...window, listed: null }, NOW)).toBe(true);
  });

  it('is on sale between its start and its end', () => {
    expect(
      isLive({ starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-10-05T00:00:00Z' }, NOW),
    ).toBe(true);
    expect(isLive({ starts_at: '2026-10-04T00:00:00Z', ends_at: null }, NOW)).toBe(false);
    expect(isLive({ starts_at: null, ends_at: '2026-10-02T00:00:00Z' }, NOW)).toBe(false);
  });

  it('treats a missing end as open', () => {
    expect(isLive({ starts_at: '2026-01-01T00:00:00Z', ends_at: null }, NOW)).toBe(true);
  });
});

describe('value', () => {
  it('puts the best value first and free packs last', () => {
    const out = byValue([
      { id: 'a', value_ratio: 2 },
      { id: 'free', value_ratio: null },
      { id: 'b', value_ratio: 9.5 },
    ]);
    expect(out.map((row) => row.id)).toEqual(['b', 'a', 'free']);
  });

  it('prices rubies at $0.0099', () => {
    expect(dollarsOf(100)).toBe(0.99);
    expect(dollarsOf(1500)).toBe(14.85);
  });

  it('labels a ratio and its absence', () => {
    expect(ratioLabel(3.04)).toBe('×3.0');
    expect(ratioLabel(null)).toBe('—');
  });

  it('says how much of a pack rests on estimates', () => {
    // 500 rubies + 10 x 100 (game) + 5 x 100 (estimated) = 2,000; 500 estimated.
    const share = estimatedShare({
      rubies: 500,
      contents: [
        item('1', 10, 100, 'game'),
        item('2', 5, 100, 'estimated'),
        item('3', 9, null, null),
      ],
    });
    expect(share).toBe(0.25);
  });
});

function pack(id: string, name: string, contents: PackItem[], rubies = 0): PackValue {
  return {
    server_id: 580,
    pack_id: id,
    name_key: `key-${name}`,
    name,
    game_name: name,
    renamed: false,
    name_ko: null,
    dollars: 4.99,
    rubies,
    claimed_percent: null,
    starts_at: null,
    ends_at: null,
    captured_at: '2026-10-03T00:00:00Z',
    item_rubies: 0,
    unvalued_items: 0,
    contents,
    value_dollars: null,
    value_ratio: null,
    contents_listed: contents.length > 0 || rubies > 0,
    listed: null,
  };
}

describe('groupPacks', () => {
  it('groups by the game name, so a rename never splits an offer', () => {
    const renamed = { ...pack('2', 'Pack #2', []), name: 'Doomsday Key Pack', renamed: true };
    const groups = groupPacks([pack('1', 'Pack #2', []), renamed]);
    expect(groups).toHaveLength(1);
  });

  it('folds one offer listed under many ids into one row', () => {
    const tiers = ['1', '2', '3'].map((id) => pack(id, 'Legend Battle Pass', []));
    const groups = groupPacks(tiers);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.offers).toBe(3);
    expect(groups[0]?.pack_ids).toEqual(['1', '2', '3']);
  });

  it('keeps packs that differ in an item apart', () => {
    const groups = groupPacks([
      pack('a', 'Wartime Investment', [item('gear', 1, null, null)], 500),
      pack('b', 'Wartime Investment', [item('bandage', 1, null, null)], 500),
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe('matchesPack', () => {
  const core = pack('240806011', 'Power Core Pack', [
    {
      id: '230110',
      qty: 10,
      name: 'Power Core',
      name_ko: '파워 코어',
      rubies: 461,
      source: 'estimated',
    },
  ]);

  it('finds a pack by its name, an item in it, or its id', () => {
    expect(matchesPack(core, 'core pack')).toBe(true);
    expect(matchesPack(core, '파워')).toBe(true);
    expect(matchesPack(core, '240806011')).toBe(true);
    expect(matchesPack(core, 'blueprint')).toBe(false);
  });

  it('matches everything when empty', () => {
    expect(matchesPack(core, '  ')).toBe(true);
  });
});

describe('packKey', () => {
  it('keys a rename by the offer, so same-name packs with different contents stay apart', () => {
    const vip3 = pack('1', 'VIP Exclusive', [item('a', 10, 1, 'game')]);
    const vip4 = pack('2', 'VIP Exclusive', [item('a', 20, 1, 'game')]);
    expect(packKey(vip3)).not.toBe(packKey(vip4));
  });

  it('gives the ids of one offer the same key', () => {
    const tier1 = pack('1', 'Legend Battle Pass', []);
    const tier2 = pack('2', 'Legend Battle Pass', []);
    expect(packKey(tier1)).toBe(packKey(tier2));
    expect(groupPacks([tier1, tier2])[0]?.rename_keys).toEqual([packKey(tier1)]);
  });

  it('falls back to the id for a pack without a name key', () => {
    expect(packKey({ ...pack('9', 'Pack #9', []), name_key: null })).toMatch(/^pack:9\|/);
  });
});

describe('catalogSets', () => {
  it('maps each server to the pack ids its newest catalog listed', () => {
    const sets = catalogSets([
      { server_id: 580, pack_ids: ['9001', '240806011'] },
      { server_id: 581, pack_ids: null },
      { server_id: null, pack_ids: ['1'] },
    ]);
    expect([...sets.keys()]).toEqual([580]);
    expect(sets.get(580)?.has('9001')).toBe(true);
    expect(sets.get(580)?.has('1')).toBe(false);
  });
});
