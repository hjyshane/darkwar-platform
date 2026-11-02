import { describe, expect, test } from 'vitest';
import { intakeLeft, seatList, seatTotal } from './quota';

describe('seatList', () => {
  test('reads an object of counts in level order', () => {
    expect(seatList({ '2': 15, '1': 20 })).toEqual([
      [1, 20],
      [2, 15],
    ]);
  });

  test('a bare number is one pool', () => {
    expect(seatList(7)).toEqual([[0, 7]]);
  });

  test('empty is empty, not unknown', () => {
    expect(seatList({})).toEqual([]);
  });

  test('anything else is unknown, never a guess', () => {
    expect(seatList(null)).toBeNull();
    expect(seatList('unexpected')).toBeNull();
    expect(seatList([{ type: 1, num: 2 }])).toBeNull();
    expect(seatList({ a: 1 })).toBeNull();
    expect(seatList({ '1': 'x' })).toBeNull();
  });
});

describe('seatTotal', () => {
  test('sums every level', () => {
    expect(seatTotal({ '1': 20, '2': 15 })).toBe(35);
  });

  test('is null when the shape is unknown', () => {
    expect(seatTotal('x')).toBeNull();
  });
});

describe('intakeLeft', () => {
  test('is what is still allowed, never below zero', () => {
    expect(intakeLeft(60, 12)).toBe(48);
    expect(intakeLeft(40, 45)).toBe(0);
  });

  test('is unknown when either figure is', () => {
    expect(intakeLeft(null, 3)).toBeNull();
    expect(intakeLeft(60, null)).toBeNull();
  });
});
