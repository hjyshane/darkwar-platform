// Two season boards, two tables, one panel.
//
// They rank different SUBJECTS — one scores alliances, one ranks players —
// so unlike the cross-server panel there is no shared row shape to collapse
// them into. Each board declares its own fetch and its own row type, and the
// panel switches which table it draws.
//
// Both are "the board as last seen": one capture is one observation is one
// captured_at, so `latestBatch` is the whole of the freshness logic. History
// stays in the table; the panel is not a history view.

import { supabase } from '../../lib/supabase';
import { latestBatch } from '../crossRankings/latestBatch';

export type SeasonBoardId = 'alliance_score' | 'player_force';

export interface SeasonAllianceRow {
  id: string;
  /** Resolved cloud-side from the entity ref; the collector cannot fill it.
   *
   * Nullable because nothing guarantees resolution, NOT because untracked
   * servers go unresolved — measured against a real board, sync's
   * ensure_alliance() minted an identity row for all 89, including 25 on
   * server 586 and 21 on 588 that nobody sweeps, so every row resolved. The
   * null branch below is the honest fallback, not the common case. */
  allianceId: string | null;
  externalId: string;
  rank: number | null;
  /** The server's own oldRank, not a diff we computed. */
  previousRank: number | null;
  name: string | null;
  abbr: string | null;
  server_id: number;
  score: number | null;
  power: number | null;
  captured_at: string;
}

export interface SeasonPlayerRow {
  id: string;
  playerId: string | null;
  rank: number | null;
  name: string | null;
  game_uid: number;
  server_id: number;
  allianceName: string | null;
  abbr: string | null;
  force: number | null;
  captured_at: string;
}

// A season alliance board is 89 rows and a player board 149. The limit is
// wide enough that several captures of each still leave the newest whole
// board inside the window, which is what latestBatch needs to find it.
const WINDOW = 1000;

export async function fetchAllianceScoreBoard(): Promise<SeasonAllianceRow[]> {
  const { data, error } = await supabase
    .from('alliance_season_score_snapshots')
    .select(
      'snapshot_id, alliance_id, alliance_external_id, alliance_name, alliance_abbr, server_id, score, power, rank, previous_rank, captured_at',
    )
    .order('captured_at', { ascending: false })
    .order('rank', { ascending: true, nullsFirst: false })
    .limit(WINDOW);
  if (error) {
    throw new Error(`season alliance board query failed: ${error.message}`);
  }
  return latestBatch(data ?? []).map((row) => ({
    id: row.snapshot_id,
    allianceId: row.alliance_id,
    externalId: row.alliance_external_id,
    rank: row.rank,
    previousRank: row.previous_rank,
    name: row.alliance_name,
    abbr: row.alliance_abbr,
    server_id: row.server_id,
    score: row.score,
    power: row.power,
    captured_at: row.captured_at,
  }));
}

export async function fetchPlayerForceBoard(): Promise<SeasonPlayerRow[]> {
  const { data, error } = await supabase
    .from('player_season_force_snapshots')
    .select(
      'snapshot_id, player_id, name, game_uid, server_id, alliance_name, alliance_abbr, force, rank, captured_at',
    )
    .order('captured_at', { ascending: false })
    .order('rank', { ascending: true, nullsFirst: false })
    .limit(WINDOW);
  if (error) {
    throw new Error(`season player board query failed: ${error.message}`);
  }
  return latestBatch(data ?? []).map((row) => ({
    id: row.snapshot_id,
    playerId: row.player_id,
    rank: row.rank,
    name: row.name,
    game_uid: row.game_uid,
    server_id: row.server_id,
    allianceName: row.alliance_name,
    abbr: row.alliance_abbr,
    force: row.force,
    captured_at: row.captured_at,
  }));
}

/** Rank movement, for the arrow the alliance board draws.
 *
 * `previous` is the server's own oldRank (migration 0136), so this reports
 * what the game said rather than diffing two of our captures — a gap in
 * capture cannot fake a rank that did not move.
 *
 * A smaller number is a better position, so an IMPROVED rank is a NEGATIVE
 * delta. Callers get the direction named rather than the sign, because
 * "-3 is good" is exactly the sort of thing a caller gets backwards.
 */
export function movement(
  rank: number | null,
  previous: number | null,
): { direction: 'up' | 'down' | 'flat'; places: number } | null {
  if (rank === null || previous === null) {
    return null;
  }
  // The game uses 0 for "unranked last time" on a board a newcomer just
  // entered. Treating it as position zero would report a debut as the
  // biggest fall on the board.
  if (previous === 0) {
    return null;
  }
  const delta = previous - rank;
  if (delta === 0) {
    return { direction: 'flat', places: 0 };
  }
  return { direction: delta > 0 ? 'up' : 'down', places: Math.abs(delta) };
}
