// Server Clash data: two servers' strength side by side (0345), read by admins in
// Settings > Operations > Server clash data.
//
// The database does the work (`server_clash_compare`): it takes each server's
// top 3 alliances, their members from the map, and keeps the ones who moved in
// the window. This file only reads that one document and shapes it for the
// screen. What the figures can and cannot say is written where they are shown.

import type { Json } from '@dw/shared-types';
import { supabase } from './supabase';

export const OUR_SERVER = 580;
export const DEFAULT_OPPONENT = 588;
export const WINDOWS = [7, 14, 30] as const;
export type Window = (typeof WINDOWS)[number];

export interface ServerSide {
  server_id: number;
  alliances_on_board: number;
  members_seen: number;
  /** The top alliances' own member counts, summed. */
  members_official: number;
  /** Official members the map never showed: they need a scan. */
  unseen_members: number;
  active_players: number;
  /** Seen members that have a power reading. */
  power_known: number;
  total_power: number;
  median_power: number | null;
  top_power: number | null;
  power_gained: number;
  growing: number;
  map_active: number;
  no_power_reading: number;
}

export interface ClashAlliance {
  server_id: number;
  rn: number;
  code: string | null;
  name: string | null;
  power: number | null;
  member_count: number | null;
  members_seen: number;
  active_players: number;
  needs_scan: number;
  total_power: number | null;
  top_power: number | null;
}

export interface ClashPlayer {
  server_id: number;
  alliance_code: string | null;
  game_uid: string;
  name: string | null;
  power: number | null;
  power_gain: number | null;
  kills_gain: number;
  hq_gain: number;
  moved: boolean;
  shield_changed: boolean;
  trucked: boolean;
  moving: boolean;
}

export interface ServerClashData {
  days: number;
  generatedAt: string | null;
  servers: ServerSide[];
  alliances: ClashAlliance[];
  players: ClashPlayer[];
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** The document the function returns, tolerant of a missing key: an older
 * function or a trimmed fixture should draw empty, not crash the screen. */
export function parseClash(doc: Json | null): ServerClashData {
  const root = doc !== null && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  const days = typeof root.days === 'number' ? root.days : 7;
  const generatedAt = typeof root.generated_at === 'string' ? root.generated_at : null;
  return {
    days,
    generatedAt,
    servers: list<ServerSide>(root.servers),
    alliances: list<ClashAlliance>(root.alliances),
    players: list<ClashPlayer>(root.players),
  };
}

export async function fetchServerClash(
  ours: number,
  opponent: number,
  days: number,
): Promise<ServerClashData> {
  const { data, error } = await supabase.rpc('server_clash_compare', {
    p_server_a: ours,
    p_server_b: opponent,
    p_days: days,
  });
  if (error) {
    throw new Error(`server clash query failed: ${error.message}`);
  }
  return parseClash(data);
}

/** Every server the install knows, for the opponent picker. */
export async function fetchServerIds(): Promise<number[]> {
  const { data, error } = await supabase.from('servers').select('server_id').order('server_id');
  if (error) {
    throw new Error(`servers query failed: ${error.message}`);
  }
  return (data ?? []).map((row) => row.server_id);
}

/** A side's figure against the other's, as the share of the pair (0..1).
 * Null when neither has anything, so the bar is not drawn as "50/50". */
export function shareOfPair(mine: number, theirs: number): number | null {
  const total = mine + theirs;
  return total > 0 ? mine / total : null;
}

/** Which side leads on a figure. `tie` includes both zero. */
export function leader(mine: number, theirs: number): 'ours' | 'theirs' | 'tie' {
  if (mine === theirs) return 'tie';
  return mine > theirs ? 'ours' : 'theirs';
}

/** The side for a server id, or an all-zero one when the function had nothing
 * for it (it always returns both, but a stale cache may not). */
export function sideOf(data: ServerClashData, server: number): ServerSide {
  return (
    data.servers.find((entry) => entry.server_id === server) ?? {
      server_id: server,
      alliances_on_board: 0,
      members_seen: 0,
      members_official: 0,
      unseen_members: 0,
      active_players: 0,
      power_known: 0,
      total_power: 0,
      median_power: null,
      top_power: null,
      power_gained: 0,
      growing: 0,
      map_active: 0,
      no_power_reading: 0,
    }
  );
}

/** What needs another scan on one side: members the map never showed, and
 * members seen with no power reading. Together they are the people missing
 * from that side's totals. */
export function scanNeeded(side: ServerSide): { unseen: number; noPower: number; total: number } {
  return {
    unseen: side.unseen_members,
    noPower: side.no_power_reading,
    total: side.unseen_members + side.no_power_reading,
  };
}

/** One line on what the opponent's figures are likely to be missing. A thin
 * side is thin because it was scanned less, not because the server is weak, and
 * the screen says so rather than leaving it to read as weakness. */
export function coverageWarning(ours: ServerSide, theirs: ServerSide): string | null {
  if (theirs.alliances_on_board < 3 && theirs.alliances_on_board < ours.alliances_on_board) {
    return `Only ${theirs.alliances_on_board} of ${theirs.server_id}'s alliances reached the alliance board in this window, so its side is thinner than the server is.`;
  }
  const missing = scanNeeded(theirs);
  if (missing.total > 0 && missing.total >= theirs.members_seen) {
    return `${missing.total} of ${theirs.server_id}'s people still need a scan (${missing.unseen} never seen, ${missing.noPower} seen with no power reading): its totals are a floor, not the server.`;
  }
  return null;
}
