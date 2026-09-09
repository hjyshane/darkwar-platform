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

/** What a tile is FOR. Ground or a person.
 *
 * Not inferred from the size: a 3x3 alliance building and a member's base are
 * the same shape and mean opposite things. */
export type TileKind = 'base' | 'structure';

/** The colours a tile may be given. Tokens rather than CSS values, so the
 * stylesheet keeps deciding what the theme's red is — a hex here would not
 * change with the theme and could not be checked for contrast. */
export const TILE_COLOURS = [
  'slate',
  'red',
  'amber',
  'green',
  'teal',
  'blue',
  'violet',
  'pink',
] as const;
export type TileColour = (typeof TILE_COLOURS)[number];

/** Frankie, the structure that stands on the anchor. Four east-west by three
 * north-south — not a base, and the difference is a whole column. Offered as
 * a default rather than hardcoded: since 0169 it is an ordinary tile with a
 * size, which is what lets an alliance building or a 1x1 marker live beside
 * it under the same rule. */
export const FRANKIE = { spanX: 4, spanY: 3 } as const;

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

/** A tile of any size, at an offset from the anchor. */
export interface SizedOffset extends Offset {
  spanX: number;
  spanY: number;
}

/** The west (or south) edge of a span whose coordinate is `centre`.
 *
 * THE ONE RULE FOR WHERE A COORDINATE SITS IN ITS FOOTPRINT, and it has to be
 * written down because an even span has no middle. Floors, so:
 *
 *   span 3 -> centre-1 .. centre+1   the middle, unchanged
 *   span 4 -> centre-1 .. centre+2   one column WEST of the middle
 *   span 1 -> centre .. centre       the tile itself
 *
 * The database computes the same thing as `c - (span - 1) / 2` with integer
 * division (0169). Both follow the rule rather than a list of cases, so a
 * size nobody has tried yet behaves the same on each side.
 */
export function spanLow(centre: number, span: number): number {
  return centre - Math.floor((span - 1) / 2);
}

/** The tiles something of this size at this coordinate covers, inclusive. */
export function footprintOf(at: Coordinate, spanX = BASE_SPAN, spanY = BASE_SPAN): FootprintBox {
  const x0 = spanLow(at.x, spanX);
  const y0 = spanLow(at.y, spanY);
  return { x0, x1: x0 + spanX - 1, y0, y1: y0 + spanY - 1 };
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

/** Whether two tiles of any size share ground.
 *
 * The general form of `basesOverlap`, and the one everything uses now that a
 * tile carries its size. Two boxes intersect when they overlap on BOTH axes —
 * the same test, with each side's own span instead of a shared constant.
 * `basesOverlap` is kept because it is the 3x3 statement of the same thing
 * and reads better where both sides really are bases.
 */
export function tilesOverlap(a: SizedOffset, b: SizedOffset): boolean {
  const boxA = footprintOf({ x: a.dx, y: a.dy }, a.spanX, a.spanY);
  const boxB = footprintOf({ x: b.dx, y: b.dy }, b.spanX, b.spanY);
  return boxA.x0 <= boxB.x1 && boxB.x0 <= boxA.x1 && boxA.y0 <= boxB.y1 && boxB.y0 <= boxA.y1;
}

/** Whether a base centred here has room for all nine of its tiles. */
export function centreFitsOnMap(at: Coordinate): boolean {
  return tileFitsOnMap(at, BASE_SPAN, BASE_SPAN);
}

/** Whether something of this size fits on the map at this coordinate.
 *
 * Asks about the FOOTPRINT rather than about the coordinate, which is the
 * only form that works once tiles differ: a 1x1 may sit on column 0 and a
 * 4-wide one needs two columns to its east.
 */
export function tileFitsOnMap(at: Coordinate, spanX: number, spanY: number): boolean {
  if (!Number.isInteger(at.x) || !Number.isInteger(at.y)) {
    return false;
  }
  const box = footprintOf(at, spanX, spanY);
  return box.x0 >= MAP_MIN && box.x1 <= MAP_MAX && box.y0 >= MAP_MIN && box.y1 <= MAP_MAX;
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
export function firstOverlap(offsets: readonly SizedOffset[]): [SizedOffset, SizedOffset] | null {
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
      if (tilesOverlap(a, b)) {
        return [a, b];
      }
    }
  }
  return null;
}

/** Whether one more tile fits into a layout without touching any of it.
 *
 * Sizes come off each tile, so a 1x1 marker slipping into a gap and a 4x3
 * structure refusing a base three columns away are the same question asked of
 * different rows — and the same question the database's exclusion constraint
 * asks (0169).
 */
