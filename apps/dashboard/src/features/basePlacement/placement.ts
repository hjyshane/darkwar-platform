// Base placement tester: where 3x3 bases can go around a structure, and
// whether the territory it claims is left with room for somebody else's base.
//
// Pure functions only, no DOM. The page draws what these return.
//
// The rules (owner, 2026-11-20):
//   - A base is always 3x3. Two bases never overlap.
//   - A base never overlaps a structure's FOOTPRINT (the Trade Shop's 5x5).
//   - Structures may overlap each other freely, and a base may stand inside a
//     structure's AREA (its territory, 17x17 for the Trade Shop). The area is
//     what the sealing question is asked about, not an obstacle.
//
// Coordinates are the game's own (x, y as typed into the game's coordinate
// box). A square is named by its CENTRE cell, so an odd side is the only kind
// that has one; every size here is odd for that reason.

export const BASE_SIZE = 3;

export interface Cell {
  x: number;
  y: number;
}

export interface Structure {
  id: string;
  name: string;
  /** Centre cell. */
  x: number;
  y: number;
  /** Side of the footprint no base may touch. Odd. */
  footprint: number;
  /** Side of the territory around it, or null when it claims none. Odd. */
  area: number | null;
}

/** Inclusive cell bounds of a square of `size` centred on a cell. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function squareAt(centre: Cell, size: number): Rect {
  const half = (size - 1) / 2;
  return { x0: centre.x - half, y0: centre.y - half, x1: centre.x + half, y1: centre.y + half };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1
  );
}

export const baseRect = (base: Cell): Rect => squareAt(base, BASE_SIZE);
export const footprintRect = (s: Structure): Rect => squareAt(s, s.footprint);
export const areaRect = (s: Structure): Rect | null =>
  s.area === null ? null : squareAt(s, s.area);

/** An odd, positive side, or null for anything the grid cannot centre. */
export function validSide(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n % 2 === 1;
}

export type Refusal = 'overlaps-base' | 'overlaps-structure';

/** Why a base cannot stand at `at`, or null when it can. `bases` is the others
 * already placed (the one being moved is left out by the caller). */
export function refusal(
  at: Cell,
  bases: readonly Cell[],
  structures: readonly Structure[],
): Refusal | null {
  const me = baseRect(at);
  if (bases.some((other) => overlaps(me, baseRect(other)))) return 'overlaps-base';
  if (structures.some((s) => overlaps(me, footprintRect(s)))) return 'overlaps-structure';
  return null;
}

export function refusalText(r: Refusal): string {
  return r === 'overlaps-base'
    ? 'Overlaps another base: bases cannot share a tile.'
    : 'Overlaps a structure: bases cannot stand on its footprint.';
}

/** Centres where one more base could still be placed INSIDE a structure's
 * area (all nine tiles in it), each listed once however many areas hold it.
 * Empty means the territory is sealed: nobody can place in it. */
export function openSlots(bases: readonly Cell[], structures: readonly Structure[]): Cell[] {
  const seen = new Set<string>();
  const slots: Cell[] = [];
  for (const s of structures) {
    const area = areaRect(s);
    if (area === null) continue;
    const half = (BASE_SIZE - 1) / 2;
    for (let x = area.x0 + half; x <= area.x1 - half; x++) {
      for (let y = area.y0 + half; y <= area.y1 - half; y++) {
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        if (refusal({ x, y }, bases, structures) === null) {
          seen.add(key);
          slots.push({ x, y });
        }
      }
    }
  }
  return slots;
}

/** How many more bases would fit if somebody kept placing one by one, first
 * free spot first. A floor on the room left, not the most it could hold. */
export function packedExtra(bases: readonly Cell[], structures: readonly Structure[]): number {
  const placed = [...bases];
  let extra = 0;
  for (;;) {
    const next = openSlots(placed, structures)[0];
    if (next === undefined) return extra;
    placed.push(next);
    extra++;
  }
}

export const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;

/** The Trade Shop: a 5x5 building with a 17x17 territory (owner, 2026-11-20). */
export const TRADE_SHOP = { footprint: 5, area: 17 } as const;

/** Offsets from a Trade Shop's centre that seal its territory with eight bases:
 * a ring of three-by-three, the top and bottom middle pushed one tile apart
 * from the building. Found by exhaustive search (16 arrangements seal 17x17
 * with eight bases; this is the one that keeps the ring's shape), and pinned by
 * a test that checks it leaves no open slot. */
const TRADE_SHOP_RING: readonly Cell[] = [
  { x: -5, y: -5 },
  { x: 0, y: -6 },
  { x: 5, y: -5 },
  { x: -5, y: 0 },
  { x: 5, y: 0 },
  { x: -5, y: 5 },
  { x: 0, y: 5 },
  { x: 5, y: 5 },
];

/** The sealing ring for a structure shaped like the Trade Shop, or null for any
 * other shape: no other has been searched. */
export function ringFor(s: Structure): Cell[] | null {
  if (s.footprint !== TRADE_SHOP.footprint || s.area !== TRADE_SHOP.area) return null;
  return TRADE_SHOP_RING.map((o) => ({ x: s.x + o.x, y: s.y + o.y }));
}

/** `(x,y)` per line, for pasting into chat. */
export function coordinateList(bases: readonly Cell[]): string {
  return [...bases]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((b) => `${b.x},${b.y}`)
    .join('\n');
}
