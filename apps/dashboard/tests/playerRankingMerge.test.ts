import { describe, expect, it } from 'vitest';
import {
  type PlayerReading,
  latestBatchPer,
  mergeBoardAndRoster,
} from '../src/features/crossRankings/mergeRoster';
import { summariseServers } from '../src/features/overview/serverSummary';
import { filterByServer, resolveServer, serverCounts } from '../src/lib/serverFilter';

const reading = (over: Partial<PlayerReading> & { game_uid: number }): PlayerReading => ({
  snapshot_id: `s${over.game_uid}-${over.captured_at ?? 't'}`,
  player_id: `p${over.game_uid}`,
  rank: null,
  name: `n${over.game_uid}`,
  server_id: 580,
  captured_at: '2026-10-09T10:00:00Z',
  power: 100,
  kills: 1,
  ...over,
});

describe('latestBatchPer', () => {
  it('keeps the newest capture of each collecting server, not one overall', () => {
    const rows = [
      { captured_at: '2026-10-09T10:00:00Z', from: 580, id: 'a' },
      { captured_at: '2026-10-09T09:00:00Z', from: 580, id: 'old' },
      { captured_at: '2026-10-09T11:00:00Z', from: 590, id: 'b' },
    ];
    expect(latestBatchPer(rows, (row) => row.from).map((row) => row.id)).toEqual(['a', 'b']);
  });
});

describe('mergeBoardAndRoster', () => {
  it('adds roster members the board does not list, tagged and ranked by figure', () => {
    const merged = mergeBoardAndRoster(
      [reading({ game_uid: 1, power: 500, rank: 1 })],
      [reading({ game_uid: 2, power: 900 }), reading({ game_uid: 3, power: null })],
      'power',
    );
    expect(merged.map((row) => [row.game_uid, row.rank, row.source])).toEqual([
      [2, 1, 'roster'],
      [1, 2, 'board'],
    ]);
  });

  it('keeps the board row when the roster ties it, and the roster row when it is newer', () => {
    const tie = mergeBoardAndRoster(
      [reading({ game_uid: 1, power: 500 })],
      [reading({ game_uid: 1, power: 400 })],
      'power',
    );
    expect(tie).toHaveLength(1);
    expect(tie[0]?.source).toBe('board');
    const newer = mergeBoardAndRoster(
      [reading({ game_uid: 1, power: 500 })],
      [reading({ game_uid: 1, power: 650, captured_at: '2026-10-09T12:00:00Z' })],
      'power',
    );
    expect(newer[0]).toMatchObject({ source: 'roster', value: 650 });
  });
});

describe('server filter', () => {
  const rows = [{ server_id: 586 }, { server_id: 577 }, { server_id: 586 }];
  it('lists every server present, numerically, with counts', () => {
    expect(serverCounts(rows)).toEqual([
      { id: 577, count: 1 },
      { id: 586, count: 2 },
    ]);
  });
  it('falls back to all when the chosen server is not shown', () => {
    const servers = serverCounts(rows);
    expect(resolveServer(servers, 586)).toBe(586);
    expect(resolveServer(servers, 999)).toBeNull();
    expect(filterByServer(rows, 586)).toHaveLength(2);
    expect(filterByServer(rows, null)).toHaveLength(3);
  });
});

describe('summariseServers', () => {
  it('sums per server and leaves unknown figures unknown', () => {
    const out = summariseServers([
      { server_id: 586, member_count: 10, power: 5, captured_at: '2026-10-09T10:00:00Z' },
      { server_id: 586, member_count: null, power: null, captured_at: '2026-10-09T11:00:00Z' },
      { server_id: 577, member_count: null, power: null, captured_at: '2026-10-09T09:00:00Z' },
    ]);
    expect(out).toEqual([
      { serverId: 577, alliances: 1, members: null, power: null, lastSeen: '2026-10-09T09:00:00Z' },
      { serverId: 586, alliances: 2, members: 10, power: 5, lastSeen: '2026-10-09T11:00:00Z' },
    ]);
  });
});
