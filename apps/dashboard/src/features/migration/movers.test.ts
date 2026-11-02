import { describe, expect, test } from 'vitest';
import { tierOf } from './candidates';
import {
  type ListFreshness,
  type Mover,
  filterMovers,
  flows,
  moversByUid,
  staleLists,
  tally,
} from './movers';

const mover = (uid: number, home: number, now: number, rank = 5000): Mover => ({
  game_uid: uid,
  name: `p${uid}`,
  home_server: home,
  server_id: now,
  alliance_name: null,
  power: 100,
  board_rank: rank,
  captured_at: '2026-11-02T07:00:00Z',
  source: 'list',
});

const movers = [
  mover(1, 588, 580, 3),
  mover(2, 588, 580, 30),
  mover(3, 577, 580),
  mover(4, 578, 565),
];

describe('flows', () => {
  test('counts each from-to pair, biggest first', () => {
    expect(flows(movers)).toEqual([
      { from: 588, to: 580, count: 2 },
      { from: 577, to: 580, count: 1 },
      { from: 578, to: 565, count: 1 },
    ]);
  });
});

describe('tally', () => {
  test('arrivals and departures per server', () => {
    expect(tally(movers)).toEqual([
      { server: 565, arrived: 1, left: 0 },
      { server: 577, arrived: 0, left: 1 },
      { server: 578, arrived: 0, left: 1 },
      { server: 580, arrived: 3, left: 0 },
      { server: 588, arrived: 0, left: 2 },
    ]);
  });
});

describe('filterMovers', () => {
  const none = { from: '', to: '', tier: '' };

  test('by origin, destination and tier', () => {
    expect(filterMovers(movers, { ...none, from: '588' }, tierOf)).toHaveLength(2);
    expect(filterMovers(movers, { ...none, to: '565' }, tierOf).map((m) => m.game_uid)).toEqual([
      4,
    ]);
    expect(
      filterMovers(movers, { ...none, tier: 'commander' }, tierOf).map((m) => m.game_uid),
    ).toEqual([1]);
    expect(filterMovers(movers, { ...none, tier: 'elite' }, tierOf).map((m) => m.game_uid)).toEqual(
      [2],
    );
  });

  test('no filter keeps everyone', () => {
    expect(filterMovers(movers, none, tierOf)).toHaveLength(4);
  });
});

describe('staleLists', () => {
  const day = 86_400_000;
  const now = Date.parse('2026-11-02T08:00:00Z');
  const rows: ListFreshness[] = [
    { server_id: 565, captured_at: '2026-11-02T07:00:00Z', listed: 150, movers: 5 },
    { server_id: 566, captured_at: '2026-10-27T14:00:00Z', listed: 150, movers: 0 },
    { server_id: 567, captured_at: null, listed: 0, movers: 0 },
  ];

  test('older than the limit, or never read', () => {
    expect(staleLists(rows, now, day)).toEqual([566, 567]);
  });
});

describe('moversByUid', () => {
  test('finds a mover by uid', () => {
    const by = moversByUid(movers);
    expect(by.get(3)?.home_server).toBe(577);
    expect(by.get(99)).toBeUndefined();
  });
});
