import { describe, expect, it } from 'vitest';
import { plannerStrip } from '../src/features/planner/strip';

const buffs = (constructionSpeed: number, researchSpeed: number, costReduction: number) => ({
  constructionSpeed,
  researchSpeed,
  costReduction,
});
const NONE = buffs(0, 0, 0);

const cell = (label: string, base = buffs(206.16, 171.51, 20), extra = NONE, chosen = 2) =>
  plannerStrip(base, extra, chosen).find((entry) => entry.label === label);

describe('plannerStrip', () => {
  it('shows the three buffs the arithmetic uses, and how many things are chosen', () => {
    expect(plannerStrip(buffs(206.16, 171.51, 20), NONE, 3).map((c) => [c.label, c.value])).toEqual(
      [
        ['Construction speed', '206.16%'],
        ['Research speed', '171.51%'],
        ['Construction cost', '−20%'],
        ['Chosen to raise', '3'],
      ],
    );
  });

  it('adds what the reader put on top, and says which part came from where', () => {
    const speed = cell('Construction speed', buffs(100, 0, 0), buffs(50, 0, 0));

    expect(speed).toMatchObject({
      value: '150%',
      note: '100% from the login, 50% added',
    });
    expect(cell('Research speed')?.note).toBe('from the login');
  });

  it('writes no cost reduction as 0%, not a minus sign in front of nothing', () => {
    expect(cell('Construction cost', NONE)?.value).toBe('0%');
  });

  it('adds the reduction on top too', () => {
    expect(cell('Construction cost', buffs(0, 0, 20), buffs(0, 0, 5))?.value).toBe('−25%');
  });

  it('prompts when nothing is chosen yet', () => {
    expect(cell('Chosen to raise', undefined, undefined, 0)).toMatchObject({
      value: '0',
      note: 'pick something below',
    });
    expect(cell('Chosen to raise', undefined, undefined, 2)?.note).toBeUndefined();
  });
});
