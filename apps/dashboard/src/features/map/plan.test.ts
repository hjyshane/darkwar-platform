import { describe, expect, it } from 'vitest';
import type { BoardSlot } from '../hive/hiveFormations';
import type { AtlasBase } from './atlas';
import { matchPlan } from './plan';

const slot = (id: string, x: number, y: number, kind: 'base' | 'structure' = 'base'): BoardSlot =>
  ({ slotId: id, x, y, kind, spanX: 3, spanY: 3 }) as BoardSlot;

const base = (uid: number, x: number, y: number): AtlasBase => ({
  gameUid: uid,
  at: { x, y },
  hq: 30,
  power: 1,
  alliance: 0,
  seenAt: new Date(0),
  name: `p${uid}`,
  shieldEnd: null,
});

describe('matchPlan', () => {
  it('matches a base standing on the centre of its planned tile', () => {
    const plan = matchPlan([slot('a', 100, 200)], [base(1, 100, 200)]);
    expect(plan.placed).toBe(1);
    expect(plan.tiles[0]?.base?.gameUid).toBe(1);
  });

  it('leaves a tile unmatched when the base is a tile off', () => {
    const plan = matchPlan([slot('a', 100, 200)], [base(1, 101, 200)]);
    expect(plan.placed).toBe(0);
    expect(plan.total).toBe(1);
    expect(plan.tiles[0]?.base).toBeNull();
  });

  it('counts base tiles only, not structures', () => {
    const plan = matchPlan(
      [slot('a', 10, 10), slot('s', 20, 20, 'structure')],
      [base(1, 10, 10), base(2, 20, 20)],
    );
    expect(plan.total).toBe(1);
    expect(plan.placed).toBe(1);
  });
});
