// "Who is behind?" — one number and one switch, stored where every other
// admin choice lives.
//
// The alliance's actual question about the building board is not "what level
// is everyone" but "who is under X". That threshold is a judgement the
// officers make and change as the season moves, so it belongs in
// `app_settings` beside the overview tiles and the notification routing —
// not in a constant somebody has to deploy to edit.
//
// NOW PER-BUILDING, and the old note said how it would go: the stored value is
// a jsonb object, so it grew a `perBuilding` key without a migration.
//
// One level across everything was the alliance's rule until it wasn't. The lab
// and the barrack are not levelled on the same schedule as the greenhouses,
// so a single floor either accuses everybody of being behind on the thing
// nobody has started, or sits so low it marks nobody.
//
// A BUILDING WITH NO ENTRY HAS NO FLOOR. Setting a level is how an officer
// says "this one matters this week"; the rest are not judged at all, which is
// what makes the marks worth reading.

import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

export const ALERT_SETTING_KEY = 'season_building_alert';

export interface SeasonBuildingAlert {
  /** Whether to mark anybody at all. Off by default: a board that starts
   * accusing people the moment it ships is not a board anybody trusts. */
  enabled: boolean;
  /** Building type id (as a string, because that is what a JSON key is) → the
   * level below which that building is behind. A building absent from this
   * map is not judged. */
  perBuilding: Record<string, number>;
  /** The single level this setting used to hold, kept only so a value saved
   * before per-building floors still means what it meant. Null once anybody
   * saves the new shape. */
  legacyLevel: number | null;
}

export const DEFAULT_ALERT: SeasonBuildingAlert = {
  enabled: false,
  perBuilding: {},
  legacyLevel: null,
};

/** Read a stored value that may predate this shape, or be nonsense.
 *
 * A setting is edited by hand often enough that "the row exists" is not the
 * same as "the row is usable". Anything unreadable falls back to the default
 * rather than throwing, because a broken setting should not take the board
 * down with it. */
function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

export function parseAlert(value: unknown): SeasonBuildingAlert {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_ALERT;
  }
  const raw = value as { level?: unknown; enabled?: unknown; perBuilding?: unknown };
  const perBuilding: Record<string, number> = {};
  if (typeof raw.perBuilding === 'object' && raw.perBuilding !== null) {
    for (const [key, level] of Object.entries(raw.perBuilding as Record<string, unknown>)) {
      const floor = whole(level);
      // A key that is not a building id, or a level that is not a level, is
      // dropped rather than defaulted: an unreadable entry must not become a
      // floor nobody set.
      if (floor !== null && Number.isFinite(Number(key))) {
        perBuilding[key] = floor;
      }
    }
  }
  return {
    enabled: raw.enabled === true,
    perBuilding,
    // Only meaningful while nothing per-building has been saved. Once it has,
    // the old single level is not silently mixed in — that would put a floor
    // under buildings the officer deliberately left out.
    legacyLevel: Object.keys(perBuilding).length === 0 ? whole(raw.level) : null,
  };
}

/** The floor for each building on screen: type id → level, missing = no floor.
 *
 * `columns` is the catalogue the board is rendering, so a legacy single level
 * lands on exactly the buildings that used to be judged by it and no others.
 */
export function floorsFor(
  alert: SeasonBuildingAlert | undefined,
  columns: readonly { id: number }[],
): Map<number, number> {
  const floors = new Map<number, number>();
  if (alert === undefined || !alert.enabled) {
    return floors;
  }
  if (alert.legacyLevel !== null) {
    for (const column of columns) {
      floors.set(column.id, alert.legacyLevel);
    }
    return floors;
  }
  for (const [key, level] of Object.entries(alert.perBuilding)) {
    floors.set(Number(key), level);
  }
  return floors;
}

export async function fetchAlert(): Promise<SeasonBuildingAlert> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', ALERT_SETTING_KEY)
    .maybeSingle();
  if (error) {
    // A reader without the grant gets the default rather than an error page:
    // the marker is a convenience, not the point of the screen.
    if (error.code === '42501') {
      return DEFAULT_ALERT;
    }
    throw new Error(`building alert setting query failed: ${error.message}`);
  }
  return parseAlert(data?.value);
}

export function useSeasonBuildingAlert() {
  return useQuery({ queryKey: ['season-building-alert'], queryFn: fetchAlert });
}