export function canPlace(tiles: readonly SizedOffset[], candidate: SizedOffset): boolean {
  return !tiles.some((other) => tilesOverlap(other, candidate));
}

/** The most tiles one formation may hold.
 *
 * NOT AN OPINION ABOUT HIVE SIZE — it is what the board query can carry.
 * `fetchBoard` asks PostgREST for 500 rows, and PostgREST answers a bigger
 * request by silently returning fewer rather than by failing. A formation
 * past this would look complete and be missing tiles, which is the exact
 * failure the one-row-per-entity rule exists to prevent. Dragging out an area
 * is the first thing here that can add hundreds of tiles in one gesture, so
 * it is the first thing that has to know the ceiling.
 */
export const MAX_TILES = 500;

/** The inclusive box two corner tiles span, in either drag direction.
 *
 * A drag names two opposite corners and nothing says which is which: pulling
 * up-and-left is as normal as down-and-right. Sorting here is what stops
 * three of the four directions producing an empty box.
 */
export function boxBetween(a: Coordinate, b: Coordinate): FootprintBox {
  return {
    x0: Math.min(a.x, b.x),
    x1: Math.max(a.x, b.x),
    y0: Math.min(a.y, b.y),
    y1: Math.max(a.y, b.y),
  };
}

/** How many tiles a box covers. */
export function boxArea(box: FootprintBox): number {
  return (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1);
}

/** Whether a tile's whole footprint sits inside a box. */
export function tileInsideBox(at: Coordinate, box: FootprintBox, spanX = 1, spanY = 1): boolean {
  const foot = footprintOf(at, spanX, spanY);
  return foot.x0 >= box.x0 && foot.x1 <= box.x1 && foot.y0 >= box.y0 && foot.y1 <= box.y1;
}

/** Every free 1x1 tile inside a dragged box, as offsets from the anchor.
 *
 * FILLS AROUND WHAT IS ALREADY THERE rather than refusing the whole box. An
 * officer dragging out a strip to keep clear is drawing on ground that
 * usually has something on it already — the hive it runs beside is the reason
 * the strip exists. Placing one rectangle would be one row instead of a
 * hundred, but it would be refused outright the moment a single base fell
 * inside it, and the officer would have to shrink the drag until it fitted
 * between the bases rather than around them.
 *
 * 1x1 because a marker means "this square is spoken for" and nothing larger
 * can say that about an irregular gap.
 */
export function freeTilesIn(
  box: FootprintBox,
  anchor: Coordinate,
  taken: readonly SizedOffset[],
): SizedOffset[] {
  const free: SizedOffset[] = [];
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = box.x0; x <= box.x1; x += 1) {
      if (x < MAP_MIN || x > MAP_MAX || y < MAP_MIN || y > MAP_MAX) {
        continue;
      }
      const candidate: SizedOffset = {
        dx: x - anchor.x,
        dy: y - anchor.y,
        spanX: 1,
        spanY: 1,
      };
      if (canPlace(taken, candidate)) {
        free.push(candidate);
      }
    }
  }
  return free;
}

/** The free 1x1 tiles on a box's EDGE, as offsets from the anchor.
 *
 * A BOUNDARY IS A LINE, NOT A FILL. Marking where a zone or a building
 * footprint ends means four sides, and filling the middle costs hundreds of
 * markers to say the same thing — a 40x40 area is 1,600 tiles filled against
 * 156 outlined, and the fill would eat the formation's whole tile budget to
 * record one edge.
 *
 * A box one or two tiles thick is all edge, and comes back whole rather than
 * as a degenerate ring.
 */
export function outlineTilesIn(
  box: FootprintBox,
  anchor: Coordinate,
  taken: readonly SizedOffset[],
): SizedOffset[] {
  const onEdge = (x: number, y: number) =>
    x === box.x0 || x === box.x1 || y === box.y0 || y === box.y1;
  return freeTilesIn(box, anchor, taken).filter((tile) =>
    onEdge(tile.dx + anchor.x, tile.dy + anchor.y),
  );
}

/** The same offset shifted by a whole number of tiles. */
export function shiftedBy<T extends Offset>(offset: T, byX: number, byY: number): T {
  return { ...offset, dx: offset.dx + byX, dy: offset.dy + byY };
}

