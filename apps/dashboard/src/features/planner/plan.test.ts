import { describe, expect, it } from 'vitest';
import {
  type Step,
  type StepBook,
  bookKey,
  buffsFrom,
  duration,
  groupSteps,
  plan,
  totals,
} from './plan';

function step(
  subject: string,
  level: number,
  parts: number,
  requires: { subject: string; level: number; kind?: 'building' | 'research' }[] = [],
  kind: Step['kind'] = 'building',
): Step {
  return {
    kind,
    subject_id: subject,
    level,
    name: subject,
    costs: [
      { type: 'resource', id: '25', amount: 1000 },
      { type: 'item', id: '253042', amount: parts },
    ],
    seconds: 3600,
    requires,
  };
}

function book(...steps: Step[]): StepBook {
  const out: StepBook = new Map();
  for (const s of steps) {
    const key = bookKey(s.kind, s.subject_id);
    const levels = out.get(key) ?? new Map();
    levels.set(s.level, s);
    out.set(key, levels);
  }
  return out;
}

// Watchtower 31 and 32 each need Alliance Hall 31; Alliance Hall 31 needs nothing.
const BOOK = book(
  step('400000', 31, 180, [{ subject: '402000', level: 31 }]),
  step('400000', 32, 180, [{ subject: '402000', level: 31 }]),
  step('402000', 31, 40),
  step('402000', 32, 40),
);
const LEVELS = new Map([
  ['400000', 30],
  ['402000', 30],
]);

describe('plan', () => {
  it('adds the steps above the current level, by the level each reaches', () => {
    const out = plan([{ kind: 'building', subject: '402000', from: 30, to: 32 }], BOOK, LEVELS);
    expect(out.steps.map((s) => s.step.level)).toEqual([31, 32]);
    expect(out.missing).toEqual([]);
  });

  it('pulls in a prerequisite once, before the step that needs it', () => {
    const out = plan([{ kind: 'building', subject: '400000', from: 30, to: 32 }], BOOK, LEVELS);
    expect(out.steps.map((s) => `${s.step.subject_id}:${s.step.level}:${s.prerequisite}`)).toEqual([
      '402000:31:true',
      '400000:31:false',
      '400000:32:false',
    ]);
  });

  it('counts a prerequisite already met by an earlier goal', () => {
    const out = plan(
      [
        { kind: 'building', subject: '402000', from: 30, to: 32 },
        { kind: 'building', subject: '400000', from: 30, to: 31 },
      ],
      BOOK,
      LEVELS,
    );
    expect(out.steps.filter((s) => s.prerequisite)).toEqual([]);
  });

  it('can leave prerequisites out', () => {
    const out = plan(
      [{ kind: 'building', subject: '400000', from: 30, to: 31 }],
      BOOK,
      LEVELS,
      false,
    );
    expect(out.steps.map((s) => s.step.subject_id)).toEqual(['400000']);
  });

  it('reports a building it has no steps for, so the caller can load it', () => {
    const out = plan([{ kind: 'building', subject: '424000', from: 30, to: 31 }], BOOK, LEVELS);
    expect(out.missing).toEqual(['424000']);
  });

  it('reports a level past the end of a subject as a gap', () => {
    const out = plan([{ kind: 'building', subject: '402000', from: 30, to: 40 }], BOOK, LEVELS);
    expect(out.gaps).toEqual([{ kind: 'building', subject: '402000', level: 33 }]);
  });
});

describe('totals', () => {
  it('discounts building resources but not items, and speeds time up', () => {
    const out = plan([{ kind: 'building', subject: '402000', from: 30, to: 32 }], BOOK, LEVELS);
    const t = totals(out.steps, { constructionSpeed: 100, researchSpeed: 0, costReduction: 20 });
    expect(t.materials).toEqual([
      { type: 'resource', id: '25', amount: 1600 },
      { type: 'item', id: '253042', amount: 80 },
    ]);
    // 2 x 3600 s at +100% is 3600 s.
    expect(t.buildSeconds).toBe(3600);
  });

  it('matches the user table: 7d23h at +73.14% is 4d15h', () => {
    const t = totals(
      [{ step: { ...step('400000', 31, 180), seconds: 689184 }, prerequisite: false, goal: 0 }],
      { constructionSpeed: 73.14, researchSpeed: 0, costReduction: 0 },
    );
    expect(duration(t.buildSeconds)).toBe('4d 15h');
  });
});

describe('buffsFrom', () => {
  it('reads the server totals and adds a switched-on timed buff', () => {
    const b = buffsFrom({ '30070': 156.16, '30071': 171.51, '30421': 20 }, [
      { effect: 30070, value: 50 },
    ]);
    expect(b).toEqual({ constructionSpeed: 206.16, researchSpeed: 171.51, costReduction: 20 });
  });
});

