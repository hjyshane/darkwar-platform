import { describe, expect, it } from 'vitest';
import { type Target, breakthroughsCrossed, goalsOf, withTarget } from './targets';

const wt: Target = { kind: 'building', subject: '400000', name: 'Watchtower', from: 30, to: 35 };

describe('withTarget', () => {
  it('replaces the target for the same thing', () => {
    const once = withTarget(new Map(), wt);
    const twice = withTarget(once, { ...wt, to: 40 });
    expect([...twice.values()].map((t) => t.to)).toEqual([40]);
  });

  it('drops a target that raises nothing', () => {
    expect(withTarget(withTarget(new Map(), wt), { ...wt, to: 30 }).size).toBe(0);
  });
});

describe('goalsOf', () => {
  it('turns gear into its level list and stages, and heroes into the Food list', () => {
    const { goals, names } = goalsOf([
      {
        kind: 'hero_gear',
        subject: '0:410100:5',
        name: 'Mia · D5-Slayer',
        from: 90,
        to: 100,
        stageFrom: 0,
        stageTo: 2,
      },
      { kind: 'hero', subject: '1017', name: 'Mia', from: 100, to: 110 },
      { kind: 'exclusive', subject: '40002', name: 'Pyro Pup · exclusive weapon', from: 3, to: 5 },
    ]);

    expect(goals).toEqual([
      { kind: 'hero_gear', subject: 'level:q5', from: 90, to: 100 },
      { kind: 'hero_gear', subject: 'promote', from: 0, to: 2 },
      { kind: 'hero', subject: 'hero', from: 100, to: 110 },
      { kind: 'exclusive', subject: '40002', from: 3, to: 5 },
    ]);
    expect(names[1]).toBe('Mia · D5-Slayer (stages)');
  });
});

describe('pets', () => {
  it('needs every breakthrough it passes and has not reached', () => {
    expect(breakthroughsCrossed(60, 75, 60)).toEqual([70]);
    expect(breakthroughsCrossed(65, 90, 60)).toEqual([70, 80]);
    // At a cap not yet broken: that one first.
    expect(breakthroughsCrossed(70, 72, 60)).toEqual([70]);
    // Up to a cap only: nothing to break.
    expect(breakthroughsCrossed(61, 70, 60)).toEqual([]);
  });

  it('turns a pet target into its rarity levels and breakthroughs', () => {
    const { goals, names } = goalsOf([
      { kind: 'pet', subject: '106:4', name: 'Rex', from: 65, to: 75, stageFrom: 60 },
    ]);
    expect(goals).toEqual([
      { kind: 'pet', subject: '4', from: 65, to: 75 },
      { kind: 'pet_break', subject: '4', from: 69, to: 70 },
    ]);
    expect(names).toEqual(['Rex', 'Rex (breakthrough 70)']);
  });
});
