import { describe, expect, it } from 'vitest';
import { parseStartsRule, refsIn, slugify } from './guides';
import {
  HALLOWEEN_POINT_TABLES,
  HALLOWEEN_PREP,
  HALLOWEEN_REWARDS,
  HALLOWEEN_STAGES,
} from './sections/fixtures';
import { type GuideSection, parseSections } from './sections/index';

describe('parseStartsRule', () => {
  it('keeps a weekday, a server time, a server range and a note', () => {
    expect(
      parseStartsRule({ weekday: 3, time: '14:00', servers: '577-584', note: 'biweekly' }),
    ).toEqual({ weekday: 3, time: '14:00', servers: '577-584', note: 'biweekly' });
  });
  it('drops what is not a weekday or a clock time', () => {
    expect(parseStartsRule({ weekday: 9, time: '25:00' })).toEqual({});
    expect(parseStartsRule('monday')).toEqual({});
    expect(parseStartsRule(null)).toEqual({});
  });
});

describe('refsIn', () => {
  it('collects every item_ref a guide shows, once each', () => {
    const rows: GuideSection[] = [
      { kind: 'rewards', payload: HALLOWEEN_REWARDS },
      { kind: 'stages', payload: HALLOWEEN_STAGES },
      ...HALLOWEEN_POINT_TABLES.map((payload) => ({ kind: 'point_table', payload })),
      { kind: 'prep', payload: HALLOWEEN_PREP },
    ].map((row, index) => ({
      section_id: `s${index}`,
      guide_id: 'g',
      title: null,
      sort_order: index,
      source: 'officer' as const,
      ...row,
    }));
    expect(
      refsIn(parseSections(rows))
        .map((ref) => `${ref.kind}:${ref.id}`)
        .sort(),
    ).toEqual(['item:200036', 'item:253042', 'item:300100', 'item:300101', 'resource:25']);
  });
});

describe('slugify', () => {
  it('makes the shape the table accepts', () => {
    expect(slugify('Halloween 2026!')).toBe('halloween-2026');
    expect(slugify('  할로윈  ')).toBe('guide');
    expect(slugify('a'.repeat(120)).length).toBe(80);
  });
});
