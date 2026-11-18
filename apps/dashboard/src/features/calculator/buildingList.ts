// Which buildings the calculator offers, and which season a season building
// belongs to when the catalogue does not say (owner, 2026-11-18).
//
// WHY A LIST IN CODE. The catalogue (`game_upgrade_subjects`, kind building)
// has 207 rows, and most are not something anybody upgrades on purpose:
// furniture inside the shelter (Bed, Sink, Lamp …), one-level map objects
// (Road, Truck, Portal Point), and buildings the owner called irrelevant.
// `category` is null on every row and `max_level` does not separate them (Bank
// and the Consoles run to 200), so there is no column to filter on. The owner
// named them; they are listed here by id.
//
// WHY A SEASON FALLBACK. The importer fills `game_season` from the client's
// `building_season`, but in production every row read null on 2026-11-18
// (the re-run after the 0311 importer fix had not happened, see
// docs/runbooks/game-data.md). Without it every season building landed in the
// ordinary list. The ids below put them back into season groups; once the
// catalogue is re-imported its own `game_season` wins.

import type { Subject } from '../planner/data';

/** Furniture inside the shelter: 500000–554000, all of it. */
const FURNITURE = { from: 500000, to: 554999 };

/** Buildings the owner asked to leave out (2026-11-18), by id. */
export const HIDDEN_BUILDINGS: ReadonlySet<string> = new Set([
  '401000', // Arena
  '409000', // Bank
  '411000', // Medical Workshop
  '427000',
  '793000',
  '794000',
  '795000', // Formation I–IV
  '444000', // State Chronicles
  '477000',
  '478000',
  '479000',
  '480000',
  '481000',
  '482000',
  '483000', // Console I–VII
  '706000', // Material Factory
  '710000', // Trade Center
  '725000', // Laboratory
  '726000', // Space Police Station
  '728000',
  '801000',
  '802000',
  '803000',
  '804000',
  '805000',
  '806000',
  '807000',
  '808000', // Dorm
  '729000', // Grocery Store
  '730000', // Load Module
  '731000',
  '734000', // Supply Station
  '732000', // Bounty Center
  '733000', // Hero Council
  '738000', // Library
  '787000', // DeerHunter Bar
  '791000', // Portal Gate
  '811000',
  '812000',
  '813000',
  '814000', // Smelting Plant
  '1008000', // Gathering Hall
]);

/** Names hidden wherever they turn up (rows past the ones the owner listed). */
const HIDDEN_NAMES = new Set(['defunct portal gate']);

/** Whether the calculator offers this building at all. */
export function isOffered(subject: Pick<Subject, 'subject' | 'name' | 'maxLevel'>): boolean {
  const id = Number(subject.subject);
  if (HIDDEN_BUILDINGS.has(subject.subject)) return false;
  if (id >= FURNITURE.from && id <= FURNITURE.to) return false;
  // One level is nothing to calculate: roads, trucks, portal points, plazas.
  if (subject.maxLevel <= 1) return false;
  // The client has no name for it (449000, 727000).
  if (subject.name.startsWith('#')) return false;
  return !HIDDEN_NAMES.has(subject.name.toLowerCase());
}

/** Season groups the fallback can name. Keys at 100+ are ours, not the game's
 * theme numbers, so they can never collide with a real `game_season`. */
export const FALLBACK_SEASON_LABELS: Readonly<Record<number, string>> = {
  101: 'Season 1 (unconfirmed)',
  102: 'Altar set, second (season unconfirmed)',
  105: 'Season 5+ (not played yet)',
};

/** A season building's group when the catalogue has no `game_season`.
 * 3 / 4 / 6 are the game's theme numbers (docs/runbooks/game-data.md, seasons.ts):
 * 3 = our Season 2 (the ids the sweeps saw in Season 2), 4 = Season 3,
 * 6 = Season 4 (Mineral Factory … Guardian Gem). */
export function fallbackSeason(subjectId: string): number | null {
  const id = Number(subjectId);
  if (id === 705000 || id === 709000) return 101; // Crystal Factory II, I
  if ([743000, 744000, 745000, 750000, 751000, 752000].includes(id)) return 3;
  if (id >= 851000 && id <= 856000) return 3; // Altar I–V, Obelisk
  if (id >= 760000 && id <= 769000) return 102; // the other Altar / Obelisk / Statue set
  if (id >= 857000 && id <= 867000) return 4; // Smart Greenhouse … Defensive Base
  if (id >= 868000 && id <= 878000) return 6; // Mineral Factory … Guardian Gem
  if (id >= 1000000) return 105; // Holy Altar, Guardian Sanctuary …
  return null;
}

/** The building list as the calculator shows it: hidden ones out, a season
 * filled in where the catalogue left it empty, and an ordinary building that
 * appears twice under one name (Mart) offered once. */
export function buildingsForCalculator(rows: ReadonlyArray<Subject>): Subject[] {
  const seen = new Set<string>();
  const out: Subject[] = [];
  for (const row of [...rows].sort((a, b) => Number(a.subject) - Number(b.subject))) {
    if (!isOffered(row)) continue;
    const gameSeason = row.gameSeason ?? fallbackSeason(row.subject);
    if (gameSeason === null) {
      const key = row.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push({ ...row, gameSeason });
  }
  return out;
}
