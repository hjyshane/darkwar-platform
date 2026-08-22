// FR-UI-005: each topic invalidates only its own panel's queries.
import { expect, test } from 'vitest';
import { queryKeysForTopic } from '../src/lib/realtime';

test('roster topics refetch the roster and the overview', () => {
  // The overview summarises the same rows, so a topic that changes the
  // roster has to reach both — a stat tile that disagrees with the table
  // under it is worse than one that is a moment late.
  expect(queryKeysForTopic('alliance_member_snapshots')).toEqual([
    ['roster'],
    ['overview'],
    ['player'],
  ]);
  expect(queryKeysForTopic('alliance_contribution_snapshots')).toEqual([
    ['roster'],
    ['overview'],
    ['player'],
  ]);
});

test('component power boards refetch the ranking panel', () => {
  expect(queryKeysForTopic('player_component_power_snapshots')).toEqual([
    ['crossRankings'],
    ['player'],
  ]);
});

test('player snapshots feed both the roster summary and the ranking boards', () => {
  // server.rank / kill.rank write player_snapshots, and those rows are the
  // cross-server boards; the same insert also advances the players summary.
  expect(queryKeysForTopic('player_snapshots')).toEqual([
    ['roster'],
    ['crossRankings'],
    ['overview'],
    ['player'],
  ]);
});

test('arena topics reach the board and whichever player page is open', () => {
  expect(queryKeysForTopic('arena_snapshots')).toEqual([['arena'], ['player']]);
  expect(queryKeysForTopic('arena_entries')).toEqual([['arena'], ['player']]);
});

test('alliance ranking topic maps to the rankings query only', () => {
  expect(queryKeysForTopic('alliance_snapshots')).toEqual([['rankings']]);
});

test('naming a hero reaches every board that prints the name', () => {
  // The admin page is where the rename happens; the arena board and the
  // cross-server board are where it shows. Miss one and the person who just
  // typed the name is the only one who cannot see it took effect.
  expect(queryKeysForTopic('heroes')).toEqual([['heroes'], ['heroes-admin'], ['crossRankings']]);
  expect(queryKeysForTopic('pets')).toEqual([['pets'], ['pets-admin'], ['crossRankings']]);
});

test('unknown topics invalidate nothing', () => {
  expect(queryKeysForTopic('battle_report_ingests')).toEqual([]);
});

test('a permission change reaches the screens that gate on it', () => {
  // Every form in the app asks the database what it may do; when the answer
  // changes, the person looking at a greyed-out control has to see it
  // ungrey without reloading.
  expect(queryKeysForTopic('role_permissions')).toEqual([['permissions'], ['session']]);
});

test('a decided claim reaches the member who filed it', () => {
  // Both halves, because the decision lands in two tables: the claim row
  // says "approved" and app_users carries the link. Watching only the first
  // leaves the member's own session reporting no character.
  expect(queryKeysForTopic('player_claims')).toEqual([['my-claim'], ['player-claims']]);
  expect(queryKeysForTopic('app_users')).toEqual([['session'], ['my-claim'], ['members-admin']]);
});

test('a comment reaches the thread and the activity score', () => {
  // Two readers of one write. The thread is the obvious one; the score is the
  // one that gets forgotten, because it reads comments from a screen that is
  // nowhere near the post (0114). A comment is worth 2 points the moment it
  // exists, and the admin table should not sit a staleTime behind saying 0.
  expect(queryKeysForTopic('post_comments')).toEqual([['comments'], ['activity-scores']]);
});

// The sweep is watched WHILE it runs — an officer reads a location off the
// player page as the collector pans past. Both new tables carry a notify
// trigger, and without a mapping here those fire into nothing and the page
// waits out its stale time instead.
test('a sweep refreshes an open player page', () => {
  const keys = queryKeysForTopic('world_city_snapshots');
  expect(keys).toContainEqual(['player-location']);
  expect(keys).toContainEqual(['player']);
});

test('season buildings refresh the season boards', () => {
  expect(queryKeysForTopic('season_building_snapshots')).toContainEqual(['seasonBoard']);
});

test('a topic nobody maps still says nothing', () => {
  expect(queryKeysForTopic('world_city_snapshots_typo')).toEqual([]);
});
