// FR-UI-005: each topic invalidates only its own panel's queries.
import { expect, test } from 'vitest';
import { queryKeysForTopic } from '../src/lib/realtime';

test('roster topics map to the roster query only', () => {
  expect(queryKeysForTopic('alliance_member_snapshots')).toEqual([['roster']]);
  expect(queryKeysForTopic('player_snapshots')).toEqual([['roster']]);
});

test('arena topics map to the arena query only', () => {
  expect(queryKeysForTopic('arena_snapshots')).toEqual([['arena']]);
  expect(queryKeysForTopic('arena_entries')).toEqual([['arena']]);
});

test('unknown topics invalidate nothing', () => {
  expect(queryKeysForTopic('battle_report_ingests')).toEqual([]);
});
