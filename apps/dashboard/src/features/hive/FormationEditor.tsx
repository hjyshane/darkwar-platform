import type { Coordinate } from '@dw/ui';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { Select } from '../../components/ui/Select';
import {
  type AssignOrder,
  type AssignableMember,
  BASE_SPAN,
  type FootprintBox,
  MAX_TILES,
  type Offset,
  type SizedOffset,
  type TileColour,
  type TileKind,
  absoluteOf,
  assignOrderLabel,
  autoAssign,
  boxArea,
  canMoveGroup,
  canPlace,
  footprintOf,
  formatTeleport,
  freeTilesIn,
  isMemberBase,
  memberNumbering,
  offsetKey,
  outlineTilesIn,
  ringOf,
  ringOrderAround,
  shiftedBy,
  sortMembers,
  sortSlots,
  tileCaption,
  tileFitsOnMap,
  tileInsideBox,
  tilesOverlap,
} from '../../lib/hiveFormation';
import { rich, useT } from '../../lib/i18n';
import { type Translate, english } from '../../lib/i18n/core';
import { shareCoordinate } from '../../lib/shareCoordinate';
import { EditorToolbar } from './EditorToolbar';
import { ConflictBanner, Stamp } from './HiveStamp';
import { MapKey, MapNav, type RankEntry, rankTally } from './MapControls';
import { PanelDivider } from './PanelDivider';
import {
  type GridBase,
  type GridSighting,
  MEMBER_DRAG_TYPE,
  TileGrid,
  ZOOM_DEFAULT,
  centreKeeping,
  pannedCentre,
  rankClass,
  windowAround,
  windowFitting,
  windowRadius,
  zoomedBy,
} from './TileGrid';
import {
  type BoardSlot,
  type Formation,
  type FormationTemplate,
  type LayoutTile,
  type MapFeature,
  createMapFeature,
  deleteMapFeature,
  deleteTemplate,
  fetchTemplateTiles,
  moveFormation,
  reanchorFormation,
  saveFormation,
  saveTemplate,
  useMapFeatures,
  useOccupiedTiles,
  useTemplates,
} from './hiveFormations';
import {
  PlanDeletedError,
  StaleSaveError,
  boardVersionOf,
  draftStatus,
  peopleByOffset,
} from './hiveSafety';
import {
  PANEL_WIDTH_DEFAULT,
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN,
  clampMapSize,
  clampPanelWidth,
  mapSizeProps,
  panelWidthStyle,
  setMapPrefs,
  useMapPrefs,
} from './mapPrefs';
import {
  PALETTE_SORTS,
  type PaletteRow,
  type PaletteSort,
  groupRows,
  paletteRows,
  placedTiles,
  shortPower,
} from './memberPalette';
import {
  BUILT_IN_SHAPES,
  type StampShape,
  shapeFromTemplate,
  shapeLabel,
  stampPlan,
  stampSummary,
} from './shapeStamp';

/** A tile in the draft, identified by where it is.
 *
 * IT CARRIES THE ID OF THE SAVED SLOT IT CAME FROM, and through that its
 * member. Who stands where lives in ONE place — `assignments`, keyed by slot
 * id — and a moved tile finds its member there by the id it brought along.
 *
 * It used to carry the member itself, copied from the board when the draft
 * was read. That copy was the saved state, so a member handed a tile by Fill
 * or the dropdown was not on it: drag the base and the caption fell back to a
 * number, and saving the moved shape put the OLD occupant back — or nobody.
 * Two copies of one fact, and the one that travelled was the stale one.
 *
 * Null for a tile drawn since the board was read, which has nobody on it yet.
 */
export interface DraftSlot extends SizedOffset {
  ordinal: number;
  label: string;
  kind: TileKind;
  colour: TileColour | null;
  slotId: string | null;
}

/** Where everybody ends up once a draft is written out, by the offset they
 * will stand on.
 *
 * Read through each tile's slot id rather than by position, which is the
 * point: a base that was dragged is somewhere its slot never was, and a
 * position-keyed lookup finds nobody there. The same goes for its pin — a pin
 * is a decision about a person, and the person moved with the square.
 */
export function placementsOf(
  tiles: readonly (Offset & { slotId: string | null })[],
  assignments: ReadonlyMap<string, string>,
  pinned: ReadonlyMap<string, string>,
): Map<string, { playerId: string; pinned: boolean }> {
  return new Map(
    tiles.flatMap((tile) => {
      const playerId = tile.slotId === null ? undefined : assignments.get(tile.slotId);
      return playerId === undefined || tile.slotId === null
        ? []
        : [[offsetKey(tile), { playerId, pinned: pinned.get(tile.slotId) === playerId }] as const];
    }),
  );
}

/** A slot id for a tile that has not been saved yet.
 *
 * `assignments` is keyed by slot id, and a base drawn by dropping somebody on
 * empty ground has none until the layout is written. A stand-in lets the
 * member ride on it like any other tile — `placementsOf` reads it by that key
 * and the save maps it to the real id by where the tile stands. The prefix is
 * what tells one apart from an id the database gave out.
 */
function draftSlotId(): string {
  return `draft:${crypto.randomUUID()}`;
}

/** What dropping a member on a tile would do.
 *
 * ONTO A MEMBER'S BASE, it hands them that base. ON FREE GROUND, it draws a
 * new 3x3 for them there, centred on the tile under the pointer, exactly as a
 * click would. Anything else — a structure, ground a new base would overlap,
 * the edge of the map — is refused, with the reason the officer needs to aim
 * again.
 */
export type DropTarget =
  | { kind: 'onto'; key: string }
  | { kind: 'new'; tile: SizedOffset }
  | { kind: 'refused'; reason: string };

export function dropTarget(
  drawn: readonly DraftSlot[],
  anchor: Coordinate,
  at: Coordinate,
  t: Translate = english,
): DropTarget {
  const hit = drawn.find((slot) => {
    const box = footprintOf(absoluteOf(anchor, slot), slot.spanX, slot.spanY);
    return at.x >= box.x0 && at.x <= box.x1 && at.y >= box.y0 && at.y <= box.y1;
  });
  if (hit !== undefined) {
    return isMemberBase(hit)
      ? { kind: 'onto', key: offsetKey(hit) }
      : {
          kind: 'refused',
          reason:
            hit.label === ''
              ? t('That tile is ground, not a base — nobody can stand on it.')
              : t('{label} is ground, not a base — nobody can stand on it.', { label: hit.label }),
        };
  }
  const tile: SizedOffset = {
    dx: at.x - anchor.x,
    dy: at.y - anchor.y,
    spanX: BASE_SPAN,
    spanY: BASE_SPAN,
  };
  if (!tileFitsOnMap(at, BASE_SPAN, BASE_SPAN)) {
    return {
      kind: 'refused',
      reason: t('A base centred on {coordinate} would need ground off the edge of the map.', {
        coordinate: formatTeleport(at),
      }),
    };
  }
  if (!canPlace(drawn, tile)) {
    const clash = drawn.find((slot) => tilesOverlap(slot, tile));
    return {
      kind: 'refused',
      reason:
        clash === undefined
          ? t('That ground is taken.')
          : t(
              'A base there would share ground with the tile at {coordinate}. Drop them on a base, or on free ground.',
              { coordinate: formatTeleport(absoluteOf(anchor, clash)) },
            ),
    };
  }
  return { kind: 'new', tile };
}

/** What the next click puts down.
 *
 * A BRUSH RATHER THAN A MODE. Size, kind and colour are the three things a
 * tile has beyond its position, so they are chosen once and then clicked out
 * — which is also why 3x3 stays the default: it is what almost every click
 * places, and the officer only touches this to draw a structure or a marker.
 */
export interface Brush {
  spanX: number;
  spanY: number;
  kind: TileKind;
  colour: TileColour | null;
  /** Written onto the tile as its caption when the brush came from the
   * catalogue. COPIED, not referenced: renaming 'Depot' later must not go
   * back and relabel ground an officer has already sent people to. */
  label: string;
}

/** The pins still worth keeping once the board has been re-read.
 *
 * EVERY SAVE RE-READS THE BOARD, and this used to be the moment every pin was
 * thrown away — so an officer who had pinned twenty people found them all
 * loose again the instant they pressed Save, which is the opposite of what a
 * pin is for.
 *
 * A pin is dropped only where it has stopped meaning anything: the tile is
 * gone — a moved tile is deleted and reinserted under a new id, so a pin on it
 * cannot follow — or somebody else is standing there now, which makes the pin
 * a plan for a placement that no longer exists.
 */
export function survivingPins(
  pinned: ReadonlyMap<string, string>,
  slots: readonly { slotId: string; playerId: string | null }[],
): Map<string, string> {
  const live = new Map(slots.map((slot) => [slot.slotId, slot.playerId]));
  return new Map([...pinned].filter(([slotId, playerId]) => live.get(slotId) === playerId));
}

/** The draft with every selected tile given a colour.
 *
 * RECOLOURING IS NOT REPLACING. A click on a tile takes it out, so the only
 * way to change a base's colour used to be to delete it and put a new one
 * down — which loses the member standing on it, their pin, and the slot id
 * that ties the row in the table to the square on the map. Painting keeps all
 * three: it is the same tile, in a different colour.
 *
 * Keyed by offset, like everything else in the draft, so a tile that has
 * never been saved paints exactly like one that has.
 */
export function paintedTiles(
  draft: ReadonlyMap<string, DraftSlot>,
  selection: ReadonlySet<string>,
  colour: TileColour | null,
): Map<string, DraftSlot> {
  const next = new Map(draft);
  for (const key of selection) {
    const held = next.get(key);
    if (held !== undefined && held.colour !== colour) {
      next.set(key, { ...held, colour });
    }
  }
  return next;
}

/** A member as one line: who they are, how senior, how strong.
 *
 * The inner ring is picked by hand, and the question being answered while the
 * dropdown is open is "who are my R4s" — which a bare name cannot answer and
 * which sent the officer off to the roster tab to find out.
 *
 * Power is abbreviated because the exact figure is not the point here; the
 * ordering is, and three significant figures is enough to see it.
 */
function memberLabel(member: AssignableMember, t: Translate = english): string {
  const rank = member.memberRank === null ? '' : `R${member.memberRank}`;
  const extra = [rank, shortPower(member.power)].filter(Boolean).join(' · ');
  const name = member.name ?? t('unnamed');
  return extra === '' ? name : `${name} (${extra})`;
}

/** What a drag does. Clicking a tile places or removes one in every mode. */
export type Tool = 'draw' | 'mark' | 'outline' | 'erase' | 'select';

const ORDERS: readonly AssignOrder[] = ['power', 'hq', 'rank', 'name'];

function draftFromBoard(slots: readonly BoardSlot[]): Map<string, DraftSlot> {
  return new Map(
    slots.map((slot) => [
      offsetKey(slot),
      {
        dx: slot.dx,
        dy: slot.dy,
        spanX: slot.spanX,
        spanY: slot.spanY,
        kind: slot.kind,
        colour: slot.colour,
        ordinal: slot.ordinal,
        label: slot.label,
        slotId: slot.slotId,
      },
    ]),
  );
}

/** Whether every tile of a drawn shape stays on the map with the anchor on
 * `anchor`. Asked before an anchor move is sent so the officer is told where they are aiming rather than handed
 * the database's refusal naming one tile afterwards. */
export function formationFitsAt(anchor: Coordinate, tiles: readonly SizedOffset[]): boolean {
  return tiles.every((tile) => tileFitsOnMap(absoluteOf(anchor, tile), tile.spanX, tile.spanY));
}

/** The draft measured from a new anchor: every tile where it stood, its offset
 * moved the other way — what 0339 does to the saved rows, done to the draft
 * in the same render the anchor changes, so the map never draws the old
 * offsets from the new anchor (the whole shape jumping by the difference). */
