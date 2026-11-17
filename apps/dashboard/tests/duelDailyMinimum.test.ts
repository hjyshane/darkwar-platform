import { expect, test } from 'vitest';
import { everyDuelDay, uniformDuelMinimum } from '../src/features/admin/RankTiersSetting';

// The single "points per duel day" field is a view over the six weekday
// floors the scorer reads (0328), never a seventh setting. These pin the two
// directions of that view.

test('six weekdays that agree read as one number', () => {
  expect(uniformDuelMinimum(everyDuelDay(624000))).toBe(624000);
  expect(uniformDuelMinimum(everyDuelDay(0))).toBe(0);
});

test('weekdays that differ are not one number', () => {
  const mins = { ...everyDuelDay(100), sat: 1000 };
  expect(uniformDuelMinimum(mins)).toBeNull();
});

test('the single field writes every weekday, Monday to Saturday and no Sunday', () => {
  const mins = everyDuelDay(5);
  expect(Object.keys(mins).sort()).toEqual(['fri', 'mon', 'sat', 'thu', 'tue', 'wed']);
  expect(Object.values(mins)).toEqual([5, 5, 5, 5, 5, 5]);
});
