import { describe, expect, it } from 'vitest';
import type { PlannedStep, Step } from '../planner/plan';
import {
  KIND_OPTIONS,
  buffFields,
  buffsFor,
  goalsFor,
  levelFloor,
  levelName,
  notesFor,
  planTables,
  stepTable,
  withoutInertBuffs,
} from './model';
import { DEFAULT_STATE } from './url';

const TIERS = new Map([['400000', new Map([[35, 1]])]]);

function planned(step: Partial<Step> & Pick<Step, 'kind' | 'level'>): PlannedStep {
  return {
    step: { subject_id: '409000', name: 'Bank', costs: [], seconds: null, requires: [], ...step },
    prerequisite: false,
    goal: 0,
  };
}

describe('the form', () => {
  it('lists the kinds in the order the spec gives, season buildings last', () => {
    expect(KIND_OPTIONS.map((k) => k.id)).toEqual([
      'building',
      'research',
      'hero',
      'hero_gear',
      'exclusive',
      'vehicle',
      'vehicle_part',
      'chip',
      'pet',
      'season',
    ]);
  });

  it('shows a buff field only where the planner applies the buff', () => {
    expect(buffFields('building')).toEqual({ speed: true, cost: true });
    expect(buffFields('research')).toEqual({ speed: true, cost: false });
    expect(buffFields('chip')).toEqual({ speed: false, cost: false });
  });

  it('never keeps an inert buff in the state it writes to the address', () => {
    const state = { ...DEFAULT_STATE, speed: 35, cost: 10 };
    expect(withoutInertBuffs({ ...state, kind: 'chip' })).toMatchObject({ speed: 0, cost: 0 });
    expect(withoutInertBuffs({ ...state, kind: 'research' })).toMatchObject({
      speed: 35,
      cost: 0,
    });
    expect(withoutInertBuffs(state)).toMatchObject({ speed: 35, cost: 10 });
  });

  it('floors from at the level a track starts from', () => {
    // Hero, vehicle and pet steps start at level 2: the thing exists at 1.
    expect(levelFloor('hero')).toBe(1);
    expect(levelFloor('vehicle')).toBe(1);
    expect(levelFloor('pet')).toBe(1);
    expect(levelFloor('building')).toBe(0);
    expect(levelFloor('chip')).toBe(0);
  });
});

describe('goalsFor', () => {
  it('is one goal for the range, and none without a subject or a climb', () => {
    const state = { ...DEFAULT_STATE, subject: '409000', from: 28, to: 30 };
    expect(goalsFor(state)).toEqual([{ kind: 'building', subject: '409000', from: 28, to: 30 }]);
    expect(goalsFor({ ...state, subject: null })).toEqual([]);
    expect(goalsFor({ ...state, to: 28 })).toEqual([]);
  });

  it('adds the breakthroughs a pet passes on the way', () => {
    const goals = goalsFor({ ...DEFAULT_STATE, kind: 'pet', subject: '4', from: 8, to: 25 });
    expect(goals).toEqual([
      { kind: 'pet', subject: '4', from: 8, to: 25 },
      { kind: 'pet_break', subject: '4', from: 9, to: 10 },
      { kind: 'pet_break', subject: '4', from: 19, to: 20 },
    ]);
  });

  it('feeds the speed figure to the clock the kind runs on, and to no other', () => {
    expect(buffsFor({ ...DEFAULT_STATE, speed: 35, cost: 10 })).toEqual({
      constructionSpeed: 35,
      researchSpeed: 0,
      costReduction: 10,
    });
    // A research priced with its buildings: the bonus does not build faster.
    expect(buffsFor({ ...DEFAULT_STATE, kind: 'research', speed: 35 })).toEqual({
      constructionSpeed: 0,
      researchSpeed: 35,
      costReduction: 0,
    });
  });

  it('keeps the prerequisites switch only on a kind that has prerequisites', () => {
    const on = { ...DEFAULT_STATE, prereqs: true };
    expect(withoutInertBuffs(on).prereqs).toBe(true);
    expect(withoutInertBuffs({ ...on, kind: 'research' }).prereqs).toBe(true);
    expect(withoutInertBuffs({ ...on, kind: 'pet' }).prereqs).toBe(false);
  });
});

