// The geometry of standing eighty bases in a row.
//
// A BASE IS THREE TILES BY THREE, AND ITS COORDINATE IS THE MIDDLE ONE. The
// map is addressed one tile at a time — `world.get.new` returns tiles, the
// game's teleport box takes a tile — so nothing in the coordinate itself says
// that it stands for nine of them. That gap is the whole reason a hive comes
// out crooked: 500,500 and 501,500 read as two neighbouring squares and are
// the same piece of ground, and the second member to teleport is the one who
// finds out.
//
// Every rule below follows from that one fact, and this file is the only
// place it is written down on the client. The database holds the same rule as
// an exclusion constraint (0165), so a layout that gets past here is refused
// there too — that is belt and braces on purpose, because the cost of being
// wrong is paid in teleport items by people who did what they were told.

import { MAP_MAX, MAP_MIN } from './mapProjection';
import type { Coordinate } from './mapProjection';

/** Tiles a base occupies on each side. */
export const BASE_SPAN = 3;

/** Tiles from the centre to the edge of the footprint: (BASE_SPAN - 1) / 2.
 *
 * Derived rather than typed, so a game that ever ships a 5x5 base needs one
 * edit here and not a hunt for every literal 1. */
export const BASE_RADIUS = (BASE_SPAN - 1) / 2;

/** The innermost and outermost centre a base can have.
 *
 * NOT the map's own bounds. A base centred on 0 needs a column at -1, which
 * does not exist — the game refuses the teleport and the plan has a hole in
 * it. The usable centres are one footprint-radius inside each edge.
 */
export const CENTRE_MIN = MAP_MIN + BASE_RADIUS;
export const CENTRE_MAX = MAP_MAX - BASE_RADIUS;

/** An offset from a formation's anchor, in tiles. What is stored. */
export interface Offset {
  dx: number;
  dy: number;
}

export interface FootprintBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** The nine tiles a base at this centre covers, as an inclusive box. */
export function footprintOf(at: Coordinate): FootprintBox {
  return {
    x0: at.x - BASE_RADIUS,
    x1: at.x + BASE_RADIUS,
    y0: at.y - BASE_RADIUS,
    y1: at.y + BASE_RADIUS,
  };
}

/** Whether two bases would share ground.
 *
 * TRUE WHEN THEY ARE CLOSER THAN A FULL SPAN ON BOTH AXES, and the "both" is
 * the part worth reading twice. Two centres two tiles apart on x alone do not
 * overlap if their y differs by three or more — that is a legal, tightly
 * packed neighbour and exactly the shape a hive wants. Refusing it would
 * scatter the formation for no reason.
 */
export function basesOverlap(a: Coordinate, b: Coordinate): boolean {
  return Math.abs(a.x - b.x) < BASE_SPAN && Math.abs(a.y - b.y) < BASE_SPAN;
}

/** Whether a base centred here has room for all nine of its tiles. */
export function centreFitsOnMap(at: Coordinate): boolean {
  return (
    Number.isInteger(at.x) &&
    Number.isInteger(at.y) &&
    at.x >= CENTRE_MIN &&
    at.x <= CENTRE_MAX &&
    at.y >= CENTRE_MIN &&
    at.y <= CENTRE_MAX
  );
}

/** Whether a particular tile is under a particular base. */
export function coversTile(centre: Coordinate, tile: Coordinate): boolean {
  return Math.abs(centre.x - tile.x) <= BASE_RADIUS && Math.abs(centre.y - tile.y) <= BASE_RADIUS;
}

/** An offset turned into the coordinate a member is actually told. */
export function absoluteOf(anchor: Coordinate, offset: Offset): Coordinate {
  return { x: anchor.x + offset.dx, y: anchor.y + offset.dy };
}

/** The key an offset is held under while a layout is being drawn.
 *
 * A slot has no id until it has been saved, and the editor has to be able to
 * add and remove one before then — so the position is the identity, which it
 * is anyway: two slots cannot share a centre. */
export function offsetKey(offset: Offset): string {
  return `${offset.dx},${offset.dy}`;
}

/** The first pair of offsets in a layout that share ground, or null.
 *
 * Returns the PAIR rather than a boolean because the editor has to point at
 * something: "this layout is invalid" sends an officer hunting through eighty
 * tiles for the two that clash.
 */
