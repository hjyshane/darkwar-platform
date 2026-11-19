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

/** How the list is stacked. The fill order's own options less HQ level,
 * which nobody places a member by. */
export type PaletteSort = Extract<AssignOrder, 'name' | 'power' | 'rank'>;

export const PALETTE_SORTS: readonly { sort: PaletteSort; label: string }[] = [
  { sort: 'name', label: 'A–Z' },
  { sort: 'power', label: 'Power' },
  { sort: 'rank', label: 'Rank' },
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

/** Power as the game prints it — 48.0M, 512k — or nothing when the collector
 * has not read it yet. */
export function shortPower(power: number | null): string {
  if (power === null) {
    return '';
  }
  return power >= 1_000_000 ? `${(power / 1_000_000).toFixed(1)}M` : `${Math.round(power / 1000)}k`;
}
