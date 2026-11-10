import { describe, expect, it } from 'vitest';
import {
  type GuideRow,
  guideStart,
  nextRuleStart,
  orderGuides,
  parseStartsRule,
  refsIn,
  slugify,
  stockLed,
} from './guides';
import {
  HALLOWEEN_POINT_TABLES,
  HALLOWEEN_PREP,
  HALLOWEEN_REWARDS,
  HALLOWEEN_STAGES,
} from './sections/fixtures';
import { type GuideSection, parseSections } from './sections/index';

function guide(over: Partial<GuideRow>): GuideRow {
  return {
    guide_id: over.slug ?? 'g',
    activity_id: null,
    slug: 'g',
    title: 'Guide',
    title_ko: null,
    summary: null,
    summary_ko: null,
    starts_rule: {},
    published: true,
    post_id: null,
    updated_at: '2026-11-01T00:00:00Z',
    ...over,
  };
}

// Server time is UTC−2: Monday 00:00 on the server is Monday 02:00 UTC.
const NOW = new Date('2026-11-09T12:00:00Z'); // Monday 10:00 server

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

describe('nextRuleStart', () => {
  it('is null without both a weekday and a time', () => {
    expect(nextRuleStart({ weekday: 1 }, NOW)).toBeNull();
    expect(nextRuleStart({}, NOW)).toBeNull();
  });
  it('finds the next server-time occurrence', () => {
    // Wednesday 14:00 server = Wednesday 16:00 UTC.
    expect(nextRuleStart({ weekday: 3, time: '14:00' }, NOW)?.toISOString()).toBe(
      '2026-11-11T16:00:00.000Z',
    );
  });
  it('rolls to next week once today’s time has passed', () => {
    // Monday 09:00 server already passed at Monday 10:00 server.
    expect(nextRuleStart({ weekday: 1, time: '09:00' }, NOW)?.toISOString()).toBe(
      '2026-11-16T11:00:00.000Z',
    );
  });
  it('counts the instant itself as the next start', () => {
    const at = new Date('2026-11-09T02:00:00Z'); // Monday 00:00 server
    expect(nextRuleStart({ weekday: 1, time: '00:00' }, at)?.toISOString()).toBe(
      '2026-11-09T02:00:00.000Z',
    );
    const before = new Date('2026-11-09T01:00:00Z'); // Sunday 23:00 server
    expect(nextRuleStart({ weekday: 1, time: '00:00' }, before)?.toISOString()).toBe(
      '2026-11-09T02:00:00.000Z',
    );
  });
});

describe('guideStart', () => {
  const duel = guide({ slug: 'duel', activity_id: '70005' });
  it('a live calendar row beats an upcoming one', () => {
    const start = guideStart(
      duel,
      [
        {
          activity_id: '70005',
          starts_at: '2026-11-12T00:00:00Z',
          ends_at: '2026-11-13T00:00:00Z',
        },
        {
          activity_id: '70005',
          starts_at: '2026-11-09T00:00:00Z',
          ends_at: '2026-11-10T00:00:00Z',
        },
      ],
      NOW,
    );
    expect(start).toMatchObject({ state: 'live', source: 'calendar' });
    expect(start.startsAt).toBe('2026-11-09T00:00:00Z');
  });
  it('takes the soonest upcoming start across servers', () => {
    const start = guideStart(
      duel,
      [
        { activity_id: '70005', starts_at: '2026-11-14T00:00:00Z', ends_at: null },
        { activity_id: '70005', starts_at: '2026-11-11T00:00:00Z', ends_at: null },
        { activity_id: '100004', starts_at: '2026-11-10T00:00:00Z', ends_at: null },
      ],
      NOW,
    );
    expect(start).toMatchObject({ state: 'upcoming', startsAt: '2026-11-11T00:00:00Z' });
  });
  it('says ended when everything the calendar has is over', () => {
    const start = guideStart(
      duel,
      [
        {
          activity_id: '70005',
          starts_at: '2026-11-01T00:00:00Z',
          ends_at: '2026-11-02T00:00:00Z',
        },
      ],
      NOW,
    );
    expect(start.state).toBe('ended');
  });
  it('falls back to the rule when the calendar has nothing', () => {
    const festival = guide({ slug: 'fest', starts_rule: { weekday: 3, time: '14:00' } });
    expect(guideStart(festival, [], NOW)).toMatchObject({
      state: 'upcoming',
      source: 'rule',
      startsAt: '2026-11-11T16:00:00.000Z',
    });
  });
  it('is unknown with no calendar row and no rule, never "now"', () => {
    expect(guideStart(duel, [], NOW)).toEqual({
      startsAt: null,
      endsAt: null,
      state: 'unknown',
      source: 'none',
    });
  });
});

describe('orderGuides', () => {
  const schedule = [
    { activity_id: '1', starts_at: '2026-11-09T00:00:00Z', ends_at: '2026-11-10T00:00:00Z' },
    { activity_id: '2', starts_at: '2026-11-12T00:00:00Z', ends_at: null },
    { activity_id: '3', starts_at: '2026-11-10T00:00:00Z', ends_at: null },
    { activity_id: '4', starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-11-02T00:00:00Z' },
  ];
  const guides = [
    guide({ slug: 'unknown', title: 'Unknown' }),
    guide({ slug: 'ended', title: 'Ended', activity_id: '4' }),
    guide({ slug: 'later', title: 'Later', activity_id: '2' }),
    guide({ slug: 'draft', title: 'Draft', activity_id: '3', published: false }),
    guide({ slug: 'sooner', title: 'Sooner', activity_id: '3' }),
    guide({ slug: 'live', title: 'Live', activity_id: '1' }),
  ];
  it('lists live, then upcoming soonest first, then ended, then unknown', () => {
    expect(orderGuides(guides, schedule, NOW, false).map((e) => e.guide.slug)).toEqual([
      'live',
      'sooner',
      'later',
      'ended',
      'unknown',
    ]);
  });
  it('shows drafts only to somebody who may write', () => {
    expect(orderGuides(guides, schedule, NOW, true).map((e) => e.guide.slug)).toContain('draft');
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

describe('stockLed', () => {
  it('says there is no linked account when there is no reading', () => {
    expect(stockLed(null, NOW)).toEqual({ tone: 'neutral', text: 'NO LINKED ACCOUNT' });
  });
  it('is ok within a day, warn within a week, bad after', () => {
    expect(stockLed('2026-11-09T09:00:00Z', NOW)).toEqual({ tone: 'ok', text: 'STOCK READ 3h' });
    expect(stockLed('2026-11-07T12:00:00Z', NOW)).toEqual({ tone: 'warn', text: 'STOCK READ 2d' });
    expect(stockLed('2026-10-20T12:00:00Z', NOW)).toEqual({ tone: 'bad', text: 'STOCK READ 20d' });
  });
});

describe('slugify', () => {
  it('makes the shape the table accepts', () => {
    expect(slugify('Halloween 2026!')).toBe('halloween-2026');
    expect(slugify('  할로윈  ')).toBe('guide');
    expect(slugify('a'.repeat(120)).length).toBe(80);
  });
});
