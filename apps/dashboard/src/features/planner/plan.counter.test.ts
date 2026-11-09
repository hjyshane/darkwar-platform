// Counter costs (0311): chip star-up EXP points and duplicates are summed by
// id like items and resources, never discounted, and never matched against
// stock — a player holds EXP cards, not points.
import { describe, expect, it } from 'vitest';
import { type Buffs, type PlannedStep, type Step, stockable, totals } from './plan';

const NO_BUFFS: Buffs = { constructionSpeed: 0, researchSpeed: 0, costReduction: 0 };

function chipStep(level: number, costs: Step['costs']): PlannedStep {
  return {
    step: { kind: 'chip', subject_id: '4', level, name: null, costs, seconds: null, requires: [] },
    prerequisite: false,
    goal: 0,
  };
}

describe('totals with counters', () => {
  const steps = [
    chipStep(1, [{ type: 'counter', id: 'chip_exp', amount: 500 }]),
    chipStep(2, [{ type: 'counter', id: 'chip_exp', amount: 1000 }]),
    chipStep(10, [{ type: 'counter', id: 'chip_duplicate:4', amount: 1 }]),
  ];

  it('sums counters by id alongside everything else', () => {
    expect(totals(steps, NO_BUFFS).materials).toEqual([
      { type: 'counter', id: 'chip_exp', amount: 1500 },
      { type: 'counter', id: 'chip_duplicate:4', amount: 1 },
    ]);
  });

  it('never discounts a counter', () => {
    const { materials } = totals(steps, { ...NO_BUFFS, costReduction: 50 });
    expect(materials.find((m) => m.id === 'chip_exp')?.amount).toBe(1500);
  });

  it('keeps a counter apart from an item or resource of the same id', () => {
    const mixed = [
      chipStep(1, [
        { type: 'counter', id: '25', amount: 1 },
        { type: 'resource', id: '25', amount: 1 },
      ]),
    ];
    expect(totals(mixed, NO_BUFFS).materials).toHaveLength(2);
  });
});

describe('stockable', () => {
  it('drops counters and keeps what an account can hold', () => {
    expect(
      stockable([
        { type: 'resource', id: '25', amount: 10 },
        { type: 'counter', id: 'chip_exp', amount: 500 },
        { type: 'item', id: '230104', amount: 3 },
      ]),
    ).toEqual([
      { type: 'resource', id: '25', amount: 10 },
      { type: 'item', id: '230104', amount: 3 },
    ]);
  });
});
