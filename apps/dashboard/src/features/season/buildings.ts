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
 * EIGHTEEN IDS EXIST AND SEVEN ARE NAMED. The unnamed ones render as their
 * number. That is deliberate: a made-up name is indistinguishable from a
 * real one once it is on screen, and this board is read by 94 people who
 * would have no way to tell. When the rest are clicked and named, they go
 * here — and if this list ever needs editing by somebody who cannot deploy,
 * it should become a catalogue table like `heroes` (0037) rather than grow.
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

/** Column order: named buildings first in id order, then the rest. */
export function buildingLabel(typeId: number): string {
  return BUILDING_NAMES[typeId] ?? `#${typeId}`;
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
  /** Every type id the map has shown, named ones first. */
  columns: number[];
  capturedAt: string | null;
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
      return { members: [], columns: [], capturedAt: null };
    }
    throw new Error(`season building query failed: ${error.message}`);
  }

  const byMember = new Map<string, MemberBuildings>();
  const columns = new Set<number>();
  let newest: string | null = null;

  for (const row of data ?? []) {
    if (row.player_id === null || row.building_type_id === null) {
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

  const named = (id: number) => (id in BUILDING_NAMES ? 0 : 1);
  return {
    members: [...byMember.values()].sort((a, b) => totalLevels(b, ids) - totalLevels(a, ids)),
    columns: ids.sort((a, b) => named(a) - named(b) || a - b),
    capturedAt: newest,
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
