// One ranking capture produces many rows sharing a captured_at (one
// observation → one timestamp). Later captures of the same board coexist
// with earlier ones in the snapshot table — that history is the point of
// snapshots — but the PANEL is "the board as last seen", which is exactly
// the newest batch. Reducing client-side keeps the query a plain select;
// a window function is not worth a view for one panel.

export interface Batched {
  captured_at: string;
}

export function latestBatch<T extends Batched>(rows: T[]): T[] {
  if (rows.length === 0) {
    return rows;
  }
  // ISO-8601 UTC strings sort chronologically as text.
  const newest = rows.reduce((a, b) => (a.captured_at >= b.captured_at ? a : b)).captured_at;
  return rows.filter((row) => row.captured_at === newest);
}
