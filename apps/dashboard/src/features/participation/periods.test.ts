import { describe, expect, it } from 'vitest';
import {
  MAX_RANGE_DAYS,
  SEASON_START,
  customPeriod,
  gameDate,
  gameDayStart,
  roundPeriods,
  seasonPeriod,
  weekPeriods,
} from './periods';

const NOW = new Date('2026-10-02T15:00:00Z');

describe('gameDayStart', () => {
  it('is 02:00 UTC of the same day after the reset', () => {
    expect(gameDayStart(NOW).toISOString()).toBe('2026-10-02T02:00:00.000Z');
  });
  it('is the previous day before the reset', () => {
    expect(gameDayStart(new Date('2026-10-02T01:59:00Z')).toISOString()).toBe(
      '2026-10-01T02:00:00.000Z',
    );
  });
  it('the reset instant itself opens the new day', () => {
    expect(gameDayStart(new Date('2026-10-02T02:00:00Z')).toISOString()).toBe(
      '2026-10-02T02:00:00.000Z',
    );
  });
});

describe('seasonPeriod', () => {
  it('runs from the season start through the end of today', () => {
    const season = seasonPeriod(NOW);
    expect(season.from).toBe(SEASON_START);
    expect(season.to).toBe('2026-10-03T02:00:00.000Z');
  });
  it('is clamped from the recent end to the longest range the report answers', () => {
    const season = seasonPeriod(new Date('2027-06-01T12:00:00Z'));
    const days = (Date.parse(season.to) - Date.parse(season.from)) / 86_400_000;
    expect(days).toBe(MAX_RANGE_DAYS);
    expect(season.to).toBe('2027-06-02T02:00:00.000Z');
  });
});

describe('roundPeriods', () => {
  it('counts four-week rounds from the anchor, newest first', () => {
    const rounds = roundPeriods(NOW);
    expect(rounds.map((r) => r.from)).toEqual([
      '2026-09-14T02:00:00.000Z',
      '2026-08-17T02:00:00.000Z',
    ]);
    expect(rounds[0]?.to).toBe('2026-10-12T02:00:00.000Z');
    expect(rounds[0]?.label).toBe('Round 2: 2026-09-14 – 2026-10-11');
  });
  it('a round opens on its first instant', () => {
    expect(roundPeriods(new Date('2026-10-12T02:00:00Z'))).toHaveLength(3);
  });
});

describe('weekPeriods', () => {
  it('lists every season week that has started, newest first', () => {
    const weeks = weekPeriods(NOW);
    expect(weeks[0]?.from).toBe('2026-09-28T02:00:00.000Z');
    expect(weeks[0]?.to).toBe('2026-10-05T02:00:00.000Z');
    expect(weeks.at(-1)?.from).toBe(SEASON_START);
    expect(weeks).toHaveLength(7);
  });
  it('every week starts on a Monday reset', () => {
    for (const week of weekPeriods(NOW)) {
      const start = new Date(week.from);
      expect(start.getUTCDay()).toBe(1);
      expect(start.getUTCHours()).toBe(2);
    }
  });
});

describe('gameDate', () => {
  it('names the game day, not the UTC calendar day', () => {
    expect(gameDate(new Date('2026-10-02T01:00:00Z'))).toBe('2026-10-01');
    expect(gameDate(new Date('2026-10-02T03:00:00Z'))).toBe('2026-10-02');
  });
});

describe('a later season start (0242)', () => {
  const START = '2026-09-28T02:00:00.000Z';
  const LATER = new Date('2026-10-20T15:00:00Z');
  it('counts the season, its rounds and its weeks from the given start', () => {
    expect(seasonPeriod(LATER, START, 'Season 4').from).toBe(START);
    expect(seasonPeriod(LATER, START, 'Season 4').label).toContain('Season 4');
    expect(roundPeriods(LATER, START).at(-1)?.from).toBe(START);
    expect(weekPeriods(LATER, START).at(-1)?.from).toBe(START);
  });
  it('has no rounds or weeks before a season that has not started', () => {
    expect(roundPeriods(new Date('2026-09-01T00:00:00Z'), START)).toEqual([]);
    expect(weekPeriods(new Date('2026-09-01T00:00:00Z'), START)).toEqual([]);
  });
});

describe('a season that has ended', () => {
  const END = '2026-10-05T02:00:00.000Z';
  const BREAK = new Date('2026-10-20T15:00:00Z');

  it('stops at its end, not at today', () => {
    expect(seasonPeriod(BREAK, SEASON_START, 'Season 3', END).to).toBe(END);
  });

  it('lists only the rounds and weeks that began before the end', () => {
    expect(roundPeriods(BREAK, SEASON_START, END).length).toBe(2);
    expect(weekPeriods(BREAK, SEASON_START, END)[0]?.from).toBe('2026-09-28T02:00:00.000Z');
  });
});

describe('customPeriod', () => {
  it('is whole game days, both ends included', () => {
    const p = customPeriod('2026-09-28', '2026-09-30', NOW);
    expect(p?.from).toBe('2026-09-28T02:00:00.000Z');
    expect(p?.to).toBe('2026-10-01T02:00:00.000Z');
    expect(p?.kind).toBe('custom');
  });

  it('cuts the end at today', () => {
    expect(customPeriod('2026-09-30', '2026-12-31', NOW)?.to).toBe('2026-10-03T02:00:00.000Z');
  });

  it('refuses a missing, malformed, backwards or future range', () => {
    expect(customPeriod('', '2026-09-30', NOW)).toBeNull();
    expect(customPeriod('09/28', '2026-09-30', NOW)).toBeNull();
    expect(customPeriod('2026-09-30', '2026-09-28', NOW)).toBeNull();
    expect(customPeriod('2026-11-01', '2026-11-05', NOW)).toBeNull();
  });

  it('keeps the recent end of a range longer than the report answers', () => {
    const p = customPeriod('2026-01-01', '2026-10-02', NOW);
    const days = (Date.parse(p?.to ?? '') - Date.parse(p?.from ?? '')) / 86_400_000;
    expect(days).toBe(MAX_RANGE_DAYS);
    expect(p?.label).toContain('last');
  });
});