describe('levelName', () => {
  it('names a level the way the game shows that kind', () => {
    expect(levelName('building', '409000', 0, TIERS)).toBe('Not built');
    expect(levelName('building', '400000', 35, TIERS)).toBe('i1 · 35');
    expect(levelName('building', '409000', 28, TIERS)).toBe('28');
    expect(levelName('exclusive', '40002', 27, TIERS)).toBe('★5 ⬠0 ▰2');
    expect(levelName('chip', '4', 5, TIERS)).toBe('0★ 5/10');
    expect(levelName('research', '908200', 3, TIERS)).toBe('3');
  });
});

describe('stepTable', () => {
  const wood = (amount: number) => [{ type: 'resource' as const, id: '25', amount }];
  const steps = [
    planned({ kind: 'building', level: 29, costs: wood(100), seconds: 60 }),
    planned({ kind: 'building', level: 30, costs: wood(100), seconds: 60 }),
  ];

  it('prices every step and the total after buffs, through the planner totals', () => {
    const table = stepTable(steps, {
      constructionSpeed: 100,
      researchSpeed: 0,
      costReduction: 50,
    });
    expect(table.materials).toEqual([{ type: 'resource', id: '25', amount: 100 }]);
    expect(table.rows.map((r) => [r.level, r.amounts.get('resource:25'), r.seconds])).toEqual([
      [29, 50, 30],
      [30, 50, 30],
    ]);
    expect(table.total.amounts.get('resource:25')).toBe(100);
    expect(table.total.seconds).toBe(60);
    expect(table.total.level).toBeNull();
  });

  it('gives every row a key of its own, a breakthrough beside the level it sits at', () => {
    const table = stepTable(
      [
        planned({ kind: 'pet', subject_id: '4', level: 10 }),
        planned({ kind: 'pet_break', subject_id: '4', level: 10 }),
      ],
      { constructionSpeed: 0, researchSpeed: 0, costReduction: 0 },
    );
    expect(new Set(table.rows.map((r) => r.key)).size).toBe(2);
  });
});

describe('planTables', () => {
  const wood = (amount: number) => [{ type: 'resource' as const, id: '25', amount }];
  const parts = (amount: number) => [{ type: 'item' as const, id: '253042', amount }];
  const none = { constructionSpeed: 0, researchSpeed: 0, costReduction: 0 };
  const first = (step: Parameters<typeof planned>[0]): PlannedStep => ({
    ...planned(step),
    prerequisite: true,
  });

  it('is one table when nothing is needed first', () => {
    const tables = planTables([planned({ kind: 'building', level: 30, costs: wood(100) })], none);
    expect(tables.needed).toBeNull();
    expect(tables.own).toBe(tables.all);
  });

  it('folds each thing needed first into one row and keeps the range step by step', () => {
    const tables = planTables(
      [
        first({ kind: 'building', subject_id: '401000', name: 'Wall', level: 29, costs: parts(5) }),
        first({ kind: 'building', subject_id: '401000', name: 'Wall', level: 30, costs: parts(7) }),
        first({ kind: 'research', subject_id: '7001', name: null, level: 1, costs: wood(40) }),
        planned({ kind: 'building', level: 30, costs: wood(100), seconds: 60 }),
      ],
      none,
    );
    expect(tables.needed?.rows.map((r) => [r.climb, r.amounts.get('item:253042')])).toEqual([
      [{ name: 'Wall', floor: 28, from: 28, to: 30 }, 12],
      [{ name: 'Research 7001', floor: 0, from: 0, to: 1 }, undefined],
    ]);
    expect(tables.needed?.total.amounts.get('resource:25')).toBe(40);
    expect(tables.own.rows.map((r) => r.level)).toEqual([30]);
    expect(tables.own.total.amounts.get('resource:25')).toBe(100);
    // The top of the page is everything, and every table has its columns.
    expect(tables.all.total.amounts.get('resource:25')).toBe(140);
    expect(tables.own.materials).toBe(tables.all.materials);
    expect(tables.needed?.materials).toBe(tables.all.materials);
  });
});

