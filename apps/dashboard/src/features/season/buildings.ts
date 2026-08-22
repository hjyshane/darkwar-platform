// The member × building grid, and the catalogue that decides what it shows.
//
// `member_season_buildings` (0139) already reduces the snapshot table to the
// newest level per member per building type, so this file pivots those rows
// into the shape a table renders: one row per member, one column per
// building.

import { supabase } from '../../lib/supabase';

export interface BuildingKind {
  id: number;
  /** What the game calls it. Never an id — a number on screen tells a reader
   * nothing they can act on. */
  name: string;
  /** True while the name is a placeholder somebody has yet to correct. */
  provisional?: boolean;
}

/** Season 3, in the order the alliance reads them.
 *
 * ORDER IS EDITORIAL, NOT NUMERIC. The ids run 857000-863000 with the
 * greenhouses first, but the alliance thinks lab, then greenhouses, then what
 * defends them — so that is the order across the top.
 *
 * Confirmed against a member reading their own screen (WonderingDuck):
 * greenhouses 1-4 at level 19, greenhouse 5 at 18, thermal lab 19, strategic
 * barrack 1. All seven ids matched exactly, which is what turned the mapping
 * from a reading into a fact.
 *
 * ARMED TURRET AND DEFENSE BASE HAVE NO ID YET. Nobody in the alliance has
 * built either, so neither has ever appeared on the map and neither can be
 * identified from it. They are named in this comment rather than left out of
 * the story, and they will get a row the day somebody builds one.
 */
export const SEASON3_BUILDINGS: readonly BuildingKind[] = [
  { id: 862000, name: 'Thermal Lab' },
  { id: 857000, name: 'Smart Green House 1' },
  { id: 858000, name: 'Smart Green House 2' },
  { id: 859000, name: 'Smart Green House 3' },
  { id: 860000, name: 'Smart Green House 4' },
  { id: 861000, name: 'Smart Green House 5' },
  { id: 863000, name: 'Strategic Barrack' },
];

/** Season 2, behind the admin-only tab.
 *
 * The counts and two of the placements are the alliance's: one Obelisk, five
 * Altars, one Barrack, two Attack, two Defense — eleven, exactly how many ids
 * there are — with Obelisk at 743000 and the Altars in the 85x run.
 *
 * WHICH FIVE OF THE SIX 85x IDS ARE ALTARS is the part the data answered.
 * 855000 is held by 24 owners while the rest of that run have 153-210, and
 * that is the same signature season 3's top greenhouse tier has: 861000 sits
 * at 23 owners against 89, 74, 55 and 39 for tiers 1-4, because it needs the
 * pass. A tier that rare is the last one, so the Altars run 851000-855000 and
 * 856000 is the odd one out.
 *
 * 856000 IS READ AS THE BARRACK by the same shape season 3 has. There the
 * multi-tier building occupied a run (857000-861000) and the single buildings
 * sat immediately after it (862000, 863000). 856000 is the single id adjacent
 * to the Altar run, and it also carries the highest mean level of the six.
 *
 * STILL A GUESS: which of the two remaining pairs is Attack and which is
 * Defense. 744000/745000 and 751000/752000 are two pairs with nothing to tell
 * them apart, so they are laid down in the order the alliance listed the
 * names. That is the placement most likely to be wrong.
 *
 * These were last seen between 12 and 16 August, frozen at level 30, while
 * season 3 began around the 17th — which is why they are on their own tab
 * rather than mixed into the board the alliance reads.
 */
export const SEASON2_BUILDINGS: readonly BuildingKind[] = [
  { id: 743000, name: 'Obelisk', provisional: true },
  { id: 851000, name: 'Altar 1', provisional: true },
  { id: 852000, name: 'Altar 2', provisional: true },
  { id: 853000, name: 'Altar 3', provisional: true },
  { id: 854000, name: 'Altar 4', provisional: true },
  { id: 855000, name: 'Altar 5', provisional: true },
  { id: 856000, name: 'Barrack', provisional: true },
  { id: 744000, name: 'Attack 1', provisional: true },
  { id: 745000, name: 'Attack 2', provisional: true },
  { id: 751000, name: 'Defense 1', provisional: true },
  { id: 752000, name: 'Defense 2', provisional: true },
];

export type SeasonCatalogue = readonly BuildingKind[];

/** `b<typeId>` → the level last seen, or null when never observed.
 *
 * FLAT KEYS, not a Map, because that is what sorting needs: the shared table
 * orders by reading `row[key]`, so "who is furthest behind on the thermal
 * lab" is one header click away only if the lab is a property.
 */
