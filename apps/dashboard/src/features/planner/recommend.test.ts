import { describe, expect, it } from 'vitest';
import type { Buffs, Step } from './plan';
import { type StepPair, recommend } from './recommend';

const NO_BUFFS: Buffs = { constructionSpeed: 0, researchSpeed: 0, costReduction: 0 };

function step(
  kind: 'building' | 'research',
  subject: string,
  level: number,
  over: Partial<Step> = {},
): Step {
  return {
    kind,
    subject_id: subject,
    level,
    name: `${subject}`,
    costs: [],
    seconds: 3600,
    requires: [],
    power: 0,
    ...over,
  };
}

/** One upgradable thing: owned at `owned`, power AT each level given. */
function pair(
  kind: 'building' | 'research',
  subject: string,
  owned: number,
  currentPower: number | null,
  nextPower: number | null,
  over: Partial<Step> = {},
): StepPair {
  return {
    current: owned === 0 ? null : step(kind, subject, owned, { power: currentPower }),
    next: step(kind, subject, owned + 1, { power: nextPower, ...over }),
  };
}

const owned = (entries: Record<string, number>) => new Map(Object.entries(entries));

function run(pairs: StepPair[], over: Partial<Parameters<typeof recommend>[0]> = {}) {
  return recommend({
    pairs,
    buildings: new Map(),
    research: new Map(),
    stock: { resources: {}, items: {} },
    buffs: NO_BUFFS,
    metric: 'perHour',
    ...over,
  });
}

describe('recommend', () => {
  it('measures a step by the power it ADDS, not the power at its level', () => {
    // 100 -> 130 adds 30. A ranking by absolute power would call this 130.
    const out = run([pair('building', '400000', 5, 100, 130)], {
      buildings: owned({ '400000': 5 }),
    });
    expect(out.ranked[0]?.gain).toBe(30);
  });

  it('treats a never-built subject as starting from zero power', () => {
    const out = run([pair('building', '400000', 0, null, 50)]);
    expect(out.ranked[0]?.gain).toBe(50);
  });

  it('puts the best power per hour first', () => {
    const out = run([
      pair('building', 'slow', 1, 0, 100, { seconds: 36000 }), // 10/h
      pair('building', 'fast', 1, 0, 100, { seconds: 3600 }), // 100/h
    ]);
    expect(out.ranked.map((r) => r.step.subject_id)).toEqual(['fast', 'slow']);
  });

  it('applies speed buffs to the hours', () => {
    const out = run([pair('building', 'a', 1, 0, 100, { seconds: 7200 })], {
      buffs: { ...NO_BUFFS, constructionSpeed: 100 },
    });
    expect(out.ranked[0]?.hours).toBe(1);
  });

  it('keeps a zero-power step out of the ranking: it adds nothing, it is not free', () => {
    const out = run([pair('building', 'bed', 3, 0, 0, { seconds: 0, costs: [] })]);
    expect(out.ranked).toEqual([]);
    expect(out.noPower.map((c) => c.step.subject_id)).toEqual(['bed']);
  });

  it('keeps an unknown-power step out of the ranking, apart from the zeros', () => {
    const out = run([
      pair('building', 'a', 1, 0, null),
      pair('building', 'b', 2, null, 40), // owned level has no power: gain unknowable
    ]);
    expect(out.ranked).toEqual([]);
    expect(out.unknown.map((c) => c.step.subject_id).sort()).toEqual(['a', 'b']);
  });

  it('ranks a timeless gain above any timed one rather than dividing by zero', () => {
    const out = run([
      pair('building', 'timed', 1, 0, 1000, { seconds: 60 }),
      pair('building', 'instant', 1, 0, 10, { seconds: 0 }),
    ]);
    expect(out.ranked[0]?.step.subject_id).toBe('instant');
    expect(out.ranked[0]?.hours).toBeNull();
  });

  it('sets aside a step whose prerequisite the account has not reached', () => {
    const out = run(
      [
        pair('building', 'a', 1, 0, 100, {
          requires: [{ subject: '402000', level: 30 }],
        }),
      ],
      { buildings: owned({ '402000': 29 }) },
    );
    expect(out.ranked).toEqual([]);
    expect(out.blocked[0]?.blockedBy).toEqual([{ subject: '402000', level: 30 }]);
  });

  it('lets a prerequisite that is met through, and reads research needs from research', () => {
    const out = run(
      [
        pair('research', '801100', 1, 0, 100, {
          requires: [
            { subject: '402000', level: 5 },
            { subject: '801000', level: 2, kind: 'research' },
          ],
        }),
      ],
      { buildings: owned({ '402000': 5 }), research: owned({ '801000': 2 }) },
    );
    expect(out.ranked).toHaveLength(1);
    expect(out.blocked).toEqual([]);
  });

  it('ranks by the share of stock a step eats when asked, worst resource decides', () => {
    // Both add 100. `cheap` takes 10% of food; `dear` takes 50% of food.
    const cheap = pair('building', 'cheap', 1, 0, 100, {
      costs: [{ type: 'resource', id: '24', amount: 100 }],
    });
    const dear = pair('building', 'dear', 1, 0, 100, {
      costs: [{ type: 'resource', id: '24', amount: 500 }],
    });
    const out = run([dear, cheap], {
      metric: 'perStock',
      stock: { resources: { '24': 1000 }, items: {} },
    });
    expect(out.ranked.map((r) => r.step.subject_id)).toEqual(['cheap', 'dear']);
    expect(out.ranked.every((r) => r.affordable)).toBe(true);
  });

  it('marks a step the stock cannot pay for, and ranks it after those it can', () => {
    const can = pair('building', 'can', 1, 0, 10, {
      costs: [{ type: 'resource', id: '24', amount: 100 }],
    });
    const cannot = pair('building', 'cannot', 1, 0, 9999, {
      costs: [{ type: 'item', id: '7', amount: 5 }],
    });
    const out = run([cannot, can], {
      metric: 'perStock',
      stock: { resources: { '24': 1000 }, items: {} },
    });
    expect(out.ranked.map((r) => r.step.subject_id)).toEqual(['can', 'cannot']);
    expect(out.ranked[1]?.affordable).toBe(false);
  });

  it('applies cost reduction to building resources but not to items', () => {
    const out = run(
      [
        pair('building', 'a', 1, 0, 10, {
          costs: [
            { type: 'resource', id: '24', amount: 1000 },
            { type: 'item', id: '7', amount: 10 },
          ],
        }),
      ],
      { buffs: { ...NO_BUFFS, costReduction: 20 } },
    );
    const costs = out.ranked[0]?.costs ?? [];
    expect(costs.find((c) => c.id === '24')?.amount).toBe(800);
    expect(costs.find((c) => c.id === '7')?.amount).toBe(10);
  });
});