describe('planTables with levels the reader set', () => {
  const parts = (amount: number) => [{ type: 'item' as const, id: '253042', amount }];
  const none = { constructionSpeed: 0, researchSpeed: 0, costReduction: 0 };
  const wall = (level: number): PlannedStep => ({
    ...planned({ kind: 'building', subject_id: '401000', name: 'Wall', level, costs: parts(5) }),
    prerequisite: true,
  });
  const lab: PlannedStep = {
    ...planned({ kind: 'building', subject_id: '402000', name: 'Lab', level: 3, costs: parts(9) }),
    prerequisite: true,
  };
  const bank = planned({ kind: 'building', level: 30, costs: parts(1) });
  const floor = [wall(29), wall(30), lab, bank];

  it('keeps every row the floor listed, priced from where it now stands', () => {
    // Wall said to be at 29 already; the Lab at 3, so nothing of it is left.
    const tables = planTables([wall(30), bank], none, floor);
    expect(tables.needed?.rows.map((r) => [r.climb, r.amounts.get('item:253042') ?? 0])).toEqual([
      [{ name: 'Wall', floor: 28, from: 29, to: 30 }, 5],
      [{ name: 'Lab', floor: 2, from: 3, to: 3 }, 0],
    ]);
    expect(tables.needed?.total.amounts.get('item:253042')).toBe(5);
    expect(tables.all.total.amounts.get('item:253042')).toBe(6);
  });

  it('still lists them when nothing is left to pay, so a level can be set back', () => {
    const tables = planTables([bank], none, floor);
    expect(tables.needed?.rows).toHaveLength(2);
    expect(tables.needed?.total.amounts.size).toBe(0);
    expect(tables.own.rows.map((r) => r.level)).toEqual([30]);
  });
});

describe('notesFor', () => {
  const chip = { ...DEFAULT_STATE, kind: 'chip' as const, subject: '5', to: 100 };
  const sums = {
    materials: [
      { type: 'counter' as const, id: 'chip_exp', amount: 129_000_000 },
      { type: 'counter' as const, id: 'chip_duplicate:5', amount: 500 },
    ],
    buildSeconds: 0,
    researchSeconds: 0,
  };
  const cards = [
    { itemId: '300017', name: 'Small card', amount: 500 },
    { itemId: '300030', name: 'Big card', amount: 60_000 },
  ];

  it('converts chip EXP to the largest card from data, and counts duplicates', () => {
    expect(notesFor(chip, sums, cards)).toEqual([
      '129M EXP = 2,150 × Big card (60,000 each)',
      '500 duplicates of the same chip',
    ]);
  });

  it('states the EXP alone when no card value is readable', () => {
    expect(notesFor(chip, sums, [])[0]).toBe('129M star-up EXP');
    expect(notesFor(chip, sums, [{ itemId: 'x', name: 'Broken', amount: 0 }])[0]).toBe(
      '129M star-up EXP',
    );
  });

  it('says what a building or research total leaves out', () => {
    const none = { materials: [], buildSeconds: 0, researchSeconds: 0 };
    expect(notesFor({ ...DEFAULT_STATE, subject: '409000', to: 30 }, none, [])).toEqual([
      'Buildings this needs first are not included; Advanced adds them.',
    ]);
    expect(notesFor({ ...DEFAULT_STATE, kind: 'research', subject: '1', to: 3 }, none, [])).toEqual(
      ['Research and buildings this needs first are not included; Advanced adds them.'],
    );
    // With them priced in, there is nothing left out to mention.
    expect(
      notesFor({ ...DEFAULT_STATE, subject: '409000', to: 30, prereqs: true }, none, []),
    ).toEqual([]);
  });

  it('marks an exclusive weapon range that reaches the red ranks', () => {
    const none = { materials: [], buildSeconds: 0, researchSeconds: 0 };
    const weapon = { ...DEFAULT_STATE, kind: 'exclusive' as const, subject: '40002' };
    const same = 'Every exclusive weapon takes the same count, in its own fragments.';
    expect(notesFor({ ...weapon, to: 25 }, none, [])).toEqual([same]);
    expect(notesFor({ ...weapon, to: 26 }, none, [])).toEqual([
      same,
      'Red ranks open season by season.',
    ]);
  });

  it('says a vehicle part range holds for every part', () => {
    const none = { materials: [], buildSeconds: 0, researchSeconds: 0 };
    expect(
      notesFor({ ...DEFAULT_STATE, kind: 'vehicle_part', subject: '1', to: 66 }, none, []),
    ).toEqual(['Every vehicle part costs the same.']);
  });

  it('counts the breakthroughs a pet range includes', () => {
    const none = { materials: [], buildSeconds: 0, researchSeconds: 0 };
    expect(
      notesFor({ ...DEFAULT_STATE, kind: 'pet', subject: '4', from: 8, to: 25 }, none, []),
    ).toEqual(['Includes 2 breakthroughs (levels 10, 20).']);
  });
});
