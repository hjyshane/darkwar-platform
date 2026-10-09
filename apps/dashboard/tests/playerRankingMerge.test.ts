import { describe, expect, it } from 'vitest';
import { summariseServers } from '../src/features/overview/serverSummary';
import { filterByServer, resolveServer, serverCounts } from '../src/lib/serverFilter';

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