/** Whether a whole group of tiles can move together by (byX, byY).
 *
 * THE GROUP IS COMPARED AGAINST EVERYTHING IT IS NOT, and against nothing it
 * is. Members of a moving group cannot clash with each other — they keep
 * their spacing, so if they fitted before they fit after — but they WOULD
 * clash with their own old positions, which is the same trap a single base
 * drag hits: a one-tile nudge leaves old and new footprints overlapping, and
 * every move would be refused for colliding with itself.
 */
export function canMoveGroup(
  tiles: readonly SizedOffset[],
  moving: ReadonlySet<string>,
  byX: number,
  byY: number,
  anchor: Coordinate,
): boolean {
  const stayingPut = tiles.filter((tile) => !moving.has(offsetKey(tile)));
  return tiles
    .filter((tile) => moving.has(offsetKey(tile)))
    .every((tile) => {
      const landing = shiftedBy(tile, byX, byY);
      return (
        tileFitsOnMap(absoluteOf(anchor, landing), landing.spanX, landing.spanY) &&
        canPlace(stayingPut, landing)
      );
    });
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
export function blockOffsets(columns: number, rows: number): SizedOffset[] {
  const offsets: SizedOffset[] = [];
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
        spanX: BASE_SPAN,
        spanY: BASE_SPAN,
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
export function ringOffsets(columns: number, rows: number): SizedOffset[] {
  if (columns < 3 || rows < 3) {
    return blockOffsets(columns, rows);
  }
  const offsets: SizedOffset[] = [];
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
        spanX: BASE_SPAN,
        spanY: BASE_SPAN,
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

/** How many rings out from the middle of the formation a tile sits.
 *
 * MEASURED FROM THE STRUCTURES, not from the anchor. Frankie is four wide, so
 * the anchor is not its middle, and a distance measured from the anchor calls
 * the base two tiles west closer than the base two tiles east — a fact about
 * where the coordinate is printed rather than about the hive. With no
 * structure drawn there is nothing to measure from and the anchor tile itself
 * is the fallback.
 *
 * Divided by the pitch so a ring is a ring of BASES rather than of tiles: the
 * bases packed against Frankie are ring 1, the ones behind them ring 2. That
 * is what an officer means by "inner layer".
 */
export function ringOf(offset: Offset, structures: readonly SizedOffset[] = []): number {
  const cores =
    structures.length > 0
      ? structures.map((tile) => footprintOf({ x: tile.dx, y: tile.dy }, tile.spanX, tile.spanY))
      : [{ x0: 0, x1: 0, y0: 0, y1: 0 }];
  let closest = Number.POSITIVE_INFINITY;
  for (const core of cores) {
    const gapX = Math.max(core.x0 - offset.dx, offset.dx - core.x1, 0);
    const gapY = Math.max(core.y0 - offset.dy, offset.dy - core.y1, 0);
    closest = Math.min(closest, Math.max(Math.ceil(gapX / BASE_SPAN), Math.ceil(gapY / BASE_SPAN)));
  }
  return closest;
}

/** Fill order: innermost ring first, reading order inside a ring.
 *
 * THE INNER RING IS THE ONE THAT MATTERS, so it is the one that gets filled
 * first — the members handed a tile before the formation runs out of people
 * are the ones standing against Frankie. Reading order breaks the tie inside
 * a ring rather than an angle, because the printed list has to be checkable
 * against the picture with one finger, and "north row first, west to east" is
 * how somebody reads a screen.
 */
export function ringOrderAround(
  structures: readonly SizedOffset[],
): (a: Offset, b: Offset) => number {
  return (a, b) => ringOf(a, structures) - ringOf(b, structures) || readingOrder(a, b);
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

/** Slots in the order they get filled: the planner's numbering, then ring
 * order for everything they left at zero — innermost first. */
export function sortSlots<T extends AssignableSlot>(
  slots: readonly T[],
  structures: readonly SizedOffset[] = [],
): T[] {
  const byRing = ringOrderAround(structures);
  return [...slots].sort((a, b) => a.ordinal - b.ordinal || byRing(a, b));
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
  options: {
    order: AssignOrder;
    pinned?: ReadonlyMap<string, string>;
    /** The tiles rings are counted out from, when the slots carry no
     * numbering of their own. Usually just Frankie. */
    structures?: readonly SizedOffset[];
  },
): AutoAssignResult {
  const known = new Set(members.map((member) => member.playerId));
  const assignments = new Map<string, string>();
  const spokenFor = new Set<string>();
  const ordered = sortSlots(slots, options.structures);

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
