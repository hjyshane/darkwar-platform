// The member × building grid.
//
// `member_season_buildings` (0139) already reduces the snapshot table to the
// newest level per member per building type, so this file's job is only to
// pivot those rows into the shape a table renders: one row per member, one
// column per building type.

import { supabase } from '../../lib/supabase';

/** The building ids named so far, from a capture where the operator said
 * what each click was (`season_buildin2g.pcapng`, 2026-08-22).
 *
 * Two patterns agree with those labels rather than one, which is what makes
 * this a reading and not a guess: the greenhouse ids run consecutively for
 * tiers 1-5, and the number of members holding each falls monotonically with
 * the tier — 79, 67, 51, 38, 21 — with the pass-locked fifth rarest.
 *
 * THIS LIST IS ALSO THE SEASON FILTER, and that is not a coincidence. The
 * map still returns last season's buildings from old observations: ids
 * 743000-856000 were last seen between 12 and 16 August, frozen at level 30,
 * while the seven below first appeared on 17 August and are still moving.
 * Showing both put a member's season 2 warehouse next to their season 3
 * greenhouse with nothing to tell them apart.
 *
 * A name is the evidence that somebody looked at the building and said what
 * it was. An id nobody has named is either last season's or something not
 * yet identified, and neither belongs on a board read by 94 people — so the
 * grid shows named buildings and nothing else.
 *
 * When the rest are named they go here. If this ever needs editing by
 * somebody who cannot deploy, it should become a catalogue table like
 * `heroes` (0037) rather than grow in TypeScript.
 */
export const BUILDING_NAMES: Readonly<Record<number, string>> = {
  857000: '온실 1',
  858000: '온실 2',
  859000: '온실 3',
  860000: '온실 4',
  861000: '온실 5',
  862000: '항온연구소',
  863000: '전략병영',
};

export function buildingLabel(typeId: number): string {
  // Never a bare id: an id on screen tells a reader nothing, and this
  // function only ever runs for ids the grid has already accepted.
  return BUILDING_NAMES[typeId] ?? String(typeId);
}

export function isNamed(typeId: number): boolean {
  return typeId in BUILDING_NAMES;
}

/** `b<typeId>` → the level last seen, or null when never observed.
 *
 * FLAT KEYS, not a Map, because that is what sorting needs: the shared table
 * orders by reading `row[key]`, so "who is furthest behind on the greenhouse"
 * is only one header click away if the greenhouse is a property.
 */
export type BuildingLevels = Record<`b${number}`, number | null>;

export type MemberBuildings = {
  playerId: string;
  name: string | null;
  gameUid: number;
  /** The OLDEST sighting among this member's buildings: a row is only as
   * fresh as its stalest cell, and a pan sees part of a plot. */
  oldestSeen: string | null;
} & BuildingLevels;

export function levelKey(typeId: number): `b${number}` {
  return `b${typeId}`;
}

export interface BuildingGrid {
  members: MemberBuildings[];
  /** The named buildings present in the data, in id order. */
  columns: number[];
  capturedAt: string | null;
  /** Ids the map showed that nothing can name — last season's, or something
   * new. Counted rather than listed on screen: the number is a prompt to go
   * and identify them, the ids themselves would just be noise to a reader. */
  unnamedSeen: number;
}

export async function fetchBuildingGrid(): Promise<BuildingGrid> {
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
      return { members: [], columns: [], capturedAt: null, unnamedSeen: 0 };
    }
    throw new Error(`season building query failed: ${error.message}`);
  }

  const byMember = new Map<string, MemberBuildings>();
  const columns = new Set<number>();
  let newest: string | null = null;

  const unnamed = new Set<number>();
  for (const row of data ?? []) {
    if (row.player_id === null || row.building_type_id === null) {
      continue;
    }
    if (!isNamed(row.building_type_id)) {
      // Last season's buildings still arrive from old observations. See the
      // note on BUILDING_NAMES: the name IS the season filter.
      unnamed.add(row.building_type_id);
      continue;
    }
    columns.add(row.building_type_id);
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

  // Every member carries every column, so a missing building is an explicit
  // null rather than an absent key — the table renders "—" either way, but
  // sorting a column needs the property to exist on every row.
  const ids = [...columns];
  for (const member of byMember.values()) {
    for (const id of ids) {
      if (member[levelKey(id)] === undefined) {
        member[levelKey(id)] = null;
      }
    }
  }

  return {
    members: [...byMember.values()].sort((a, b) => totalLevels(b, ids) - totalLevels(a, ids)),
    columns: ids.sort((a, b) => a - b),
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
