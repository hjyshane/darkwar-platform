import { type Coordinate, MAP_MAX, MAP_MIN } from '@dw/ui';
import {
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  BASE_SPAN,
  type FootprintBox,
  type TileColour,
  boxBetween,
  footprintOf,
  formatTeleport,
} from '../../lib/hiveFormation';
import { TILE_H, TILE_W } from '../../lib/tileShape';
import { MAP_SIZE_MAX, MAP_SIZE_MIN } from './mapPrefs';

// A few dozen tiles, close enough to click one.
//
// THE WORLD MAP CANNOT DO THIS AND NEVER WILL. `MapCanvas` draws all 1,000
// tiles a side across about 900 pixels, which is nine tenths of a pixel per
// tile — fine for saying roughly where a base is, useless for saying WHICH
// SQUARE. A formation is decided one tile at a time, so this is a window onto
// a few dozen of them instead, and the window is what makes a click mean a
// coordinate.
//
// NO TILE IS AN ELEMENT. A 41x41 window is 1,681 squares, and drawing each as
// a node makes panning cost a thousand-node re-render for a picture that is
// only ever lines. The grid is a repeating background gradient, and the only
// elements are the things that carry information: the bases, the anchor, and
// the sightings underneath. Which is also why the click has to be projected
// rather than read off an element's identity — the helpers below are that
// projection, and they are exported because getting the y flip wrong is
// silent and would mirror every placement.

/** The rectangle of tiles on screen. Inclusive on all four sides. */
export interface GridWindow {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Tiles along one side. */
  across: number;
}

/** The window of `radius` tiles either side of a centre, clamped to the map.
 *
 * CLAMPED BY SLIDING, NOT BY SHRINKING. A window that got smaller near the
 * edge would change the size of every tile on screen as you pan, so a hive
 * being drawn at 20,20 would be at a different zoom to the same hive at
 * 500,500. Sliding keeps the tile size fixed and the picture honest.
 */
export function windowAround(centre: Coordinate, radius: number): GridWindow {
  const across = radius * 2 + 1;
  const slide = (value: number) =>
    Math.min(MAP_MAX - across + 1, Math.max(MAP_MIN, value - radius));
  const xMin = slide(centre.x);
  const yMin = slide(centre.y);
  return { xMin, xMax: xMin + across - 1, yMin, yMax: yMin + across - 1, across };
}

/** Where a tile's top-left corner sits, as fractions of the grid.
 *
 * The y flip lives here and in `tileAtFraction`, and nowhere else: the map
 * counts y UPWARD from the bottom and every browser API counts downward from
 * the top. Getting it backwards does not throw — it mirrors the formation.
 */
export function tileCorner(window: GridWindow, at: Coordinate): { left: number; top: number } {
  return {
    left: (at.x - window.xMin) / window.across,
    top: (window.yMax - at.y) / window.across,
  };
}

/** The tile under a point given as fractions of the grid.
 *
 * Floors rather than rounds, for `fromFraction`'s reason: a tile OWNS the
 * band it covers, so a click anywhere inside names it. Rounding would give
 * each tile's outer half to its neighbour, which at this zoom is a base
 * placed one square from where the officer pointed.
 */
export function tileAtFraction(window: GridWindow, left: number, top: number): Coordinate {
  const column = Math.floor(left * window.across);
  const row = Math.floor(top * window.across);
  return {
    x: Math.min(window.xMax, Math.max(window.xMin, window.xMin + column)),
    y: Math.min(window.yMax, Math.max(window.yMin, window.yMax - row)),
  };
}

/** Steps an axis may count in. Round numbers only, so a label reads as a
 * coordinate to type rather than a value to work out. */
const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100] as const;

/** Labels to assume before the grid has been measured.
 *
 * Only ever used for the first paint. Deliberately the old fixed value, so a
 * frame rendered before the measurement lands is never denser than what used
 * to ship — a label budget guessed too high would show a collided axis and
 * then tidy itself, which looks like a bug.
 */
const TICKS_UNMEASURED = 10;

/** Pixels to allow per label on the X axis.
 *
 * THE X AXIS IS THE TIGHT ONE. Its labels sit side by side and "515" is about
 * three characters wide; the Y axis stacks them a line apart and fits far
 * more, which is why the two get different budgets below.
 *
 * A fixed COUNT cannot serve both a 720px grid and a 322px phone: sixteen
 * labels leaves 28px of air on the desktop and 0.7px on the phone. Measured,
 * both get as many labels as they can actually hold.
 */
const X_LABEL_PX = 30;

/** Pixels per label going down. A line of text, plus air. */
const Y_LABEL_PX = 22;

/** The width of the element behind `ref` in CSS pixels, or 0 until it has
 * been measured. Follows it as it changes — the map can be resized now. */
