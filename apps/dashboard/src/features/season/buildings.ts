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
 * ARMED TURRET AND DEFENSE BASE ARRIVED, which is what this comment used to
 * say would happen the day somebody built one. The sweeps turned up four ids
 * nothing had claimed — 864000-867000, continuing the season 3 run — across
 * 1,717 rows, newest 29 August.
 *
 * THE PAIRING IS MEASURED: 864000 and 865000 reach level 8 while 866000 and
 * 867000 stop at 5 and 4. Two pairs, and the split is in the levels rather
 * than in the numbering.
 *
 * WHICH PAIR IS WHICH IS NOT MEASURED. It is the attack-before-defense rule
 * of thumb season 2 records below, and it is a rule of thumb: nobody has
 * opened one, so `world.get.detail.new` has never returned a name for these
 * ids and the mapping rests on the lower pair being the attacking one.
 *
 * That is why all four are provisional and the seven above are not — those
 * were checked against a member reading their own screen, and these have not
 * been. One person opening an Armed Turret settles it.
 */
export const SEASON3_BUILDINGS: readonly BuildingKind[] = [
  { id: 862000, name: 'Thermal Lab' },
  { id: 857000, name: 'Smart Green House 1' },
  { id: 858000, name: 'Smart Green House 2' },
  { id: 859000, name: 'Smart Green House 3' },
  { id: 860000, name: 'Smart Green House 4' },
  { id: 861000, name: 'Smart Green House 5' },
  { id: 863000, name: 'Strategic Barrack' },
  { id: 864000, name: 'Armed Turret 1', provisional: true },
  { id: 865000, name: 'Armed Turret 2', provisional: true },
  { id: 866000, name: 'Defense Base 1', provisional: true },
  { id: 867000, name: 'Defense Base 2', provisional: true },
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
 * ATTACK BEFORE DEFENSE, on the alliance's own reading of the game: the
 * attack buff building is usually released before the defence one, so the
 * lower pair of ids is the attack pair. 744000/745000 are Attack and
 * 751000/752000 are Defense. That is a rule of thumb rather than a
 * measurement — the data has nothing to separate two pairs of the same size
 * — but it beats the coin-flip it replaced, and it should generalise to
 * whatever the next season ships.
 *
 * None of this matters much. Season 2 is kept for the record, not to act on.
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
  /** How many members the roster holds, or null when it could not be read.
   *
   * SO THE SCREEN CAN SAY WHAT IT IS NOT SHOWING. This board displayed 67 of
   * 84 members and looked complete; a reader had to count the alliance by
   * hand to notice. A member with no building observed is a normal state —
   * the collector has not panned over their plot — but it is not the same
   * fact as "they have nothing built", and only the total makes the
   * difference visible. */
  rosterTotal: number | null;
}

const EMPTY: BuildingGrid = {
  members: [],
  columns: [],
  capturedAt: null,
  unnamedSeen: 0,
  rosterTotal: null,
};

/** How many members the roster holds, without fetching them.
 *
 * head + count, so the answer is a header rather than rows — immune to the
 * 1,000-row cap that hid members from this board in the first place, and
 * free enough to ask on every load.
 */
async function fetchRosterTotal(): Promise<number | null> {
  const { count, error } = await supabase
    .from('member_roster')
    .select('player_id', { count: 'exact', head: true });
  // Null rather than zero on failure: "we could not read the roster" must not
  // render as "the alliance is empty", which would make the board look
  // complete for the wrong reason.
  return error ? null : (count ?? null);
}

export async function fetchBuildingGrid(catalogue: SeasonCatalogue): Promise<BuildingGrid> {
  const rosterTotal = await fetchRosterTotal();
  const { data, error } = await supabase
    // ONE ROW PER MEMBER (0147), not one per building.
    //
    // PostgREST caps a response at 1,000 rows and ignores a larger limit. The
    // per-building view returns about eighteen rows each, so 84 members were
    // 1,198 rows, the last 198 were cut, and the members inside them
    // disappeared from the board without a word — it showed 67 of 84 and
    // looked complete. Folding the buildings server-side makes the row count
    // the member count, so the cap is nowhere near and a generous-looking
    // limit cannot quietly reintroduce it.
    .from('member_season_buildings_by_member')
    .select('player_id, current_name, game_uid, levels, oldest_seen, newest_seen')
    .limit(500);
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
    if (row.player_id === null) {
      continue;
    }
    // `levels` is a jsonb object of building_type_id -> level, so its keys
    // are strings. Parsed back to numbers because the catalogue is keyed on
    // the id the game uses.
    const levels = (row.levels ?? {}) as Record<string, number | null>;
    const member = {
      playerId: row.player_id,
      name: row.current_name,
      gameUid: Number(row.game_uid ?? 0),
      oldestSeen: row.oldest_seen,
    } as MemberBuildings;

    let anyKnown = false;
    for (const [key, level] of Object.entries(levels)) {
      const typeId = Number(key);
      if (!Number.isFinite(typeId)) {
        continue;
      }
      if (!known.has(typeId)) {
        // Another season's building, or one nobody has identified. The
        // catalogue IS the season filter — see the note on SEASON2_BUILDINGS.
        unnamed.add(typeId);
        continue;
      }
      present.add(typeId);
      member[levelKey(typeId)] = level;
      anyKnown = true;
    }
    // A member whose only buildings belong to another season does not belong
    // on this season's board.
    if (!anyKnown) {
      continue;
    }
    if (row.newest_seen !== null && (newest === null || row.newest_seen > newest)) {
      newest = row.newest_seen;
    }
    byMember.set(row.player_id, member);
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
    rosterTotal,
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

/** How many roster members the board cannot show, or null when unknown.
 *
 * Split out of the component so the arithmetic is testable and so the
 * "unknown" case cannot be confused with zero: a roster we failed to read
 * must not render as a complete board, which is the failure this whole line
 * of work started from.
 */
export function membersMissing(grid: BuildingGrid): number | null {
  if (grid.rosterTotal === null) {
    return null;
  }
  return Math.max(0, grid.rosterTotal - grid.members.length);
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
  floors: ReadonlyMap<number, number>,
): boolean {
  return buildingsBehind(member, columns, floors).length > 0;
}

/** Which of this member's buildings are under their own floor.
 *
 * Per building rather than one level for all of them (0158): the lab and the
 * barrack are not levelled on the same schedule as the greenhouses, so a
 * single floor either marks everybody for the building nobody has started or
 * sits low enough to mark nobody. A building with no floor set is not judged.
 */
export function buildingsBehind(
  member: MemberBuildings,
  columns: readonly BuildingKind[],
  floors: ReadonlyMap<number, number>,
): BuildingKind[] {
  return columns.filter((kind) => {
    const floor = floors.get(kind.id);
    if (floor === undefined) {
      return false;
    }
    const seen = member[levelKey(kind.id)];
    return seen !== null && seen !== undefined && seen < floor;
  });
}
