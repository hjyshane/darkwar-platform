// The editor's member list: who stands where in the plan as drawn, and the
// rows the list shows. Pure, so the rule for "placed" is tested rather than
// eyeballed — it was wrong once (see `placedTiles`).

import {
  type AssignOrder,
  type AssignableMember,
  searchMembers,
  sortMembers,
} from '../../lib/hiveFormation';
import type { DraftSlot } from './FormationEditor';
import { rankClass } from './TileGrid';

/** How the list is stacked within each rank. Rank itself is the grouping
 * (`groupRows`), so it is not also an order. */
export type PaletteSort = Extract<AssignOrder, 'name' | 'power'>;

export const PALETTE_SORTS: readonly { sort: PaletteSort; label: string }[] = [
  { sort: 'name', label: 'A–Z' },
  { sort: 'power', label: 'Power' },
];

/** Who stands on which tile of the plan AS IT IS DRAWN NOW, by player id.
 *
 * ONLY TILES STILL IN THE DRAFT. This used to count an assignment whose slot
 * was still in the SAVED board too, so a member dragged onto a saved base
 * stayed placed — greyed in the list, left out of "not placed" — after that
 * base was clicked away, and went on looking placed until the next save. The
 * save drops the tile and takes them off it; the list has to say so now.
 *
 * A dragged base keeps its slot id in the draft, so its member still counts.
 */
export function placedTiles(
  assignments: ReadonlyMap<string, string>,
  drawn: readonly DraftSlot[],
): Map<string, DraftSlot> {
  const bySlot = new Map<string, DraftSlot>();
  for (const slot of drawn) {
    if (slot.slotId !== null) {
      bySlot.set(slot.slotId, slot);
    }
  }
  const placed = new Map<string, DraftSlot>();
  for (const [slotId, playerId] of assignments) {
    const tile = bySlot.get(slotId);
    if (tile !== undefined) {
      placed.set(playerId, tile);
    }
  }
  return placed;
}

export interface PaletteRow {
  member: AssignableMember;
  /** The tile they stand on in the draft; null for nobody's tile yet. */
  tile: DraftSlot | null;
}

/** The list's rows: searched, stacked, and without the placed when asked.
 *
 * Searching and hiding only ever take rows away. The order is the one asked
 * for and nothing else, so a name stays where it was when somebody is placed
 * (unless the placed are hidden, which is the point of hiding them). */
export function paletteRows(
  members: readonly AssignableMember[],
  placed: ReadonlyMap<string, DraftSlot>,
  options: { query: string; sort: PaletteSort; hidePlaced: boolean },
): PaletteRow[] {
  return searchMembers(sortMembers(members, options.sort), options.query)
    .map((member) => ({ member, tile: placed.get(member.playerId) ?? null }))
    .filter((row) => !options.hidePlaced || row.tile === null);
}

/** A run of rows under one heading. */
export interface PaletteGroup {
  /** `r5`..`r1`, `r0` for an unknown rank, or `all` when not grouped. */
  key: string;
  /** The heading; null when not grouped, which has none. */
  label: string | null;
  rows: PaletteRow[];
  /** How many of those rows are on a tile. */
  placed: number;
}

const RANK_GROUPS: readonly { key: string; label: string }[] = [
  { key: 'r5', label: 'R5' },
  { key: 'r4', label: 'R4' },
  { key: 'r3', label: 'R3' },
  { key: 'r2', label: 'R2' },
  { key: 'r1', label: 'R1' },
  { key: 'r0', label: 'Rank unknown' },
];

/** The rows under a heading per alliance rank, R5 first and the unknown last,
 * or under no heading at all.
 *
 * GROUPS, NOT AN ORDER. Officers place the R5s and R4s first and the rest
 * after, so the list says who is in which rank in so many words; within a
 * rank the rows keep whatever order they came in (A–Z or power). A rank
 * nobody in the rows holds has no heading — an empty "R2" is noise. */
export function groupRows(rows: readonly PaletteRow[], byRank: boolean): PaletteGroup[] {
  const placedIn = (some: readonly PaletteRow[]) => some.filter((row) => row.tile !== null).length;
  if (!byRank) {
    return rows.length === 0
      ? []
      : [{ key: 'all', label: null, rows: [...rows], placed: placedIn(rows) }];
  }
  return RANK_GROUPS.flatMap(({ key, label }) => {
    const inRank = rows.filter((row) => rankClass(row.member.memberRank) === key);
    return inRank.length === 0 ? [] : [{ key, label, rows: inRank, placed: placedIn(inRank) }];
  });
}

/** Power as the game prints it — 48.0M, 512k — or nothing when the collector
 * has not read it yet. */
export function shortPower(power: number | null): string {
  if (power === null) {
    return '';
  }
  return power >= 1_000_000 ? `${(power / 1_000_000).toFixed(1)}M` : `${Math.round(power / 1000)}k`;
}