function useWidthOf(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    // jsdom has no ResizeObserver, and a test that renders this should get the
    // unmeasured fallback rather than a crash.
    if (element === null || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** The coordinates one axis labels, between `min` and `max` inclusive.
 *
 * Multiples of the step rather than every nth tile from the edge, so panning
 * one tile does not relabel the whole axis — 480 stays 480 and slides along
 * under the pointer, the way the ground does.
 */
export function axisTicks(min: number, max: number, maxTicks = TICKS_UNMEASURED): number[] {
  const across = max - min + 1;
  const step = TICK_STEPS.find((candidate) => across / candidate <= maxTicks) ?? 100;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max; value += step) {
    ticks.push(value);
  }
  return ticks;
}

/** The labelled edges around a grid.
 *
 * OUTSIDE THE GRID ELEMENT, NOT INSIDE IT. Every click is projected from the
 * grid's own box (`tileUnder`), so anything drawn within that box would shift
 * the projection or sit on top of tiles somebody is trying to click.
 *
 * Each label is centred on its tile, not on a grid line: a tile is a square
 * with a coordinate, and a label on the line between 480 and 481 names neither.
 */
function AxisFrame({
  view,
  children,
  grip,
  overlay,
}: {
  view: GridWindow;
  children: ReactNode;
  /** The resize handle, drawn just off the grid's bottom-right corner. */
  grip?: ReactNode;
  /** Controls drawn over the grid's corners — see `TileGrid`'s `overlay`. */
  overlay?: ReactNode;
}) {
  // MEASURED ON THE X AXIS ITSELF, not on the frame around it. The frame is
  // full width while the grid column is capped at 720px, so on a wide screen
  // the frame is the wrong number — measuring it budgeted 23 labels into the
  // space for 15 and left 10px between them. The x axis shares the grid's
  // column, so its width IS the width the labels are laid out across.
  const axisRef = useRef<HTMLDivElement | null>(null);
  const width = useWidthOf(axisRef);
  // The grid is 4:3 (a tile is wider than tall), so the Y labels stack down
  // three quarters of that width. One measurement, two spacings.
  const budget = (perLabel: number, along = width) =>
    width === 0 ? TICKS_UNMEASURED : Math.max(2, Math.floor(along / perLabel));

  return (
    <div className={grip === undefined ? 'tile-frame' : 'tile-frame tile-frame--resizable'}>
      <span aria-hidden="true" className="tile-frame__title tile-frame__title--y">
        Y
      </span>
      <div aria-hidden="true" className="tile-frame__axis tile-frame__axis--y">
        {axisTicks(view.yMin, view.yMax, budget(Y_LABEL_PX, (width * TILE_H) / TILE_W)).map((y) => (
          <span key={y} style={{ top: `${((view.yMax - y + 0.5) / view.across) * 100}%` }}>
            {y}
          </span>
        ))}
      </div>
      {children}
      {/* A SIBLING OF THE GRID, NOT A CHILD. The editor's grid is a button,
          and a button cannot hold buttons; laid over the same cell instead,
          and only its panels take the pointer, so every tile between them is
          still the grid's to click. */}
      {overlay !== undefined && <div className="tile-frame__overlay">{overlay}</div>}
      <div aria-hidden="true" className="tile-frame__axis tile-frame__axis--x" ref={axisRef}>
        {axisTicks(view.xMin, view.xMax, budget(X_LABEL_PX)).map((x) => (
          <span key={x} style={{ left: `${((x - view.xMin + 0.5) / view.across) * 100}%` }}>
            {x}
          </span>
        ))}
      </div>
      <span aria-hidden="true" className="tile-frame__title tile-frame__title--x">
        X
      </span>
      {grip}
    </div>
  );
}

/** How far one arrow-key press resizes the map, in CSS pixels. */
const RESIZE_KEY_STEP = 40;

/** The handle that resizes the map: drag it, or focus it and use the arrows.
 *
 * A HANDLE ON THE MAP RATHER THAN A SETTING ELSEWHERE, because the size you
 * want is the size that looks right, and the only way to find it is to watch
 * the map while you change it.
 *
 * OFF THE CORNER, NOT ON IT. The grid is one big click target where every
 * pixel names a tile; a handle drawn over its corner would steal the clicks
 * for the tiles under it, so it sits just outside, in a column of its own.
 *
 * Reports the GRID's width, measured from the grid itself, so a drag starts
 * from the size actually on screen even when the page has squeezed it below
 * the size last chosen. Double-click hands the size back to the page.
 */
function ResizeGrip({
  target,
  width,
  onResize,
  min,
  max,
}: {
  target: RefObject<HTMLElement | null>;
  /** The grid's measured width, 0 until measured. */
  width: number;
  onResize: (width: number | null) => void;
  min: number;
  max: number;
}) {
  const [held, setHeld] = useState<{ x: number; y: number; width: number; limit: number } | null>(
    null,
  );

  /** As wide as the page column allows from where the grid starts, so a drag
   * past its edge stops there instead of growing a size nobody can see —
   * which would then have to be dragged all the way back. The COLUMN, not the
   * window: the content is capped at --measure, so on a wide screen the
   * window's edge is hundreds of pixels past anything the map can fill. */
  function limit(): number {
    const grid = target.current;
    if (grid === null) {
      return max;
    }
    const column = grid.closest('main');
    const right =
      column === null ? document.documentElement.clientWidth : column.getBoundingClientRect().right;
    // The handle's own column and the padding round the map.
    return Math.max(min, Math.min(max, right - grid.getBoundingClientRect().left - 40));
  }

  const report = (next: number, ceiling = limit()) =>
    onResize(Math.round(Math.min(ceiling, Math.max(min, next))));

  return (
    <span
      aria-label="Map size. Drag, or use the arrow keys; double-click to reset."
      aria-orientation="horizontal"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={Math.round(width)}
      aria-valuetext={`${Math.round(width)} pixels wide`}
      className={held === null ? 'tile-frame__grip' : 'tile-frame__grip tile-frame__grip--held'}
      onDoubleClick={() => onResize(null)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? RESIZE_KEY_STEP * 3 : RESIZE_KEY_STEP;
        const grow =
          event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? step
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
              ? -step
              : 0;
        if (grow !== 0) {
          event.preventDefault();
          report(width + grow);
        } else if (event.key === 'Home') {
          event.preventDefault();
          report(min);
        } else if (event.key === 'End') {
          event.preventDefault();
          report(limit());
        }
      }}
      onLostPointerCapture={() => setHeld(null)}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setHeld({
          x: event.clientX,
          y: event.clientY,
          width: target.current?.getBoundingClientRect().width ?? width,
          limit: limit(),
        });
      }}
      onPointerMove={(event) => {
        if (held === null) {
          return;
        }
        // The map is square, so a corner handle has one size to give it: the
        // larger of the two movements, so dragging straight right or straight
        // down both work, and so does the diagonal everybody actually does.
        const byX = event.clientX - held.x;
        const byY = event.clientY - held.y;
        report(held.width + (Math.abs(byX) >= Math.abs(byY) ? byX : byY), held.limit);
      }}
      onPointerUp={() => setHeld(null)}
      role="slider"
      tabIndex={0}
    />
  );
}

/** A base drawn on the grid. */
export interface GridBase {
  key: string;
  at: Coordinate;
  /** Tiles east-west and north-south. A base is 3x3, Frankie 4x3, a marker
   * 1x1 — the grid draws whatever it is told rather than assuming. */
  spanX?: number;
  spanY?: number;
  /** Ground rather than a person: drawn as an outline, and never dimmed as
   * "carried" because a structure is not somebody's place. */
  structure?: boolean;
  colour?: TileColour | null;
  /** Shown inside the footprint when there is room — a number, or a name. */
  caption?: string;
  selected?: boolean;
  /** The reader's own tile, picked out from everybody else's. */
  own?: boolean;
  /** Drawn as a warning: an assignment for somebody off the roster. */
  stale?: boolean;
  /** Coloured by the alliance rank of whoever stands on it — 1 to 5 for R1 to
   * R5, null for a member whose rank is not known — INSTEAD of `colour`.
   * Absent, `colour` decides, which is how every tile was drawn before. */
  rank?: number | null;
  /** A member base with nobody on it yet. Only set while bases are coloured by
   * rank: there an empty base painted the default colour would read as one
   * more rank, so it is drawn as an empty outline instead. */
  vacant?: boolean;
}

/** The class that colours a base by rank: r1..r5, or r0 for anything that is
 * not a rank the game gives (null, or a number from a column gone wrong). */
export function rankClass(rank: number | null): string {
  return Number.isInteger(rank) && rank !== null && rank >= 1 && rank <= 5 ? `r${rank}` : 'r0';
}

/** Somebody already standing here, from the map's own sightings. */
export interface GridSighting {
  key: string;
  at: Coordinate;
  name: string | null;
  /** True when this base belongs to a member of our own alliance — one of
   * ours standing on the ground is a very different thing to a stranger. */
  ours?: boolean;
}

