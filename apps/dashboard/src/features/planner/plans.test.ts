import { describe, expect, test } from 'vitest';
import {
  buffsFromJson,
  planHash,
  planIdFromHash,
  targetMap,
  targetText,
  targetsFromJson,
} from './plans';
import type { Target } from './targets';

const HQ: Target = { kind: 'building', subject: '400000', name: 'Headquarters', from: 30, to: 31 };
const GEAR: Target = {
  kind: 'hero_gear',
  subject: '0:1001:5',
  name: 'Helmet',
  from: 40,
  to: 40,
  stageFrom: 1,
  stageTo: 3,
};

describe('targetsFromJson', () => {
  test('a saved list comes back as it was written', () => {
    expect(targetsFromJson(JSON.parse(JSON.stringify([HQ, GEAR])))).toEqual([HQ, GEAR]);
  });

  test('anything that is not a target is left out, not guessed at', () => {
    expect(
      targetsFromJson([
        HQ,
        null,
        'building',
        { ...HQ, kind: 'castle' },
        { ...HQ, to: '31' },
        { ...HQ, from: -1 },
        { kind: 'building', subject: '1', from: 1, to: 2 },
      ]),
    ).toEqual([HQ]);
  });

  test('a row that is not a list holds no targets', () => {
    expect(targetsFromJson({})).toEqual([]);
    expect(targetsFromJson(null)).toEqual([]);
  });
});

test('buffs missing from a row are zero', () => {
  expect(buffsFromJson({ constructionSpeed: 10, researchSpeed: 'x' })).toEqual({
    constructionSpeed: 10,
    researchSpeed: 0,
    costReduction: 0,
  });
  expect(buffsFromJson(null)).toEqual({ constructionSpeed: 0, researchSpeed: 0, costReduction: 0 });
});

test('targets are keyed the way the pickers key them', () => {
  expect([...targetMap([HQ, GEAR]).keys()]).toEqual(['building:400000', 'hero_gear:0:1001:5']);
});

test('a target reads as what it raises, with a gear its stages', () => {
  const plain = (_: Target, level: number) => String(level);
  expect(targetText(HQ, plain)).toBe('Headquarters 30 → 31');
  expect(targetText(GEAR, plain)).toBe('Helmet 40 → 40 · stage 1 → 3');
});

describe('a planner address that names a saved plan', () => {
  const id = '00000000-0000-4000-8000-000003410001';

  test('round-trips', () => {
    expect(planHash(id)).toBe(`#/planner?plan=${id}`);
    expect(planIdFromHash(planHash(id))).toBe(id);
  });

  test('names none without a well-formed id', () => {
    expect(planIdFromHash('#/planner')).toBeNull();
    expect(planIdFromHash('#/planner?plan=nope')).toBeNull();
    expect(planIdFromHash('#/planner?target=1')).toBeNull();
  });
});
