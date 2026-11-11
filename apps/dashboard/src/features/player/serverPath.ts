import { supabase } from '../../lib/supabase';

/** One recorded server change (player_server_moves, 0320). */
export interface ServerMove {
  fromServerId: number;
  toServerId: number;
  /** First sighting on the new server: the move happened before this. */
  seenAt: string;
  /** Newest sighting on the old server before it; null = never seen there. */
  lastSeenFromAt: string | null;
}

/** One stop in a player's server path, oldest first. */
export interface ServerStop {
  serverId: number;
  /** null for the first server: the account was made there. */
  arrivedBy: string | null;
  /** When they were last seen on the server they left to come here. */
  leftPreviousAfter: string | null;
  current: boolean;
}

export interface ServerPath {
  /** The server the account was made on. */
  homeServerId: number;
  stops: ServerStop[];
  moved: boolean;
}

/** Moves come oldest first. The first server is the first move's origin: the
 * recorder starts every player from the server their uid ends in, computed in
 * SQL. Not computed here — a 16-digit uid is past what a JS number holds
 * exactly, so `uid % 1e6` in the browser can be wrong. With no move, the
 * player is where they started. */
export function serverPath(moves: readonly ServerMove[], currentServerId: number): ServerPath {
  const first = moves[0];
  if (first === undefined) {
    return {
      homeServerId: currentServerId,
      stops: [
        { serverId: currentServerId, arrivedBy: null, leftPreviousAfter: null, current: true },
      ],
      moved: false,
    };
  }
  const homeServerId = first.fromServerId;
  const stops: ServerStop[] = [
    { serverId: homeServerId, arrivedBy: null, leftPreviousAfter: null, current: false },
    ...moves.map((move, at) => ({
      serverId: move.toServerId,
      arrivedBy: move.seenAt,
      leftPreviousAfter: move.lastSeenFromAt,
      current: at === moves.length - 1,
    })),
  ];
  return { homeServerId, stops, moved: true };
}

export async function fetchServerMoves(playerId: string): Promise<ServerMove[]> {
  const { data, error } = await supabase
    .from('player_server_moves')
    .select('from_server_id, to_server_id, seen_at, last_seen_from_at')
    .eq('player_id', playerId)
    .order('seen_at', { ascending: true });
  if (error) {
    throw new Error(`server move query failed: ${error.message}`);
  }
  return data.map((row) => ({
    fromServerId: row.from_server_id,
    toServerId: row.to_server_id,
    seenAt: row.seen_at,
    lastSeenFromAt: row.last_seen_from_at,
  }));
}
