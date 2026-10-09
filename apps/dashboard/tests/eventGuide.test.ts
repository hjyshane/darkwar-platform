import { describe, expect, it } from 'vitest';
import {
  type CalendarSlot,
  DUEL,
  SURVIVAL,
  type ScoreSource,
  type Theme,
  actionText,
  bestPerUnit,
  missingDuelDays,
  scoresOf,
  serverNow,
  slotStart,
  themesOf,
  weekGrid,
  worth,
} from '../src/features/eventGuide/guide';

const theme = (event_id: string, activity_id: string, day: number | null): Theme => ({
  activity_id,
  event_id,
  day,
  name: event_id,
  name_ko: null,
  min_day_score: null,
  min_week_score: null,
});

const score = (
  score_id: string,
  points: number,
  per_value: number,
  sort_order = 0,
): ScoreSource => ({
  activity_id: DUEL,
  event_id: 'e1',
  score_id,
  action: score_id,
  per_value,
  points,
  sort_order,
});

describe('slots', () => {
  it('starts slot 1 at midnight server time and runs in four-hour steps', () => {
    expect([1, 2, 3, 4, 5, 6].map(slotStart)).toEqual([
      '00:00',
      '04:00',
      '08:00',
      '12:00',
      '16:00',
      '20:00',
    ]);
  });
});

describe('actionText', () => {
  it('fills the game placeholder with the amount one payment is for', () => {
    expect(actionText('Use {0} Gears', 1)).toBe('Use 1 Gears');
    expect(actionText('Increase Tech CP by {0} Points', 100)).toBe(
      'Increase Tech CP by 100 Points',
    );
  });
  it('leaves a sentence without a placeholder alone, and names a missing one', () => {
    expect(actionText('Open 1 Orange-quality Chip Chest', 1)).toBe(
      'Open 1 Orange-quality Chip Chest',
    );
    expect(actionText(null, 1)).toBe('Unnamed action');
  });
});

describe('scoresOf', () => {
  it('puts what pays most per unit first, not the game order', () => {
    const rows = [score('a', 10, 100, 0), score('b', 600, 1, 1), score('c', 40, 1, 2)];
    expect(scoresOf(rows, DUEL, 'e1').map((r) => r.score_id)).toEqual(['b', 'c', 'a']);
  });
  it('keeps to one theme of one activity', () => {
    const other = { ...score('z', 1, 1), event_id: 'e2' };
    expect(scoresOf([score('a', 1, 1), other], DUEL, 'e1')).toHaveLength(1);
    expect(scoresOf([score('a', 1, 1)], SURVIVAL, 'e1')).toHaveLength(0);
  });
});

describe('weekGrid', () => {
  const cell = (day: number, slot: number, event_id: string): CalendarSlot => ({
    activity_id: SURVIVAL,
    day,
    slot,
    event_id,
  });

  it('lays the calendar out by slot and weekday, with null where nothing was sent', () => {
    const grid = weekGrid([cell(1, 1, 'a'), cell(7, 6, 'b')], SURVIVAL);

    expect(grid).toHaveLength(6);
    expect(grid[0]?.[0]).toBe('a');
    expect(grid[5]?.[6]).toBe('b');
    expect(grid[2]?.[3]).toBeNull();
  });
  it('ignores another activity and a day or slot outside the week', () => {
    const grid = weekGrid(
      [{ ...cell(1, 1, 'a'), activity_id: DUEL }, cell(8, 1, 'x'), cell(1, 9, 'y')],
      SURVIVAL,
    );

    expect(grid.flat().every((v) => v === null)).toBe(true);
  });
});

describe('themes', () => {
  it('orders the Duel by weekday and says which Mon-Sat days are not loaded yet (Sunday has no Duel)', () => {
    const themes = [theme('4', DUEL, 4), theme('1', DUEL, 1), theme('s', SURVIVAL, null)];

    expect(themesOf(themes, DUEL).map((t) => t.day)).toEqual([1, 4]);
    expect(missingDuelDays(themes)).toEqual([2, 3, 5, 6]);
  });
});

describe('serverNow', () => {
  it('reads the weekday and the slot on the game clock, UTC-2', () => {
    // Thursday 2026-10-08 13:30 UTC is 11:30 server time: slot 3 (08:00-12:00).
    expect(serverNow(new Date('2026-10-08T13:30:00Z'))).toEqual({ weekday: 4, slot: 3 });
  });
  it('turns the day over at 02:00 UTC, which is midnight server time', () => {
    expect(serverNow(new Date('2026-10-08T01:59:00Z'))).toEqual({ weekday: 3, slot: 6 });
    expect(serverNow(new Date('2026-10-08T02:00:00Z'))).toEqual({ weekday: 4, slot: 1 });
  });
  it('counts Sunday as day 7', () => {
    expect(serverNow(new Date('2026-10-11T14:00:00Z')).weekday).toBe(7);
  });
});

describe('worth', () => {
  it('compares per unit, so a payment per hundred is not drawn as bigger than one per action', () => {
    const rows = [
      { points: 300, per_value: 1 },
      { points: 10, per_value: 100 },
    ];
    const best = bestPerUnit(rows);

    expect(best).toBe(300);
    expect(worth(rows[0] as (typeof rows)[number], best)).toBe(1);
    expect(worth(rows[1] as (typeof rows)[number], best)).toBeCloseTo(0.1 / 300);
  });
  it('is zero with nothing to compare against', () => {
    expect(worth({ points: 5, per_value: 1 }, 0)).toBe(0);
    expect(bestPerUnit([])).toBe(0);
  });
});