export function firstOverlap(offsets: readonly Offset[]): [Offset, Offset] | null {
  for (let i = 0; i < offsets.length; i += 1) {
    for (let j = i + 1; j < offsets.length; j += 1) {
      const a = offsets[i];
      const b = offsets[j];
      // `noUncheckedIndexedAccess` is on, and the guard is honest rather
      // than ceremonial: a sparse array would otherwise compare undefined
      // against a coordinate and quietly report no overlap.
      if (a === undefined || b === undefined) {
        continue;
      }
      if (basesOverlap({ x: a.dx, y: a.dy }, { x: b.dx, y: b.dy })) {
        return [a, b];
      }
    }
  }
  return null;
}

/** Whether one more base fits into a layout without touching any of it. */
export function canPlace(offsets: readonly Offset[], candidate: Offset): boolean {
  const at = { x: candidate.dx, y: candidate.dy };
  return !offsets.some((other) => basesOverlap({ x: other.dx, y: other.dy }, at));
}

/** A rectangular block of bases, packed as tightly as 3x3 footprints allow.
 *
 * THE PITCH IS BASE_SPAN, NOT ONE. A block drawn on the map's own grid would
 * put every base on top of its neighbour; the lattice a hive actually sits on
 * has a centre every three tiles, which is what makes the rows line up when
 * eighty people teleport onto it.
 *
 * Centred on the anchor, so the anchor is the middle of the hive rather than
 * a corner of it — the anchor is normally the flag, and a formation that grew
 * to the south-east of its flag would need moving every time it was resized.
 * With an even count there is no middle base, and the block sits half a pitch
 * off; that is preferred to silently refusing even numbers.
 */
export function blockOffsets(columns: number, rows: number): Offset[] {
  const offsets: Offset[] = [];
  const halfX = (columns - 1) / 2;
  const halfY = (rows - 1) / 2;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      offsets.push({
        dx: Math.round((column - halfX) * BASE_SPAN),
        // Rows count DOWNWARD on screen and y counts upward on the map, so
        // the first row is the northern one — which is what somebody
        // numbering slots off a picture expects. Written as `halfY - row`
        // rather than negating `row - halfY`: the negation of a middle row
        // is -0, which is === 0 everywhere but is a different value to a
        // deep equality check, and that difference would only ever surface
        // in a test written months later.
        dy: Math.round((halfY - row) * BASE_SPAN),
      });
    }
  }
  return offsets;
}

/** The same block with the middle taken out — a hollow rectangle.
 *
 * What a defensive formation looks like: the perimeter is bases, the inside
 * is left clear for the alliance buildings and for a rally to land in.
 */
export function ringOffsets(columns: number, rows: number): Offset[] {
  if (columns < 3 || rows < 3) {
    return blockOffsets(columns, rows);
  }
  const offsets: Offset[] = [];
  const halfX = (columns - 1) / 2;
  const halfY = (rows - 1) / 2;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const edge = row === 0 || row === rows - 1 || column === 0 || column === columns - 1;
      if (!edge) {
        continue;
      }
      offsets.push({
        dx: Math.round((column - halfX) * BASE_SPAN),
        dy: Math.round((halfY - row) * BASE_SPAN),
      });
    }
  }
  return offsets;
}

/** Reading order for the tiles of a formation: north first, then west.
 *
 * The order auto-assignment fills them in when the planner has not numbered
 * them, and the order the printed list comes out in. It matches how somebody
 * reads the shape off the screen, which is the only thing that makes a
 * printed list checkable against the map.
 */
export function readingOrder(a: Offset, b: Offset): number {
  return b.dy - a.dy || a.dx - b.dx;
}

export interface AssignableSlot {
  slotId: string;
  ordinal: number;
  dx: number;
  dy: number;
}

export interface AssignableMember {
  playerId: string;
  name: string | null;
  power: number | null;
  hqLevel: number | null;
  /** R1..R5 as the game numbers it. Higher is more senior. */
  memberRank: number | null;
}

/** How the strongest member is decided when filling a formation. */
export type AssignOrder = 'power' | 'hq' | 'rank' | 'name';

