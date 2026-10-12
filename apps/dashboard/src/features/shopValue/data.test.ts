import { describe, expect, it } from 'vitest';
import {
  PACK_CATEGORIES,
  type PackChoiceOption,
  type PackGroup,
  type PackItem,
  type PackValue,
  bestOption,
  byValue,
  catalogSets,
  dollarsOf,
  estimatedShare,
  familyKey,
  foldVariants,
  groupPacks,
  isGated,
  isInStore,
  isLive,
  matchesPack,
  packCategory,
  packKey,
  plainName,
  ratioLabel,
  variantKey,
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
    choices: [],
    choice_rubies: 0,
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

function option(rubies: number, items: PackItem[]): PackChoiceOption {
  return { rubies, unvalued: 0, items };
}

describe('picks (0276)', () => {
  const gems = option(50, [item('g', 50, 1, 'game')]);
  const speedups = option(80, [{ ...item('s', 8, 10, 'estimated'), name: 'Speedup' }]);

  it('counts the best option of a slot', () => {
    expect(bestOption([gems, speedups])).toBe(speedups);
    expect(bestOption([])).toBeUndefined();
  });

  it('puts the best option of each pick into the estimated share', () => {
    // 100 + 80 (estimated, the best option): 80 of 180.
    const share = estimatedShare({ rubies: 100, contents: [], choices: [[gems, speedups]] });
    expect(share).toBeCloseTo(80 / 180);
  });

  it('keeps packs that differ only in what they let you pick apart', () => {
    const a = { ...pack('a', 'Gem Pack', []), choices: [[gems, speedups]] };
    const b = { ...pack('b', 'Gem Pack', []), choices: [[gems]] };
    const again = { ...pack('c', 'Gem Pack', []), choices: [[speedups, gems]] };
    expect(groupPacks([a, b])).toHaveLength(2);
    // The same options in another order are the same offer.
    expect(groupPacks([a, again])).toHaveLength(1);
  });

  it('finds a pack by an item it lets you pick', () => {
    const p = { ...pack('a', 'Gem Pack', []), choices: [[gems, speedups]] };
    expect(matchesPack(p, 'speedup')).toBe(true);
    expect(matchesPack(p, 'blueprint')).toBe(false);
  });

  it('does not change the rename key', () => {
    const plain = pack('a', 'Gem Pack', []);
    expect(packKey({ ...plain, choices: [[gems, speedups]] })).toBe(packKey(plain));
  });
});

describe('packCategory', () => {
  it('reads a pack type as a category, and an unknown type as Other', () => {
    expect(packCategory('26').key).toBe('daily');
    expect(packCategory('27').key).toBe('weekly');
    expect(packCategory('24').key).toBe('goods');
    expect(packCategory('9999').key).toBe('other');
    expect(packCategory(null).key).toBe('other');
  });

  it('gives every category in the table a label and an icon', () => {
    expect(new Set(PACK_CATEGORIES.map((c) => c.key)).size).toBe(PACK_CATEGORIES.length);
    for (const c of PACK_CATEGORIES) {
      expect(c.label).not.toBe('');
      expect(c.icon).not.toBe('');
    }
  });
});

describe('foldVariants', () => {
  // Four stages of one daily package: same name and price, other contents.
  const stage = (id: string, parts: number) =>
    pack(id, 'Pioneer Package', [item('parts', parts, 1, 'game')], 0);
  const groups = () => groupPacks([stage('1', 4), stage('2', 5), stage('3', 6)]);

  it('leaves every version alone until an officer chooses', () => {
    const { rows, hidden } = foldVariants(groups(), new Map(), false);
    expect(rows).toHaveLength(3);
    expect(hidden).toBe(0);
    expect(rows.every((r) => r.variants === 3 && !r.picked && !r.stale)).toBe(true);
  });

  it('keeps only the chosen version, and says how many it hid', () => {
    const all = groups();
    const second = all[1];
    if (second === undefined) throw new Error('fixture');
    const choices = new Map([[familyKey(second), variantKey(second)]]);
    const { rows, hidden } = foldVariants(all, choices, false);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.picked).toBe(true);
    expect(rows[0]?.pack_ids).toEqual(['2']);
    expect(hidden).toBe(2);
  });

  it('shows the others on request, the chosen one marked', () => {
    const all = groups();
    const first = all[0];
    if (first === undefined) throw new Error('fixture');
    const choices = new Map([[familyKey(first), variantKey(first)]]);
    const { rows, hidden } = foldVariants(all, choices, true);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.picked)).toHaveLength(1);
    expect(hidden).toBe(0);
  });

  it('flags a choice whose version is gone and keeps every version', () => {
    const choices = new Map([['Pioneer Package|4.99', 'deadbeefdeadbeef']]);
    const { rows } = foldVariants(groups(), choices, false);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.stale && !r.family_picked)).toBe(true);
  });

  it('leaves a name with one version alone, chosen or not', () => {
    const only = groupPacks([stage('1', 4)]);
    const first = only[0];
    if (first === undefined) throw new Error('fixture');
    const choices = new Map([[familyKey(first), variantKey(first)]]);
    const { rows } = foldVariants(only, choices, false);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.picked).toBe(false);
    expect(rows[0]?.stale).toBe(false);
  });

  it('keys a version by what is in it, not by its ids', () => {
    const a = groupPacks([stage('1', 4)])[0];
    const b = groupPacks([stage('99', 4)])[0];
    if (a === undefined || b === undefined) throw new Error('fixture');
    expect(variantKey(a)).toBe(variantKey(b));
    expect(variantKey(a)).not.toBe(variantKey(groupPacks([stage('1', 5)])[0] as PackGroup));
  });
});

describe('what the store lists', () => {
  const open = { starts_at: '2026-10-01T00:00:00Z', ends_at: null, listed: true };

  it('treats a pack shown only with an event item as gated', () => {
    expect(isGated({ show_type: '6;240027' })).toBe(true);
    expect(isGated({ show_type: '' })).toBe(false);
    expect(isGated({ show_type: null })).toBe(false);
    expect(isGated({})).toBe(false);
  });

  it('lists on sale and not gated packs, and leaves gated ones to the event view', () => {
    expect(isInStore({ ...open, show_type: '' }, NOW)).toBe(true);
    expect(isInStore({ ...open, show_type: '6;240027' }, NOW)).toBe(false);
    expect(isInStore({ ...open, show_type: '', listed: false }, NOW)).toBe(false);
  });

  it("strips the game's markup from a name", () => {
    expect(plainName('<b>100</b>-Ruby Pack')).toBe('100-Ruby Pack');
    expect(plainName('Pioneer Package')).toBe('Pioneer Package');
  });
});