/** A tile of any size as a percentage rectangle.
 *
 * Goes through `footprintOf` rather than doing its own arithmetic, so where a
 * coordinate sits inside an even span is decided in ONE place — and the
 * picture cannot disagree with the constraint about which tiles are covered.
 */
function boxStyle(window: GridWindow, at: Coordinate, spanX: number, spanY = spanX) {
  return rectStyle(window, footprintOf(at, spanX, spanY));
}

/** How close and how wide the window can go, in tiles either side of the
 * centre.
 *
 * ANY RADIUS IN BETWEEN, NOT A LADDER. This used to be four fixed steps (17,
 * 29, 45 and 69 tiles across), which was too coarse to frame a hive the way
 * an officer wanted it and stopped well short of the ground round it. The
 * closest is one base and its neighbours; the widest is a couple of hundred
 * tiles, for finding somewhere to put the whole thing.
 *
 * Shared by both grids so the member's picture and the officer's editor zoom
 * the same way — and so "45 tiles" means one thing in the app.
 */
export const ZOOM_MIN = 3;
export const ZOOM_MAX = 100;

/** Where the editor opens: a hive's inner rings, close enough to click. */
export const ZOOM_DEFAULT = 14;

/** How much one wheel notch, or one press of + or −, changes the radius. Small
 * enough that a notch never loses the ground being looked at; at the closest
 * end it still moves the window by a whole tile either side. */
export const ZOOM_NOTCH = 1.2;

/** The tightest a fitted window goes, so a formation of three bases is not
 * blown up to fill the screen. Deliberately not ZOOM_MIN: the reader can still
 * zoom in past this by hand. */
const FIT_MIN_RADIUS = 8;

/** A zoom held as a number, clamped to the range. */
export function clampZoom(radius: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, radius));
}

/** The radius the window is actually drawn at.
 *
 * THE ZOOM IS KEPT AS A FRACTION, THE WINDOW IS WHOLE TILES. A trackpad pinch
 * arrives as dozens of tiny steps, each far less than a tile; rounding every
 * one of them would throw each away and the pinch would never move at all.
 */
export function windowRadius(zoom: number): number {
  return Math.round(clampZoom(zoom));
}

/** The zoom `notches` closer (positive) or wider (negative), clamped at both
 * ends rather than wrapping. Fractional notches are what a pinch sends.
 *
 * CLOSER IS A SMALLER RADIUS. Getting that backwards does not throw; it just
 * makes the wheel do the opposite of what every map does, which is how it was
 * found the first time.
 */
export function zoomedBy(zoom: number, notches: number): number {
  const next = clampZoom(zoom / ZOOM_NOTCH ** notches);
  // A WHOLE NOTCH ALWAYS MOVES THE WINDOW. Near the closest end a fifth of a
  // radius is under a tile, so from a fractional zoom (left by a pinch) a
  // press of + could round to the window already on screen and appear to do
  // nothing. A pinch's fractions are left alone: those are meant to add up.
  if (Math.abs(notches) >= 1 && windowRadius(next) === windowRadius(zoom)) {
    return clampZoom(windowRadius(zoom) - Math.sign(notches));
  }
  return next;
}

/** One wheel event as notches, positive for closer.
 *
 * TWO DEVICES, ONE EVENT. A mouse wheel arrives one notch per event, as a
 * line count or a hundred-odd pixels; a trackpad pinch arrives as a stream of
 * small pixel deltas with ctrl set. Treating the pinch's deltas as notches
 * zoomed the whole range in a flick, and treating the wheel's hundred pixels
 * as a pinch made one notch a jump of three. So each is read as what it is.
 */
export function wheelNotches(deltaY: number, deltaMode: number): number {
  if (deltaY === 0) {
    return 0;
  }
  if (deltaMode !== 0 || Math.abs(deltaY) >= 50) {
    return -Math.sign(deltaY);
  }
  return -deltaY / 20;
}

/** Where the pointer is across the grid, 0..1 from the top-left corner. */
export interface GridFraction {
  left: number;
  top: number;
}

/** The centre that keeps the ground under the pointer where it is when the
 * window becomes `radius` tiles either side.
 *
 * ZOOMING ABOUT THE POINTER, NOT ABOUT THE TILE UNDER IT. This used to
 * re-centre on the tile under the pointer, which with four big steps at least
 * kept it in view; with a pinch that sends forty small steps, re-centring on
 * each one flew the map toward the cursor. Holding the pointer's spot fixed is
 * what every map does, and the formula is the same one: the edges move by the
 * change in size, shared out by where the pointer sits between them.
 *
 * From the window as DRAWN, which near the map's edge has slid away from the
 * centre the caller holds — so the answer is about the ground on screen.
 */
export function centreKeeping(view: GridWindow, radius: number, at: GridFraction): Coordinate {
  const grown = radius * 2 + 1 - view.across;
  // The map's y counts upward, so the top edge is yMax and growing the window
  // pushes it UP by the share of the growth that lies above the pointer.
  const xMin = view.xMin - at.left * grown;
  const yMax = view.yMax + at.top * grown;
  return pannedCentre({ x: Math.round(xMin + radius), y: Math.round(yMax - radius) }, 0, 0);
}

/** The smallest a tile may be drawn and still carry a caption, in CSS pixels.
 * A 3x3 base is then about fourteen pixels — a name is clipped to its first
 * letters there, but it is still the letters of a name, which is what a member
 * looking for themselves on the widest view needs. */
const CAPTION_MIN_TILE_PX = 4.5;

/** Below this the grid lines are dropped: one line every three pixels is not a
 * grid any more, it is a grey wash over the bases it is meant to measure. */
const LINES_MIN_TILE_PX = 4;

/** The window that shows every footprint whole, with a margin round it.
 *
 * For the members' picture, which is there to be looked at rather than
 * worked in: it opens on the WHOLE formation instead of a fixed zoom round the
 * anchor, which on an eighty-base hive showed the middle and left everybody
 * past the second ring to be panned for. Never closer than FIT_MIN_RADIUS, so
 * a formation of three bases is not blown up to fill the screen, and never
 * wider than the zoom can go. Null for nothing drawn — the caller keeps its
 * own default.
 */
export function windowFitting(
  boxes: readonly FootprintBox[],
  margin = 2,
): { centre: Coordinate; radius: number } | null {
  if (boxes.length === 0) {
    return null;
  }
  const x0 = Math.min(...boxes.map((box) => box.x0));
  const x1 = Math.max(...boxes.map((box) => box.x1));
  const y0 = Math.min(...boxes.map((box) => box.y0));
  const y1 = Math.max(...boxes.map((box) => box.y1));
  const centre = { x: Math.floor((x0 + x1) / 2), y: Math.floor((y0 + y1) / 2) };
  const reach = Math.max(centre.x - x0, x1 - centre.x, centre.y - y0, y1 - centre.y);
  return { centre, radius: clampZoom(Math.max(FIT_MIN_RADIUS, reach + margin)) };
}

