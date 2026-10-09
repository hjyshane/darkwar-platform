// The server chips on the ranking screens. The list of servers is whatever
// the rows on screen mention, not the `servers` table: a server joins the
// screen the moment its first scan lands, with nothing to register or
// hard-code, and a chip never leads to an empty list.

export interface ServerCount {
  id: number;
  count: number;
}

export function serverCounts(rows: readonly { server_id: number | null }[]): ServerCount[] {
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (row.server_id !== null) {
      counts.set(row.server_id, (counts.get(row.server_id) ?? 0) + 1);
    }
  }
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => a.id - b.id);
}

/** The chosen server, or null (all) when it is not among the servers shown.
 *
 * Switching board can drop the server you had picked; falling back to "all" is
 * better than a filter that silently matches nothing. */
export function resolveServer(
  servers: readonly ServerCount[],
  chosen: number | null,
): number | null {
  return chosen !== null && servers.some((server) => server.id === chosen) ? chosen : null;
}

export function filterByServer<T extends { server_id: number | null }>(
  rows: readonly T[],
  server: number | null,
): T[] {
  return server === null ? [...rows] : rows.filter((row) => row.server_id === server);
}
