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
      ['level:q5', 'Orange gear · to level 100'],
    ]);
    expect(
      ['1', '2', '3', '4'].map((q) => gearSubjectName(`level:q${q}`, 60).split(' gear')[0]),
    ).toEqual(['Grey', 'Green', 'Blue', 'Purple']);
    // A quality the game adds later keeps its number until it is named here.
    expect(gearSubjectName('level:q6', 120)).toBe('Quality 6 gear · to level 120');
  });

  it("names chips by quality, not by the view's top step label", () => {
    const labelled = labelSubjects(
      'chip',
      [subject('5', '10★ 0/10', 100), subject('4', '10★ 0/10', 100)],
      new Map(),
    );
    expect(labelled.map((s) => s.name)).toEqual(['Purple chip', 'Orange chip']);
  });

  it('offers the vehicle parts and the exclusive weapons as one entry each', () => {
    const parts = labelSubjects(
      'vehicle_part',
      [subject('3', 'Armor', 66), subject('1', 'Gun', 66), subject('6', 'Wheel', 66)],
      new Map(),
    );
    expect(parts.map((s) => [s.subject, s.name, s.maxLevel])).toEqual([
      ['1', 'Vehicle part (any)', 66],
    ]);
    const weapons = labelSubjects(
      'exclusive',
      [subject('40002', 'Pyro Pup', 52), subject('21001', 'Blood Rose', 52)],
      new Map([['40002', 'Margaret']]),
    );
    expect(weapons.map((s) => [s.subject, s.name])).toEqual([['21001', 'Exclusive weapon (any)']]);
  });

  it('lists them apart again if their tracks stop at different levels', () => {
    const labelled = labelSubjects(
      'exclusive',
      [subject('40002', 'Pyro Pup', 52), subject('40006', 'Night Owl', 40)],
      new Map([['40002', 'Margaret']]),
    );
    expect(labelled.map((s) => s.name)).toEqual(['Night Owl', 'Pyro Pup (Margaret)']);
    const parts = labelSubjects(
      'vehicle_part',
      [subject('2', 'Engine', 66), subject('1', 'Gun', 70)],
      new Map(),
    );
    expect(parts.map((s) => s.name)).toEqual(['Gun', 'Engine']);
  });

  it('names the single-subject kinds, and pets by grade', () => {
    expect(labelSubjects('hero', [subject('hero', '#hero', 200)], new Map())[0]?.name).toBe(
      'Hero level',
    );
    expect(labelSubjects('vehicle', [subject('0', '#0', 500)], new Map())[0]?.name).toBe('Vehicle');
    expect(
      labelSubjects('pet', [subject('4', '#4', 100), subject('1', '#1', 60)], new Map()).map(
        (s) => s.name,
      ),
    ).toEqual(['C-grade pet · to level 60', 'S-grade pet · to level 100']);
    expect(
      labelSubjects('pet', [subject('2', '#2', 70), subject('3', '#3', 80)], new Map()).map(
        (s) => s.name,
      ),
    ).toEqual(['B-grade pet · to level 70', 'A-grade pet · to level 80']);
  });

  it('sorts buildings by name, leaving out unnamed and hidden ones (buildingList.ts)', () => {
    const labelled = labelSubjects(
      'building',
      [
        subject('999000', '#999000'),
        subject('438000', 'Warehouse'),
        subject('409000', 'Bank'),
        subject('424000', 'Blastproof Hall'),
      ],
      new Map(),
    );
    expect(labelled.map((s) => s.name)).toEqual(['Blastproof Hall', 'Warehouse']);
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
