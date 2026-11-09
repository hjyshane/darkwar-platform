import { describe, expect, it } from 'vitest';
import type { Subject } from '../planner/data';
import { expCardsFrom, gearSubjectName, labelSubjects } from './data';

function subject(id: string, name: string, maxLevel = 30): Subject {
  return { subject: id, name, nameKo: null, maxLevel, category: null, gameSeason: null };
}

describe('labelSubjects', () => {
  it('offers hero gear by quality only, never the stage track', () => {
    const labelled = labelSubjects(
      'hero_gear',
      [subject('promote', '#promote', 36), subject('level:q5', '#level:q5', 100)],
      new Map(),
    );
    expect(labelled.map((s) => [s.subject, s.name])).toEqual([
      ['level:q5', 'Quality 5 gear · to level 100'],
    ]);
    expect(gearSubjectName('level:q3', 60)).toBe('Quality 3 gear · to level 60');
  });

  it('names chips by quality, not by the view\'s top step label', () => {
    const labelled = labelSubjects(
      'chip',
      [subject('5', '10★ 0/10', 100), subject('4', '10★ 0/10', 100)],
      new Map(),
    );
    expect(labelled.map((s) => s.name)).toEqual(['Purple chip', 'Orange chip']);
  });

  it('puts the hero beside an exclusive weapon, so either name finds it', () => {
    const labelled = labelSubjects(
      'exclusive',
      [subject('40002', 'Pyro Pup', 52), subject('40006', 'Night Owl', 52)],
      new Map([['40002', 'Margaret']]),
    );
    expect(labelled.map((s) => s.name)).toEqual(['Night Owl', 'Pyro Pup (Margaret)']);
  });

  it('names the single-subject kinds and the pet rarities', () => {
    expect(labelSubjects('hero', [subject('hero', '#hero', 200)], new Map())[0]?.name).toBe(
      'Hero level',
    );
    expect(labelSubjects('vehicle', [subject('0', '#0', 500)], new Map())[0]?.name).toBe(
      'Vehicle',
    );
    expect(
      labelSubjects('pet', [subject('4', '#4', 100), subject('1', '#1', 60)], new Map()).map(
        (s) => s.name,
      ),
    ).toEqual(['Pet · rarity 1', 'Pet · rarity 4']);
  });

  it('sorts buildings by name and leaves the unnamed ones last', () => {
    const labelled = labelSubjects(
      'building',
      [subject('999000', '#999000'), subject('438000', 'Warehouse'), subject('409000', 'Bank')],
      new Map(),
    );
    expect(labelled.map((s) => s.name)).toEqual(['Bank', 'Warehouse', '#999000']);
  });
});

describe('expCardsFrom', () => {
  it('keeps the rows that carry a chip EXP value and drops the rest', () => {
    expect(
      expCardsFrom([
        { item_id: '300030', name: 'Big', counter_value: { id: 'chip_exp', amount: 60000 } },
        { item_id: '300031', name: 'Other', counter_value: { id: 'something', amount: 5 } },
        { item_id: '300032', name: null, counter_value: { id: 'chip_exp', amount: 500 } },
        { item_id: '300033', name: 'Bad', counter_value: [60000] },
        { item_id: '300034', name: 'Zero', counter_value: { id: 'chip_exp', amount: 0 } },
      ]),
    ).toEqual([
      { itemId: '300030', name: 'Big', amount: 60000 },
      { itemId: '300032', name: 'EXP card 300032', amount: 500 },
    ]);
  });
});
