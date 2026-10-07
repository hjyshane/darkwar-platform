// The game's seasons and the buildings each one has (0242).
//
// What used to be constants in `features/season/buildings.ts` and a date in
// `participation/periods.ts` is now rows an admin edits. The constants stay as
// the FALLBACK: a table nobody has seeded, or a reader who may not read it,
// still gets the seasons the code was written against rather than a blank.

import { useQuery } from '@tanstack/react-query';
import {
  type BuildingKind,
  SEASON2_BUILDINGS,
  SEASON3_BUILDINGS,
} from '../features/season/buildings';
import { supabase } from './supabase';

export interface Season {
  id: number;
  name: string;
  /** ISO instant of the first game day, or null while it is not known. */
  startsAt: string | null;
  endsAt: string | null;
  buildings: readonly BuildingKind[];
}

/** Season 3's start: the date the participation periods and the duel rounds
 * were anchored to before there was a table. */
export const SEASON3_START = '2026-08-17T02:00:00.000Z';

export const FALLBACK_SEASONS: readonly Season[] = [
  { id: 2, name: 'Season 2', startsAt: null, endsAt: null, buildings: SEASON2_BUILDINGS },
  { id: 3, name: 'Season 3', startsAt: SEASON3_START, endsAt: null, buildings: SEASON3_BUILDINGS },
];

/** The latest season that has started. A season with no start date is never
 * "current": an unknown start must not read as "since the beginning of time". */
export function currentSeason(seasons: readonly Season[], now: Date): Season | null {
  let best: Season | null = null;
  for (const season of seasons) {
    if (season.startsAt === null || Date.parse(season.startsAt) > now.getTime()) continue;
    if (best === null || Date.parse(season.startsAt) > Date.parse(best.startsAt ?? '')) {
      best = season;
    }
  }
  return best;
}

/** The season before the current one, for the admin-only look back. The
 * highest number below the current season's; with no current season, none. */
export function pastSeason(seasons: readonly Season[], now: Date): Season | null {
  const current = currentSeason(seasons, now);
  if (current === null) return null;
  return (
    [...seasons].filter((season) => season.id < current.id).sort((a, b) => b.id - a.id)[0] ?? null
  );
}

export async function fetchSeasons(): Promise<Season[]> {
  const [seasons, buildings] = await Promise.all([
    supabase.from('seasons').select('season_id, name, starts_at, ends_at').order('season_id'),
    supabase
      .from('season_buildings')
      .select('season_id, building_type_id, name, sort_order, provisional, stall_hours')
      .order('sort_order')
      // A tie in the typed order must not shuffle between loads.
      .order('building_type_id')
      .limit(1000),
  ]);
  const error = seasons.error ?? buildings.error;
  if (error) {
    // A reader who may not read the tables, or a database without them yet,
    // gets the seasons the code knows rather than an error page.
    if (error.code === '42501' || error.code === '42P01' || error.code === 'PGRST205') {
      return [...FALLBACK_SEASONS];
    }
    throw new Error(`seasons query failed: ${error.message}`);
  }
  const rows = seasons.data ?? [];
  if (rows.length === 0) {
    return [...FALLBACK_SEASONS];
  }
  return rows.map((row) => ({
    id: row.season_id,
    name: row.name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    buildings: (buildings.data ?? [])
      .filter((building) => building.season_id === row.season_id)
      .map((building) => ({
        id: building.building_type_id,
        name: building.name,
        ...(building.provisional ? { provisional: true } : {}),
        ...(building.stall_hours === null ? {} : { stallHours: building.stall_hours }),
      })),
  }));
}

/** Every season, with the fallback while loading or when there are none. */
export function useSeasons() {
  return useQuery({
    queryKey: ['seasons'],
    queryFn: fetchSeasons,
    staleTime: 5 * 60_000,
  });
}

/** The current season's building catalogue, or Season 3's when nothing is
 * known — what the boards and the admin pickers read. */
export function currentBuildings(seasons: readonly Season[] | undefined, now: Date) {
  const list = seasons ?? FALLBACK_SEASONS;
  const current = currentSeason(list, now);
  if (current !== null && current.buildings.length > 0) {
    return current.buildings;
  }
  // A season that has started but has no buildings named yet (the days between
  // its start and the first sweep): the pickers keep offering the last season
  // that has some, rather than an empty table nobody can fix.
  const named = [...list]
    .filter((season) => season.buildings.length > 0 && (current === null || season.id < current.id))
    .sort((a, b) => b.id - a.id)[0];
  return named?.buildings ?? SEASON3_BUILDINGS;
}

export async function saveSeason(entry: {
  id: number;
  name: string;
  startsAt: string | null;
  endsAt: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('save_season', {
    p_season_id: entry.id,
    p_name: entry.name,
    ...(entry.startsAt === null ? {} : { p_starts_at: entry.startsAt }),
    ...(entry.endsAt === null ? {} : { p_ends_at: entry.endsAt }),
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function saveSeasonBuilding(entry: {
  seasonId: number;
  typeId: number;
  name: string;
  sortOrder?: number;
  provisional?: boolean;
  stallHours?: number | null;
}): Promise<void> {
  const { error } = await supabase.rpc('save_season_building', {
    p_season_id: entry.seasonId,
    p_building_type_id: entry.typeId,
    p_name: entry.name,
    ...(entry.sortOrder === undefined ? {} : { p_sort_order: entry.sortOrder }),
    p_provisional: entry.provisional ?? false,
    ...(entry.stallHours == null ? {} : { p_stall_hours: entry.stallHours }),
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteSeasonBuilding(seasonId: number, typeId: number): Promise<void> {
  const { error } = await supabase.rpc('delete_season_building', {
    p_season_id: seasonId,
    p_building_type_id: typeId,
  });
  if (error) {
    throw new Error(error.message);
  }
}

export interface UnnamedBuilding {
  typeId: number;
  players: number;
  newestSeen: string | null;
}

/** Building types the sweeps have seen that no season has named. */
export async function fetchUnnamedBuildings(): Promise<UnnamedBuilding[]> {
  const { data, error } = await supabase.rpc('season_unnamed_buildings');
  if (error) {
    if (error.code === '42501') return [];
    throw new Error(`unnamed buildings query failed: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    typeId: row.building_type_id,
    players: row.players,
    newestSeen: row.newest_seen,
  }));
}

/** An instant as the `datetime-local` box wants it: the game's UTC, no zone.
 * Every timestamp in this app is UTC, and a box that silently used the
 * browser's zone would move a season start by hours. */
export function toUtcInput(iso: string | null): string {
  return iso === null ? '' : new Date(iso).toISOString().slice(0, 16);
}

/** The box's text back to an instant, read as UTC. Null for an empty box;
 * undefined for text that is not a date. */
export function fromUtcInput(text: string): string | null | undefined {
  if (text.trim() === '') return null;
  // Strict: the engine's own parser accepts a surprising amount of nonsense.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return undefined;
  const parsed = Date.parse(`${text}:00Z`);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}
