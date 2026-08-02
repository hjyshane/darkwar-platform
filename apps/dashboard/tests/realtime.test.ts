// FR-UI-005: each topic invalidates only its own panel's queries.
import { expect, test } from 'vitest';
import { queryKeysForTopic } from '../src/lib/realtime';

test('roster topics refetch the roster and the overview', () => {
  // The overview summarises the same rows, so a topic that changes the
  // roster has to reach both — a stat tile that disagrees with the table
  // under it is worse than one that is a moment late.
  expect(queryKeysForTopic('alliance_member_snapshots')).toEqual([['roster'], ['overview']]);
  expect(queryKeysForTopic('alliance_contribution_snapshots')).toEqual([['roster'], ['overview']]);
});

test('component power boards refetch the ranking panel', () => {
  expect(queryKeysForTopic('player_component_power_snapshots')).toEqual([['crossRankings']]);
});

test('player snapshots feed both the roster summary and the ranking boards', () => {
  // server.rank / kill.rank write player_snapshots, and those rows are the
  // cross-server boards; the same insert also advances the players summary.
  expect(queryKeysForTopic('player_snapshots')).toEqual([
    ['roster'],
    ['crossRankings'],
    ['overview'],
  ]);
});

test('arena topics map to the arena query only', () => {
  expect(queryKeysForTopic('arena_snapshots')).toEqual([['arena']]);
  expect(queryKeysForTopic('arena_entries')).toEqual([['arena']]);
});

test('alliance ranking topic maps to the rankings query only', () => {
  expect(queryKeysForTopic('alliance_snapshots')).toEqual([['rankings']]);
});

test('naming a hero reaches the board that prints the name, not just the form', () => {
  // The admin page is where the rename happens and the arena board is where
  // it shows, so the topic has to invalidate both — otherwise the person who
  // just typed the name is the only one who cannot see it took effect.
  expect(queryKeysForTopic('heroes')).toEqual([['heroes'], ['heroes-admin']]);
});

test('unknown topics invalidate nothing', () => {
  expect(queryKeysForTopic('battle_report_ingests')).toEqual([]);
});
