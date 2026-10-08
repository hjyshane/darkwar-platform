import { describe, expect, it } from 'vitest';
import {
  type DuelReading,
  type TimeRow,
  bestActions,
  duelBoard,
  duelCoverage,
  runningNow,
  timeState,
} from '../src/features/eventGuide/extras';
import type { ScoreSource, Theme } from '../src/features/eventGuide/guide';

const theme = (event_id: string, name: string): Theme => ({
  activity_id: '100004',
  event_id,
  day: null,
  name,
  name_ko: null,
  min_day_score: null,
  min_week_score: null,
});

const score = (event_id: string, id: string, points: number, action: string): ScoreSource => ({
  activity_id: '100004',
  event_id,
  score_id: id,
  action,
  per_value: 1,
  points,
  sort_order: 0,
});

describe('runningNow', () => {
  const grid = [
    ['a', null],
    ['b', 'a'],
  ];
  const themes = [theme('a', 'Shelter'), theme('b', 'Hero')];

  it('names the theme the current slot runs and when the slot ends', () => {
    expect(runningNow(grid, themes, { weekday: 1, slot: 2 })).toEqual({
      name: 'Hero',
      until: '08:00',
    });
  });

  it('is null where the game has not said what runs', () => {
    expect(runningNow(grid, themes, { weekday: 2, slot: 1 })).toBeNull();
  });

  it('hands over at midnight after the last slot of the day', () => {
    const six = Array.from({ length: 6 }, () => ['a']);
    expect(runningNow(six, themes, { weekday: 1, slot: 6 })?.until).toBe('00:00');
  });
});

describe('bestActions', () => {
  it('returns the best payments first, as the sentences the game reads', () => {
    const scores = [
      score('a', '1', 10, 'Low'),
      score('a', '2', 300, 'High'),
      score('b', '3', 999, 'Other'),
    ];
    expect(bestActions(scores, '100004', 'a', 1)).toEqual(['High']);
    expect(bestActions(scores, '100004', 'a', 5)).toEqual(['High', 'Low']);
  });
});

describe('timeState', () => {
  const row = (startsAt: string, endsAt: string | null): TimeRow => ({
    id: 'x',
    title: 'Siege',
    startsAt,
    endsAt,
  });
  const now = new Date('2026-10-10T12:00:00Z');

  it('is ahead before the start', () => {
    expect(timeState(row('2026-10-10T13:00:00Z', null), now)).toBe('ahead');
  });

  it('is running between start and a known end', () => {
    expect(timeState(row('2026-10-10T11:00:00Z', '2026-10-10T13:00:00Z'), now)).toBe('running');
  });

  it('is over once it ended, and a started event with no end is not claimed to run', () => {
    expect(timeState(row('2026-10-10T09:00:00Z', '2026-10-10T10:00:00Z'), now)).toBe('over');
    expect(timeState(row('2026-10-10T11:00:00Z', null), now)).toBe('over');
  });
});

describe('duelBoard', () => {
  // Saturday 2026-10-10 12:00 UTC: server day Oct 10 (UTC-2), game week from Mon Oct 5.
  const now = new Date('2026-10-10T12:00:00Z');
  const reading = (over: Partial<DuelReading> & { player_id: string }): DuelReading => ({
    duel_daily_score: null,
    duel_daily_updated_at: null,
    duel_weekly_score: null,
    duel_weekly_updated_at: null,
    ...over,
  });
  const members = [
    { player_id: 'a', current_name: 'Ann' },
    { player_id: 'b', current_name: 'Bob' },
    { player_id: 'c', current_name: 'Cy' },
  ];
  const readings = [
    reading({
      player_id: 'a',
      duel_daily_score: 100,
      duel_daily_updated_at: '2026-10-10T10:00:00Z',
      duel_weekly_score: 500,
      duel_weekly_updated_at: '2026-10-10T10:00:00Z',
    }),
    reading({
      player_id: 'b',
      duel_daily_score: 900,
      duel_daily_updated_at: '2026-10-09T10:00:00Z',
      duel_weekly_score: 400,
      duel_weekly_updated_at: '2026-10-01T10:00:00Z',
    }),
  ];

  it('sorts by the column asked for, and sinks a member with no reading', () => {
    expect(duelBoard(members, readings, now, 'daily').map((l) => l.name)).toEqual([
      'Bob',
      'Ann',
      'Cy',
    ]);
    expect(duelBoard(members, readings, now, 'weekly').map((l) => l.name)).toEqual([
      'Ann',
      'Bob',
      'Cy',
    ]);
  });

  it('marks a reading from an earlier day or week as stale, but keeps the number', () => {
    const board = duelBoard(members, readings, now, 'daily');
    expect(board.find((l) => l.name === 'Bob')).toMatchObject({
      daily: 900,
      dailyToday: false,
      weekly: 400,
      weeklyThisWeek: false,
    });
    expect(board.find((l) => l.name === 'Ann')).toMatchObject({
      dailyToday: true,
      weeklyThisWeek: true,
    });
  });

  it('leaves a member with no reading at null, not zero', () => {
    const cy = duelBoard(members, readings, now, 'daily').find((l) => l.name === 'Cy');
    expect(cy).toMatchObject({ daily: null, weekly: null, dailyToday: false });
  });

  it('counts only readings that belong to today and this week', () => {
    expect(duelCoverage(duelBoard(members, readings, now, 'daily'))).toEqual({ today: 1, week: 1 });
  });

  it('ignores a reading for somebody who is not on the roster', () => {
    const extra = [...readings, reading({ player_id: 'zz', duel_daily_score: 5 })];
    expect(duelBoard(members, extra, now, 'daily')).toHaveLength(3);
  });
});
