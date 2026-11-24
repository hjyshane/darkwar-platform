// Shapes as stamps: pick one, click the map, and it is put down centred on the
// square clicked — as many times as anybody likes, mixed with other shapes.
//
// IT USED TO REPLACE THE DRAWING. "Start from a shape" threw away whatever was
// drawn and put one block or ring round the anchor, which made a hive of two
// blocks, or a ring with a block beside it, impossible to build except tile by
// tile. A stamp ADDS, and where one of its tiles would land on something
// already drawn that tile is left out and said so — never pushed through it,
// since a stamp that silently ate the bases under it would be the old
// replace-everything with extra steps.

import type { Coordinate } from '@dw/ui';
import {
  FRANKIE,
  type SizedOffset,
  type TileColour,
  type TileKind,
  blockOffsets,
  canPlace,
  ringOffsets,
  tileFitsOnMap,
} from '../../lib/hiveFormation';
import { type Translate, english } from '../../lib/i18n/core';
import type { LayoutTile } from './hiveFormations';

/** One tile of a shape, as an offset from the square the shape is put on. */
export interface ShapeTile extends SizedOffset {
  kind: TileKind;
  colour: TileColour | null;
  label: string;
}

/** A shape that can be picked up and stamped. */
export interface StampShape {
  key: string;
  label: string;
  tiles: readonly ShapeTile[];
}

function bases(offsets: readonly SizedOffset[]): ShapeTile[] {
  return offsets.map((offset) => ({ ...offset, kind: 'base', colour: null, label: '' }));
}

/** The shapes always on offer: blocks and rings of bases on the three-tile
 * pitch, and Frankie on his own.
 *
 * FRANKIE IS HIS OWN SHAPE NOW. The old generator put him in the middle of
 * every block, which is right once a hive and wrong for the second block
 * stamped beside it — so the blocks are bases only, and Frankie goes down
 * where somebody puts him. */
export const BUILT_IN_SHAPES: readonly StampShape[] = [
  ...[3, 5, 7, 9].map((side) => ({
    key: `block-${side}`,
    label: `${side}x${side} block`,
    tiles: bases(blockOffsets(side, side)),
  })),
  ...[5, 7, 9].map((side) => ({
    key: `ring-${side}`,
    label: `${side}x${side} ring`,
    tiles: bases(ringOffsets(side, side)),
  })),
  {
    key: 'frankie',
    label: 'Frankie',
    tiles: [
      {
        dx: 0,
        dy: 0,
        spanX: FRANKIE.spanX,
        spanY: FRANKIE.spanY,
        kind: 'structure',
        colour: 'amber',
        label: 'Frankie',
      },
    ],
  },
];

/** A shape's name as shown: the built-in blocks and rings in the reader's
 * language, anything else (Frankie, a saved shape's name) as it is. */
export function shapeLabel(shape: StampShape, t: Translate = english): string {
  const built = /^(block|ring)-(\d+)$/.exec(shape.key);
  if (built === null) {
    return shape.label;
  }
  const size = `${built[2]}x${built[2]}`;
  return built[1] === 'block' ? t('{size} block', { size }) : t('{size} ring', { size });
}

/** A saved shape as a stamp: its tiles round the square its anchor was on. */
export function shapeFromTemplate(tiles: readonly LayoutTile[]): ShapeTile[] {
  return tiles.map((tile) => ({
    dx: tile.dx,
    dy: tile.dy,
    spanX: tile.span_x,
    spanY: tile.span_y,
    kind: tile.kind,
    colour: tile.colour,
    label: tile.label,
  }));
}

/** One tile of a stamp where it would land — as an offset from the
 * formation's anchor — and whether it may go there. */
export interface StampedTile extends ShapeTile {
  /** Where it lands on the map. */
  at: Coordinate;
  fate: 'placed' | 'off-map' | 'taken';
}

/** Where each tile of `shape` lands when it is put down on `at`.
 *
 * Checked against what is drawn AND against the stamp's own earlier tiles, so
 * a saved shape whose tiles overlap (it was drawn before the rule) cannot
 * stack two bases on one square either. */
export function stampPlan(
  shape: readonly ShapeTile[],
  at: Coordinate,
  anchor: Coordinate,
  drawn: readonly SizedOffset[],
): StampedTile[] {
  const taken: SizedOffset[] = [...drawn];
  return shape.map((tile): StampedTile => {
    const landsAt = { x: at.x + tile.dx, y: at.y + tile.dy };
    const placed = { ...tile, dx: landsAt.x - anchor.x, dy: landsAt.y - anchor.y, at: landsAt };
    if (!tileFitsOnMap(landsAt, tile.spanX, tile.spanY)) {
      return { ...placed, fate: 'off-map' };
    }
    if (!canPlace(taken, placed)) {
      return { ...placed, fate: 'taken' };
    }
    taken.push(placed);
    return { ...placed, fate: 'placed' };
  });
}

/** What a stamp did, when it did not simply put everything down. */
export function stampSummary(plan: readonly StampedTile[], t: Translate = english): string | null {
  const placed = plan.filter((tile) => tile.fate === 'placed').length;
  const taken = plan.filter((tile) => tile.fate === 'taken').length;
  const offMap = plan.filter((tile) => tile.fate === 'off-map').length;
  if (taken === 0 && offMap === 0) {
    return null;
  }
  const why =
    taken !== 0 && offMap !== 0
      ? t('{taken} would land on tiles already drawn and {offmap} would run off the map', {
          taken,
          offmap: offMap,
        })
      : taken !== 0
        ? t('{taken} would land on tiles already drawn', { taken })
        : t('{offmap} would run off the map', { offmap: offMap });
  if (placed === 0) {
    return t('Nothing put down: {why}.', { why });
  }
  return taken + offMap === 1
    ? t('Put down {placed} of {total} tiles; {why}, so it was left out.', {
        placed,
        total: plan.length,
        why,
      })
    : t('Put down {placed} of {total} tiles; {why}, so they were left out.', {
        placed,
        total: plan.length,
        why,
      });
}
