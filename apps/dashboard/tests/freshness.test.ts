import { expect, test } from 'vitest';
import { classifyFreshness, classifyPass, formatAge, formatPass } from '../src/lib/freshness';

const NOW = new Date('2026-07-28T12:00:00Z');

test('recent capture is fresh', () => {
  expect(classifyFreshness('2026-07-28T11:30:00Z', NOW)).toBe('fresh');
});

test('capture older than an hour is stale', () => {
  expect(classifyFreshness('2026-07-28T10:30:00Z', NOW)).toBe('stale');
});

test('null capture is missing, never zero-aged', () => {
  expect(classifyFreshness(null, NOW)).toBe('missing');
});

test.each([
  ['2026-07-28T11:59:40Z', '방금'],
  ['2026-07-28T11:55:00Z', '5분 전'],
  ['2026-07-28T09:00:00Z', '3시간 전'],
  ['2026-07-26T12:00:00Z', '2일 전'],
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
  expect(formatPass('2026-07-01T00:00:00Z', NOW)).toBe('만료');
  expect(formatPass('2026-07-28T20:00:00Z', NOW)).toBe('오늘 만료');
  expect(formatPass('2026-08-25T02:00:00Z', NOW)).toBe('D-27');
});
