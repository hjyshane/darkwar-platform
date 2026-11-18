import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OBJECTIVES, OBJECTIVE_FACTS, placed } from './battlefield';

describe('the Black Gold battlefield', () => {
  it('has each objective once, with the counts the game states', () => {
    const ids = OBJECTIVES.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    const count = (kind: string) => OBJECTIVES.filter((o) => o.kind === kind).length;
    for (const fact of OBJECTIVE_FACTS) {
      expect(count(fact.kind)).toBe(fact.count);
    }
  });

  it('is point-symmetric about the centre', () => {
    const at = (id: string) => OBJECTIVES.find((o) => o.id === id);
    const pairs = [
      ['hq-ours', 'hq-theirs'],
      ['mil-a', 'mil-b'],
      ['hosp-ours', 'hosp-theirs'],
      ['oil-1', 'oil-4'],
      ['oil-2', 'oil-5'],
      ['oil-3', 'oil-6'],
    ] as const;
    for (const [one, other] of pairs) {
      expect((at(one)?.x ?? 0) + (at(other)?.x ?? 0)).toBeCloseTo(1);
      expect((at(one)?.y ?? 0) + (at(other)?.y ?? 0)).toBeCloseTo(1);
    }
    expect(at('factory')).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it('keeps every objective on the map', () => {
    for (const o of OBJECTIVES) {
      expect(o.x).toBeGreaterThan(0);
      expect(o.x).toBeLessThan(1);
      expect(o.y).toBeGreaterThan(0);
      expect(o.y).toBeLessThan(1);
    }
  });

  it('draws our headquarters at the bottom left, or top right when asked', () => {
    const hq = OBJECTIVES.find((o) => o.id === 'hq-ours');
    if (hq === undefined) throw new Error('no hq');
    expect(placed(hq, false)).toEqual({ x: hq.x, y: hq.y });
    expect(placed(hq, true).x).toBeCloseTo(1 - hq.x);
    expect(placed(hq, true).y).toBeCloseTo(1 - hq.y);
    expect(placed(hq, false).x).toBeLessThan(0.5);
    expect(placed(hq, false).y).toBeGreaterThan(0.5);
  });

  it('names the same objectives as the plan table accepts', () => {
    const sql = readFileSync(
      resolve(process.cwd(), '../../supabase/migrations/20260728000331_bgb_plans.sql'),
      'utf8',
    );
    const block = /objective_key in \(([^)]*)\)/.exec(sql)?.[1] ?? '';
    const accepted = [...block.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]).sort();
    expect(accepted).toEqual([...OBJECTIVES.map((o) => o.id), 'roam'].sort());
  });
});
