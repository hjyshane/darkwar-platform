// Season buildings for the calculator's "Season building" entry (0311).
//
// The client's `building` table is imported whole, so a season's buildings are
// ordinary `kind='building'` steps with costs and time. What groups them is the
// client's own `building_season` column, written to `game_upgrade_steps.
// game_season` and exposed per subject by `game_upgrade_subjects`. That number
// is the GAME's season theme id, not our `seasons.season_id`: theme 4 (Smart
// Greenhouse … Defensive Base) was our Season 3, theme 3 (Altar, Obelisk,
// Statues) our Season 2. The two are mapped here where both are known; a theme
// we have not played is labelled by its number rather than guessed.
//
// The map is also the calculator's allow-list: only the themes in it are
// offered (owner, 2026-11-19 — "Seasons 2, 3 and 4 are the ones we used"). The
// catalogue holds 2, 8 and 10 as well; theme 2 is a second Altar / Obelisk /
// Statue set (760000–769000) no server here has built. When a new season
// starts, add its theme here or its buildings stay out of the picker.
//
// The hand-curated `season_buildings` table is NOT used here: it lists only
// types somebody has seen and is not community-readable.

import type { Subject } from '../planner/data';

/** The game's season theme → our seasons.season_id, where both are known
 * (read off the client's building table against seasons.ts, 2026-11-08). */
export const OUR_SEASON_BY_GAME_SEASON: Readonly<Record<number, number>> = {
  3: 2,
  4: 3,
  // Mineral Factory … Guardian Gem, the set Season 4 builds (2026-11-18).
  6: 4,
};

/** Whether a game theme is one of our seasons, i.e. one the calculator offers. */
export function isOurSeason(gameSeason: number): boolean {
  return OUR_SEASON_BY_GAME_SEASON[gameSeason] !== undefined;
}

export interface SeasonGroup {
  gameSeason: number;
  label: string;
  subjects: Subject[];
}

/** "Season 3" for a theme we have played, "Game season 8" for one we have not. */
export function seasonLabel(gameSeason: number): string {
  const ours = OUR_SEASON_BY_GAME_SEASON[gameSeason];
  return ours === undefined ? `Game season ${gameSeason}` : `Season ${ours}`;
}

/** Whether a subject is a season building: the client gave it a season. */
export function isSeasonBuilding(subject: Pick<Subject, 'gameSeason'>): boolean {
  return subject.gameSeason !== null;
}

/** Season buildings grouped by the game's season, themes in numeric order
 * and buildings in id order (the client numbers a season's buildings in the
 * order the game lists them). Subjects with no season are left out. */
export function groupBySeason(subjects: ReadonlyArray<Subject>): SeasonGroup[] {
  const groups = new Map<number, Subject[]>();
  for (const subject of subjects) {
    if (subject.gameSeason === null) continue;
    const held = groups.get(subject.gameSeason) ?? [];
    groups.set(subject.gameSeason, [...held, subject]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([gameSeason, members]) => ({
      gameSeason,
      label: seasonLabel(gameSeason),
      subjects: [...members].sort((a, b) => Number(a.subject) - Number(b.subject)),
    }));
}
