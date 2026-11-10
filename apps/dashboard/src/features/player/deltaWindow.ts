// "+59.4M · 30d": a change over a window the data can actually cover.
//
// Retention (0070, 0299) keeps snapshots of our own members for three months
// and everyone else's for seven days, so the window is not a preference — it
// is whatever still exists. Written out on the cell, always, so "+1.2M" is
// never read as "since yesterday" for one player and "since last month" for
// another.

import { supabase } from '../../lib/supabase';

export type WindowDays = 7 | 30;

export function retentionWindowDays(isOwnAlliance: boolean): WindowDays {
  return isOwnAlliance ? 30 : 7;
}

/** One `player_power_history` row (0073/0098 over `player_snapshots`). A
 * `server.rank` reading carries power and no kills; a `kill.rank` reading
 * carries kills and no power. Both are readings about something else, not a
 * player with zero of it, so each series picks its own rows. */
export interface HistoryRow {
  captured_at: string;
  power: number | null;
  kills: number | null;
  source_command: string;
}

export type Delta =
  | { kind: 'delta'; change: number; windowDays: WindowDays; from: string; to: string }
  /** One reading inside the window: a figure, but nothing to measure it against. */
  | { kind: 'asOf'; at: string; value: number }
  | null;

export function deltaOver(
  rows: readonly HistoryRow[],
  pick: (row: HistoryRow) => number | null,
  windowDays: WindowDays,
): Delta {
  const series = rows
    .map((row) => ({ at: row.captured_at, value: pick(row) }))
    .filter((point): point is { at: string; value: number } => point.value !== null)
    .sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0));
  const oldest = series[0];
  const newest = series[series.length - 1];
  if (oldest === undefined || newest === undefined) return null;
  if (series.length === 1) return { kind: 'asOf', at: newest.at, value: newest.value };
  return {
    kind: 'delta',
    change: newest.value - oldest.value,
    windowDays,
    from: oldest.at,
    to: newest.at,
  };
}

export const KILLS_SOURCE = 'kill.rank';

export function powerDelta(rows: readonly HistoryRow[], windowDays: WindowDays): Delta {
  return deltaOver(rows, (row) => row.power, windowDays);
}

/** Kills come from the kill board only (spec §3): the other boards do not
 * report them, and a profile read's kills column is not the same series. */
export function killsDelta(rows: readonly HistoryRow[], windowDays: WindowDays): Delta {
  return deltaOver(
    rows,
    (row) => (row.source_command === KILLS_SOURCE ? row.kills : null),
    windowDays,
  );
}

export async function fetchHistoryWindow(
  playerId: string,
  windowDays: WindowDays,
  now: Date,
): Promise<HistoryRow[]> {
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('player_power_history')
    .select('captured_at, power, kills, source_command')
    .eq('player_id', playerId)
    .gte('captured_at', since)
    .order('captured_at', { ascending: true });
  if (error) throw new Error(`power history query failed: ${error.message}`);
  // The view's columns are nullable to PostgREST because it is a view; a row
  // without a capture time or source is not a reading and is dropped.
  return data.filter(
    (row): row is HistoryRow => row.captured_at !== null && row.source_command !== null,
  );
}
