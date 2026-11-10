import { describe, expect, it } from 'vitest';
import type { GuideRow } from '../guides';
import { type GuideFormState, formFromGuide, guideInputFrom } from './guideFields';

const blank: GuideFormState = {
  title: 'Halloween 2026',
  title_ko: '',
  slug: 'halloween-2026',
  summary: '',
  summary_ko: '',
  published: false,
  post_id: '',
  weekday: '',
  time: '',
  servers: '',
  note: '',
};

describe('guideInputFrom', () => {
  it('turns empty optional fields into null and an empty rule into {}', () => {
    expect(guideInputFrom(blank)).toEqual({
      ok: true,
      input: {
        slug: 'halloween-2026',
        title: 'Halloween 2026',
        title_ko: null,
        summary: null,
        summary_ko: null,
        starts_rule: {},
        published: false,
        post_id: null,
      },
    });
  });

  it('keeps the guide id so it updates instead of inserting', () => {
    const result = guideInputFrom(blank, 'g1');
    expect(result.ok && result.input.guide_id).toBe('g1');
  });

  it('builds the start rule from what was filled', () => {
    const result = guideInputFrom({
      ...blank,
      weekday: '3',
      time: '14:00',
      servers: '577-584',
      note: 'biweekly',
    });
    expect(result.ok && result.input.starts_rule).toEqual({
      weekday: 3,
      time: '14:00',
      servers: '577-584',
      note: 'biweekly',
    });
  });

  it('refuses what the table would refuse, with a sentence', () => {
    expect(guideInputFrom({ ...blank, title: '  ' })).toEqual({
      ok: false,
      reason: 'The guide needs a title.',
    });
    expect(guideInputFrom({ ...blank, slug: 'Halloween 2026' })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('lower-case'),
    });
    expect(guideInputFrom({ ...blank, time: '25:00', weekday: '1' })).toEqual({
      ok: false,
      reason: 'The time is a server-time clock, like 14:00.',
    });
    expect(guideInputFrom({ ...blank, weekday: '9', time: '14:00' })).toEqual({
      ok: false,
      reason: 'The weekday is 1 (Monday) to 7 (Sunday).',
    });
  });

  it('a weekday without a time, or a time without a weekday, computes nothing, so it is refused', () => {
    expect(guideInputFrom({ ...blank, weekday: '3' })).toEqual({
      ok: false,
      reason: 'Set both the weekday and the time, or neither.',
    });
    expect(guideInputFrom({ ...blank, time: '14:00' })).toEqual({
      ok: false,
      reason: 'Set both the weekday and the time, or neither.',
    });
  });
});

describe('formFromGuide', () => {
  it('reads a stored guide back into the form', () => {
    const guide: GuideRow = {
      guide_id: 'g1',
      activity_id: null,
      slug: 'frost-fair',
      title: 'Frost Fair',
      title_ko: null,
      summary: 'Ice.',
      summary_ko: null,
      starts_rule: { weekday: 2, time: '09:30', note: 'x' },
      published: true,
      post_id: 'p1',
      updated_at: '2026-11-01T00:00:00Z',
    };
    expect(formFromGuide(guide)).toEqual({
      title: 'Frost Fair',
      title_ko: '',
      slug: 'frost-fair',
      summary: 'Ice.',
      summary_ko: '',
      published: true,
      post_id: 'p1',
      weekday: '2',
      time: '09:30',
      servers: '',
      note: 'x',
    });
  });
});
