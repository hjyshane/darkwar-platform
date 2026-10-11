// Which group a recommended step belongs to, and which buildings the planner
// never offers at all. No React, no queries.

import type { Step } from './plan';

export type StepCategory = 'building' | 'research' | 'season';

/** Formation I-IV: 200 levels in the client, none a player builds (user,
 * 2026-10-04). */
export const FORMATION_IDS: ReadonlySet<string> = new Set(['427000', '793000', '794000', '795000']);

/** The Smelting Plant opens only after a later industry upgrade, so for now it
 * is not something to recommend (user, 2026-10-11). Matched by the game's name:
 * the id is not recorded anywhere in the repo. */
const SMELTING = /smelting/i;

/** A building the game never upgrades (highest level 0 or 1: Road, Arena,
 * Helipad...), a Formation, or one that is not open yet. A building the
 * catalogue does not know is kept: better a row too many than a silent gap. */
export function isNotUpgradable(
  step: Pick<Step, 'subject_id' | 'name'>,
  maxLevels: ReadonlyMap<string, number>,
): boolean {
  if (FORMATION_IDS.has(step.subject_id)) return true;
  if (step.name !== null && SMELTING.test(step.name)) return true;
  const max = maxLevels.get(step.subject_id);
  return max !== undefined && max <= 1;
}

export function categoryOf(
  step: Pick<Step, 'kind' | 'subject_id'>,
  seasonBuildingIds: ReadonlySet<string>,
): StepCategory {
  if (step.kind === 'research') return 'research';
  return seasonBuildingIds.has(step.subject_id) ? 'season' : 'building';
}
