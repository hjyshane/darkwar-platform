// The alliance page's two judgement calls, stored where the other per-alliance
// choices live (0342).
//
// "Tower 35 or higher" and "since the first capture" were both fixed: 35 was
// written into the view, and the baseline was whichever capture happened to be
// oldest. Which tower level is worth counting moves as the alliance grows, and
// "since when" is a question with a different answer after a merge or a season
// change, so both are the alliance's to set.

import { useQuery } from '@tanstack/react-query';
import { fetchAllianceSetting } from './allianceSetting';

export const TRENDS_SETTING_KEY = 'alliance_trends';

export interface AllianceTrendsSetting {
  /** Members whose tower is at this level or higher are counted. */
  towerLevel: number;
  /** A UTC day, `YYYY-MM-DD`: changes are measured from the first capture on
   * or after it. Null measures from the first capture there is. */
  since: string | null;
}

export const DEFAULT_TRENDS: AllianceTrendsSetting = { towerLevel: 35, since: null };

/** The highest level the form accepts. Generous on purpose: the cap has moved
 * before, and a setting that refuses the new cap is a deploy to fix. */
export const MAX_TOWER_LEVEL = 99;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A stored value that may be absent, empty (`{}`, what a newly pinned
 * alliance starts with) or nonsense: anything unreadable is the default
 * rather than an error, so a broken setting cannot take the page down. */
export function parseTrends(value: unknown): AllianceTrendsSetting {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_TRENDS;
  }
  const raw = value as { towerLevel?: unknown; since?: unknown };
  const level =
    typeof raw.towerLevel === 'number' &&
    Number.isFinite(raw.towerLevel) &&
    raw.towerLevel >= 1 &&
    raw.towerLevel <= MAX_TOWER_LEVEL
      ? Math.floor(raw.towerLevel)
      : DEFAULT_TRENDS.towerLevel;
  const since =
    typeof raw.since === 'string' &&
    DAY.test(raw.since) &&
    !Number.isNaN(Date.parse(`${raw.since}T00:00:00Z`))
      ? raw.since
      : null;
  return { towerLevel: level, since };
}

/** Where a change is measured from: the first row on or after `since`, or the
 * first row when no day is set. Null when every row is older than the day —
 * said as "no capture since", never quietly measured from somewhere else.
 *
 * Rows are oldest first. The day is compared in UTC, the same way the page
 * prints a capture's day. */
export function baselineOf<Row extends { captured_at: string }>(
  rows: readonly Row[],
  since: string | null,
): Row | null {
  if (since === null) {
    return rows[0] ?? null;
  }
  const from = Date.parse(`${since}T00:00:00Z`);
  return rows.find((row) => Date.parse(row.captured_at) >= from) ?? null;
}

/** How many members of one capture have a tower at `level` or higher.
 *
 * `hq_levels` is every known level in the capture (0342). A database that has
 * not had that migration yet carries only the count at 35, so that is what
 * answers for 35 and nothing answers for any other level. */
export function membersAtLevel(
  row: { hq_levels?: number[] | null; members_at_hq35: number },
  level: number,
): number | null {
  if (row.hq_levels !== undefined && row.hq_levels !== null) {
    return row.hq_levels.filter((value) => value >= level).length;
  }
  return level === 35 ? row.members_at_hq35 : null;
}

export async function fetchTrendsSetting(): Promise<AllianceTrendsSetting> {
  return parseTrends(await fetchAllianceSetting(TRENDS_SETTING_KEY));
}

export function useAllianceTrendsSetting() {
  return useQuery({ queryKey: ['alliance-trends-setting'], queryFn: fetchTrendsSetting });
}
