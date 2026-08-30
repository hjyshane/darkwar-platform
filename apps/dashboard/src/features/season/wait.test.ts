import { expect, test } from 'vitest';
import { formatWait, parseAmount, waitFor } from './wait';

// --- parseAmount ----------------------------------------------------------

// The figures come off a game screen and get typed or pasted with the
// separators the game draws, so "1,200" and "1 200" have to mean 1200 rather
// than nothing.
test('separators in a pasted figure are ignored', () => {
  expect(parseAmount('1,200')).toBe(1200);
  expect(parseAmount('1 200')).toBe(1200);
  expect(parseAmount('1200')).toBe(1200);
});

test('an empty or unreadable box is not a zero', () => {
  expect(parseAmount('')).toBeNull();
  expect(parseAmount('   ')).toBeNull();
  expect(parseAmount('soon')).toBeNull();
  // A negative amount is not a number this calculator can mean anything by.
  expect(parseAmount('-5')).toBeNull();
});

test('a decimal rate survives, because production is not always whole', () => {
  expect(parseAmount('12.5')).toBe(12.5);
});

// --- waitFor --------------------------------------------------------------

test('the wait is the shortfall divided by the rate', () => {
  expect(waitFor({ perHour: 100, current: 500, needed: 1000 })).toEqual({
    kind: 'wait',
    hours: 5,
  });
});

test('already having enough is ready, not a zero-hour wait', () => {
  expect(waitFor({ perHour: 100, current: 1000, needed: 1000 })).toEqual({ kind: 'ready' });
  expect(waitFor({ perHour: 100, current: 2000, needed: 1000 })).toEqual({ kind: 'ready' });
});

// Dividing by a zero rate gives Infinity, which formats as "Infinityh" and
// reads as a bug. A building that produces nothing never finishes, and the
// answer has to say so rather than print a number.
test('nothing coming in never arrives', () => {
  expect(waitFor({ perHour: 0, current: 0, needed: 1000 })).toEqual({ kind: 'never' });
});

test('a box left empty has no answer yet', () => {
  expect(waitFor({ perHour: null, current: 0, needed: 1000 })).toBeNull();
  expect(waitFor({ perHour: 100, current: null, needed: 1000 })).toBeNull();
  expect(waitFor({ perHour: 100, current: 0, needed: null })).toBeNull();
});

// --- formatWait -----------------------------------------------------------

test('a wait is read in days, hours and minutes', () => {
  expect(formatWait(5)).toBe('5h');
  expect(formatWait(0.5)).toBe('30m');
  expect(formatWait(26.25)).toBe('1d 2h 15m');
  expect(formatWait(48)).toBe('2d');
});

// Under a minute is still a wait, and "0m" reads as ready — which it is not.
test('a wait shorter than a minute rounds up rather than to nothing', () => {
  expect(formatWait(0.001)).toBe('1m');
});

// The minutes are rounded, so 59.6 minutes must carry into the hour rather
// than print "60m".
test('rounded minutes carry instead of printing sixty', () => {
  expect(formatWait(59.7 / 60)).toBe('1h');
  expect(formatWait(23 + 59.7 / 60)).toBe('1d');
});