export type BuildingLevels = Record<`b${number}`, number | null>;

export type MemberBuildings = {
  playerId: string;
  name: string | null;
  gameUid: number;
  /** The OLDEST sighting among this member's buildings: a row is only as
   * fresh as its stalest cell, and one pan sees part of a plot. */
  oldestSeen: string | null;
} & BuildingLevels;

export function levelKey(typeId: number): `b${number}` {
  return `b${typeId}`;
}

export interface BuildingGrid {
  members: MemberBuildings[];
  /** Catalogue entries present in the data, in CATALOGUE order. */
  columns: BuildingKind[];
  capturedAt: string | null;
  /** Ids the map showed that this catalogue does not name. Counted rather
   * than listed: the number is a prompt to go and identify them, the ids
   * themselves would be noise to a reader. */
  unnamedSeen: number;
}

const EMPTY: BuildingGrid = { members: [], columns: [], capturedAt: null, unnamedSeen: 0 };

export async function fetchBuildingGrid(catalogue: SeasonCatalogue): Promise<BuildingGrid> {
  const { data, error } = await supabase
    .from('member_season_buildings')
    .select('player_id, current_name, game_uid, building_type_id, level, captured_at')
    // A hundred members times eighteen types is the ceiling, and the view is
    // already reduced to one row per pair.
    .limit(3000);
  if (error) {
    // A viewer gets nothing from the view's own gate rather than an error
    // page — the same shape the roster uses.
    if (error.code === '42501') {
      return EMPTY;
    }
    throw new Error(`season building query failed: ${error.message}`);
  }

  const known = new Set(catalogue.map((kind) => kind.id));
  const byMember = new Map<string, MemberBuildings>();
  const present = new Set<number>();
  const unnamed = new Set<number>();
  let newest: string | null = null;

  for (const row of data ?? []) {
    if (row.player_id === null || row.building_type_id === null) {
      continue;
    }
    if (!known.has(row.building_type_id)) {
      // Another season's building, or one nobody has identified. The
      // catalogue IS the season filter — see the note on SEASON2_BUILDINGS.
      unnamed.add(row.building_type_id);
      continue;
    }
    present.add(row.building_type_id);
    if (row.captured_at !== null && (newest === null || row.captured_at > newest)) {
      newest = row.captured_at;
    }
    let member = byMember.get(row.player_id);
    if (member === undefined) {
      member = {
        playerId: row.player_id,
        name: row.current_name,
        gameUid: Number(row.game_uid ?? 0),
        oldestSeen: null,
      } as MemberBuildings;
      byMember.set(row.player_id, member);
    }
    member[levelKey(row.building_type_id)] = row.level;
    if (
      row.captured_at !== null &&
      (member.oldestSeen === null || row.captured_at < member.oldestSeen)
    ) {
      member.oldestSeen = row.captured_at;
    }
  }

  const columns = catalogue.filter((kind) => present.has(kind.id));
  const ids = columns.map((kind) => kind.id);
  // Every member carries every column, so a building never seen is an
  // explicit null rather than an absent key — the table renders "—" either
  // way, but sorting a column needs the property on every row.
  for (const member of byMember.values()) {
    for (const id of ids) {
      if (member[levelKey(id)] === undefined) {
        member[levelKey(id)] = null;
      }
    }
  }

  return {
    members: [...byMember.values()].sort((a, b) => totalLevels(b, ids) - totalLevels(a, ids)),
    columns,
    capturedAt: newest,
    unnamedSeen: unnamed.size,
  };
}

/** Sum of a member's levels, used ONLY to order the table so the furthest
 * along sit at the top. It is not shown and is not a score: adding levels
 * across different buildings would invent a metric the game does not have. */
export function totalLevels(member: MemberBuildings, ids: readonly number[]): number {
  let total = 0;
  for (const id of ids) {
    total += member[levelKey(id)] ?? 0;
  }
  return total;
}

/** Whether a member has any building below the alert level.
 *
 * A BUILDING NOBODY HAS SEEN IS NOT BEHIND. An absent level means the
 * collector has never panned over it, and flagging that would accuse
 * somebody of falling behind on the strength of a gap in our own coverage —
 * the same reason the cell renders a dash rather than a zero.
 */
export function isBehind(
  member: MemberBuildings,
  columns: readonly BuildingKind[],
  level: number,
): boolean {
  return columns.some((kind) => {
    const seen = member[levelKey(kind.id)];
    return seen !== null && seen !== undefined && seen < level;
  });
}
