import { describe, expect, it } from 'vitest';
import {
  type TimeRow,
  bestActions,
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
