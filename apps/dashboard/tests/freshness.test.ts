import { expect, test } from 'vitest';
import { classifyFreshness, classifyPass, formatAge, formatPass } from '../src/lib/freshness';

const NOW = new Date('2026-07-28T12:00:00Z');

test('recent capture is fresh', () => {
  expect(classifyFreshness('2026-07-28T11:30:00Z', NOW)).toBe('fresh');
});

test('a capture from earlier today is still fresh', () => {
  // The threshold was an hour, and at an hour almost every board on the screen
  // was amber almost all the time — the routine opens most screens a few times
  // a day, not hourly. A warning colour that is always on is not a warning.
  expect(classifyFreshness('2026-07-28T10:30:00Z', NOW)).toBe('fresh');
  expect(classifyFreshness('2026-07-27T13:00:00Z', NOW)).toBe('fresh');
});

test('capture older than a day is stale', () => {
  expect(classifyFreshness('2026-07-27T11:59:00Z', NOW)).toBe('stale');
});

test('null capture is missing, never zero-aged', () => {
  expect(classifyFreshness(null, NOW)).toBe('missing');
});

test.each([
  ['2026-07-28T11:59:40Z', 'just now'],
  ['2026-07-28T11:55:00Z', '5m ago'],
  ['2026-07-28T09:00:00Z', '3h ago'],
  ['2026-07-26T12:00:00Z', '2d ago'],
])('formatAge(%s) → %s', (capturedAt, label) => {
  expect(formatAge(capturedAt, NOW)).toBe(label);
});

test('pass status distinguishes never-seen from expired', () => {
  expect(classifyPass(null, NOW)).toBe('none');
  expect(classifyPass('2026-07-01T00:00:00Z', NOW)).toBe('expired');
  expect(classifyPass('2026-07-31T00:00:00Z', NOW)).toBe('expiring');
  expect(classifyPass('2026-09-01T00:00:00Z', NOW)).toBe('active');
});

test('pass formatting', () => {
  expect(formatPass(null, NOW)).toBe('—');
  expect(formatPass('2026-07-01T00:00:00Z', NOW)).toBe('Expired');
  expect(formatPass('2026-07-28T20:00:00Z', NOW)).toBe('Expires today');
  expect(formatPass('2026-08-25T02:00:00Z', NOW)).toBe('27d left');
});