describe('groupSteps', () => {
  it('splits a plan into each goal and each building needed first', () => {
    const out = plan(
      [
        { kind: 'building', subject: '400000', from: 30, to: 32 },
        { kind: 'building', subject: '402000', from: 31, to: 32 },
      ],
      BOOK,
      LEVELS,
    );
    const groups = groupSteps(out.steps);

    expect(groups.map((g) => [g.key, g.from, g.to, g.prerequisite])).toEqual([
      ['pre:building:402000', 30, 31, true],
      ['goal:0', 30, 32, false],
      ['goal:1', 31, 32, false],
    ]);
    // A prerequisite remembers which goal needed it.
    expect(groups[0]?.goal).toBe(0);
  });

  it('keeps two goals on one cost list apart', () => {
    const gear = book(
      step('level:q5', 1, 1, [], 'hero_gear'),
      step('level:q5', 2, 1, [], 'hero_gear'),
    );
    const out = plan(
      [
        { kind: 'hero_gear', subject: 'level:q5', from: 0, to: 2 },
        { kind: 'hero_gear', subject: 'level:q5', from: 1, to: 2 },
      ],
      gear,
      new Map(),
    );

    expect(groupSteps(out.steps).map((g) => g.steps.length)).toEqual([2, 1]);
  });
});

// A research needs a Research Center level AND an earlier research (0243).
//   research 819100 level 1 needs building 403000 at 30 and research 818100 at 2.
//   research 818100 levels 1 and 2 need building 403000 at 30 and 20.
const RESEARCH = book(
  step(
    '819100',
    1,
    5,
    [
      { subject: '403000', level: 30 },
      { subject: '818100', level: 2, kind: 'research' },
    ],
    'research',
  ),
  step('818100', 1, 3, [{ subject: '403000', level: 20 }], 'research'),
  step('818100', 2, 3, [{ subject: '403000', level: 20 }], 'research'),
  step('403000', 21, 7),
  step('403000', 22, 7),
  step('403000', 23, 7),
  step('403000', 24, 7),
  step('403000', 25, 7),
  step('403000', 26, 7),
  step('403000', 27, 7),
  step('403000', 28, 7),
  step('403000', 29, 7),
  step('403000', 30, 7),
);
const GOAL = [{ kind: 'research' as const, subject: '819100', from: 0, to: 1 }];

describe('research prerequisites', () => {
  it('pulls in the earlier research and the buildings it needs, in order', () => {
    const out = plan(GOAL, RESEARCH, new Map([['403000', 20]]), true, new Map());
    const order = out.steps.map((p) => `${p.step.kind}:${p.step.subject_id}:${p.step.level}`);
    // The research it needs first (818100 1, 2), the Research Center climb to 30,
    // then the goal itself.
    expect(order.at(-1)).toBe('research:819100:1');
    expect(order).toContain('research:818100:1');
    expect(order).toContain('research:818100:2');
    expect(order).toContain('building:403000:30');
    expect(order.indexOf('research:818100:2')).toBeLessThan(order.indexOf('research:819100:1'));
    expect(order.indexOf('building:403000:30')).toBeLessThan(order.indexOf('research:819100:1'));
    expect(out.steps.filter((p) => p.prerequisite).length).toBe(out.steps.length - 1);
    expect(out.missing).toEqual([]);
    expect(out.missingResearch).toEqual([]);
  });
  it('does not plan research or buildings the account already has', () => {
    const out = plan(GOAL, RESEARCH, new Map([['403000', 30]]), true, new Map([['818100', 2]]));
    expect(out.steps.map((p) => p.step.subject_id)).toEqual(['819100']);
  });
  it('plans only the research still short', () => {
    const out = plan(GOAL, RESEARCH, new Map([['403000', 30]]), true, new Map([['818100', 1]]));
    expect(out.steps.map((p) => `${p.step.subject_id}:${p.step.level}`)).toEqual([
      '818100:2',
      '819100:1',
    ]);
  });
  it('asks for a research it has no steps for yet, instead of dropping it', () => {
    const partial = book(
      step('819100', 1, 5, [{ subject: '818100', level: 2, kind: 'research' }], 'research'),
    );
    const out = plan(GOAL, partial, new Map(), true, new Map());
    expect(out.missingResearch).toEqual(['818100']);
  });
  it('adds nothing when prerequisites are switched off', () => {
    const out = plan(GOAL, RESEARCH, new Map(), false, new Map());
    expect(out.steps.map((p) => p.step.subject_id)).toEqual(['819100']);
  });
  it('groups a prerequisite research apart from the buildings, and totals its time as research', () => {
    const out = plan(GOAL, RESEARCH, new Map([['403000', 30]]), true, new Map());
    const groups = groupSteps(out.steps);
    expect(groups.map((g) => g.key)).toEqual(['pre:research:818100', 'goal:0']);
    const sums = totals(out.steps, { constructionSpeed: 0, researchSpeed: 0, costReduction: 0 });
    // Three research steps of an hour each; no building was needed.
    expect(sums.researchSeconds).toBe(3 * 3600);
    expect(sums.buildSeconds).toBe(0);
  });
  it('does not loop on research that needs itself', () => {
    const circular = book(
      step('900100', 1, 1, [{ subject: '900100', level: 1, kind: 'research' }], 'research'),
    );
    expect(() =>
      plan([{ kind: 'research', subject: '900100', from: 0, to: 1 }], circular, new Map(), true),
    ).not.toThrow();
  });
});
