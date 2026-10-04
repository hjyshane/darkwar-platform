import { describe, expect, it } from 'vitest';
import { type Step, type StepBook, bookKey, buffsFrom, duration, plan, totals } from './plan';

function step(
  subject: string,
  level: number,
  parts: number,
  requires: { subject: string; level: number }[] = [],
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
      [{ step: { ...step('400000', 31, 180), seconds: 689184 }, prerequisite: false }],
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
