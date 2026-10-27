import { describe, expect, test } from 'vitest';
import {
  type BoardInfo,
  type Candidate,
  type CandidateRow,
  cells,
  matchesOf,
  parseQuery,
  queryOf,
  tierOf,
  unlistedTier,
  unmatched,
} from './candidates';

describe('tierOf', () => {
  test('cuts at 10 / 46 / 226', () => {
    expect([1, 10, 11, 46, 47, 226, 227, 3000].map(tierOf)).toEqual([
      'commander',
      'commander',
      'elite',
      'elite',
      'advanced',
      'advanced',
      'backbone',
      'backbone',
    ]);
  });
});

describe('parseQuery', () => {
  test('splits names from uids, drops blanks and repeats', () => {
    expect(parseQuery('Alpha\n\n  bravo , ALPHA\t1343375089000584\n')).toEqual({
      names: ['Alpha', 'bravo'],
      uids: [1343375089000584],
    });
  });

  test('a short number is a name', () => {
    expect(parseQuery('007')).toEqual({ names: ['007'], uids: [] });
  });
});

describe('unlistedTier', () => {
  const info: BoardInfo = {
    servers: [567],
    missing_servers: [],
    listed: 150,
    oldest_at: null,
    newest_at: null,
    rank_floor_unlisted: 400,
  };

  test('is backbone only when every list is in and the floor is past 226', () => {
    expect(unlistedTier(info)).toBe('backbone');
    expect(unlistedTier({ ...info, rank_floor_unlisted: 200 })).toBeNull();
    expect(unlistedTier({ ...info, missing_servers: [580] })).toBeNull();
    expect(unlistedTier(null)).toBeNull();
  });
});

describe('unmatched', () => {
  test('names the entries with no row, ignoring case and spaces', () => {
    const rows = [
      {
        game_uid: 5,
        name: 'Alpha ',
        server_id: 567,
        alliance_name: null,
        power: 1,
        overall_rank: 1,
        captured_at: '',
        migrate_power: null,
        migrate_power_at: null,
      },
    ];
    expect(unmatched({ names: ['alpha', 'Zed'], uids: [5, 9] }, rows)).toEqual(['Zed', '9']);
  });
});

describe('saved candidates', () => {
  const row = (game_uid: number, name: string, server_id: number): CandidateRow => ({
    game_uid,
    name,
    server_id,
    alliance_name: null,
    power: 1,
    overall_rank: 1,
    captured_at: '',
    migrate_power: null,
    migrate_power_at: null,
  });
  const candidate = (query: string, game_uid: number | null = null): Candidate => ({
    candidate_id: query,
    query,
    game_uid,
    desired_alliance_id: null,
    extra: {},
  });

  test('a name matches ignoring case and spaces, all same-name players', () => {
    const rows = [row(1, 'Alpha ', 567), row(2, 'alpha', 570), row(3, 'Bravo', 568)];
    expect(matchesOf(candidate(' ALPHA'), rows).map((r) => r.game_uid)).toEqual([1, 2]);
  });

  test('a pinned uid wins over the name', () => {
    const rows = [row(1, 'Alpha', 567), row(2, 'Alpha', 570)];
    expect(matchesOf(candidate('Alpha', 2), rows).map((r) => r.server_id)).toEqual([570]);
  });

  test('the lookup is asked once per name and per uid', () => {
    expect(queryOf([candidate('Alpha'), candidate('Alpha', 7), candidate('Bravo')])).toEqual({
      names: ['Alpha', 'Bravo'],
      uids: [7],
    });
  });

  test('cells keeps only text', () => {
    expect(cells({ a: 'x', b: 3, c: null })).toEqual({ a: 'x' });
    expect(cells(null)).toEqual({});
    expect(cells(['x'])).toEqual({});
  });
});