/** How far the pointer must travel before a press becomes a drag.
 *
 * In TILES, not pixels, so it scales with the zoom: at 69 tiles across a
 * quarter-tile is three pixels and every click would jitter into a one-tile
 * move. Below this a press is a click and does what a click did before —
 * which is what keeps "click a base to remove it" working now that pressing
 * a base also starts a drag. */
const DRAG_THRESHOLD_TILES = 0.4;

interface Drag {
  /** The base being carried, by the tile it started on. */
  from: Coordinate;
  to: Coordinate;
  /** Its size, so the ghost is the shape that will actually land. */
  spanX: number;
  spanY: number;
  /** False while the pointer is still inside the threshold: the press has not
   * become a drag yet and releasing here is still a click. */
  moved: boolean;
  /** Whether dropping here is allowed. The grid does not know the rule — the
   * parent owns overlap — so this is whatever `canMoveTo` said. */
  allowed: boolean;
}

/** What a member dragged out of the editor's list carries: their player id,
 * under a type of our own so a file or a link dragged onto the map is not
 * mistaken for somebody. */
export const MEMBER_DRAG_TYPE = 'application/x-dw-member';

/** The centre a pan step lands on, kept on the map.
 *
 * CLAMPED TO THE MAP, NOT TO THE WINDOW. `windowAround` already slides a
 * window that would hang off an edge, so an unclamped centre would go on
 * counting past 999 while the picture stopped moving — and the officer would
 * then have to drag the same distance back before anything happened.
 */
export function pannedCentre(from: Coordinate, byX: number, byY: number): Coordinate {
  const onMap = (value: number) => Math.min(MAP_MAX, Math.max(MAP_MIN, value));
  return { x: onMap(from.x + byX), y: onMap(from.y + byY) };
}

/** An inclusive tile box as a percentage rectangle. */
/** Where a tile lands when the anchor goes from `from` to `to`: every tile is
 * an offset from the anchor, so it moves by exactly what the anchor did. */
export function shiftedAt(at: Coordinate, from: Coordinate, to: Coordinate): Coordinate {
  return { x: at.x + to.x - from.x, y: at.y + to.y - from.y };
}

/** Whether a press on `tile` picks up the anchor rather than what is under it.
 *
 * THE ANCHOR'S OWN SQUARE, WHATEVER IS DRAWN OVER IT. It used to yield to a
 * person's base standing there, which left an officer with no way to take
 * hold of the one tile every offset hangs from once somebody was put on it.
 * The anchor is one square and drawn on top; a base over it is still carried
 * from any of its other eight. */
export function grabsAnchor(tile: Coordinate, anchor: Coordinate): boolean {
  return tile.x === anchor.x && tile.y === anchor.y;
}

/** One tile of a shape about to be stamped, where it would land and whether
 * it would — drawn under the pointer before the click. */
export interface StampGhost {
  key: string;
  at: Coordinate;
  spanX: number;
  spanY: number;
  allowed: boolean;
}

function rectStyle(window: GridWindow, box: FootprintBox) {
  const corner = tileCorner(window, { x: box.x0, y: box.y1 });
  return {
    left: `${corner.left * 100}%`,
    top: `${corner.top * 100}%`,
    width: `${((box.x1 - box.x0 + 1) / window.across) * 100}%`,
    height: `${((box.y1 - box.y0 + 1) / window.across) * 100}%`,
  };
}

