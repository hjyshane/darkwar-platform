// FR-UI-005: each topic invalidates only its own panel's queries.
import { expect, test } from 'vitest';
import { queryKeysForTopic } from '../src/lib/realtime';

test('roster topics refetch the roster', () => {
  expect(queryKeysForTopic('alliance_member_snapshots')).toEqual([['roster']]);
  expect(queryKeysForTopic('alliance_contribution_snapshots')).toEqual([['roster']]);
});

test('player snapshots feed both the roster summary and the ranking boards', () => {
  // server.rank / kill.rank write player_snapshots, and those rows are the
  // cross-server boards; the same insert also advances the players summary.
  expect(queryKeysForTopic('player_snapshots')).toEqual([['roster'], ['crossRankings']]);
});

test('arena topics map to the arena query only', () => {
  expect(queryKeysForTopic('arena_snapshots')).toEqual([['arena']]);
  expect(queryKeysForTopic('arena_entries')).toEqual([['arena']]);
});

test('alliance ranking topic maps to the rankings query only', () => {
  expect(queryKeysForTopic('alliance_snapshots')).toEqual([['rankings']]);
});

test('unknown topics invalidate nothing', () => {
  expect(queryKeysForTopic('battle_report_ingests')).toEqual([]);
});
