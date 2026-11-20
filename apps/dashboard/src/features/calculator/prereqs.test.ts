import { describe, expect, it } from 'vitest';
import { type Requirement, type Step, type StepBook, bookKey } from '../planner/plan';
import { fromNothing, planWithPrerequisites, standingAfter } from './prereqs';

function step(
  kind: 'building' | 'research',
  subject: string,
  level: number,
  requires: Requirement[] = [],
): Step {
  return {
    kind,
    subject_id: subject,
    level,
    name: subject,
    costs: [{ type: 'resource', id: '25', amount: 100 }],
    seconds: 60,
    requires,
  };
}

function book(...steps: Step[]): StepBook {
  const out: StepBook = new Map();
  for (const s of steps) {
    const key = bookKey(s.kind, s.subject_id);
    const levels = out.get(key) ?? new Map<number, Step>();
    levels.set(s.level, s);
    out.set(key, levels);
  }
  return out;
}

/** HQ level n needs Wall n-1; Wall level n needs Depot n-1. */
const BASE = book(
  ...[1, 2, 3, 4].map((n) =>
    step('building', 'hq', n, n > 1 ? [{ subject: 'wall', level: n - 1 }] : []),
  ),
  ...[1, 2, 3].map((n) =>
    step('building', 'wall', n, n > 1 ? [{ subject: 'depot', level: n - 1 }] : []),
  ),
  ...[1, 2].map((n) => step('building', 'depot', n)),
);

const reached = (plan: { steps: { step: Step; prerequisite: boolean }[] }) =>
  plan.steps.map((s) => `${s.step.subject_id} ${s.step.level}${s.prerequisite ? ' first' : ''}`);

describe('planWithPrerequisites', () => {
  it('adds only what the range asks for beyond what the from level already did', () => {
    // At HQ 3 the Wall stands at 2 and the Depot at 1. HQ 4 asks for Wall 3,
    // and Wall 3 for Depot 2: one step each, not their climbs from nothing.
    const plan = planWithPrerequisites([{ kind: 'building', subject: 'hq', from: 3, to: 4 }], BASE);
    expect(reached(plan)).toEqual(['depot 2 first', 'wall 3 first', 'hq 4']);
    expect(plan.gaps).toEqual([]);
  });

  it('prices everything from nothing when the range starts unbuilt', () => {
    const plan = planWithPrerequisites([{ kind: 'building', subject: 'hq', from: 0, to: 3 }], BASE);
    expect(reached(plan)).toEqual([
      'hq 1',
      'wall 1 first',
      'hq 2',
      'depot 1 first',
      'wall 2 first',
      'hq 3',
    ]);
  });

  it('adds nothing when the range asks for nothing new', () => {
    const flat = book(
      step('building', 'hq', 1, [{ subject: 'wall', level: 1 }]),
      step('building', 'hq', 2, [{ subject: 'wall', level: 1 }]),
      step('building', 'wall', 1),
    );
    const plan = planWithPrerequisites([{ kind: 'building', subject: 'hq', from: 1, to: 2 }], flat);
    expect(reached(plan)).toEqual(['hq 2']);
  });

  it('follows a research into the research and the buildings it needs', () => {
    const tree = book(
      step('research', 'march', 1, [{ subject: 'lab', level: 1 }]),
      step('research', 'march', 2, [
        { subject: 'lab', level: 2 },
        { subject: 'scout', level: 1, kind: 'research' },
      ]),
      step('research', 'scout', 1, [{ subject: 'lab', level: 1 }]),
      step('building', 'lab', 1),
      step('building', 'lab', 2),
    );
    const plan = planWithPrerequisites(
      [{ kind: 'research', subject: 'march', from: 1, to: 2 }],
      tree,
    );
    // The Lab stood at 1 for March 1; Scout was never asked for.
    expect(reached(plan)).toEqual(['lab 2 first', 'scout 1 first', 'march 2']);
  });

  it('reports a requirement the catalogue cannot price as a gap of that requirement', () => {
    const short = book(
      step('building', 'hq', 1),
      step('building', 'hq', 2, [{ subject: 'wall', level: 2 }]),
      step('building', 'wall', 1),
    );
    const plan = planWithPrerequisites(
      [{ kind: 'building', subject: 'hq', from: 1, to: 2 }],
      short,
    );
    expect(plan.gaps).toEqual([{ kind: 'building', subject: 'wall', level: 2 }]);
  });
});

describe('the levels the reader has', () => {
  const goal = [{ kind: 'building' as const, subject: 'hq', from: 3, to: 4 }];

  it('drops a requirement already raised, and what it would have asked for in turn', () => {
    // Wall already at 3: its step goes, and so does the Depot 2 only it needed.
    const plan = planWithPrerequisites(goal, BASE, new Map([['building:wall', 3]]));
    expect(reached(plan)).toEqual(['hq 4']);
  });

  it('never takes a level below the floor the from level sets', () => {
    const plan = planWithPrerequisites(goal, BASE, new Map([['building:wall', 0]]));
    expect(reached(plan)).toEqual(['depot 2 first', 'wall 3 first', 'hq 4']);
  });

  it('tells a research from a building of the same id', () => {
    const tree = book(
      step('research', 'march', 1, [{ subject: 'x', level: 1, kind: 'research' }]),
      step('research', 'x', 1),
      step('building', 'x', 1),
    );
    const march = [{ kind: 'research' as const, subject: 'march', from: 0, to: 1 }];
    expect(reached(planWithPrerequisites(march, tree, new Map([['building:x', 1]])))).toEqual([
      'x 1 first',
      'march 1',
    ]);
    expect(reached(planWithPrerequisites(march, tree, new Map([['research:x', 1]])))).toEqual([
      'march 1',
    ]);
  });
});

describe('the helpers', () => {
  it('asks for the book from level 0, whatever the range starts at', () => {
    expect(fromNothing([{ kind: 'building', subject: 'hq', from: 28, to: 30 }])).toEqual([
      { kind: 'building', subject: 'hq', from: 0, to: 30 },
    ]);
  });

  it('reads a standing as the highest level each building and research reaches', () => {
    const steps = [
      step('building', 'wall', 1),
      step('building', 'wall', 2),
      step('research', 'scout', 1),
    ].map((s) => ({ step: s, prerequisite: true, goal: 0 }));
    const standing = standingAfter(steps);
    expect([...standing.buildings]).toEqual([['wall', 2]]);
    expect([...standing.research]).toEqual([['scout', 1]]);
  });
});
