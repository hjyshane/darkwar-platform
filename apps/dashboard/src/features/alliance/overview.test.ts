import { describe, expect, it } from 'vitest';
import {
  type Verdict,
  eventHref,
  foldVerdicts,
  kindLabel,
  overviewWindow,
  summariseDuel,
} from './overview';

const v = (
  kind: string,
  held_on: string,
  attended: boolean | null,
  extra: Partial<Verdict> = {},
): Verdict => ({ kind, held_on, round: 1, attended, score: null, damage: null, ...extra });

describe('foldVerdicts', () => {
  it('is one row per event, newest first, counting the three verdicts apart', () => {
    const events = foldVerdicts([
      v('frankie', '2026-11-10', true),
      v('frankie', '2026-11-10', false),
      v('capital_clash', '2026-11-15', true),
      v('capital_clash', '2026-11-15', null),
      v('capital_clash', '2026-11-15', null),
    ]);
    expect(events.map((e) => `${e.kind}@${e.day}`)).toEqual([
      'capital_clash@2026-11-15',
      'frankie@2026-11-10',
    ]);
    expect(events[0]).toMatchObject({ present: 1, absent: 0, unknown: 2 });
    expect(events[1]).toMatchObject({ present: 1, absent: 1, unknown: 0 });
  });

  it('keeps two rounds of one day apart', () => {
    const events = foldVerdicts([
      v('frankie', '2026-11-10', true, { round: 1 }),
      v('frankie', '2026-11-10', true, { round: 2 }),
    ]);
    expect(events.map((e) => e.round)).toEqual([2, 1]);
  });

  it('totals are null with no figure, and an absent member adds none', () => {
    const events = foldVerdicts([
      v('server_clash', '2026-11-12', true, { score: 100, damage: 7 }),
      v('server_clash', '2026-11-12', false, { score: 999 }),
      v('ice_pit', '2026-11-12', true),
    ]);
    expect(events.find((e) => e.kind === 'server_clash')).toMatchObject({
      totalScore: 100,
      totalDamage: 7,
    });
    expect(events.find((e) => e.kind === 'ice_pit')).toMatchObject({
      totalScore: null,
      totalDamage: null,
    });
  });
});

describe('summariseDuel', () => {
  it('leaves out unread and zero days: Sunday reads 0 for everybody', () => {
    const duel = summariseDuel([
      { game_day: '2026-11-16', total: 300, members_counted: 80 },
      { game_day: '2026-11-15', total: 0, members_counted: 80 },
      { game_day: '2026-11-14', total: 500, members_counted: 80 },
      { game_day: '2026-11-13', total: null, members_counted: 0 },
    ]);
    expect(duel).toEqual({
      days: 2,
      total: 800,
      best: { day: '2026-11-14', total: 500 },
      latest: { day: '2026-11-16', total: 300 },
    });
  });

  it('has nothing to say with no reading', () => {
    expect(summariseDuel([])).toEqual({ days: 0, total: 0, best: null, latest: null });
  });
});

describe('the window and the names', () => {
  it('is fourteen UTC days back and holds still within a day', () => {
    const morning = overviewWindow(new Date('2026-11-19T03:00:00Z'));
    const evening = overviewWindow(new Date('2026-11-19T22:00:00Z'));
    expect(morning).toEqual(evening);
    expect(morning.fromDay).toBe('2026-11-05');
    expect(morning.to).toBe('2026-11-21T00:00:00.000Z');
  });

  it('names an event from the settings, else from its key', () => {
    expect(kindLabel('frankie', { frankie: 'Frankie' })).toBe('Frankie');
    expect(kindLabel('merchant_war', {})).toBe('Merchant war');
  });

  it('links an event to its own page, or to Participation', () => {
    expect(eventHref('capital_clash')).toBe('#/capital-clash');
    expect(eventHref('season_clash')).toBe('#/participation');
  });
});
