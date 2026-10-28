import { describe, expect, test } from 'vitest';
import {
  type BoardInfo,
  type Candidate,
  type CandidateRow,
  type SeenRow,
  type TierBoardRow,
  cells,
  foundFor,
  matchesOf,
  parseQuery,
  queryOf,
  serverFromUid,
  sourceLabel,
  summarize,
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

describe('summarize', () => {
  const row = (overall_rank: number, server_id: number, power: number): TierBoardRow => ({
    overall_rank,
    game_uid: overall_rank,
    name: `p${overall_rank}`,
    server_id,
    alliance_name: null,
    power,
    captured_at: '',
  });

  test('one line per tier, with the weakest power and the servers', () => {
    const rows = [row(1, 578, 900), row(10, 580, 800), row(11, 580, 700), row(47, 570, 600)];
    const [commander, elite, advanced, backbone] = summarize(rows);

    expect(commander).toMatchObject({
      tier: 'commander',
      count: 2,
      floorPower: 800,
      topPower: 900,
    });
    expect(commander?.byServer).toEqual([
      [578, 1],
      [580, 1],
    ]);
    expect(elite).toMatchObject({ first: 11, last: 46, count: 1, floorPower: 700 });
    expect(advanced).toMatchObject({ first: 47, last: 226, count: 1 });
    expect(backbone).toMatchObject({ first: 227, last: null, count: 0, floorPower: null });
  });
});

describe('foundFor', () => {
  const listed: CandidateRow = {
    game_uid: 1,
    name: 'Alpha',
    server_id: 567,
    alliance_name: 'Crew',
    power: 900,
    overall_rank: 4,
    captured_at: 't',
    migrate_power: null,
    migrate_power_at: null,
  };
  const seen: SeenRow = {
    game_uid: 2,
    name: 'Bravo',
    server_id: 570,
    alliance_name: null,
    power: 300,
    captured_at: 't',
    source_command: 'get.user.info.multi',
    estimated_rank: 2500,
    migrate_power: 7,
    migrate_power_at: 't',
  };
  const who = (query: string, game_uid: number | null = null): Candidate => ({
    candidate_id: query,
    query,
    game_uid,
    desired_alliance_id: null,
    extra: {},
  });

  test('a state list gives the exact place', () => {
    const [found] = foundFor(who('alpha'), [listed], [seen]);
    expect(found).toMatchObject({
      place: 4,
      estimated: false,
      server_id: 567,
      source: 'state list',
    });
  });

  test('outside the lists, the power last seen gives an estimated place', () => {
    const [found] = foundFor(who('Bravo'), [listed], [seen]);
    expect(found).toMatchObject({
      place: 2500,
      estimated: true,
      server_id: 570,
      migrate_power: 7,
      source: 'profile',
    });
  });

  test('a uid finds the player by uid', () => {
    expect(foundFor(who('2', 2), [], [seen])).toHaveLength(1);
    expect(foundFor(who('3', 3), [], [seen])).toHaveLength(0);
  });
});

describe('serverFromUid', () => {
  test('is the last six digits', () => {
    expect(serverFromUid(1343375089000584)).toBe(584);
    expect(serverFromUid(null)).toBeNull();
    expect(serverFromUid(12345)).toBeNull();
  });
});

describe('sourceLabel', () => {
  test('words the route of a sighting', () => {
    expect(sourceLabel('cross.server.rank')).toBe('state list');
    expect(sourceLabel('roster')).toBe('alliance roster');
    expect(sourceLabel('get.user.info.multi')).toBe('profile');
    expect(sourceLabel('apex.rank')).toBe('apex.rank');
    expect(sourceLabel(null)).toBeNull();
  });
});
