import { describe, expect, it } from 'vitest';
import {
  type CalendarSlot,
  DUEL,
  SURVIVAL,
  type ScoreSource,
  type Theme,
  actionText,
  missingDuelDays,
  scoresOf,
  slotStart,
  themesOf,
  weekGrid,
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
  it('orders the Duel by weekday and says which days the game has not sent yet', () => {
    const themes = [theme('4', DUEL, 4), theme('1', DUEL, 1), theme('s', SURVIVAL, null)];

    expect(themesOf(themes, DUEL).map((t) => t.day)).toEqual([1, 4]);
    expect(missingDuelDays(themes)).toEqual([2, 3, 5, 6, 7]);
  });
});
