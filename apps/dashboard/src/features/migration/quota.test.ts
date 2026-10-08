import { describe, expect, test } from 'vitest';
import { intakeLeft, levelOf, seatList, seatTotal } from './quota';

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

describe('levelOf', () => {
  const floors = [10_000_000, 15_000_000, 25_000_000, 35_000_000];

  test('is the highest cutoff reached', () => {
    expect(levelOf(10_000_000, floors)).toBe(0);
    expect(levelOf(24_999_999, floors)).toBe(1);
    expect(levelOf(60_000_000, floors)).toBe(3);
  });

  test('is -1 below the first cutoff', () => {
    expect(levelOf(5_000_000, floors)).toBe(-1);
  });

  test('is unknown with no cutoffs', () => {
    expect(levelOf(1, null)).toBeNull();
    expect(levelOf(1, [])).toBeNull();
  });
});