export function TileGrid({
  window: view,
  anchor,
  bases,
  sightings = [],
  onPick,
  onMove,
  onRegion,
  onPan,
  canMoveTo,
  onZoom,
  onDropMember,
  canDropAt,
  onMoveAnchor,
  canAnchorAt,
  onResize,
  overlay,
  stampGhosts,
  busy = false,
}: {
  window: GridWindow;
  /** The formation's origin. Drawn because every offset is measured from it,
   * so an officer who cannot see it cannot read the shape. */
  anchor: Coordinate;
  bases: readonly GridBase[];
  sightings?: readonly GridSighting[];
  /** Given, clicking a tile reports it. Absent, the grid is a picture. */
  onPick?: (tile: Coordinate) => void;
  /** Given, a base can be picked up and put down somewhere else. Without it
   * pressing a base and moving does nothing, which is the read-only grid. */
  onMove?: (from: Coordinate, to: Coordinate) => void;
  /** Given, a drag sweeps out a rectangle of tiles instead of carrying a
   * base, and the box is reported on release.
   *
   * TAKES OVER THE DRAG RATHER THAN SHARING IT. One pointer gesture cannot
   * mean both "carry this base" and "sweep this area" — whichever the grid
   * guessed would be wrong half the time, on a press that looks identical
   * either way. So this is a MODE the parent switches into, and while it is
   * on, bases stay where they are.
   */
  onRegion?: (box: FootprintBox) => void;
  /** Given, holding ctrl (or the middle button) and dragging slides the view.
   * Reported as a step in TILES since the last call, so the caller adds it to
   * its centre rather than tracking where the gesture began.
   *
   * A MODIFIER RATHER THAN A MODE, because panning is the one thing an
   * officer does WHILE doing something else — halfway through drawing a wing
   * of the hive, to see where it is going. A mode would mean leaving the tool
   * they are using and coming back to it, every time they wanted to look.
   */
  onPan?: (byX: number, byY: number) => void;
  /** Whether the base now on `from` may land on `to`. Asked on every tile the
   * pointer crosses, so the square under the cursor can say no BEFORE the
   * drop rather than the drop being silently ignored. */
  canMoveTo?: (from: Coordinate, to: Coordinate) => boolean;
  /** Given, ctrl + wheel (or a pinch) zooms. `notches` is positive to go
   * closer and may be fractional (a pinch); `at` is where the pointer is
   * across the grid, for `centreKeeping` — so the ground being looked at stays
   * under the cursor instead of sliding away.
   *
   * At most once a frame: a pinch sends far more events than the screen can
   * draw, and they are added up rather than each one re-rendering the page. */
  onZoom?: (notches: number, at: GridFraction) => void;
  /** Given, a member dragged from a list (MEMBER_DRAG_TYPE) can be dropped on
   * a tile, which is reported with their player id. The parent decides what a
   * drop there means — a new base, or the base already standing there. */
  onDropMember?: (playerId: string, at: Coordinate) => void;
  /** Whether a member dropped on `at` would land, asked as the pointer moves
   * so the square under it can say no before the drop. */
  canDropAt?: (at: Coordinate) => boolean;
  /** Given, pressing the anchor's own square and dragging carries the WHOLE
   * formation, reported on release as the anchor's new coordinate.
   *
   * THE ANCHOR SQUARE AND NOTHING ELSE. Frankie sits on it and a drag on
   * Frankie still slides the map, as it always has — only the one tile the
   * offsets are measured from means "move all of it", and it is drawn on top
   * so that tile is what the pointer finds. A base standing on the anchor
   * keeps it: dragging a person is the more common thing to mean. */
  onMoveAnchor?: (to: Coordinate) => void;
  /** Whether the whole formation fits with the anchor on `to`. Asked while
   * dragging so the ghosts can refuse before the drop. */
  canAnchorAt?: (to: Coordinate) => boolean;
  /** Given, a handle off the grid's bottom-right corner resizes it, reported
   * as the grid's new width in CSS pixels — or null, on a double-click, to
   * hand the size back to the page. The caller owns the size and lays the
   * page out round it; the grid only draws the handle. */
  onResize?: (width: number | null) => void;
  /** Controls laid over the grid's corners: the view buttons and the colour
   * key. Each panel takes the pointer; the ground between them stays the
   * grid's. */
  overlay?: ReactNode;
  /** Given, the shape a click would put down, drawn under the pointer as it
   * moves — so a stamp is aimed rather than guessed. The click itself still
   * arrives through `onPick`. */
  stampGhosts?: (at: Coordinate) => readonly StampGhost[];
  busy?: boolean;
}) {
  const surfaceRef = useRef<HTMLElement | null>(null);
  const surfaceWidth = useWidthOf(surfaceRef);
  // Pixels per tile, which is what decides whether a caption or a grid line
  // can be read — not how many tiles are across, now that the same number of
  // tiles can be drawn 300px or 1,500px wide. Unmeasured (the first paint, and
  // jsdom), the old rule: captions up to 69 tiles across, lines always.
  const tilePx = surfaceWidth === 0 ? null : surfaceWidth / view.across;
  // A caption is clipped to its own footprint and footprints never overlap, so
  // names cannot run together into the grey mass MapCanvas guards against —
  // and hiding them early meant a member zoomed out to see the whole hive
  // could find nobody but themselves.
  const roomForCaptions = tilePx === null ? view.across <= 69 : tilePx >= CAPTION_MIN_TILE_PX;
  const dense = tilePx !== null && tilePx < LINES_MIN_TILE_PX;

  const [drag, setDrag] = useState<Drag | null>(null);
  const [region, setRegion] = useState<{ from: Coordinate; to: Coordinate } | null>(null);
  // Where a member being dragged in from the list would land, while they are
  // over the grid.
  const [incoming, setIncoming] = useState<{ at: Coordinate; allowed: boolean } | null>(null);
  // The tile under a pointer that is only hovering, while a stamp is armed.
  const [hover, setHover] = useState<Coordinate | null>(null);
  // The anchor being carried: where it would land, and whether it may.
  const [anchorDrag, setAnchorDrag] = useState<{
    to: Coordinate;
    moved: boolean;
    allowed: boolean;
  } | null>(null);
  // Where the last whole-tile step was emitted from, in client pixels. Held
  // rather than the gesture's origin so the steps accumulate without drift:
  // a pan of forty tiles is forty deltas, not one growing subtraction.
  const [pan, setPan] = useState<{
    x: number;
    y: number;
    moved: boolean;
    /** Started by ctrl or the middle button rather than by a press on empty
     * ground. Decides what a press that never moved means on release. */
    viaModifier: boolean;
  } | null>(null);
  // A completed drag must not also fire the click that follows pointerup.
  // A ref rather than state: it is read and cleared inside the very next
  // event, and a re-render in between would be a frame of the wrong thing.
  const swallowClick = useRef(false);
  const sweeping = onRegion !== undefined;
  const pannable = onPan !== undefined;

  /** Where each carried tile would land.
   *
   * The dragged tile alone when nothing is selected, and the whole selection
   * when the drag began on one of its members — the same rule pointerdown
   * used to decide it was a group drag in the first place.
   */
  function ghostsFor(current: Drag) {
    const byX = current.to.x - current.from.x;
    const byY = current.to.y - current.from.y;
    const held = baseUnder(current.from);
    const group =
      held?.selected === true ? bases.filter((base) => base.selected === true) : [held ?? null];
    return group.flatMap((base) =>
      base === null
        ? []
        : [
            {
              key: base.key,
              at: { x: base.at.x + byX, y: base.at.y + byY },
              spanX: base.spanX ?? BASE_SPAN,
              spanY: base.spanY ?? BASE_SPAN,
            },
          ],
    );
  }

  /** The base whose footprint covers a tile, if any. */
  const baseUnder = (tile: Coordinate) =>
    bases.find((base) => {
      const box = footprintOf(base.at, base.spanX ?? BASE_SPAN, base.spanY ?? BASE_SPAN);
      return tile.x >= box.x0 && tile.x <= box.x1 && tile.y >= box.y0 && tile.y <= box.y1;
    });

  /** Whether this press is asking to slide the view rather than to draw.
   *
   * Ctrl or the middle button, and checked BEFORE everything else — a press
   * that means "pan" must not also carry a base or start a sweep, and the
   * modifier is the only thing that distinguishes them. */
  const isPanGesture = (event: ReactPointerEvent<HTMLElement>) =>
    pannable && (event.ctrlKey || event.metaKey || event.button === 1);

  function beginPan(event: ReactPointerEvent<HTMLElement>, viaModifier: boolean) {
    // The middle button scrolls the page on Windows unless the press itself
    // is taken.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setPan({ x: event.clientX, y: event.clientY, moved: false, viaModifier });
  }

  function stepPan(event: ReactPointerEvent<HTMLElement>) {
    if (pan === null) {
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const cell = box.width / view.across;
    const cellY = box.height / view.across;
    if (cell === 0 || cellY === 0) {
      return;
    }
    // Whole tiles only. A sub-tile pan would have to move the grid's
    // background by fractions of a cell to show anything, and the window this
    // draws is defined in tiles — so the picture would not change until the
    // step landed anyway, just later and less evenly.
    const stepX = Math.round((event.clientX - pan.x) / cell);
    const stepY = Math.round((event.clientY - pan.y) / cellY);
    if (stepX === 0 && stepY === 0) {
      return;
    }
    // THE CONTENT FOLLOWS THE POINTER, which inverts x and does NOT invert y.
    // Dragging right shows ground further west, so the centre moves west;
    // dragging down shows ground further north, and map y counts upward while
    // the screen counts downward — the two flips cancel and the sign stays
    // positive.
    onPan?.(-stepX, stepY);
    setPan({ ...pan, x: pan.x + stepX * cell, y: pan.y + stepY * cellY, moved: true });
  }
  // Base dragging is off while sweeping: one gesture, one meaning.
  const draggable = onMove !== undefined && !sweeping;
  // The same rule for the anchor: an area tool owns every press, the anchor's
  // square included, so carrying the formation is a draw-mode gesture.
  const anchorGrabbable = onMoveAnchor !== undefined && !sweeping;

  // CTRL + WHEEL ZOOMS; A BARE WHEEL SCROLLS THE PAGE. The map is most of the
  // screen, so a bare-wheel zoom trapped anybody scrolling past it — the page
  // stopped and the map zoomed instead. Ctrl is also what a trackpad pinch
  // arrives as, so pinching still zooms.
  //
  // A NON-PASSIVE LISTENER, which React's onWheel is not: ctrl + wheel is the
  // browser's own page zoom, and only preventDefault on a non-passive handler
  // keeps it from zooming the whole page while the map zooms too.
  //
  // ADDED UP AND HANDED OVER ONCE A FRAME. A pinch sends several events per
  // frame; each one calling the parent read the zoom from the last render, so
  // all but one of them were lost and the pinch crawled. Summed here and sent
  // on the next frame, by which point the parent has drawn the last one.
  //
  // `onZoom` is redefined every render by the parent, so it is read through a
  // ref at the moment of sending rather than captured when the listener was
  // attached — attaching once is what lets the sum survive between events.
  const zoomRef = useRef(onZoom);
  // After every commit and before the next frame, which is when `send` reads
  // it — never during render, where React may throw the render away.
  useLayoutEffect(() => {
    zoomRef.current = onZoom;
  });
  const zoomable = onZoom !== undefined;
  useEffect(() => {
    const element = surfaceRef.current;
    if (element === null || !zoomable) {
      return;
    }
    let notches = 0;
    let at: GridFraction = { left: 0.5, top: 0.5 };
    let frame: number | null = null;
    const send = () => {
      frame = null;
      // Capped so a burst from a free-spinning wheel is a few notches, not
      // the whole range in one frame.
      const total = Math.max(-4, Math.min(4, notches));
      notches = 0;
      if (total !== 0) {
        zoomRef.current?.(total, at);
      }
    };
    const wheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      event.preventDefault();
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) {
        return;
      }
      const inside = (value: number) => Math.min(1, Math.max(0, value));
      at = {
        left: inside((event.clientX - box.left) / box.width),
        top: inside((event.clientY - box.top) / box.height),
      };
      notches += wheelNotches(event.deltaY, event.deltaMode);
      if (frame === null) {
        frame = requestAnimationFrame(send);
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', wheel);
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [zoomable]);

  /** The tile under a pointer event, or null when the box has no size yet.
   * Any event with a position will do — a drag from the member list is not a
   * pointer event, and it has to land on the same tile a click would. */
  function tileUnder(event: {
    clientX: number;
    clientY: number;
    currentTarget: HTMLElement;
  }): Coordinate | null {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) {
      return null;
    }
    return tileAtFraction(
      view,
      (event.clientX - box.left) / box.width,
      (event.clientY - box.top) / box.height,
    );
  }

  const surface = (
    <>
      {sightings.map((sighting) => (
        <span
          className={sighting.ours ? 'tile-grid__seen tile-grid__seen--ours' : 'tile-grid__seen'}
          key={sighting.key}
          style={boxStyle(view, sighting.at, BASE_SPAN)}
          title={`${sighting.name ?? 'unnamed'} was last seen at ${formatTeleport(sighting.at)}`}
        />
      ))}
      {/* THE SHAPE A CLICK WOULD STAMP, under the pointer before the click. */}
      {hover !== null &&
        stampGhosts !== undefined &&
        stampGhosts(hover).map((ghost) => (
          <span
            className={
              ghost.allowed ? 'tile-grid__ghost' : 'tile-grid__ghost tile-grid__ghost--blocked'
            }
            key={`stamp-${ghost.key}`}
            style={boxStyle(view, ghost.at, ghost.spanX, ghost.spanY)}
          />
        ))}
      {/* THE WHOLE FORMATION WHERE IT WOULD LAND. Moving the anchor moves
          every tile, so every tile gets a ghost — one ghost would say nothing
          about whether the far wing runs off the map. */}
      {anchorDrag?.moved === true &&
        bases.map((base) => (
          <span
            className={
              anchorDrag.allowed ? 'tile-grid__ghost' : 'tile-grid__ghost tile-grid__ghost--blocked'
            }
            key={`anchor-ghost-${base.key}`}
            style={boxStyle(
              view,
              shiftedAt(base.at, anchor, anchorDrag.to),
              base.spanX ?? BASE_SPAN,
              base.spanY ?? BASE_SPAN,
            )}
          />
        ))}
      {/* THE AREA BEING SWEPT. Without it a drag across forty tiles is
          invisible until it lands, and the officer is aiming at nothing. */}
      {region !== null && (
        <span
          className="tile-grid__region"
          style={rectStyle(view, boxBetween(region.from, region.to))}
        />
      )}
      {/* WHERE IT WOULD LAND, drawn while the pointer is down. Without it the
          only feedback is the base jumping on release, and a refused drop
          looks identical to a drag that did not register. */}
      {/* EVERY TILE THAT WOULD MOVE, not just the one under the pointer. A
          group drag showing one ghost says nothing about where the other
          nineteen land, which is the only question the officer has. */}
      {drag?.moved === true &&
        ghostsFor(drag).map((ghost) => (
          <span
            className={
              drag.allowed ? 'tile-grid__ghost' : 'tile-grid__ghost tile-grid__ghost--blocked'
            }
            key={ghost.key}
            style={boxStyle(view, ghost.at, ghost.spanX, ghost.spanY)}
          />
        ))}
      {/* WHERE AN INCOMING MEMBER WOULD STAND: the base they would take over,
          or the new 3x3 that would be drawn for them. */}
      {incoming !== null &&
        (() => {
          const onto = baseUnder(incoming.at);
          const ghost =
            onto !== undefined && onto.structure !== true
              ? { at: onto.at, spanX: onto.spanX ?? BASE_SPAN, spanY: onto.spanY ?? BASE_SPAN }
              : { at: incoming.at, spanX: BASE_SPAN, spanY: BASE_SPAN };
          return (
            <span
              className={
                incoming.allowed ? 'tile-grid__ghost' : 'tile-grid__ghost tile-grid__ghost--blocked'
              }
              style={boxStyle(view, ghost.at, ghost.spanX, ghost.spanY)}
            />
          );
        })()}
      {bases.map((base) => {
        const carried =
          anchorDrag?.moved === true ||
          (drag?.moved === true &&
            (base.selected === true && baseUnder(drag.from)?.selected === true
              ? true
              : base.at.x === drag.from.x && base.at.y === drag.from.y));
        const className = [
          'tile-grid__base',
          base.structure ? 'tile-grid__base--structure' : '',
          // Rank, when the page asks for it, replaces the painted colour
          // rather than fighting it: both set the fill and the border, and
          // two rules racing on one tile is how a colour silently loses.
          base.rank !== undefined
            ? `tile-grid__base--${rankClass(base.rank)}`
            : base.colour == null
              ? ''
              : `tile-grid__base--${base.colour}`,
          base.vacant ? 'tile-grid__base--vacant' : '',
          base.selected ? 'tile-grid__base--on' : '',
          base.own ? 'tile-grid__base--own' : '',
          base.stale ? 'tile-grid__base--stale' : '',
          carried ? 'tile-grid__base--carried' : '',
          // Only what a press can actually pick up. The pointerdown handler
          // below refuses to drag a structure — it is ground, not somebody's
          // place — and a `grab` cursor on Frankie promised a drag that never
          // started. Cheap to get wrong now that most structures are the
          // officer's own buildings rather than the one hardcoded centre.
          draggable && base.structure !== true ? 'tile-grid__base--draggable' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <span
            className={className}
            key={base.key}
            style={boxStyle(view, base.at, base.spanX ?? BASE_SPAN, base.spanY ?? BASE_SPAN)}
            title={`${base.caption ?? ''} ${formatTeleport(base.at)}`.trim()}
          >
            {/* NOT ON A ONE-TILE STRIP. A boundary is a line of 1x1 markers
                and reads by its colour; a caption squeezed into one square is
                a clipped letter repeated all round the edge. The label is
                still in the title for whoever hovers. */}
            {roomForCaptions &&
              base.caption !== undefined &&
              Math.min(base.spanX ?? BASE_SPAN, base.spanY ?? BASE_SPAN) > 1 && (
                <span className="tile-grid__caption">{base.caption}</span>
              )}
          </span>
        );
      })}
      {/* THE ANCHOR LAST, one square, over everything drawn on it. Under a
          base it was a square nobody could see or take hold of; on top it is
          always there to find, and a press on it is always the anchor's
          (`grabsAnchor`). */}
      <span
        className={
          anchorGrabbable ? 'tile-grid__anchor tile-grid__anchor--grab' : 'tile-grid__anchor'
        }
        style={boxStyle(view, anchorDrag?.moved === true ? anchorDrag.to : anchor, 1)}
        title={
          anchorGrabbable
            ? `Anchor — ${formatTeleport(anchor)}. Drag it to move the whole formation.`
            : `Anchor — ${formatTeleport(anchor)}`
        }
      />
    </>
  );

  const grip =
    onResize === undefined ? undefined : (
      <ResizeGrip
        max={MAP_SIZE_MAX}
        min={MAP_SIZE_MIN}
        onResize={onResize}
        target={surfaceRef}
        width={surfaceWidth}
      />
    );

  if (onPick === undefined) {
    return (
      <AxisFrame grip={grip} overlay={overlay} view={view}>
        {/* NO MODIFIER NEEDED HERE. On the read-only map a drag has nothing
            else it could mean, so plain dragging pans and ctrl still works —
            the editor needs ctrl only because a bare drag there already
            carries a base or sweeps an area. */}
        <div
          className={[
            'tile-grid',
            pan !== null ? 'tile-grid--panning' : '',
            dense ? 'tile-grid--dense' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onPointerCancel={() => setPan(null)}
          onPointerDown={(event) => {
            if (pannable && (event.button === 0 || event.button === 1)) {
              beginPan(event, false);
            }
          }}
          onPointerMove={stepPan}
          onPointerUp={() => setPan(null)}
          ref={surfaceRef as RefObject<HTMLDivElement>}
          style={{ '--tiles': view.across } as CSSProperties}
        >
          {surface}
        </div>
      </AxisFrame>
    );
  }

  // A BUTTON, NOT A DIV WITH A CLICK. The whole surface is one target and
  // what happens depends on which tile the pointer was over, so there is
  // nothing smaller to make focusable. Keyboard use is not served by
  // pressing this — Enter has no pointer position — which is why the page
  // carries a coordinate box beside the grid that does the same job. Those
  // presses arrive with `detail === 0` and are ignored rather than
  // silently placing a base in the middle.
  return (
    <AxisFrame grip={grip} overlay={overlay} view={view}>
      <button
        aria-label={[
          sweeping
            ? 'Drag out an area of tiles.'
            : draggable
              ? 'Pick a tile, or drag a base to move it.'
              : 'Pick a tile.',
          anchorGrabbable ? 'Drag the anchor square to move the whole formation.' : '',
          pannable
            ? sweeping
              ? 'Hold ctrl and drag, or drag with the middle button, to slide the map.'
              : 'Drag from empty ground, or hold ctrl, to slide the map.'
            : '',
          'The coordinate boxes beside the map do the same without a pointer.',
        ]
          .filter(Boolean)
          .join(' ')}
        className={[
          'tile-grid',
          busy ? 'tile-grid--busy' : '',
          sweeping ? 'tile-grid--sweeping' : '',
          pan !== null ? 'tile-grid--panning' : '',
          anchorDrag?.moved === true ? 'tile-grid--carrying-anchor' : '',
          dense ? 'tile-grid--dense' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={(event) => {
          // The drag already did the work and the browser fires a click after
          // the pointerup that ended it. Without this, dropping a base also
          // removes it, and sweeping an area also toggles the tile underneath.
          if (swallowClick.current) {
            swallowClick.current = false;
            return;
          }
          if (event.detail === 0) {
            return;
          }
          const tile = tileUnder(event as unknown as ReactPointerEvent<HTMLElement>);
          if (tile !== null) {
            onPick(tile);
          }
        }}
        onDragLeave={() => setIncoming(null)}
        onPointerLeave={() => setHover(null)}
        onDragOver={(event) => {
          if (onDropMember === undefined || !event.dataTransfer.types.includes(MEMBER_DRAG_TYPE)) {
            return;
          }
          // Accepting the drop at all is what preventDefault means here.
          event.preventDefault();
          const at = tileUnder(event);
          if (at === null) {
            return;
          }
          const allowed = canDropAt === undefined || canDropAt(at);
          event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
          if (incoming?.at.x !== at.x || incoming.at.y !== at.y || incoming.allowed !== allowed) {
            setIncoming({ at, allowed });
          }
        }}
        onDrop={(event) => {
          const playerId = event.dataTransfer.getData(MEMBER_DRAG_TYPE);
          setIncoming(null);
          if (onDropMember === undefined || playerId === '') {
            return;
          }
          event.preventDefault();
          const at = tileUnder(event);
          if (at !== null) {
            onDropMember(playerId, at);
          }
        }}
        onPointerCancel={() => {
          setDrag(null);
          setRegion(null);
          setPan(null);
          setAnchorDrag(null);
        }}
        onPointerDown={(event) => {
          if (isPanGesture(event)) {
            beginPan(event, true);
            return;
          }
          if (sweeping) {
            if (event.button !== 0) {
              return;
            }
            const corner = tileUnder(event);
            if (corner === null) {
              return;
            }
            // A PRESS ON SOMETHING ALREADY SELECTED CARRIES IT, and everything
            // else selected with it. That is the one gesture a selection needs
            // beyond making one, and it stays unambiguous because it can only
            // begin on ground the officer has already picked out — in a tool
            // where nothing is selected (marking, erasing) this never fires.
            const held = baseUnder(corner);
            if (held?.selected === true && onMove !== undefined) {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDrag({
                from: held.at,
                to: held.at,
                spanX: held.spanX ?? BASE_SPAN,
                spanY: held.spanY ?? BASE_SPAN,
                moved: false,
                allowed: true,
              });
              return;
            }
            // Captured for the same reason a base drag is: a sweep that starts
            // in the middle and ends past the edge of the grid is the normal
            // way to select everything down to a corner.
            event.currentTarget.setPointerCapture(event.pointerId);
            setRegion({ from: corner, to: corner });
            return;
          }
          if (event.button !== 0) {
            return;
          }
          const tile = tileUnder(event);
          if (tile === null) {
            return;
          }
          const held = baseUnder(tile);
          // THE ANCHOR FIRST, over whatever is drawn on its square — Frankie,
          // or somebody's base. Like a base drag, nothing moves until the
          // pointer does; what a press that goes nowhere means is on release.
          if (anchorGrabbable && grabsAnchor(tile, anchor)) {
            event.currentTarget.setPointerCapture(event.pointerId);
            setAnchorDrag({ to: anchor, moved: false, allowed: true });
            return;
          }
          // A press on a base MIGHT be the start of a drag. Whether it is one
          // is not known until the pointer moves, so nothing happens yet — the
          // click handler above still owns a press that goes nowhere.
          if (!draggable) {
            return;
          }
          // A structure is ground rather than somebody's place, and dragging
          // the hive's centre by accident is not a thing anybody means to do.
          if (held === undefined || held.structure === true) {
            // NOTHING TO CARRY, SO THE DRAG CAN MEAN THE MAP. A drag that starts
            // on empty ground had no meaning here at all — clicking places a
            // tile, and dragging did nothing — so panning costs nothing and is
            // what everybody tries first. The two starts are disjoint: on a base
            // the drag carries it, off one it slides the view, and neither has
            // to guess.
            //
            // Only where a drag is otherwise idle. In an area tool the same
            // press is the sweep, which is why ctrl still exists above.
            if (pannable) {
              beginPan(event, false);
            }
            return;
          }
          // Captured so the drag survives the pointer leaving the grid, which
          // it does constantly near the edges — without this a base dropped
          // half off the window is just lost.
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrag({
            from: held.at,
            to: held.at,
            spanX: held.spanX ?? BASE_SPAN,
            spanY: held.spanY ?? BASE_SPAN,
            moved: false,
            allowed: true,
          });
        }}
        onPointerMove={(event) => {
          if (pan !== null) {
            stepPan(event);
            return;
          }
          if (region !== null) {
            const corner = tileUnder(event);
            if (corner === null || (corner.x === region.to.x && corner.y === region.to.y)) {
              return;
            }
            setRegion({ ...region, to: corner });
            return;
          }
          if (anchorDrag !== null) {
            const tile = tileUnder(event);
            if (tile === null || (tile.x === anchorDrag.to.x && tile.y === anchorDrag.to.y)) {
              return;
            }
            // Whole tiles, so leaving the anchor's square at all is past the
            // threshold — and coming back to it is a drag to nowhere, not a
            // click, once it has left.
            const allowed = canAnchorAt === undefined || canAnchorAt(tile);
            setAnchorDrag({ to: tile, moved: true, allowed });
            return;
          }
          if (drag === null) {
            // Only hovering: where an armed stamp would land.
            if (stampGhosts !== undefined) {
              const over = tileUnder(event);
              if (over?.x !== hover?.x || over?.y !== hover?.y) {
                setHover(over);
              }
            }
            return;
          }
          const tile = tileUnder(event);
          if (tile === null) {
            return;
          }
          // THE THRESHOLD IS IN TILES. A press that wanders three pixels is a
          // click, and at 69 tiles across three pixels is a whole square.
          const far =
            Math.abs(tile.x - drag.from.x) + Math.abs(tile.y - drag.from.y) >= DRAG_THRESHOLD_TILES;
          const moved = drag.moved || far;
          if (!moved) {
            return;
          }
          const allowed = canMoveTo === undefined || canMoveTo(drag.from, tile);
          if (drag.moved === moved && drag.to.x === tile.x && drag.to.y === tile.y) {
            return;
          }
          setDrag({ ...drag, to: tile, moved, allowed });
        }}
        onPointerUp={(event) => {
          if (pan !== null) {
            // A PRESS THAT NEVER MOVED IS STILL A CLICK, and that distinction is
            // the whole reason `viaModifier` is carried. Plain-drag panning
            // starts on the same press that places a tile, so swallowing it
            // unconditionally would stop clicking on empty ground from working
            // at all. A ctrl-press is different: it was never going to place
            // anything, so it is swallowed whether it moved or not.
            if (pan.moved || pan.viaModifier) {
              swallowClick.current = true;
            }
            setPan(null);
            return;
          }
          if (region !== null) {
            const corner = tileUnder(event) ?? region.to;
            setRegion(null);
            // A press and release on one tile is a box of one — a marker on
            // that square — so there is no threshold here and nothing to
            // forward to the click handler. Swallowed so the click does not
            // then toggle the same tile straight back off.
            swallowClick.current = true;
            onRegion?.(boxBetween(region.from, corner));
            return;
          }
          if (anchorDrag !== null) {
            setAnchorDrag(null);
            if (!anchorDrag.moved) {
              // A CLICK ON THE ANCHOR IS THE ANCHOR'S when something is drawn
              // over it: it must not fall through and take away the base it
              // sits on. Free ground under it still takes the click, so a tile
              // can be put down centred on the anchor.
              if (baseUnder(anchor) !== undefined) {
                swallowClick.current = true;
              }
              return;
            }
            swallowClick.current = true;
            const to = anchorDrag.to;
            if (anchorDrag.allowed && (to.x !== anchor.x || to.y !== anchor.y)) {
              onMoveAnchor?.(to);
            }
            return;
          }
          if (drag === null) {
            return;
          }
          setDrag(null);
          if (!drag.moved) {
            // Never left the tile it started on: still a click, and the click
            // handler is about to run.
            return;
          }
          swallowClick.current = true;
          const tile = tileUnder(event) ?? drag.to;
          if (drag.allowed && (tile.x !== drag.from.x || tile.y !== drag.from.y)) {
            onMove?.(drag.from, tile);
          }
        }}
        ref={surfaceRef as RefObject<HTMLButtonElement>}
        style={{ '--tiles': view.across } as CSSProperties}
        type="button"
      >
        {surface}
      </button>
    </AxisFrame>
  );
}