export function reanchoredDraft(
  draft: ReadonlyMap<string, DraftSlot>,
  from: Coordinate,
  to: Coordinate,
): Map<string, DraftSlot> {
  const byX = from.x - to.x;
  const byY = from.y - to.y;
  return new Map(
    [...draft.values()].map((slot) => {
      const moved = shiftedBy(slot, byX, byY);
      return [offsetKey(moved), moved];
    }),
  );
}

/** The drawn tile whose footprint covers `tile`, if any: what a click while
 * choosing an anchor lands on. */
export function tileUnderPointer(
  drawn: readonly DraftSlot[],
  anchor: Coordinate,
  tile: Coordinate,
): DraftSlot | undefined {
  return drawn.find((slot) => {
    const box = footprintOf(absoluteOf(anchor, slot), slot.spanX, slot.spanY);
    return tile.x >= box.x0 && tile.x <= box.x1 && tile.y >= box.y0 && tile.y <= box.y1;
  });
}

/** Whether a refetched board is the SAME saved shape, tile for tile.
 *
 * The board's rows carry each tile's absolute x and y, which the view works
 * out from the anchor — so moving the anchor hands back new rows for a layout
 * that has not changed at all. Judged by identity, that refetch looked like
 * somebody else's save and threw the draft away: a template loaded to be
 * positioned, the documented reason to move the anchor, vanished the moment
 * the anchor moved. Offsets, sizes, labels AND slot ids have to agree; a save
 * deletes and reinserts, so new ids mean new rows even for an identical
 * shape, and a draft holding the old ids would assign people to tiles that
 * no longer exist. */
export function sameSavedShape(a: Map<string, DraftSlot>, b: Map<string, DraftSlot>): boolean {
  if (!sameLayout(a, b)) {
    return false;
  }
  for (const [key, slot] of a) {
    if (b.get(key)?.slotId !== slot.slotId) {
      return false;
    }
  }
  return true;
}

/** Whether two reads of the board put the same people on the same tiles, pins
 * included. The assignment half's version of `sameSavedShape`, for the same
 * refetch: an anchor move rewrites every row's coordinates and nobody's
 * place, so it must not reset who the officer has been moving around. */
export function sameOccupancy(a: readonly BoardSlot[], b: readonly BoardSlot[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const before = new Map(a.map((slot) => [slot.slotId, slot]));
  return b.every((slot) => {
    const was = before.get(slot.slotId);
    return was !== undefined && was.playerId === slot.playerId && was.pinned === slot.pinned;
  });
}

function sameLayout(a: Map<string, DraftSlot>, b: Map<string, DraftSlot>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [key, slot] of a) {
    const other = b.get(key);
    if (
      other === undefined ||
      other.ordinal !== slot.ordinal ||
      other.label !== slot.label ||
      other.spanX !== slot.spanX ||
      other.spanY !== slot.spanY ||
      other.kind !== slot.kind ||
      other.colour !== slot.colour
    ) {
      return false;
    }
  }
  return true;
}

/** Draw the shape, then fill it.
 *
 * TWO STEPS IN THAT ORDER, AND THE ORDER IS FORCED BY THE DATA. A tile has no
 * id until it has been saved, and an assignment names a tile by its id — so
 * there is nothing to assign a member to while the shape is still a draft.
 * Rather than invent client-side ids that would have to be reconciled, the
 * assignment half simply says "save the shape first". That also means an
 * officer never assigns eighty people to ground they then move.
 */
