import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  LIVE_WITHIN_MS,
  claimedStatusLabel,
  collectorBadgeClass,
  collectorState,
} from '../src/lib/collectorHealth';

const NOW = new Date('2026-08-03T12:00:00Z');

test('a collector that beat within the window is live', () => {
  expect(collectorState('2026-08-03T11:59:30Z', NOW)).toBe('live');
});

test('the boundary is inclusive, and one millisecond past it is not', () => {
  expect(collectorState('2026-08-03T11:59:00.000Z', NOW)).toBe('live');
  expect(collectorState('2026-08-03T11:58:59.999Z', NOW)).toBe('silent');
});

test('never having checked in is not the same as having gone quiet', () => {
  // A collector registered but never started has no last heartbeat. Calling
  // that "silent" would report an outage that never began.
  expect(collectorState(null, NOW)).toBe('never');
  expect(collectorState('2026-07-01T00:00:00Z', NOW)).toBe('silent');
});

test('the threshold is the one sync_status uses', () => {
  // 0060 says in as many words that the threshold lives in SQL so that
  // "live" means one thing. This file holds a second copy; the point of
  // reading the migration is that the copy cannot quietly drift.
  const migration = readFileSync(
    `${__dirname}/../../../supabase/migrations/20260728000060_sync_status.sql`,
    'utf8',
  );
  expect(migration).toContain("interval '1 minute'");
  expect(LIVE_WITHIN_MS).toBe(60_000);
});

test('a silent collector reports its own status in the past tense', () => {
  // "healthy" next to a heartbeat three days old would be the board
  // asserting something nothing has told it since.
  expect(claimedStatusLabel('healthy', 'live')).toBe('healthy');
  expect(claimedStatusLabel('healthy', 'silent')).toBe('last said healthy');
  expect(claimedStatusLabel('healthy', 'never')).toBe('—');
});

test('the badge reuses the freshness palette rather than a third one', () => {
  expect(collectorBadgeClass('live')).toBe('badge badge-fresh');
  expect(collectorBadgeClass('silent')).toBe('badge badge-stale');
  expect(collectorBadgeClass('never')).toBe('badge badge-missing');
});
