// One line per server the scans have reached, from the alliance board.
// Pure, so the arithmetic can be checked without a database.

export interface AllianceFigure {
  server_id: number;
  member_count: number | null;
  power: number | null;
  captured_at: string;
}

export interface ServerSummary {
  serverId: number;
  alliances: number;
  members: number | null;
  power: number | null;
  lastSeen: string;
}

export function summariseServers(rows: readonly AllianceFigure[]): ServerSummary[] {
  const byServer = new Map<number, ServerSummary>();
  for (const row of rows) {
    const held = byServer.get(row.server_id) ?? {
      serverId: row.server_id,
      alliances: 0,
      members: null,
      power: null,
      lastSeen: row.captured_at,
    };
    held.alliances += 1;
    // Unknown stays unknown: a server with no figures is not a server with zero.
    if (row.member_count !== null) held.members = (held.members ?? 0) + row.member_count;
    if (row.power !== null) held.power = (held.power ?? 0) + row.power;
    if (row.captured_at > held.lastSeen) held.lastSeen = row.captured_at;
    byServer.set(row.server_id, held);
  }
  return [...byServer.values()].sort((a, b) => a.serverId - b.serverId);
}