export function FormationEditor({
  formation,
  slots,
  members,
  ownPlayerId,
  half,
}: {
  formation: Formation;
  slots: readonly BoardSlot[];
  members: readonly AssignableMember[];
  ownPlayerId: string | null;
  /** Which half is on screen. Both stay mounted — they share one unsaved
   * draft and one Save — and the other is only hidden. */
  half: 'shape' | 'people';
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const saved = useMemo(() => draftFromBoard(slots), [slots]);
  // Keyed by the version of the saved layout it was seeded from, so a
  // refetch after a save replaces the draft rather than leaving the old one
  // on screen looking unsaved. Reconciled with each arriving board further
  // down, once the people's state exists too — see "WHEN A BOARD ARRIVES".
  const [draftFor, setDraftFor] = useState<Map<string, DraftSlot>>(saved);
  const [draft, setDraft] = useState<Map<string, DraftSlot>>(saved);
  // WHICH VERSION OF THE PLAN THE DRAFT WAS BUILT FROM (0330). A save names
  // it, and is refused if somebody else has saved since. It moves forward
  // when a newer board is taken in, and to whatever this officer's own save
  // returns — never to a newer board while there are unsaved changes, which
  // is what keeps those changes from being saved over somebody else's.
  const boardVersion = boardVersionOf(slots, formation.version);
  const [baseVersion, setBaseVersion] = useState<number>(boardVersion);

  const [centre, setCentre] = useState<Coordinate>({ x: formation.anchorX, y: formation.anchorY });
  // The same reset the draft gets above. The centre is seeded from the anchor
  // once, so moving the anchor used to leave the view on the OLD ground while
  // the marker and every tile — all offsets from the anchor — jumped away to
  // the new one, and the officer had to drag around looking for their own
  // formation. Following the anchor is what the seed already promised.
  const [anchorFor, setAnchorFor] = useState<Coordinate>({
    x: formation.anchorX,
    y: formation.anchorY,
  });
  if (anchorFor.x !== formation.anchorX || anchorFor.y !== formation.anchorY) {
    setAnchorFor({ x: formation.anchorX, y: formation.anchorY });
    setCentre({ x: formation.anchorX, y: formation.anchorY });
  }
  // WHERE THE ANCHOR IS GOING, while the write is in flight. The view is sent
  // to the new ground at once; without this the formation stayed behind at the
  // old anchor until the board refetched, so for a moment the officer was
  // looking at empty ground and the move read as having failed.
  const [pendingAnchor, setPendingAnchor] = useState<Coordinate | null>(null);
  // A fraction, like the members' picture: see `windowRadius`.
  const [zoom, setZoom] = useState<number>(ZOOM_DEFAULT);
  const prefs = useMapPrefs();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [brush, setBrush] = useState<Brush>({
    spanX: BASE_SPAN,
    spanY: BASE_SPAN,
    kind: 'base',
    colour: null,
    label: '',
  });
  // A shape being added to the catalogue takes its size, kind and colour
  // from the brush, so the only thing left to type is what it is called.
  const [featureName, setFeatureName] = useState('');
  const [templateName, setTemplateName] = useState('');
  // What a drag on the map means. One gesture cannot mean two things, so
  // carrying a base and sweeping out an area are modes rather than a guess
  // about intent — see TileGrid's `onRegion`.
  const [tool, setTool] = useState<Tool>('draw');
  // A shape picked up to be stamped: while it is held, a click on the map
  // puts it down there instead of placing one tile (`shapeStamp`).
  const [armed, setArmed] = useState<StampShape | null>(null);
  // Choosing a new anchor by clicking something on the map: the next click
  // on a base or a structure puts the anchor on it.
  const [pickingAnchor, setPickingAnchor] = useState(false);
  // Esc puts either away, wherever the focus is — the officer's eyes are on
  // the map, not on the button they started from.
  const holding = armed !== null || pickingAnchor;
  useEffect(() => {
    if (!holding) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setArmed(null);
        setPickingAnchor(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [holding]);
  // The tiles a box-select picked out, by offset key. Kept as keys rather
  // than as slots so a selected tile that then MOVES stays selected under its
  // new key — the group drag rewrites the whole set, and holding stale slot
  // objects would leave the selection pointing at ground nobody is on.
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [order, setOrder] = useState<AssignOrder>('power');
  // How the table is STACKED, which is not how the tiles are handed out.
  // Alphabetical by default: the list is read to find a person far more often
  // than to walk the fill, and the fill order is still the `#` column.
  const [tableSort, setTableSort] = useState<'name' | 'tile'>('name');
  // slot id -> player id. Seeded from what is saved, so opening the screen
  // and saving without touching anything is a no-op rather than a wipe.
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map());
  const [assignmentsFor, setAssignmentsFor] = useState<readonly BoardSlot[]>([]);
  const [pinned, setPinned] = useState<Map<string, string>>(new Map());
  const [memberQuery, setMemberQuery] = useState('');
  // How the member list beside the map is stacked, and whether the placed
  // are in it. Its own, not the fill order's: see `paletteRows`.
  const [paletteSort, setPaletteSort] = useState<PaletteSort>('name');
  const [hidePlaced, setHidePlaced] = useState(false);
  // Grouped under R5..R1 headings unless asked otherwise: officers place by
  // rank first.
  const [groupByRank, setGroupByRank] = useState(true);
  // Which tab of the panel beside the map is open. Members first: placing
  // people is what the panel is opened for most.
  const [panelTab, setPanelTab] = useState<'members' | 'tools'>('members');
  const panelId = useId();

  /** The people as the board has them, pins included. */
  function seedPeople() {
    setAssignments(
      new Map(
        slots.flatMap((slot) => (slot.playerId === null ? [] : [[slot.slotId, slot.playerId]])),
      ),
    );
    // PINS SURVIVE THE REFETCH, which is the whole reason they were being
    // lost: every save re-reads the board, and wiping them here meant an
    // officer who had pinned twenty people found them all loose again the
    // moment they pressed Save.
    //
    // Dropped only where they no longer mean anything — the tile is gone (a
    // moved tile is deleted and reinserted under a new id), or somebody else
    // is standing on it now, in which case the pin is a plan for a placement
    // that no longer exists.
    // FROM THE ROW, not from what this browser happened to remember (0174).
    // A reload used to lose every pin; the board now carries them, so the
    // officer who set them last is the one this agrees with.
    //
    // Merged with what is held here rather than replaced outright, because a
    // pin set since the last save has not reached the row yet and dropping it
    // on the refetch would be the old bug in a new place.
    setPinned((was) => {
      const fromBoard = new Map(
        slots.flatMap((slot) =>
          slot.pinned && slot.playerId !== null ? [[slot.slotId, slot.playerId] as const] : [],
        ),
      );
      return new Map([...survivingPins(was, slots), ...fromBoard]);
    });
  }

  // WHEN A BOARD ARRIVES (0330).
  //
  // This used to replace the draft whenever the saved shape changed, which
  // was right after this officer's own save and silently wrong after anybody
  // else's: twenty minutes of unsaved drawing vanished the moment another
  // officer pressed Save. Now the board's version decides (`draftStatus`):
  //
  // - the version this draft was built from, or the one this officer's own
  //   save returned: today's rules, unchanged — an anchor move keeps the
  //   draft (`sameSavedShape`, `sameOccupancy`), a save of ours replaces it;
  // - newer, with nothing unsaved here: take it quietly;
  // - newer, with unsaved changes: KEEP THEM. They cannot be saved over the
  //   newer plan; the banner by Save says so and offers to load it.
  //
  // "Unsaved" is judged against what the draft and the people were built
  // from, not against the board that just arrived. And nothing is judged
  // while this officer's own save is in flight: its refresh can land before
  // the save's answer has moved `baseVersion`, and would read as somebody
  // else's.
  const saving = useIsMutating({ mutationKey: ['hive', 'save', formation.formationId] }) > 0;
  if (!saving && (draftFor !== saved || assignmentsFor !== slots || boardVersion !== baseVersion)) {
    const unsavedBefore =
      !sameLayout(draft, draftFor) ||
      assignmentsFor.some((slot) => (assignments.get(slot.slotId) ?? null) !== slot.playerId);
    const arriving = draftStatus({ unsaved: unsavedBefore, baseVersion, boardVersion });
    if (arriving === 'behind') {
      setBaseVersion(boardVersion);
    }
    const keep = arriving === 'conflict';
    if (draftFor !== saved) {
      setDraftFor(saved);
      if (!keep && !sameSavedShape(draftFor, saved)) {
        setDraft(saved);
      }
    }
    if (assignmentsFor !== slots) {
      setAssignmentsFor(slots);
      // Not on an anchor move either — see sameOccupancy.
      if (!keep && !sameOccupancy(assignmentsFor, slots)) {
        seedPeople();
      }
    }
  }
  // Somebody else saved while there were unsaved changes here.
  const conflicted = !saving && boardVersion > baseVersion;

  /** Drop what is unsaved here and take the newer plan. */
  function loadNewVersion() {
    setDraft(saved);
    setDraftFor(saved);
    setAssignmentsFor(slots);
    setPinned(new Map());
    seedPeople();
    setBaseVersion(boardVersion);
    setRefusal(null);
  }

  const anchor: Coordinate = pendingAnchor ?? { x: formation.anchorX, y: formation.anchorY };
  const view = windowAround(centre, windowRadius(zoom));
  const drawn = [...draft.values()];
  const structures = drawn.filter((slot) => slot.kind === 'structure');
  const byRing = ringOrderAround(structures);
  const dirty = !sameLayout(draft, saved);
  // Whether anybody has been moved since the board was read. The shape and
  // the people are saved by two different calls, and one button now covers
  // both, so it has to know which of them actually has something to write.
  const assignmentsDirty =
    slots.length > 0 &&
    slots.some((slot) => (assignments.get(slot.slotId) ?? null) !== slot.playerId);
  const unsaved = dirty || assignmentsDirty;

  /** The draft in the order it will be numbered.
   *
   * ONE ORDERING, USED BY BOTH THINGS THAT WRITE THE DRAFT OUT. The ordinal
   * drives who is handed a tile first, so a shape saved as a template has to
   * be numbered by the same rule the formation is — otherwise loading a saved
   * shape back would quietly reorder the fill, and the innermost ring would
   * stop being the one that gets the strongest members.
   *
   * Member bases come first, everything else after: ground is never handed
   * to anybody, and numbering the people's tiles 1..n with nothing in
   * between is what keeps the table's # matching the caption on the map.
   */
  function orderedDraft(): (LayoutTile & { slotId: string | null })[] {
    return [...draft.values()]
      .sort((a, b) =>
        isMemberBase(a) === isMemberBase(b) ? byRing(a, b) : isMemberBase(a) ? -1 : 1,
      )
      .map((slot, index) => ({
        dx: slot.dx,
        dy: slot.dy,
        ordinal: index + 1,
        label: slot.label,
        span_x: slot.spanX,
        span_y: slot.spanY,
        kind: slot.kind,
        colour: slot.colour,
        slotId: slot.slotId,
      }));
  }

  /** The same list with the members stripped off — what actually goes on the
   * wire, to the layout call and to a saved shape alike. A template that
   * remembered who stood where would be a stale roster in a new place. */
  function layoutForSave(): LayoutTile[] {
    return orderedDraft().map(({ slotId: _ignored, ...tile }) => tile);
  }

  // The sightings under the window. Advisory only — see `fetchOccupiedTiles`:
  // a base that was destroyed or lost its shield has been teleported
  // somewhere random, so this says where people WERE, not where they are.
  const occupied = useOccupiedTiles(formation.serverId, {
    xMin: view.xMin,
    xMax: view.xMax,
    yMin: view.yMin,
    yMax: view.yMax,
  });

  /** Save whatever is unsaved — the shape, the people, or both — in ONE call.
   *
   * `save_hive_formation` (0330) writes the shape and then puts everybody back
   * on it inside one transaction, under the version check. It used to be three
   * requests (layout, a re-read, people), and a save from another officer
   * could land between any two.
   *
   * THE PEOPLE GO BY OFFSET. A moved tile is deleted and reinserted under a
   * new id, so the rows an assignment pointed at are gone with their ids;
   * worked out from the draft BEFORE the call, each member rides with the
   * square they stand on — including a member handed that tile since the last
   * save. A member whose tile was erased outright has nowhere to go back to,
   * and is reported (`lost`) rather than quietly dropped.
   *
   * RETURNED, not fired and forgotten, in `onSuccess`: the save stays pending
   * until the board has been re-read, so its refresh is never judged as
   * somebody else's (see "WHEN A BOARD ARRIVES").
   */
  const save = useMutation({
    mutationKey: ['hive', 'save', formation.formationId],
    mutationFn: () => {
      if (dirty) {
        const ordered = orderedDraft();
        return saveFormation(
          formation.formationId,
          baseVersion,
          layoutForSave(),
          peopleByOffset(ordered, placementsOf(ordered, assignments, pinned)),
        );
      }
      return saveFormation(
        formation.formationId,
        baseVersion,
        null,
        peopleByOffset(slots, placementsOf(slots, assignments, pinned)),
      );
    },
    onSuccess: (result) => {
      setBaseVersion(result.version);
      setRefusal(
        result.lost === 0
          ? null
          : result.lost === 1
            ? t('Saved. {count} member lost a tile, because the tile they were on is gone.', {
                count: result.lost,
              })
            : t('Saved. {count} members lost a tile, because the tile they were on is gone.', {
                count: result.lost,
              }),
      );
      return queryClient.invalidateQueries({ queryKey: ['hive'] });
    },
    onError: (error: Error) => {
      if (error instanceof StaleSaveError) {
        // The banner takes over once the newer board arrives.
        setRefusal(t('Somebody else saved this plan first. Fetching their version…'));
        void queryClient.invalidateQueries({ queryKey: ['hive'] });
        return;
      }
      setRefusal(
        error instanceof PlanDeletedError
          ? t('This plan was deleted. An officer can restore it from Recently deleted.')
          : error.message,
      );
    },
  });

  const anchorMove = useMutation({
    mutationFn: (move: { from: Coordinate; to: Coordinate }) =>
      moveFormation(formation.formationId, move.from, move.to),
    // RETURNED, not fired and forgotten: the mutation stays pending until the
    // board has been re-read, so `pendingAnchor` is let go only once the
    // formation it stood in for has arrived — never a frame on the old ground.
    onSuccess: () => {
      setRefusal(null);
      return queryClient.invalidateQueries({ queryKey: ['hive'] });
    },
    onError: (error: Error) => {
      if (error instanceof StaleSaveError) {
        // The draft is untouched: an anchor move makes nobody's draft stale.
        setRefusal(t("Someone else moved this plan's anchor. It has been reloaded."));
        void queryClient.invalidateQueries({ queryKey: ['hive'] });
        return;
      }
      setRefusal(
        error instanceof PlanDeletedError
          ? t('This plan was deleted. An officer can restore it from Recently deleted.')
          : error.message,
      );
    },
  });

  /** Put the anchor somewhere else and leave every tile where it is (0339).
   *
   * THE DRAFT FOLLOWS IN THE SAME RENDER AS THE ANCHOR. The anchor shown is
   * `pendingAnchor` until the formation and the board have both been re-read;
   * setting it on its own would draw the old offsets from the new anchor, and
   * the whole hive would jump by the difference until the board arrived. */
  const reanchor = useMutation({
    mutationFn: (to: Coordinate) =>
      reanchorFormation(
        formation.formationId,
        baseVersion,
        { x: formation.anchorX, y: formation.anchorY },
        to,
      ),
    onSuccess: (result, to) => {
      setDraft(reanchoredDraft(draft, { x: formation.anchorX, y: formation.anchorY }, to));
      // Offsets are keys; a selection held by the old ones points at nothing.
      setSelection(new Set());
      setPendingAnchor(to);
      // Ours, not somebody else's: the board arriving at this version is
      // today's rules, not a conflict.
      setBaseVersion(result.version);
      setRefusal(null);
      return queryClient.invalidateQueries({ queryKey: ['hive'] });
    },
    onError: (error: Error) => {
      if (error instanceof StaleSaveError) {
        setRefusal(
          t(
            'Someone else changed this plan since you opened it, so the anchor was not moved. It has been reloaded.',
          ),
        );
        void queryClient.invalidateQueries({ queryKey: ['hive'] });
        return;
      }
      setRefusal(
        error instanceof PlanDeletedError
          ? t('This plan was deleted. An officer can restore it from Recently deleted.')
          : error.message,
      );
    },
  });

  /** Re-anchor on `to`, from the typed box or a click on the map. Refused
   * while anything is unsaved: it rewrites every SAVED offset, and a draft
   * drawn on the old ones could not be saved afterwards. */
  function reanchorAt(to: Coordinate) {
    if (unsaved) {
      setRefusal(t('Save or discard your changes first: setting the anchor rewrites every tile.'));
      return;
    }
    if (!tileFitsOnMap(to, BASE_SPAN, BASE_SPAN)) {
      setRefusal(
        t('The anchor has to be between 1 and 998 on both axes; {coordinate} is not.', {
          coordinate: formatTeleport(to),
        }),
      );
      return;
    }
    if (to.x === formation.anchorX && to.y === formation.anchorY) {
      return;
    }
    reanchor.mutate(to, { onSettled: () => setPendingAnchor(null) });
  }

  /** Move the whole formation: the typed box and the dragged anchor both end
   * here, so the two cannot disagree about what a move does.
   *
   * Sent with the anchor this screen last read, not the pending one: that is
   * what 0330 checks, so a move made from a stale view is refused rather than
   * landing on top of somebody else's. */
  function moveAnchor(to: Coordinate) {
    const from = anchor;
    setPendingAnchor(to);
    setCentre(to);
    anchorMove.mutate(
      { from: { x: formation.anchorX, y: formation.anchorY }, to },
      {
        onSettled: () => setPendingAnchor(null),
        // Refused: the formation never moved, so neither should the view.
        onError: () => setCentre(from),
      },
    );
  }

  // The catalogue the brush is loaded from (0171). Read here rather than
  // passed in: it belongs to the editor, is the same on every server, and
  // nothing above this screen has a use for it.
  const features = useMapFeatures();

  const featureAdd = useMutation({
    mutationFn: (name: string) =>
      createMapFeature({
        name,
        spanX: brush.spanX,
        spanY: brush.spanY,
        kind: brush.kind,
        colour: brush.colour,
      }),
    onSuccess: () => {
      setFeatureName('');
      setRefusal(null);
      void queryClient.invalidateQueries({ queryKey: ['hive', 'features'] });
    },
    onError: (error: Error) => setRefusal(error.message),
  });

  const featureRemove = useMutation({
    mutationFn: (featureId: string) => deleteMapFeature(featureId),
    onSuccess: () => {
      setRefusal(null);
      void queryClient.invalidateQueries({ queryKey: ['hive', 'features'] });
    },
    onError: (error: Error) => setRefusal(error.message),
  });

  /** Load a catalogue entry into the brush.
   *
   * The entry is COPIED into the brush, and the brush is copied onto the
   * tile. Nothing that gets drawn holds a reference back here, which is what
   * lets the list be tidied without a formation changing under the eighty
   * people already reading it.
   */
  function loadFeature(feature: MapFeature) {
    setBrush({
      spanX: feature.spanX,
      spanY: feature.spanY,
      kind: feature.kind,
      colour: feature.colour,
      label: feature.name,
    });
    setRefusal(null);
  }

  // Saved shapes (0172). Anchor-independent and server-independent, so this
  // list is the same wherever the officer is standing.
  const templates = useTemplates();

  const templateSave = useMutation({
    mutationFn: (name: string) => saveTemplate(name, '', layoutForSave()),
    onSuccess: () => {
      setTemplateName('');
      setRefusal(null);
      void queryClient.invalidateQueries({ queryKey: ['hive', 'templates'] });
    },
    onError: (error: Error) => setRefusal(error.message),
  });

  const templateRemove = useMutation({
    mutationFn: (templateId: string) => deleteTemplate(templateId),
    onSuccess: () => {
      setRefusal(null);
      void queryClient.invalidateQueries({ queryKey: ['hive', 'templates'] });
    },
    onError: (error: Error) => setRefusal(error.message),
  });

  /** Pick a saved shape up as a STAMP, like the built-in ones: a click on the
   * map puts it down centred where its anchor was.
   *
   * Not a write, and that is the whole design. A template has no anchor, so
   * whether its tiles fit is a question only the ground it is put on can
   * answer — the ghost under the pointer shows it, and what lands is saved
   * through the same layout call as always. It used to REPLACE the drawing,
   * centred on the anchor; Clear and a click on the anchor still does that.
   */
  const templateLoad = useMutation({
    mutationFn: (template: FormationTemplate) => fetchTemplateTiles(template.templateId),
    onSuccess: (tiles, template) => {
      arm({
        key: `template-${template.templateId}`,
        label: template.name,
        tiles: shapeFromTemplate(tiles),
      });
    },
    onError: (error: Error) => setRefusal(error.message),
  });

  /** Pick a shape up to stamp, or put it away if it is the one held. Stamping
   * is a click, so it takes the drawing tool: an area tool would turn the
   * press into a sweep. */
  function arm(shape: StampShape) {
    setRefusal(null);
    setPickingAnchor(false);
    if (armed?.key === shape.key) {
      setArmed(null);
      return;
    }
    setArmed(shape);
    setTool('draw');
  }

  /** Start or stop choosing the anchor on the map. A click is how it is
   * chosen, so it takes the drawing tool and puts any held shape away. */
  function choosingAnchor(on: boolean) {
    setPickingAnchor(on);
    setRefusal(null);
    if (on) {
      setArmed(null);
      setTool('draw');
    }
  }

  /** What a drag does from now on. */
  function chooseTool(value: Tool) {
    setTool(value);
    // An area tool owns the press, so a held shape could not be put down, nor
    // an anchor chosen: let go of them rather than leave them doing nothing.
    if (value !== 'draw') {
      setArmed(null);
      setPickingAnchor(false);
    }
    // A selection that outlived its tool would still be carried by a drag, in
    // a mode whose drag means something else entirely.
    if (value !== 'select') {
      setSelection(new Set());
    }
    setRefusal(null);
  }

  /** Put the held shape down centred on `at`. The tiles that would land on
   * something, or off the map, are left out and counted; the shape stays in
   * hand for the next click. */
  function stampShape(shape: StampShape, at: Coordinate) {
    const plan = stampPlan(shape.tiles, at, anchor, drawn);
    const landing = plan.filter((tile) => tile.fate === 'placed');
    if (draft.size + landing.length > MAX_TILES) {
      setRefusal(
        t('That would take the formation past the {limit}-tile limit.', { limit: MAX_TILES }),
      );
      return;
    }
    if (landing.length > 0) {
      const next = new Map(draft);
      // Ordinals are placeholders, as for a clicked tile: the save renumbers.
      for (const [index, tile] of landing.entries()) {
        const slot: DraftSlot = {
          dx: tile.dx,
          dy: tile.dy,
          spanX: tile.spanX,
          spanY: tile.spanY,
          kind: tile.kind,
          colour: tile.colour,
          label: tile.label,
          ordinal: draft.size + index + 1,
          slotId: null,
        };
        next.set(offsetKey(slot), slot);
      }
      setDraft(next);
    }
    setRefusal(stampSummary(plan, t));
  }

  /** Save whatever is unsaved. One button, one call (`save`): this used to be
   * two buttons an officer had to press in the right order, then one button
   * over two calls, and since 0330 the shape and the people go together. */
  function saveEverything() {
    save.mutate();
  }

  /** A click on the grid. On a base it removes it; on free ground it adds one.
   *
   * The refusal is spelled out with the OTHER tile named. "Cannot place here"
   * leaves an officer looking for which of eighty neighbours is in the way,
   * and at this zoom the offending base may be off screen. */
  function pick(tile: Coordinate) {
    if (pickingAnchor) {
      // THE OBJECT'S OWN COORDINATE, not the square clicked: the anchor goes
      // where the game puts that base or building, which is its middle.
      const under = tileUnderPointer(drawn, anchor, tile);
      if (under === undefined) {
        setRefusal(t('Click a base or a structure to put the anchor on it, or press Esc.'));
        return;
      }
      setPickingAnchor(false);
      reanchorAt(absoluteOf(anchor, under));
      return;
    }
    if (armed !== null) {
      stampShape(armed, tile);
      return;
    }
    const hit = drawn.find((slot) => {
      const box = footprintOf(absoluteOf(anchor, slot), slot.spanX, slot.spanY);
      return tile.x >= box.x0 && tile.x <= box.x1 && tile.y >= box.y0 && tile.y <= box.y1;
    });
    if (hit !== undefined) {
      const next = new Map(draft);
      next.delete(offsetKey(hit));
      setDraft(next);
      setRefusal(null);
      return;
    }
    const candidate: SizedOffset = {
      dx: tile.x - anchor.x,
      dy: tile.y - anchor.y,
      spanX: brush.spanX,
      spanY: brush.spanY,
    };
    if (!tileFitsOnMap(tile, brush.spanX, brush.spanY)) {
      setRefusal(
        t('A {x}x{y} tile centred on {coordinate} would need ground off the edge of the map.', {
          x: brush.spanX,
          y: brush.spanY,
          coordinate: formatTeleport(tile),
        }),
      );
      return;
    }
    if (!canPlace(drawn, candidate)) {
      const clash = drawn.find((slot) => tilesOverlap(slot, candidate));
      setRefusal(
        clash === undefined
          ? t('That ground is taken.')
          : t('That would share ground with the {x}x{y} tile at {coordinate}.', {
              x: clash.spanX,
              y: clash.spanY,
              coordinate: formatTeleport(absoluteOf(anchor, clash)),
            }),
      );
      return;
    }
    const next = new Map(draft);
    // The ordinal here is a placeholder: the save renumbers the whole
    // formation, and `numbering` shows that rather than this.
    next.set(offsetKey(candidate), {
      ...candidate,
      ordinal: draft.size + 1,
      label: brush.label,
      kind: brush.kind,
      colour: brush.colour,
      slotId: null,
    });
    setDraft(next);
    setRefusal(null);
  }

  /** Fill a swept box with 1x1 markers, or take the markers back out.
   *
   * FILLS AROUND WHAT IS THERE, never through it — `freeTilesIn` skips ground
   * another tile already holds, so sweeping a strip beside the hive marks the
   * gaps between the bases rather than being refused for touching one.
   *
   * The markers take the BRUSH'S colour and caption, which is what makes the
   * catalogue worth having: click 'Keep clear', then sweep. The brush's SIZE
   * is deliberately ignored — a marker says "this square is spoken for", and
   * nothing bigger than a square can say that about an irregular gap.
   */
  function sweep(box: FootprintBox) {
    if (tool === 'select') {
      // FULLY INSIDE, not merely touched. A box that grabbed everything it
      // clipped would take half a hive off a drag that overshot by a tile,
      // and the officer would then move or delete tiles they never saw
      // themselves select.
      const picked = drawn.filter((slot) => tileInsideBox(absoluteOf(anchor, slot), box));
      setSelection(new Set(picked.map(offsetKey)));
      setRefusal(
        picked.length === 0
          ? t('Nothing is completely inside that box, so nothing is selected.')
          : null,
      );
      return;
    }

    if (tool === 'erase') {
      const next = new Map(draft);
      let removed = 0;
      for (const [key, slot] of draft) {
        // The exact inverse of what marking put down, and nothing else. A
        // sweep that also swallowed bases would delete people's places on a
        // gesture meant to tidy up markers, and the drag reads the same
        // either way.
        if (slot.kind !== 'structure' || slot.spanX !== 1 || slot.spanY !== 1) {
          continue;
        }
        if (tileInsideBox(absoluteOf(anchor, slot), box)) {
          next.delete(key);
          removed += 1;
        }
      }
      setDraft(next);
      setRefusal(
        removed === 0 ? t('Nothing to erase in that area — it holds no 1x1 markers.') : null,
      );
      return;
    }

    // A BOUNDARY IS A LINE. Filling a 40x40 area to record where it ends is
    // 1,600 markers against 156, and the fill would eat the whole tile budget
    // to say the same thing.
    const free =
      tool === 'outline' ? outlineTilesIn(box, anchor, drawn) : freeTilesIn(box, anchor, drawn);
    if (free.length === 0) {
      setRefusal(
        tool === 'outline'
          ? t('Every tile on the edge of those {area} is already spoken for.', {
              area: boxArea(box),
            })
          : t('Every one of those {area} tiles is already spoken for.', { area: boxArea(box) }),
      );
      return;
    }
    // A sweep is the one gesture here that can add thousands at once, so it is
    // the one that checks the ceiling (see MAX_TILES for why it exists).
    if (draft.size + free.length > MAX_TILES) {
      const room = Math.max(0, MAX_TILES - draft.size);
      setRefusal(
        room === 0
          ? t(
              'This formation already holds {count} tiles, the most one can — erase some before marking more.',
              { count: draft.size },
            )
          : t(
              'That area needs {needed} markers and only {room} more fit under the {limit}-tile limit — drag a smaller area, or use Draw a boundary.',
              { needed: free.length, room, limit: MAX_TILES },
            ),
      );
      return;
    }
    const next = new Map(draft);
    let ordinal = draft.size;
    for (const tile of free) {
      ordinal += 1;
      next.set(offsetKey(tile), {
        ...tile,
        ordinal,
        label: brush.label,
        kind: 'structure',
        colour: brush.colour ?? 'red',
        slotId: null,
      });
    }
    setDraft(next);
    setRefusal(null);
  }

  /** Shift every selected tile by the same whole number of tiles.
   *
   * REBUILT WHOLE RATHER THAN EDITED IN PLACE. The draft is keyed by offset,
   * so moving a group one tile east would have each tile land on the key of
   * its neighbour while that neighbour is still there — the same reason the
   * database cannot take a formation piecewise, in a Map instead of a table.
   * Emptying the moved tiles out first and putting them all back is the only
   * order that has no invalid halfway state.
   *
   * The selection follows the tiles to their new keys, so a group can be
   * nudged twice without reselecting it.
   */
  function moveSelection(byX: number, byY: number) {
    if (byX === 0 && byY === 0) {
      return;
    }
    if (!canMoveGroup(drawn, selection, byX, byY, anchor)) {
      setRefusal(
        t(
          'Those {count} tiles cannot all move there — something is in the way, or the group would run off the map.',
          { count: selection.size },
        ),
      );
      return;
    }
    const next = new Map(draft);
    const landed = new Set<string>();
    for (const key of selection) {
      next.delete(key);
    }
    for (const key of selection) {
      const held = draft.get(key);
      if (held === undefined) {
        continue;
      }
      const landing = shiftedBy(held, byX, byY);
      next.set(offsetKey(landing), landing);
      landed.add(offsetKey(landing));
    }
    setDraft(next);
    setSelection(landed);
    setRefusal(null);
  }

  /** Take every selected tile out of the draft. */
  function deleteSelection() {
    if (selection.size === 0) {
      return;
    }
    const next = new Map(draft);
    let people = 0;
    for (const key of selection) {
      // A base that had somebody on it is the one deletion worth counting:
      // the officer is about to lose that assignment and the tile it named,
      // and neither is visible once the square is gone.
      const slotId = next.get(key)?.slotId;
      if (slotId != null && assignments.has(slotId)) {
        people += 1;
      }
      next.delete(key);
    }
    const removed = selection.size;
    setDraft(next);
    setSelection(new Set());
    setRefusal(
      people === 0
        ? null
        : t('Removed {removed} tiles, {people} of which had somebody standing on them.', {
            removed,
            people,
          }),
    );
  }

  /** Give every selected tile a colour, keeping the tiles themselves. */
  function paintSelection(colour: TileColour | null) {
    if (selection.size === 0) {
      return;
    }
    setDraft(paintedTiles(draft, selection, colour));
    // The selection is deliberately KEPT. Picking a colour is a thing you do
    // by eye — put it on, look at it against the rest of the hive, try the
    // next one — and dropping the selection after the first swatch would make
    // every one of those tries start with the box drag again.
    setRefusal(null);
  }

  /** Whether the base standing on `from` could stand on `to` instead.
   *
   * The moved base is taken OUT of the comparison, or it would always clash
   * with itself: a one-tile nudge leaves the old and new footprints
   * overlapping, and every drag would be refused. */
  function canMove(from: Coordinate, to: Coordinate): boolean {
    const held = draft.get(offsetKey({ dx: from.x - anchor.x, dy: from.y - anchor.y }));
    if (held === undefined) {
      return false;
    }
    // A press that began on a selected tile carries the whole selection, so
    // the question is whether the GROUP fits — asked of the same set the drop
    // will move, or the grid would green-light a drop the drop then refuses.
    if (selection.has(offsetKey(held))) {
      return canMoveGroup(drawn, selection, to.x - from.x, to.y - from.y, anchor);
    }
    const landing: SizedOffset = {
      dx: to.x - anchor.x,
      dy: to.y - anchor.y,
      spanX: held.spanX,
      spanY: held.spanY,
    };
    if (!tileFitsOnMap(to, held.spanX, held.spanY)) {
      return false;
    }
    const others = drawn.filter((slot) => offsetKey(slot) !== offsetKey(held));
    return canPlace(others, landing);
  }

  /** Put a dragged base down. The grid has already refused an invalid drop,
   * and this refuses it again — the two are cheap and the grid's answer is a
   * frame old by the time the pointer comes up. */
  function move(from: Coordinate, to: Coordinate) {
    const moving: Offset = { dx: from.x - anchor.x, dy: from.y - anchor.y };
    const held = draft.get(offsetKey(moving));
    if (held === undefined || !canMove(from, to)) {
      return;
    }
    if (selection.has(offsetKey(held))) {
      moveSelection(to.x - from.x, to.y - from.y);
      return;
    }
    const landing: SizedOffset = {
      dx: to.x - anchor.x,
      dy: to.y - anchor.y,
      spanX: held.spanX,
      spanY: held.spanY,
    };
    const next = new Map(draft);
    next.delete(offsetKey(moving));
    // Everything but the position rides along — the slot id with it, which is
    // what keeps the member on the square. The ordinal is renumbered by the
    // save anyway, and a moved base may well have changed ring.
    next.set(offsetKey(landing), { ...held, ...landing });
    setDraft(next);
    setRefusal(null);
  }

  /** A member dropped on the map from the list beside it.
   *
   * THE SAME DECISION AS THE DROPDOWN, reached by pointing instead of
   * scrolling: the member is taken off wherever they were, put on this tile,
   * and pinned — choosing somebody by hand is a pin, or the next Fill would
   * quietly move them. Whoever stood on the tile before goes back to the list.
   */
  function dropMember(playerId: string, at: Coordinate) {
    const target = dropTarget(drawn, anchor, at, t);
    if (target.kind === 'refused') {
      setRefusal(target.reason);
      return;
    }
    if (target.kind === 'new' && draft.size + 1 > MAX_TILES) {
      setRefusal(
        t('This formation already holds {count} tiles, the most one can.', { count: draft.size }),
      );
      return;
    }
    const next = new Map(draft);
    let slotId: string;
    if (target.kind === 'onto') {
      const held = draft.get(target.key);
      if (held === undefined) {
        return;
      }
      slotId = held.slotId ?? draftSlotId();
      if (held.slotId === null) {
        next.set(target.key, { ...held, slotId });
      }
    } else {
      slotId = draftSlotId();
      next.set(offsetKey(target.tile), {
        ...target.tile,
        ordinal: draft.size + 1,
        label: '',
        kind: 'base',
        colour: null,
        slotId,
      });
    }
    const placed = new Map(
      [...assignments].filter(([key, id]) => id !== playerId && liveSlotIds.has(key)),
    );
    const pins = new Map([...pinned].filter(([, id]) => id !== playerId));
    placed.set(slotId, playerId);
    pins.set(slotId, playerId);
    setDraft(next);
    setAssignments(placed);
    setPinned(pins);
    setRefusal(null);
  }

  const byId = new Map(members.map((member) => [member.playerId, member]));
  // The assignments a drop keeps for everybody else: those pointing at a tile
  // either drawn or still saved. A stand-in id outlives its tile when the tile
  // is taken away again before a save. Saved slots stay in so that Discard
  // changes, which brings a clicked-away base back, brings its member too.
  const liveSlotIds = new Set([
    ...slots.map((slot) => slot.slotId),
    ...drawn.flatMap((slot) => (slot.slotId === null ? [] : [slot.slotId])),
  ]);
  // Who is placed is a narrower question — on a tile of the plan AS DRAWN.
  // Counting the saved slots here too kept a member greyed after their base
  // was clicked away (see `placedTiles`).
  const placedAt = placedTiles(assignments, drawn);
  const placedIds = new Set(placedAt.keys());
  const unplaced = members.filter((member) => !placedIds.has(member.playerId));
  const paletteMembers = paletteRows(members, placedAt, {
    query: memberQuery,
    sort: paletteSort,
    hidePlaced,
  });
  const paletteGroups = groupRows(paletteMembers, groupByRank);

  /** Take a member off their tile and back onto the list.
   *
   * THE TILE STAYS. Clicking a base removes the ground itself — the base,
   * not just whoever was on it — so without this the only way to take one
   * person off was to delete their base and draw it again. Their pin goes
   * too: a pin is a plan for a placement, and there no longer is one. */
  function unplace(playerId: string) {
    setAssignments(new Map([...assignments].filter(([, id]) => id !== playerId)));
    setPinned(new Map([...pinned].filter(([, id]) => id !== playerId)));
  }
  // Only tiles a member's city can stand on. Structures hold ground rather
  // than people — the database refuses a player on one anyway — and a
  // base-kind tile that is not 3x3 is a drawing, not a place to send anybody.
  // FILL ORDER FIRST, ALWAYS, whatever the table is then sorted by. The `#`
  // column and the number captioned on the map both come from this, so the
  // two cannot disagree because somebody changed how the list is stacked.
  const byFillOrder = sortSlots(slots.filter(isMemberBase), structures);
  const fillNumber = new Map(byFillOrder.map((slot, index) => [slot.slotId, index + 1] as const));

  /** A→Z on the member standing there, with the empty tiles after them.
   *
   * Empty last rather than first or scattered: they sort together under no
   * name at all, and an officer reading down for a person wants the people.
   * Ties and empties fall back to fill order so the list is stable.
   */
  function byMemberName(a: BoardSlot, b: BoardSlot): number {
    const nameOf = (slot: BoardSlot) => {
      const player = assignments.get(slot.slotId);
      return player === undefined ? null : (byId.get(player)?.name ?? null);
    };
    const left = nameOf(a);
    const right = nameOf(b);
    if (left === null || right === null) {
      return left === right ? 0 : left === null ? 1 : -1;
    }
    return left.localeCompare(right) || 0;
  }

  const ordered =
    tableSort === 'name'
      ? [...byFillOrder].sort(
          (a, b) =>
            byMemberName(a, b) || (fillNumber.get(a.slotId) ?? 0) - (fillNumber.get(b.slotId) ?? 0),
        )
      : byFillOrder;

  /** Pin every filled tile whose member matches, on top of what is pinned.
   *
   * ADDITIVE, never a replacement. "Pin the R4s and up" after hand-pinning
   * three people means four groups pinned, not the three thrown away — and
   * there is a separate control for letting everybody go, which is the only
   * place anyone means to lose a pin.
   */
  function pinWhere(matches: (member: AssignableMember) => boolean) {
    const pins = new Map(pinned);
    for (const [slotId, playerId] of assignments) {
      const member = byId.get(playerId);
      if (member !== undefined && matches(member)) {
        pins.set(slotId, playerId);
      }
    }
    setPinned(pins);
  }

  /** How many of the filled tiles are pinned, for the controls to report. */
  const pinnableCount = [...assignments.keys()].filter((slotId) =>
    ordered.some((slot) => slot.slotId === slotId),
  ).length;

  // NUMBERED BY RING, INNERMOST FIRST, which is what the save writes and what
  // auto-assignment then follows. The draft holds whatever ordinal a tile was
  // given when it was placed, and after a few removals those repeat — two
  // tiles both captioned "10" is how that was found — so the caption has to
  // come from the order the save will impose rather than from the draft.
  //
  // Ring order rather than reading order because the inner layer is the one
  // that matters: the members handed a tile before the formation runs out of
  // people are the ones standing against Frankie.
  //
  // The column itself can still hold a planner's own numbering; nothing in
  // this editor offers a way to type one yet, so nothing pretends to.
  const numbering = memberNumbering(drawn);

  // ONLY WHAT IS ON SCREEN. Every drawn tile used to become an absolutely
  // positioned element whether or not the window showed it, so a formation of
  // a few thousand markers re-rendered all of them on every pan step — one
  // drag across a 4,694-tile layout took 1.7 seconds, and the tile limit was
  // really a limit on how much the editor could redraw sixty times a second.
  //
  // Culled here rather than inside the grid because everything else on this
  // screen is counted over the WHOLE formation: the numbering, the assignment
  // table and the ring order all read `drawn`, and none of them may change
  // because somebody scrolled. This affects the picture and nothing else.
  const onScreen = drawn.filter((slot) => {
    const foot = footprintOf(absoluteOf(anchor, slot), slot.spanX, slot.spanY);
    return (
      foot.x1 >= view.xMin && foot.x0 <= view.xMax && foot.y1 >= view.yMin && foot.y0 <= view.yMax
    );
  });

  // BY THE SLOT THE TILE CAME FROM, not by where it stands now. A dragged
  // base is somewhere its slot never was, and looking the member up by
  // position made their name vanish the instant it was put down — which
  // reads as "I have just deleted this person" rather than "I have moved
  // them".
  const assignedTo = (slot: DraftSlot) =>
    slot.slotId === null ? undefined : assignments.get(slot.slotId);

  /** How a tile is coloured while bases are coloured by rank: the rank of
   * whoever is on it, or an empty outline. Ground keeps its painted colour,
   * so Frankie and the boundary still read as ground among the ranks. Over
   * the unsaved assignments, so a drag shows its new rank at once. */
  const byRank = prefs.colourBy === 'rank';
  function rankOf(slot: DraftSlot): RankEntry & { colour?: null } {
    if (!byRank || slot.kind !== 'base') {
      return {};
    }
    const assigned = assignedTo(slot);
    return assigned === undefined
      ? { colour: null, vacant: true }
      : { rank: byId.get(assigned)?.memberRank ?? null };
  }

  const bases: GridBase[] = onScreen.map((slot) => {
    const at = absoluteOf(anchor, slot);
    const assigned = assignedTo(slot);
    return {
      key: offsetKey(slot),
      at,
      selected: selection.has(offsetKey(slot)),
      spanX: slot.spanX,
      spanY: slot.spanY,
      structure: slot.kind === 'structure',
      colour: slot.colour,
      caption: tileCaption(
        slot,
        assigned === undefined ? undefined : (byId.get(assigned)?.name ?? '?'),
        numbering.get(offsetKey(slot)),
      ),
      own: assigned !== undefined && assigned === ownPlayerId,
      ...rankOf(slot),
    };
  });
  // Counted over every tile, not the window: the legend must not change as
  // the map is panned.
  const ranksDrawn = rankTally(drawn.map(rankOf));
  const sized = mapSizeProps(prefs.size);

  /** The whole formation in view, the way the members' picture opens. */
  function showWhole() {
    const fit = windowFitting(
      drawn.map((slot) => footprintOf(absoluteOf(anchor, slot), slot.spanX, slot.spanY)),
    );
    setCentre(fit?.centre ?? anchor);
    setZoom(fit?.radius ?? ZOOM_DEFAULT);
  }

  const ourIds = new Set(members.map((member) => member.playerId));
  const sightings: GridSighting[] = (occupied.data ?? []).map((tile) => ({
    key: String(tile.gameUid),
    at: { x: tile.x, y: tile.y },
    name: tile.name,
    ours: tile.playerId !== null && ourIds.has(tile.playerId),
  }));

  /** One member in the Members tab: grip, rank (when not already said by a
   * heading), name, and power — or, once placed, their tile and a way off it.
   * The whole row is the drag handle. */
  function memberRow({ member, tile }: PaletteRow) {
    const name = member.name ?? t('unnamed');
    const number = tile === null ? undefined : numbering.get(offsetKey(tile));
    return (
      <li
        className={
          tile === null
            ? 'hive-palette__member'
            : 'hive-palette__member hive-palette__member--placed'
        }
        draggable
        key={member.playerId}
        onDragStart={(event) => {
          event.dataTransfer.setData(MEMBER_DRAG_TYPE, member.playerId);
          event.dataTransfer.effectAllowed = 'move';
        }}
        title={
          tile === null
            ? t('{member} — drag onto the map', { member: memberLabel(member, t) })
            : t('{member} — on tile {number}; drag somewhere else to move them', {
                member: memberLabel(member, t),
                number: number ?? '',
              })
        }
      >
        <span aria-hidden="true" className="hive-palette__grip">
          ⠿
        </span>
        {!groupByRank && (
          <span className={`hive-palette__rank hive-rank-chip--${rankClass(member.memberRank)}`}>
            {member.memberRank === null ? '–' : `R${member.memberRank}`}
          </span>
        )}
        <span className="hive-palette__name">{name}</span>
        {tile === null ? (
          <span className="hive-palette__power">{shortPower(member.power)}</span>
        ) : (
          <>
            <button
              aria-label={t("Show {name}'s tile on the map", { name })}
              className="hive-palette__where"
              onClick={() => setCentre(absoluteOf(anchor, tile))}
              title={t('Tile {number} at {coordinate} — show it on the map', {
                number: number ?? '',
                coordinate: formatTeleport(absoluteOf(anchor, tile)),
              })}
              type="button"
            >
              {number === undefined ? t('Where') : `#${number}`}
            </button>
            <button
              aria-label={t('Take {name} off their tile', { name })}
              className="hive-palette__off"
              onClick={() => unplace(member.playerId)}
              title={t('Take them off this tile. The base stays.')}
              type="button"
            >
              ×
            </button>
          </>
        )}
      </li>
    );
  }

  // On both tabs: the shape and the people are saved together, and making
  // somebody switch tabs to press Save is how a fill gets left unsaved.
  // The conflict banner sits above the button it disables: there is nothing
  // to save until the officer has chosen to take the newer plan.
  const saveActions = (
    <>
      {conflicted && (
        <ConflictBanner
          at={formation.editedAt}
          name={formation.editedByName}
          onLoad={loadNewVersion}
        />
      )}
      <div className="hive-actions">
        <button
          className="primary"
          disabled={!unsaved || conflicted || save.isPending}
          onClick={saveEverything}
          type="button"
        >
          {save.isPending
            ? t('Saving…')
            : !unsaved
              ? t('Saved')
              : dirty && assignmentsDirty
                ? t('Save the shape and the people')
                : dirty
                  ? t('Save the shape')
                  : t('Save who goes where')}
        </button>
        <button disabled={!dirty} onClick={() => setDraft(saved)} type="button">
          {t('Discard changes')}
        </button>
        <Stamp at={formation.editedAt} name={formation.editedByName} />
      </div>
    </>
  );

  return (
    <>
      <div hidden={half !== 'shape'}>
        {/* SAVE ABOVE THE MAP, always in view. It sat at the foot of the
            controls column, and with those controls now behind a tab it would
            have been behind one too. */}
        <div className="hive-editor__bar">
          {saveActions}
          <p className="hive-count">
            {draft.size === 1
              ? t('{count} tile drawn', { count: draft.size })
              : t('{count} tiles drawn', { count: draft.size })}{' '}
            ·{' '}
            {members.length === 1
              ? t('{count} member on the roster', { count: members.length })
              : t('{count} members on the roster', { count: members.length })}
            {draft.size < members.length && draft.size > 0 && (
              <>
                {' '}
                —{' '}
                <strong>
                  {t('{count} would have nowhere to stand', {
                    count: members.length - draft.size,
                  })}
                </strong>
              </>
            )}
          </p>
        </div>
        <div
          className={['hive-editor', sized.className].join(' ').trim()}
          style={{ ...sized.style, ...panelWidthStyle(prefs.panelWidth) }}
        >
          <div className="hive-editor__map">
            <EditorToolbar
              armedKey={armed?.key ?? null}
              brush={brush}
              features={features.data ?? []}
              onBrush={(next) => {
                setBrush(next);
                setRefusal(null);
              }}
              onClear={() => {
                setDraft(new Map());
                setRefusal(null);
              }}
              onFeature={loadFeature}
              onPickAnchor={() => choosingAnchor(!pickingAnchor)}
              onShape={arm}
              onTemplate={(template) =>
                armed?.key === `template-${template.templateId}`
                  ? setArmed(null)
                  : templateLoad.mutate(template)
              }
              onTool={chooseTool}
              pickDisabled={unsaved || reanchor.isPending}
              pickingAnchor={pickingAnchor}
              selection={{
                count: selection.size,
                onNudge: moveSelection,
                onPaint: paintSelection,
                onRemove: deleteSelection,
                onDeselect: () => setSelection(new Set()),
              }}
              shapes={BUILT_IN_SHAPES}
              templates={templates.data ?? []}
              tool={tool}
            />
            <TileGrid
              anchor={anchor}
              bases={bases}
              busy={save.isPending}
              canDropAt={(at) => dropTarget(drawn, anchor, at, t).kind !== 'refused'}
              canMoveTo={canMove}
              canAnchorAt={(to) => formationFitsAt(to, drawn)}
              onDropMember={dropMember}
              onMove={move}
              onMoveAnchor={anchorMove.isPending ? undefined : moveAnchor}
              onPick={pick}
              onPan={(byX, byY) => setCentre((from) => pannedCentre(from, byX, byY))}
              onRegion={tool === 'draw' ? undefined : sweep}
              onResize={(size) => setMapPrefs({ size: size === null ? null : clampMapSize(size) })}
              onZoom={(notches, at) => {
                // ABOUT THE POINTER: the ground under the cursor stays under it
                // (`centreKeeping`), so zooming in on a corner of the hive lands
                // on that corner instead of hunting for it again on every notch.
                const next = zoomedBy(zoom, notches);
                setCentre(centreKeeping(view, windowRadius(next), at));
                setZoom(next);
              }}
              overlay={
                <>
                  <MapKey colourBy={prefs.colourBy} tally={ranksDrawn} />
                  <MapNav
                    anchor={anchor}
                    fitLabel={t('Whole formation')}
                    onFit={showWhole}
                    onHome={() => setCentre(anchor)}
                    onZoom={setZoom}
                    sized={prefs.size !== null}
                    zoom={zoom}
                  />
                  {/* WHAT A CLICK WILL DO, on the map: the shape was picked up
                      in a panel that may be scrolled away by now. */}
                  {pickingAnchor && (
                    <div className="map-stamp">
                      <output>
                        {rich(
                          t(
                            '{title} — click a base or structure to put the anchor on it. Nothing moves.',
                          ),
                          { title: <strong>{t('New anchor')}</strong> },
                        )}
                        {refusal !== null && <span className="map-stamp__note"> {refusal}</span>}
                      </output>
                      <button
                        aria-label={t('Stop choosing the anchor')}
                        onClick={() => choosingAnchor(false)}
                        title={t('Stop (Esc)')}
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  )}
                  {armed !== null && (
                    <div className="map-stamp">
                      <output>
                        {rich(t('{shape} — click the map to put it down.'), {
                          shape: <strong>{shapeLabel(armed, t)}</strong>,
                        })}
                        {refusal !== null && <span className="map-stamp__note"> {refusal}</span>}
                      </output>
                      <button
                        aria-label={t('Put {shape} away', { shape: shapeLabel(armed, t) })}
                        onClick={() => setArmed(null)}
                        title={t('Put it away (Esc)')}
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </>
              }
              sightings={sightings}
              stampGhosts={
                armed === null
                  ? undefined
                  : (at) =>
                      stampPlan(armed.tiles, at, anchor, drawn).map((tile, index) => ({
                        key: String(index),
                        at: tile.at,
                        spanX: tile.spanX,
                        spanY: tile.spanY,
                        allowed: tile.fate === 'placed',
                      }))
              }
              window={view}
            />
          </div>

          {/* ONE PANEL BESIDE THE MAP, two tabs: the people, and every other
              control. Those controls were a column of seven boxes running far
              below the map, and the member list a second column that followed
              the scroll and slid over them. Now both sit in one box as tall as
              the map, each scrolling inside it, and the map keeps the room. */}
          <section aria-label={t('Members and tools')} className="hive-panel">
            <PanelDivider
              max={PANEL_WIDTH_MAX}
              min={PANEL_WIDTH_MIN}
              onResize={(width) =>
                setMapPrefs({ panelWidth: width === null ? null : clampPanelWidth(width) })
              }
              width={prefs.panelWidth ?? PANEL_WIDTH_DEFAULT}
            />
            <div className="hive-panel__inner">
              <div aria-label={t('Panel')} className="hive-panel__tabs" role="tablist">
                <button
                  aria-controls={`${panelId}-members`}
                  aria-selected={panelTab === 'members'}
                  id={`${panelId}-tab-members`}
                  onClick={() => setPanelTab('members')}
                  role="tab"
                  type="button"
                >
                  {t('Members')}
                  {unplaced.length > 0 && (
                    <span className="hive-panel__badge" title={t('Not placed yet')}>
                      {unplaced.length}
                    </span>
                  )}
                </button>
                <button
                  aria-controls={`${panelId}-tools`}
                  aria-selected={panelTab === 'tools'}
                  id={`${panelId}-tab-tools`}
                  onClick={() => setPanelTab('tools')}
                  role="tab"
                  type="button"
                >
                  {t('Tools')}
                </button>
              </div>

              {/* THE PEOPLE. Dragging a name onto a square is the same decision
                  as the dropdown on the people tab, made by pointing at it; the
                  dropdown stays for keyboards and phones, which HTML drag and
                  drop does not reach. */}
              <div
                aria-labelledby={`${panelId}-tab-members`}
                className="hive-panel__body"
                hidden={panelTab !== 'members'}
                id={`${panelId}-members`}
                role="tabpanel"
              >
                {/* A SEARCH, because eighty rows is still a lot of reading. It
                    filters what is shown and nothing else. */}
                <div className="hive-palette-search">
                  <input
                    aria-label={t('Find a member')}
                    onChange={(event) => setMemberQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setMemberQuery('');
                      }
                    }}
                    placeholder={t('Find a member…')}
                    type="search"
                    value={memberQuery}
                  />
                  <span className="hive-count">
                    {memberQuery.trim() === ''
                      ? t('{count} of {total} not placed', {
                          count: unplaced.length,
                          total: members.length,
                        })
                      : t('{count} shown', { count: paletteMembers.length })}
                  </span>
                </div>
                {/* BY RANK, then A–Z or power within it — chosen here, never
                    borrowed from the fill order elsewhere on the page. Placing
                    somebody never moves their row; "Hide placed" takes the
                    dealt-with out of the way instead of reshuffling them. */}
                <div className="hive-roster__options">
                  <fieldset className="hive-roster__sort">
                    <legend className="visually-hidden">{t('Order')}</legend>
                    {PALETTE_SORTS.map((option) => (
                      <button
                        aria-pressed={paletteSort === option.sort}
                        key={option.sort}
                        onClick={() => setPaletteSort(option.sort)}
                        type="button"
                      >
                        {option.sort === 'power' ? t('Power') : option.label}
                      </button>
                    ))}
                  </fieldset>
                  <label className="hive-roster__hide">
                    <input
                      checked={groupByRank}
                      onChange={(event) => setGroupByRank(event.target.checked)}
                      type="checkbox"
                    />
                    {t('By rank')}
                  </label>
                  <label className="hive-roster__hide">
                    <input
                      checked={hidePlaced}
                      onChange={(event) => setHidePlaced(event.target.checked)}
                      type="checkbox"
                    />
                    {t('Hide placed')}
                  </label>
                </div>
                <div className="hive-roster__list">
                  {paletteGroups.length === 0 && (
                    <p className="subtle hive-roster__empty">
                      {memberQuery.trim() !== ''
                        ? hidePlaced
                          ? t('Nobody unplaced on the roster matches “{query}”.', {
                              query: memberQuery.trim(),
                            })
                          : t('Nobody on the roster matches “{query}”.', {
                              query: memberQuery.trim(),
                            })
                        : hidePlaced && members.length > 0
                          ? t('Everybody has a tile.')
                          : t('Nobody on the roster yet.')}
                    </p>
                  )}
                  {paletteGroups.map((group) => (
                    <section
                      aria-label={
                        group.key === 'r0'
                          ? t('Rank unknown')
                          : (group.label ?? t('Members to place'))
                      }
                      className="hive-roster__group"
                      key={group.key}
                    >
                      {group.label !== null && (
                        <h4 className={`hive-roster__head hive-rank-chip--${group.key}`}>
                          <span aria-hidden="true" className="hive-roster__dot" />
                          {group.key === 'r0' ? t('Rank unknown') : group.label}
                          <span className="hive-roster__tally">
                            {group.rows.length}
                            {group.placed > 0
                              ? ` · ${t('{count} placed', { count: group.placed })}`
                              : ''}
                          </span>
                        </h4>
                      )}
                      <ul className="hive-palette">{group.rows.map(memberRow)}</ul>
                    </section>
                  ))}
                </div>
              </div>

              <div
                aria-labelledby={`${panelId}-tab-tools`}
                className="hive-panel__body hive-panel__tools"
                hidden={panelTab !== 'tools'}
                id={`${panelId}-tools`}
                role="tabpanel"
              >
                <fieldset>
                  <legend>{t('Things on the map')}</legend>
                  <p className="subtle">
                    {t(
                      'The shapes this alliance draws more than once, kept as a list rather than retyped. Clicking one loads its size, kind and colour into the brush and captions the tile with its name — a copy, so tidying the list later never changes a formation already sent out.',
                    )}
                  </p>
                  {features.isError ? (
                    <p className="error">{t('Could not load the list of map features.')}</p>
                  ) : null}
                  <div className="hive-features">
                    {(features.data ?? []).map((feature) => (
                      <span className="hive-feature" key={feature.featureId}>
                        <button
                          className={
                            feature.colour === null
                              ? 'hive-feature__load'
                              : `hive-feature__load hive-feature__load--${feature.colour}`
                          }
                          onClick={() => loadFeature(feature)}
                          title={feature.note === '' ? undefined : feature.note}
                          type="button"
                        >
                          {feature.name} {feature.spanX}x{feature.spanY}
                        </button>
                        <button
                          aria-label={t('Remove {name} from the list', { name: feature.name })}
                          className="hive-feature__drop"
                          disabled={featureRemove.isPending}
                          onClick={() => featureRemove.mutate(feature.featureId)}
                          type="button"
                        >
                          x
                        </button>
                      </span>
                    ))}
                    {features.isSuccess && features.data.length === 0 ? (
                      <span className="subtle">{t('Nothing in the list yet.')}</span>
                    ) : null}
                  </div>
                  <form
                    className="hive-feature-add"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = featureName.trim();
                      if (name !== '') {
                        featureAdd.mutate(name);
                      }
                    }}
                  >
                    <label>
                      <span>
                        {t('Add the brush ({brush}) as', {
                          brush: [
                            `${brush.spanX}x${brush.spanY}`,
                            brush.kind === 'structure' ? t('structure') : '',
                            brush.colour ?? '',
                          ]
                            .filter(Boolean)
                            .join(', '),
                        })}
                      </span>
                      <input
                        maxLength={40}
                        onChange={(event) => setFeatureName(event.target.value)}
                        placeholder={t('Alliance HQ')}
                        value={featureName}
                      />
                    </label>
                    <button
                      disabled={featureName.trim() === '' || featureAdd.isPending}
                      type="submit"
                    >
                      {t('Add to list')}
                    </button>
                  </form>
                </fieldset>

                <fieldset>
                  <legend>{t('Saved shapes')}</legend>
                  <p className="subtle">
                    {t(
                      'A shape is offsets from the anchor, so a saved one carries no map and nobody standing on it — the same hive fits any anchor on any server. Pick one and click the map, like the shapes below: it goes down round the square you click, as often as you like. Nothing is written until you save.',
                    )}
                  </p>
                  {templates.isError ? (
                    <p className="error">{t('Could not load the saved shapes.')}</p>
                  ) : null}
                  <div className="hive-features">
                    {(templates.data ?? []).map((template) => (
                      <span className="hive-feature" key={template.templateId}>
                        <button
                          aria-pressed={armed?.key === `template-${template.templateId}`}
                          className="hive-feature__load"
                          disabled={templateLoad.isPending}
                          onClick={() =>
                            armed?.key === `template-${template.templateId}`
                              ? setArmed(null)
                              : templateLoad.mutate(template)
                          }
                          title={template.note === '' ? undefined : template.note}
                          type="button"
                        >
                          {template.name} ·{' '}
                          {template.bases === 1
                            ? t('{count} base', { count: template.bases })
                            : t('{count} bases', { count: template.bases })}
                          {template.structures === 0 ? '' : ` + ${template.structures}`}
                        </button>
                        <button
                          aria-label={t('Delete the saved shape {name}', { name: template.name })}
                          className="hive-feature__drop"
                          disabled={templateRemove.isPending}
                          onClick={() => templateRemove.mutate(template.templateId)}
                          type="button"
                        >
                          x
                        </button>
                      </span>
                    ))}
                    {templates.isSuccess && templates.data.length === 0 ? (
                      <span className="subtle">{t('Nothing saved yet.')}</span>
                    ) : null}
                  </div>
                  <form
                    className="hive-feature-add"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = templateName.trim();
                      if (name !== '') {
                        templateSave.mutate(name);
                      }
                    }}
                  >
                    <label>
                      <span>
                        {draft.size === 1
                          ? t('Save the {count} tile drawn as', { count: draft.size })
                          : t('Save the {count} tiles drawn as', { count: draft.size })}
                      </span>
                      <input
                        maxLength={60}
                        onChange={(event) => setTemplateName(event.target.value)}
                        placeholder={t('Bear rally')}
                        value={templateName}
                      />
                    </label>
                    {/* Saving under a name already used REPLACES that shape, which is
                  what an officer correcting three tiles means. Said out loud
                  because it is the one thing here that can lose work. */}
                    <button
                      disabled={
                        draft.size === 0 || templateName.trim() === '' || templateSave.isPending
                      }
                      type="submit"
                    >
                      {(templates.data ?? []).some(
                        (template) =>
                          template.name.trim().toLowerCase() === templateName.trim().toLowerCase(),
                      )
                        ? t('Replace saved shape')
                        : t('Save shape')}
                    </button>
                  </form>
                </fieldset>

                <fieldset>
                  <legend>{t('Anchor')}</legend>
                  <p className="subtle">
                    {t(
                      'Every tile is stored as an offset from here, so moving the anchor moves the whole formation and cannot change its shape. Or drag the anchor square on the map — every tile follows it.',
                    )}
                  </p>
                  <CoordinateInput
                    at={anchor}
                    busy={anchorMove.isPending}
                    fits={(to) => formationFitsAt(to, drawn)}
                    label={t('Anchor')}
                    onSubmit={moveAnchor}
                    submitLabel={t('Move formation')}
                    whyNot={t('From there part of the formation would run off the map.')}
                  />
                  {/* THE OTHER THING AN ANCHOR CHANGE CAN MEAN: measure the plan
                      from somewhere else, and move nothing. */}
                  <p className="subtle">
                    {t(
                      'Or set the anchor somewhere else and leave every tile where it is — on a coordinate, or on a base or structure already drawn. It is saved at once, so save or discard your changes first.',
                    )}
                  </p>
                  <CoordinateInput
                    at={anchor}
                    busy={reanchor.isPending}
                    fits={() => !unsaved}
                    label={t('New anchor')}
                    onSubmit={reanchorAt}
                    submitLabel={t('Set anchor here')}
                    whyNot={t(
                      'Save or discard your changes first: setting the anchor rewrites every tile.',
                    )}
                  />
                  <p className="hive-shapes">
                    <button
                      aria-pressed={pickingAnchor}
                      disabled={unsaved || reanchor.isPending}
                      onClick={() => choosingAnchor(!pickingAnchor)}
                      type="button"
                    >
                      {t('Pick a base or structure on the map')}
                    </button>
                  </p>
                </fieldset>

                <fieldset>
                  <legend>{t('Look at')}</legend>
                  <CoordinateInput
                    at={centre}
                    label={t('Centre the view on')}
                    onSubmit={setCentre}
                    submitLabel={t('Go there')}
                  />
                </fieldset>
              </div>
            </div>
          </section>
        </div>
        <p className="subtle">
          {rich(
            t(
              'Drag a name from the Members tab onto the map: on free ground it draws their base there, on a base it puts them on it. To take somebody off without losing the base, press × on their row. Click free ground to place a base, click a base to take it away (with whoever is on it). Each one is {size} tiles and the coordinate is the middle. Drag from empty ground to slide the map — or hold {key}, which works while an area tool is on too. Hold {key} and use the wheel, or pinch, to zoom; the house in the corner goes to the anchor and the frame shows the whole formation. The anchor is the bright square, drawn over anything on it: drag it to move everything. Drag the corner handle to resize the map, and the bar beside the panel to widen the panel. Shaded squares are where the map last SAW somebody — a base that was destroyed or lost its shield has been teleported somewhere random, so treat them as a hint and not as a wall.',
            ),
            { size: `${BASE_SPAN}x${BASE_SPAN}`, key: <kbd>ctrl</kbd> },
          )}
        </p>
      </div>

      {refusal !== null && <p className="error">{refusal}</p>}

      <div hidden={half !== 'people'}>
        {saveActions}
        {dirty ? (
          <p className="empty">
            {t(
              'This list comes back once the shape is saved — it reads the saved tiles, and some of these are not saved yet. Until then, drag names from the list on the Draw the shape tab onto the bases; Save keeps them where they were dropped.',
            )}
          </p>
        ) : ordered.length === 0 ? (
          <p className="empty">
            {t('No member bases yet. Place some {size} bases above and save them.', {
              size: `${BASE_SPAN}x${BASE_SPAN}`,
            })}
          </p>
        ) : (
          <>
            <div className="hive-assign">
              <label>
                <span>{t('Fill in order of')}</span>
                <Select onChange={(chosen) => setOrder(chosen as AssignOrder)} value={order}>
                  {ORDERS.map((option) => (
                    <option key={option} value={option}>
                      {t(assignOrderLabel(option))}
                    </option>
                  ))}
                </Select>
              </label>
              <button
                onClick={() => {
                  const result = autoAssign(ordered, members, { order, pinned });
                  setAssignments(result.assignments);
                  setRefusal(
                    result.unplaced.length === 0
                      ? null
                      : result.unplaced.length === 1
                        ? t(
                            '{count} member has no tile: the formation is smaller than the roster.',
                            { count: result.unplaced.length },
                          )
                        : t(
                            '{count} members have no tile: the formation is smaller than the roster.',
                            { count: result.unplaced.length },
                          ),
                  );
                }}
                type="button"
              >
                {t('Fill the empty tiles')}
              </button>
              <button onClick={() => setAssignments(new Map())} type="button">
                {t('Empty every tile')}
              </button>
            </div>
            {/* PINS IN GROUPS, because the reason to pin is almost never one
              person. "The leaders stay where I put them" is one decision about
              a dozen tiles, and it was a dozen checkbox clicks down a table
              that does not say who is senior. */}
            <div className="hive-assign hive-pins">
              <span className="subtle">
                {pinnableCount === 1
                  ? t('{pinned} of {count} filled tile pinned', {
                      pinned: pinned.size,
                      count: pinnableCount,
                    })
                  : t('{pinned} of {count} filled tiles pinned', {
                      pinned: pinned.size,
                      count: pinnableCount,
                    })}
              </span>
              <button
                disabled={pinnableCount === 0}
                onClick={() => pinWhere(() => true)}
                type="button"
              >
                {t('Pin every filled tile')}
              </button>
              <button
                disabled={pinnableCount === 0}
                onClick={() => pinWhere((member) => (member.memberRank ?? 0) >= 4)}
                type="button"
              >
                {t('Pin R4 and R5')}
              </button>
              <button
                disabled={pinned.size === 0}
                onClick={() => setPinned(new Map())}
                type="button"
              >
                {t('Unpin everything')}
              </button>
            </div>
            <p className="subtle">
              {rich(
                t(
                  'Filling runs from the inside out: the innermost ring against Frankie is handed out first, so whoever sorts highest above stands closest. Choosing somebody by hand pins them, so a later fill leaves them where you put them — place the few whose position matters and let everybody else fall in around them. Nothing here is written until you press {save} above, which saves the shape and the people together.',
                ),
                { save: <strong>{t('Save')}</strong> },
              )}
            </p>
            {/* NAMED, NOT COUNTED. "6 members not placed" is the one number an
              officer cannot act on: the next thing they do is work out WHO,
              and the roster is eighty names long. */}
            {unplaced.length > 0 && (
              <details className="hive-unplaced">
                <summary>
                  {rich(t('{members} — nobody has told them where to go'), {
                    members: (
                      <strong>
                        {unplaced.length === 1
                          ? t('{count} member not placed', { count: unplaced.length })
                          : t('{count} members not placed', { count: unplaced.length })}
                      </strong>
                    ),
                  })}
                </summary>
                <ul>
                  {sortMembers(unplaced, order).map((member) => (
                    <li key={member.playerId}>{memberLabel(member, t)}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="hive-assign">
              <label>
                <span>{t('Sort the list by')}</span>
                <Select
                  onChange={(chosen) => setTableSort(chosen as 'name' | 'tile')}
                  value={tableSort}
                >
                  <option value="name">{t('Member name (A–Z)')}</option>
                  <option value="tile">{t('Tile order (innermost first)')}</option>
                </Select>
              </label>
              {/* THE TWO ORDERS ARE DIFFERENT QUESTIONS. Reading down for a
                person wants the alphabet; checking that the middle went to
                the right people wants the fill. `#` is the fill number in
                both, so neither view can lie about which tile is which. */}
            </div>
            <table className="table hive-table">
              <thead>
                <tr>
                  <th>#</th>
                  {/* WHICH LAYER, because "the first layer is the leaders" is
                    how a hive is actually planned and the table had no way to
                    say where ring 1 ended. The rows are already in ring order;
                    this only names what the order is. */}
                  <th>{t('Ring')}</th>
                  <th>{t('Teleport to')}</th>
                  <th>{t('Note')}</th>
                  <th>{t('Member')}</th>
                  <th>
                    {/* THE HEADER IS WHERE PEOPLE LOOK FOR SELECT-ALL, whatever
                      buttons sit above the table. Indeterminate when some are
                      pinned, so the box reports the state rather than only
                      offering an action. */}
                    <input
                      aria-label={
                        pinned.size === pinnableCount && pinnableCount > 0
                          ? t('Unpin every tile')
                          : t('Pin every filled tile')
                      }
                      checked={pinnableCount > 0 && pinned.size === pinnableCount}
                      disabled={pinnableCount === 0}
                      onChange={(event) => {
                        if (event.target.checked) {
                          pinWhere(() => true);
                        } else {
                          setPinned(new Map());
                        }
                      }}
                      ref={(box) => {
                        if (box !== null) {
                          box.indeterminate = pinned.size > 0 && pinned.size < pinnableCount;
                        }
                      }}
                      type="checkbox"
                    />{' '}
                    {t('Pin')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((slot) => {
                  const chosen = assignments.get(slot.slotId) ?? '';
                  return (
                    <tr key={slot.slotId}>
                      {/* COUNTED DOWN THIS TABLE, not read off the row.
                        `ordinal` numbers every tile in the formation,
                        structures included, so a formation whose first tile is
                        Frankie started this column at 2 and ran to 8 for seven
                        bases — which reads as "the structures are in my list"
                        even though they are not. The caption on the map has
                        always counted member bases alone, and this is the same
                        count, so the two now cannot disagree. */}
                      <td>{fillNumber.get(slot.slotId) ?? '?'}</td>
                      <td>{ringOf(slot, structures)}</td>
                      <td>
                        {/* THE COORDINATE IS WHAT GETS HANDED OVER, so it is one
                          press away from the clipboard. The dashboard cannot
                          drive the game — a web page has no way to reach
                          BlueStacks — so what it copies is written the way the
                          game shares a place, `#580[X:n Y:n]`, which alliance
                          chat turns back into a place you can tap. Without the
                          `#server` it stays plain text. */}
                        <button
                          className="linklike"
                          onClick={() => {
                            void navigator.clipboard?.writeText(
                              shareCoordinate(formation.serverId, { x: slot.x, y: slot.y }),
                            );
                            setCopied(slot.slotId);
                          }}
                          title={t('Copy this coordinate')}
                          type="button"
                        >
                          <code>
                            {shareCoordinate(formation.serverId, { x: slot.x, y: slot.y })}
                          </code>
                          {copied === slot.slotId ? ' ✓' : ''}
                        </button>
                      </td>
                      <td>{slot.label}</td>
                      <td>
                        <Select
                          onChange={(chosen) => {
                            const next = new Map(assignments);
                            const pins = new Map(pinned);
                            if (chosen === '') {
                              next.delete(slot.slotId);
                              pins.delete(slot.slotId);
                            } else {
                              // Removed from wherever they were: the save
                              // refuses one member on two tiles, and finding
                              // that out from a database error message is a
                              // worse way to learn it.
                              for (const [key, value] of next) {
                                if (value === chosen) {
                                  next.delete(key);
                                  pins.delete(key);
                                }
                              }
                              next.set(slot.slotId, chosen);
                              // Choosing somebody by hand IS a pin. Otherwise
                              // the next fill would quietly undo it.
                              pins.set(slot.slotId, chosen);
                            }
                            setAssignments(next);
                            setPinned(pins);
                          }}
                          value={chosen}
                        >
                          <option value="">{t('— empty —')}</option>
                          {/* RANK AND POWER IN THE OPTION, because the inner
                            ring is picked by hand and "who are my R4s" is the
                            question being answered while the list is open.
                            A name alone made that a separate lookup. */}
                          {members.map((member) => (
                            <option key={member.playerId} value={member.playerId}>
                              {memberLabel(member, t)}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td>
                        <input
                          aria-label={t('Pin tile {number}', { number: slot.ordinal })}
                          checked={pinned.has(slot.slotId)}
                          disabled={chosen === ''}
                          onChange={(event) => {
                            const pins = new Map(pinned);
                            if (event.target.checked && chosen !== '') {
                              pins.set(slot.slotId, chosen);
                            } else {
                              pins.delete(slot.slotId);
                            }
                            setPinned(pins);
                          }}
                          type="checkbox"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
}

/** A coordinate typed rather than pointed at.
 *
 * THE KEYBOARD PATH FOR THE GRID. The grid is one click target whose meaning
 * depends on where the pointer was, which a keyboard has no answer for — so
 * every place the grid takes a coordinate, this takes the same one typed.
 */
function CoordinateInput({
  at,
  label,
  onSubmit,
  submitLabel,
  fits,
  whyNot,
  busy = false,
}: {
  at: Coordinate;
  label: string;
  onSubmit: (to: Coordinate) => void;
  submitLabel: string;
  /** Whether a coordinate is somewhere this box may send. Defaults to "a base
   * fits there", which is right for looking; moving the anchor has to ask
   * about the whole formation, or the button offers a move the database then
   * refuses. */
  fits?: (to: Coordinate) => boolean;
  /** Said under the box when the numbers are real but `fits` says no, so a
   * greyed button is not the only answer. */
  whyNot?: string;
  busy?: boolean;
}) {
  const t = useT();
  const [x, setX] = useState(String(at.x));
  const [y, setY] = useState(String(at.y));
  const [seed, setSeed] = useState(at);
  if (seed !== at && (seed.x !== at.x || seed.y !== at.y)) {
    setSeed(at);
    setX(String(at.x));
    setY(String(at.y));
  }
  const parsed = parseCoordinate(x, y);
  const onMap = parsed !== null && tileFitsOnMap(parsed, BASE_SPAN, BASE_SPAN);
  const usable = parsed !== null && onMap && (fits === undefined || fits(parsed));
  const unchanged = parsed !== null && parsed.x === at.x && parsed.y === at.y;
  // A FORM, so Enter in either box sends it. It was a bare button, and typing
  // a coordinate then pressing Enter — what everybody does — did nothing.
  return (
    <form
      className="hive-coordinate"
      onSubmit={(event) => {
        event.preventDefault();
        if (usable && !busy && !unchanged) {
          onSubmit(parsed);
        }
      }}
    >
      <label>
        <span>{t('{label} x', { label })}</span>
        <input inputMode="numeric" onChange={(event) => setX(event.target.value)} value={x} />
      </label>
      <label>
        <span>y</span>
        <input inputMode="numeric" onChange={(event) => setY(event.target.value)} value={y} />
      </label>
      <button disabled={!usable || busy || unchanged} type="submit">
        {busy ? t('Moving…') : submitLabel}
      </button>
      {onMap && !usable && whyNot !== undefined && <p className="hive-coordinate__why">{whyNot}</p>}
    </form>
  );
}

/** Two typed numbers as a coordinate, or null unless both are whole numbers.
 *
 * STRICTER THAN parseInt, which reads "51O" as 51 and "5 12" as 5 — a typo
 * then moved the whole formation somewhere nobody typed. */
export function parseCoordinate(x: string, y: string): Coordinate | null {
  const whole = /^\s*\d+\s*$/;
  if (!whole.test(x) || !whole.test(y)) {
    return null;
  }
  return { x: Number(x), y: Number(y) };
}
