import { describe, expect, test } from 'vitest';
import { DEFAULT_TRENDS, baselineOf, membersAtLevel, parseTrends } from './allianceTrendsSetting';

describe('parseTrends', () => {
  test('absent, empty and nonsense all read as the defaults', () => {
    expect(parseTrends(null)).toEqual(DEFAULT_TRENDS);
    expect(parseTrends({})).toEqual(DEFAULT_TRENDS);
    expect(parseTrends('35')).toEqual(DEFAULT_TRENDS);
    expect(parseTrends({ towerLevel: 0, since: 'yesterday' })).toEqual(DEFAULT_TRENDS);
    expect(parseTrends({ towerLevel: 500, since: '2026-13-45' })).toEqual(DEFAULT_TRENDS);
  });

  test('a saved level and day are kept', () => {
    expect(parseTrends({ towerLevel: 30, since: '2026-11-01' })).toEqual({
      towerLevel: 30,
      since: '2026-11-01',
    });
    expect(parseTrends({ towerLevel: 32.9 }).towerLevel).toBe(32);
  });
});

describe('baselineOf', () => {
  const rows = [
    { captured_at: '2026-10-30T05:00:00Z' },
    { captured_at: '2026-11-01T00:00:00Z' },
    { captured_at: '2026-11-03T05:00:00Z' },
  ];

  test('no day is the first capture', () => {
    expect(baselineOf(rows, null)).toBe(rows[0]);
    expect(baselineOf([], null)).toBeNull();
  });

  test('a day is the first capture on or after it', () => {
    expect(baselineOf(rows, '2026-11-01')).toBe(rows[1]);
    expect(baselineOf(rows, '2026-11-02')).toBe(rows[2]);
    expect(baselineOf(rows, '2026-01-01')).toBe(rows[0]);
  });

  test('a day after every capture has no baseline', () => {
    expect(baselineOf(rows, '2026-12-01')).toBeNull();
  });
});

describe('membersAtLevel', () => {
  test('counts the levels at or above the chosen one', () => {
    const row = { hq_levels: [35, 34, 30, 30, 28], members_at_hq35: 1 };
    expect(membersAtLevel(row, 35)).toBe(1);
    expect(membersAtLevel(row, 30)).toBe(4);
    expect(membersAtLevel(row, 40)).toBe(0);
  });

  test('without the levels, only 35 has an answer', () => {
    expect(membersAtLevel({ members_at_hq35: 7 }, 35)).toBe(7);
    expect(membersAtLevel({ hq_levels: null, members_at_hq35: 7 }, 30)).toBeNull();
  });
});
