// "Who is behind?" — one number and one switch, stored where every other
// admin choice lives.
//
// The alliance's actual question about the building board is not "what level
// is everyone" but "who is under X". That threshold is a judgement the
// officers make and change as the season moves, so it belongs in
// `app_settings` beside the overview tiles and the notification routing —
// not in a constant somebody has to deploy to edit.
//
// DELIBERATELY NOT PER-BUILDING. One level across every building is the rule
// the alliance already states out loud ("everyone to 20"), and a per-building
// matrix would be a second thing to keep correct for a question nobody has
// asked yet. When somebody does ask, the stored shape is a jsonb object and
// can grow a `perBuilding` key without a migration.

import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

export const ALERT_SETTING_KEY = 'season_building_alert';

export interface SeasonBuildingAlert {
  /** Members holding any building below this get marked. */
  level: number;
  /** Whether to mark them at all. Off by default: a board that starts
   * accusing people the moment it ships is not a board anybody trusts. */
  enabled: boolean;
}

export const DEFAULT_ALERT: SeasonBuildingAlert = { level: 10, enabled: false };

/** Read a stored value that may predate this shape, or be nonsense.
 *
 * A setting is edited by hand often enough that "the row exists" is not the
 * same as "the row is usable". Anything unreadable falls back to the default
 * rather than throwing, because a broken setting should not take the board
 * down with it. */
export function parseAlert(value: unknown): SeasonBuildingAlert {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_ALERT;
  }
  const raw = value as { level?: unknown; enabled?: unknown };
  const level =
    typeof raw.level === 'number' && Number.isFinite(raw.level) && raw.level > 0
      ? Math.floor(raw.level)
      : DEFAULT_ALERT.level;
  return { level, enabled: raw.enabled === true };
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