const ORDER_LABELS: Record<AssignOrder, string> = {
  power: 'Power, strongest first',
  hq: 'HQ level, highest first',
  rank: 'Alliance rank, R5 first',
  name: 'Name, A to Z',
};

export function assignOrderLabel(order: AssignOrder): string {
  return ORDER_LABELS[order];
}

/** Members in the order they should be handed the slots.
 *
 * NULL SORTS LAST IN EVERY NUMERIC ORDER, and that is not a tidiness
 * preference. A missing power is a member the collector has not read yet, not
 * a member with no power — putting them at the top would give the front line
 * to whoever we know least about. Name is the tiebreak throughout so the same
 * roster always produces the same plan; an order that reshuffles equal
 * members on every click cannot be checked by eye against the last one.
 */
export function sortMembers(
  members: readonly AssignableMember[],
  order: AssignOrder,
): AssignableMember[] {
  const byName = (a: AssignableMember, b: AssignableMember) =>
    (a.name ?? '').localeCompare(b.name ?? '');
  const descending = (a: number | null, b: number | null) => {
    if (a === b) {
      return 0;
    }
    if (a === null) {
      return 1;
    }
    if (b === null) {
      return -1;
    }
    return b - a;
  };
  return [...members].sort((a, b) => {
    switch (order) {
      case 'power':
        return descending(a.power, b.power) || byName(a, b);
      case 'hq':
        return descending(a.hqLevel, b.hqLevel) || byName(a, b);
      case 'rank':
        return descending(a.memberRank, b.memberRank) || byName(a, b);
      default:
        return byName(a, b);
    }
  });
}

/** Slots in the order they get filled: the planner's numbering, then reading
 * order for everything they left at zero. */
export function sortSlots<T extends AssignableSlot>(slots: readonly T[]): T[] {
  return [...slots].sort((a, b) => a.ordinal - b.ordinal || readingOrder(a, b));
}

export interface AutoAssignResult {
  /** slot id -> player id. Slots left empty are absent rather than mapped to
   * null, so the caller cannot confuse "nobody" with "not reached". */
  assignments: Map<string, string>;
  /** Members with no slot to stand on. The number that matters when a hive
   * is drawn too small, and the one an officer has to see BEFORE the plan
   * goes out. */
  unplaced: AssignableMember[];
  /** Slots nobody was left to fill. */
  empty: AssignableSlot[];
}

/** Hand out the tiles.
 *
 * PINNED SLOTS ARE HONOURED FIRST AND THEIR MEMBER LEAVES THE POOL. Manual
 * and automatic are not two modes here — an officer places the four people
 * whose position actually matters, pins them, and lets the rest fall in
 * around them. An auto-assignment that quietly moved a pinned member would
 * make the pin worthless, and one that handed their slot to somebody else as
 * well would put two bases on one tile.
 *
 * A pin naming a member who is no longer in the list is dropped rather than
 * kept: it is a plan for somebody who has left, and keeping it holds ground
 * empty for a person who is not coming.
 */
export function autoAssign(
  slots: readonly AssignableSlot[],
  members: readonly AssignableMember[],
  options: { order: AssignOrder; pinned?: ReadonlyMap<string, string> },
): AutoAssignResult {
  const known = new Set(members.map((member) => member.playerId));
  const assignments = new Map<string, string>();
  const spokenFor = new Set<string>();
  const ordered = sortSlots(slots);

  for (const slot of ordered) {
    const pin = options.pinned?.get(slot.slotId);
    // `spokenFor` guards the case of the same member pinned to two slots:
    // the first one wins and the second falls through to the pool, rather
    // than both being written and the save being refused.
    if (pin !== undefined && known.has(pin) && !spokenFor.has(pin)) {
      assignments.set(slot.slotId, pin);
      spokenFor.add(pin);
    }
  }

  const queue = sortMembers(members, options.order).filter(
    (member) => !spokenFor.has(member.playerId),
  );
  const empty: AssignableSlot[] = [];
  let next = 0;
  for (const slot of ordered) {
    if (assignments.has(slot.slotId)) {
      continue;
    }
    const member = queue[next];
    if (member === undefined) {
      empty.push(slot);
      continue;
    }
    assignments.set(slot.slotId, member.playerId);
    next += 1;
  }

  return { assignments, unplaced: queue.slice(next), empty };
}
