import { footprintOf, isMemberBase } from '../../lib/hiveFormation';
import { TILE_H, TILE_W } from '../../lib/tileShape';
import type { BoardSlot } from './hiveFormations';

/** Tiles of air round the bases, so the outer row is not drawn on the edge. */
const MARGIN = 2;

export interface SnapshotTile {
  key: string;
  /** Top-left corner and size in the picture's own units: one unit is one map
   * tile, x counts east and y counts DOWN (the map counts y up; flipped here). */
  left: number;
  top: number;
  width: number;
  height: number;
  className: string;
  own: boolean;
}

export interface Snapshot {
  width: number;
  height: number;
  tiles: SnapshotTile[];
  /** The reader's own tile, or null when they have none in this plan. */
  own: SnapshotTile | null;
}

/** The whole plan as a small picture: where every tile falls, and which one is
 * the reader's.
 *
 * FITTED TO THE MEMBERS' BASES, like the plan screen's own map: a boundary
 * drawn round a wide area would otherwise shrink the hive to a dot in the
 * middle. Ground outside that frame is cut off rather than squeezed in.
 */
export function hiveSnapshot(
  board: readonly BoardSlot[],
  ownPlayerId: string | null,
): Snapshot | null {
  const boxed = board.map((slot) => ({
    slot,
    box: footprintOf({ x: slot.x, y: slot.y }, slot.spanX, slot.spanY),
  }));
  const bases = boxed.filter(({ slot }) => isMemberBase(slot));
  const framed = bases.length > 0 ? bases : boxed;
  if (framed.length === 0) {
    return null;
  }
  const xMin = Math.min(...framed.map(({ box }) => box.x0)) - MARGIN;
  const xMax = Math.max(...framed.map(({ box }) => box.x1)) + MARGIN;
  const yMin = Math.min(...framed.map(({ box }) => box.y0)) - MARGIN;
  const yMax = Math.max(...framed.map(({ box }) => box.y1)) + MARGIN;

  const tiles: SnapshotTile[] = [];
  for (const { slot, box } of boxed) {
    if (box.x1 < xMin || box.x0 > xMax || box.y1 < yMin || box.y0 > yMax) {
      continue;
    }
    const own = ownPlayerId !== null && slot.playerId === ownPlayerId;
    tiles.push({
      key: slot.slotId,
      left: box.x0 - xMin,
      top: yMax - box.y1,
      width: box.x1 - box.x0 + 1,
      height: box.y1 - box.y0 + 1,
      className: [
        'hive-snap__tile',
        slot.kind === 'structure' ? 'hive-snap__tile--structure' : '',
        slot.colour ? `hive-snap__tile--${slot.colour}` : '',
        own ? 'hive-snap__tile--own' : '',
      ]
        .filter(Boolean)
        .join(' '),
      own,
    });
  }
  return {
    width: xMax - xMin + 1,
    height: yMax - yMin + 1,
    tiles,
    own: tiles.find((tile) => tile.own) ?? null,
  };
}

/** A small, read-only picture of a plan with the reader's tile picked out.
 *
 * NOT THE TILE GRID. That one pans, zooms, captions and edits; this is a
 * thumbnail whose one job is "you are HERE in the shape", for the screen a
 * member lands on. It opens the plan when pressed, which is where the real map
 * is.
 */
export function HiveSnapshot({
  board,
  ownPlayerId,
}: {
  board: readonly BoardSlot[];
  ownPlayerId: string | null;
}) {
  const snapshot = hiveSnapshot(board, ownPlayerId);
  if (snapshot === null) {
    return null;
  }
  const { own } = snapshot;
  // Drawn last so no neighbour's border covers it, and ringed so it is found
  // at a glance even when eighty bases make each one a few pixels wide.
  const others = snapshot.tiles.filter((tile) => !tile.own);
  return (
    <a
      aria-label={
        own ? 'Your base on the plan map. Open the plan.' : 'The plan map. Open the plan.'
      }
      className="hive-snap"
      href="#/hive"
    >
      <svg
        aria-hidden="true"
        preserveAspectRatio="none"
        style={{ aspectRatio: `${snapshot.width * TILE_W} / ${snapshot.height * TILE_H}` }}
        viewBox={`0 0 ${snapshot.width} ${snapshot.height}`}
      >
        {others.map((tile) => (
          <rect
            className={tile.className}
            height={tile.height}
            key={tile.key}
            width={tile.width}
            x={tile.left}
            y={tile.top}
          />
        ))}
        {own && (
          <>
            {/* Stretched with the picture, so the radius is narrower across to stay round. */}
            <ellipse
              className="hive-snap__ring"
              cx={own.left + own.width / 2}
              cy={own.top + own.height / 2}
              rx={(Math.max(own.width, own.height) * 1.1 * TILE_H) / TILE_W}
              ry={Math.max(own.width, own.height) * 1.1}
            />
            <rect
              className={own.className}
              height={own.height}
              width={own.width}
              x={own.left}
              y={own.top}
            />
          </>
        )}
      </svg>
      {own && (
        <span className="hive-snap__legend">
          <span aria-hidden="true" className="hive-snap__swatch" /> Your base · north is up
        </span>
      )}
    </a>
  );
}
