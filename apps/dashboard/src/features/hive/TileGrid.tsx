import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  BASE_SPAN,
  type FootprintBox,
  type TileColour,
  boxBetween,
  footprintOf,
} from '../../lib/hiveFormation';
import { type Coordinate, MAP_MAX, MAP_MIN, formatCoordinate } from '../../lib/mapProjection';

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

/** How wide the window can be, in tiles either side of the centre.
 *
 * Shared by both grids so the member's picture and the officer's editor zoom
 * through the same steps — and so "45 tiles" means one thing in the app. The
 * middle two are where a hive is drawn; the widest is for finding somewhere
 * to put it and the closest for the last tile of an awkward corner.
 */
export const ZOOM_STEPS = [8, 14, 22, 34] as const;

/** The step one notch in or out from `radius`, clamped at both ends.
 *
 * `direction` is +1 for CLOSER, which is a smaller radius and therefore a
 * lower index — the list runs outward. Getting that backwards does not throw;
 * it just makes the wheel do the opposite of what every map does, which is
 * how it was found.
 */
export function zoomStep(radius: number, direction: number): number {
  const index = ZOOM_STEPS.indexOf(radius as (typeof ZOOM_STEPS)[number]);
  const from = index === -1 ? 1 : index;
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, from - direction))] ?? radius;
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
  /** Given, the wheel zooms. `direction` is +1 to go closer, and `at` is the
   * tile under the pointer — the caller re-centres on it so the square being
   * looked at stays under the cursor instead of sliding away. */
  onZoom?: (direction: number, at: Coordinate) => void;
  busy?: boolean;
}) {
  // Captions are dropped once a tile is too small to hold one. The same rule
  // MapCanvas follows with its labels: text that overlaps into a grey mass
  // hides the squares underneath, which are the part carrying the answer.
  const roomForCaptions = view.across <= 45;

  const [drag, setDrag] = useState<Drag | null>(null);
  const [region, setRegion] = useState<{ from: Coordinate; to: Coordinate } | null>(null);
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
  const surfaceRef = useRef<HTMLElement | null>(null);
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
    if (cell === 0) {
      return;
    }
    // Whole tiles only. A sub-tile pan would have to move the grid's
    // background by fractions of a cell to show anything, and the window this
    // draws is defined in tiles — so the picture would not change until the
    // step landed anyway, just later and less evenly.
    const stepX = Math.round((event.clientX - pan.x) / cell);
    const stepY = Math.round((event.clientY - pan.y) / cell);
    if (stepX === 0 && stepY === 0) {
      return;
    }
    // THE CONTENT FOLLOWS THE POINTER, which inverts x and does NOT invert y.
    // Dragging right shows ground further west, so the centre moves west;
    // dragging down shows ground further north, and map y counts upward while
    // the screen counts downward — the two flips cancel and the sign stays
    // positive.
    onPan?.(-stepX, stepY);
    setPan({ ...pan, x: pan.x + stepX * cell, y: pan.y + stepY * cell, moved: true });
  }
  // Base dragging is off while sweeping: one gesture, one meaning.
  const draggable = onMove !== undefined && !sweeping;

  // WHEEL ZOOM NEEDS A NON-PASSIVE LISTENER, which React's onWheel is not.
  // Without preventDefault the page scrolls at the same time and the map
  // leaves the screen while you are trying to look closer at it — so the
  // handler is attached by hand, and removed with the element.
  //
  // The dependency list is the whole closure it reads. `onZoom` is redefined
  // every render by the parent, which is why this re-attaches rather than
  // capturing a stale `view`.
  useEffect(() => {
    const element = surfaceRef.current;
    const zoom = onZoom;
    if (element === null || zoom === undefined) {
      return;
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) {
        return;
      }
      const at = tileAtFraction(
        view,
        (event.clientX - box.left) / box.width,
        (event.clientY - box.top) / box.height,
      );
      zoom(event.deltaY < 0 ? 1 : -1, at);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [onZoom, view]);

  /** The tile under a pointer event, or null when the box has no size yet. */
  function tileUnder(event: ReactPointerEvent<HTMLElement>): Coordinate | null {
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
          title={`${sighting.name ?? 'unnamed'} was last seen at ${formatCoordinate(sighting.at)}`}
        />
      ))}
      <span
        className="tile-grid__anchor"
        style={boxStyle(view, anchor, 1)}
        title={`Anchor — ${formatCoordinate(anchor)}`}
      />
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
      {bases.map((base) => {
        const carried =
          drag?.moved === true &&
          (base.selected === true && baseUnder(drag.from)?.selected === true
            ? true
            : base.at.x === drag.from.x && base.at.y === drag.from.y);
        const className = [
          'tile-grid__base',
          base.structure ? 'tile-grid__base--structure' : '',
          base.colour == null ? '' : `tile-grid__base--${base.colour}`,
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
            title={`${base.caption ?? ''} ${formatCoordinate(base.at)}`.trim()}
          >
            {roomForCaptions && base.caption !== undefined && (
              <span className="tile-grid__caption">{base.caption}</span>
            )}
          </span>
        );
      })}
    </>
  );

  if (onPick === undefined) {
    return (
      // NO MODIFIER NEEDED HERE. On the read-only map a drag has nothing else
      // it could mean, so plain dragging pans and ctrl still works — the
      // editor needs ctrl only because a bare drag there already carries a
      // base or sweeps an area.
      <div
        className={pan !== null ? 'tile-grid tile-grid--panning' : 'tile-grid'}
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
    );
  }

  return (
    // A BUTTON, NOT A DIV WITH A CLICK. The whole surface is one target and
    // what happens depends on which tile the pointer was over, so there is
    // nothing smaller to make focusable. Keyboard use is not served by
    // pressing this — Enter has no pointer position — which is why the page
    // carries a coordinate box beside the grid that does the same job. Those
    // presses arrive with `detail === 0` and are ignored rather than
    // silently placing a base in the middle.
    <button
      aria-label={[
        sweeping
          ? 'Drag out an area of tiles.'
          : draggable
            ? 'Pick a tile, or drag a base to move it.'
            : 'Pick a tile.',
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
      onPointerCancel={() => {
        setDrag(null);
        setRegion(null);
        setPan(null);
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
        // A press on a base MIGHT be the start of a drag. Whether it is one
        // is not known until the pointer moves, so nothing happens yet — the
        // click handler above still owns a press that goes nowhere.
        if (!draggable || event.button !== 0) {
          return;
        }
        const tile = tileUnder(event);
        if (tile === null) {
          return;
        }
        const held = baseUnder(tile);
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
        if (drag === null) {
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
  );
}
