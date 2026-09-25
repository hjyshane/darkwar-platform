import { type Coordinate, formatCoordinate } from '@dw/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  type AssignOrder,
  type AssignableMember,
  BASE_SPAN,
  FRANKIE,
  type FootprintBox,
  MAX_TILES,
  type Offset,
  type SizedOffset,
  TILE_COLOURS,
  type TileColour,
  type TileKind,
  absoluteOf,
  assignOrderLabel,
  autoAssign,
  blockOffsets,
  boxArea,
  canMoveGroup,
  canPlace,
  footprintOf,
  freeTilesIn,
  isMemberBase,
  offsetKey,
  outlineTilesIn,
  ringOf,
  ringOffsets,
  ringOrderAround,
  shiftedBy,
  sortMembers,
  sortSlots,
  tileFitsOnMap,
  tileInsideBox,
  tilesOverlap,
} from '../../lib/hiveFormation';
import {
  type GridBase,
  type GridSighting,
  MEMBER_DRAG_TYPE,
  TileGrid,
  ZOOM_STEPS,
  pannedCentre,
  windowAround,
  zoomStep,
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
  fetchBoard,
  fetchTemplateTiles,
  saveAssignments,
  saveLayout,
  saveTemplate,
  updateFormation,
  useMapFeatures,
  useOccupiedTiles,
  useTemplates,
} from './hiveFormations';

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
          reason: `${hit.label === '' ? 'That tile' : hit.label} is ground, not a base — nobody can stand on it.`,
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
      reason: `A base centred on ${formatCoordinate(at)} would need ground off the edge of the map.`,
    };
  }
  if (!canPlace(drawn, tile)) {
    const clash = drawn.find((slot) => tilesOverlap(slot, tile));
    return {
      kind: 'refused',
      reason:
        clash === undefined
          ? 'That ground is taken.'
          : `A base there would share ground with the tile at ${formatCoordinate(absoluteOf(anchor, clash))}. Drop them on a base, or on free ground.`,
    };
  }
  return { kind: 'new', tile };
}

/** A typed span, or the one already there. A half-typed box must not silently
 * become a 1x1 the next click then places. */
function clampSpan(typed: string, fallback: number): number {
  const value = Number.parseInt(typed, 10);
  return Number.isNaN(value) ? fallback : Math.min(32, Math.max(1, value));
}

/** What the next click puts down.
 *
 * A BRUSH RATHER THAN A MODE. Size, kind and colour are the three things a
 * tile has beyond its position, so they are chosen once and then clicked out
 * — which is also why 3x3 stays the default: it is what almost every click
 * places, and the officer only touches this to draw a structure or a marker.
 */
interface Brush {
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

/** A member as one line: who they are, how senior, how strong.
 *
 * The inner ring is picked by hand, and the question being answered while the
 * dropdown is open is "who are my R4s" — which a bare name cannot answer and
 * which sent the officer off to the roster tab to find out.
 *
 * Power is abbreviated because the exact figure is not the point here; the
 * ordering is, and three significant figures is enough to see it.
 */
function memberLabel(member: AssignableMember): string {
  const rank = member.memberRank === null ? '' : `R${member.memberRank}`;
  const power =
    member.power === null
      ? ''
      : member.power >= 1_000_000
        ? `${(member.power / 1_000_000).toFixed(1)}M`
        : `${Math.round(member.power / 1000)}k`;
  const extra = [rank, power].filter(Boolean).join(' · ');
  return extra === '' ? (member.name ?? 'unnamed') : `${member.name ?? 'unnamed'} (${extra})`;
}

/** What a drag does. Clicking a tile places or removes one in every mode. */
type Tool = 'draw' | 'mark' | 'outline' | 'erase' | 'select';

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

/** A saved shape, turned back into a draft.
 *
 * EVERY TILE LANDS EMPTY, and that is not an oversight. A template carries
 * nobody (0172) because a shape saved a fortnight ago naming who stood where
 * is a stale roster in a new place — the member it names may have left, which
 * is the whole reason the board has a `still_a_member` flag. Filling the shape
 * is auto-assignment's job, from the roster as it is today.
 */
export function draftFromTiles(tiles: readonly LayoutTile[]): Map<string, DraftSlot> {
  return new Map(
    tiles.map((tile) => [
      offsetKey(tile),
      {
        dx: tile.dx,
        dy: tile.dy,
        spanX: tile.span_x,
        spanY: tile.span_y,
        kind: tile.kind,
        colour: tile.colour,
        ordinal: tile.ordinal,
        label: tile.label,
        slotId: null,
      },
    ]),
  );
}

/** How much of a saved shape would hang off the edge from this anchor.
 *
 * ASKED BEFORE THE SAVE REFUSES IT. The database checks each footprint
 * against the map's edge when the layout is written, and its message names
 * one tile; a shape loaded onto an anchor near a corner can have thirty in
 * that state. Counting them here is what lets the screen say move the anchor
 * rather than name a tile and stop.
 */
export function tilesOffMap(anchor: Coordinate, tiles: readonly LayoutTile[]): number {
  return tiles.filter((tile) => !tileFitsOnMap(absoluteOf(anchor, tile), tile.span_x, tile.span_y))
    .length;
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
}: {
  formation: Formation;
  slots: readonly BoardSlot[];
  members: readonly AssignableMember[];
  ownPlayerId: string | null;
}) {
  const queryClient = useQueryClient();
  const saved = useMemo(() => draftFromBoard(slots), [slots]);
  // Keyed by the version of the saved layout it was seeded from, so a
  // refetch after a save replaces the draft rather than leaving the old one
  // on screen looking unsaved.
  const [draftFor, setDraftFor] = useState<Map<string, DraftSlot>>(saved);
  const [draft, setDraft] = useState<Map<string, DraftSlot>>(saved);
  if (draftFor !== saved) {
    setDraftFor(saved);
    setDraft(saved);
  }

  const [centre, setCentre] = useState<Coordinate>({ x: formation.anchorX, y: formation.anchorY });
  const [zoom, setZoom] = useState<number>(14);
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
  if (assignmentsFor !== slots) {
    setAssignmentsFor(slots);
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

  const anchor: Coordinate = { x: formation.anchorX, y: formation.anchorY };
  const view = windowAround(centre, zoom);
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

  /** Save the shape, then put everybody back on it.
   *
   * TWO CALLS, AND THE SECOND IS THE POINT. `save_hive_formation_layout`
   * deletes the tiles that moved and inserts new ones — it has to, because a
   * shape shifted by one tile overlaps its own previous version — so the rows
   * an assignment pointed at are gone, and their slot ids with them. Without
   * this, dragging a base silently unassigned its member, and so did nudging
   * a whole block.
   *
   * Each draft tile carries the id of the slot it came from, so once the
   * layout lands the board is read back and everybody is put on the tile they
   * were drawn on — including a member handed that tile since the last save. `assign_hive_formation_slots` replaces the whole map in one
   * transaction, which is what makes re-applying safe rather than eighty
   * updates that can half-fail.
   *
   * A member whose tile was deleted outright has nowhere to go back to, and
   * is reported rather than quietly dropped.
   */
  const layoutSave = useMutation({
    mutationFn: async () => {
      // Worked out BEFORE the layout call, while the old slot ids still mean
      // something: a moved tile is deleted and reinserted under a new id, so
      // afterwards the only thing that still finds it is where it now stands.
      const carried = placementsOf(orderedDraft(), assignments, pinned);
      const summary = await saveLayout(formation.formationId, layoutForSave());
      const saved = await fetchBoard(formation.formationId);
      await saveAssignments(
        formation.formationId,
        saved.map((slot) => ({
          slot_id: slot.slotId,
          player_id: carried.get(offsetKey(slot))?.playerId ?? null,
          pinned: carried.get(offsetKey(slot))?.pinned ?? false,
        })),
      );
      return { summary, restored: carried.size };
    },
    onSuccess: ({ summary, restored }) => {
      // `unassigned` counts what the layout call dropped; `restored` counts
      // what was put back. Only the difference is a member who actually lost
      // their place, and only that is worth saying out loud.
      const lost = Math.max(summary.unassigned - restored, 0);
      setRefusal(
        lost === 0
          ? null
          : `Saved. ${lost} member${lost === 1 ? '' : 's'} lost a tile, because the tile they were on is gone.`,
      );
      void queryClient.invalidateQueries({ queryKey: ['hive'] });
    },
    onError: (error: Error) => setRefusal(error.message),
  });

  const assignmentSave = useMutation({
    mutationFn: () =>
      saveAssignments(
        formation.formationId,
        slots.map((slot) => ({
          slot_id: slot.slotId,
          player_id: assignments.get(slot.slotId) ?? null,
          pinned: pinned.has(slot.slotId),
        })),
      ),
    onSuccess: () => {
      setRefusal(null);
      void queryClient.invalidateQueries({ queryKey: ['hive'] });
    },
    onError: (error: Error) => setRefusal(error.message),
  });

  const anchorMove = useMutation({
    mutationFn: (to: Coordinate) =>
      updateFormation(formation.formationId, { anchorX: to.x, anchorY: to.y }),
    onSuccess: () => {
      setRefusal(null);
      void queryClient.invalidateQueries({ queryKey: ['hive'] });
    },
    onError: (error: Error) => setRefusal(error.message),
  });

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

  /** Load a saved shape into the DRAFT, replacing what is drawn.
   *
   * Not a write, and that is the whole design. A template has no anchor, so
   * whether its tiles fit the map is a question only this formation can
   * answer — the officer sees where it lands, moves the anchor if part of it
   * hangs off the edge, and saves through the same layout call as always.
   * Saving it here instead would refuse the whole shape with a message about
   * a tile they cannot yet see.
   */
  const templateLoad = useMutation({
    mutationFn: (template: FormationTemplate) => fetchTemplateTiles(template.templateId),
    onSuccess: (tiles) => {
      setDraft(draftFromTiles(tiles));
      const offMap = tilesOffMap(anchor, tiles);
      setRefusal(
        offMap === 0
          ? null
          : `${offMap} of ${tiles.length} tiles fall off the edge of the map from this anchor. Move the anchor before saving.`,
      );
    },
    onError: (error: Error) => setRefusal(error.message),
  });

  /** Save whatever is unsaved, in the order the data allows.
   *
   * ONE BUTTON, TWO CALLS UNDERNEATH, and the order is not a preference. A
   * tile has no id until it has been written, so the people can only be
   * pinned to tiles that already exist — which is why this used to be two
   * buttons an officer had to press in the right order, and why pressing the
   * wrong one first looked like it had done nothing.
   *
   * `layoutSave` already carries each member along with the square they are
   * standing on and re-applies them once the tiles have ids, so when the
   * shape has changed it saves both and there is nothing left for the second
   * call to do. When only the people have changed there is no shape to write.
   */
  function saveEverything() {
    if (dirty) {
      layoutSave.mutate();
      return;
    }
    assignmentSave.mutate();
  }

  /** A click on the grid. On a base it removes it; on free ground it adds one.
   *
   * The refusal is spelled out with the OTHER tile named. "Cannot place here"
   * leaves an officer looking for which of eighty neighbours is in the way,
   * and at this zoom the offending base may be off screen. */
  function pick(tile: Coordinate) {
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
        `A ${brush.spanX}x${brush.spanY} tile centred on ${formatCoordinate(tile)} would need ground off the edge of the map.`,
      );
      return;
    }
    if (!canPlace(drawn, candidate)) {
      const clash = drawn.find((slot) => tilesOverlap(slot, candidate));
      setRefusal(
        clash === undefined
          ? 'That ground is taken.'
          : `That would share ground with the ${clash.spanX}x${clash.spanY} tile at ${formatCoordinate(absoluteOf(anchor, clash))}.`,
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
          ? 'Nothing is completely inside that box, so nothing is selected.'
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
      setRefusal(removed === 0 ? 'Nothing to erase in that area — it holds no 1x1 markers.' : null);
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
          ? `Every tile on the edge of those ${boxArea(box)} is already spoken for.`
          : `Every one of those ${boxArea(box)} tiles is already spoken for.`,
      );
      return;
    }
    // A sweep is the one gesture here that can add thousands at once, so it is
    // the one that checks the ceiling (see MAX_TILES for why it exists).
    if (draft.size + free.length > MAX_TILES) {
      const room = Math.max(0, MAX_TILES - draft.size);
      setRefusal(
        room === 0
          ? `This formation already holds ${draft.size} tiles, the most one can — erase some before marking more.`
          : `That area needs ${free.length} markers and only ${room} more fit under the ${MAX_TILES}-tile limit — drag a smaller area, or use Draw a boundary.`,
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
        `Those ${selection.size} tiles cannot all move there — something is in the way, or the group would run off the map.`,
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
        : `Removed ${removed} tiles, ${people} of which had somebody standing on them.`,
    );
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

  /** Replace the draft with a generated shape.
   *
   * REPLACES RATHER THAN ADDS. Merging a block into hand-drawn tiles would
   * silently drop whichever of them overlapped, and an officer would be left
   * comparing the result against what they meant to draw. */
  function generate(shape: 'block' | 'ring', columns: number, rows: number) {
    const offsets = shape === 'block' ? blockOffsets(columns, rows) : ringOffsets(columns, rows);
    // FRANKIE FIRST, then everything that fits around it. It is an ordinary
    // tile with a size since 0169, so "keep the bases off the centre" is the
    // same overlap test as everywhere else rather than a special case.
    const frankie: DraftSlot = {
      dx: 0,
      dy: 0,
      spanX: FRANKIE.spanX,
      spanY: FRANKIE.spanY,
      kind: 'structure',
      colour: 'amber',
      ordinal: 0,
      label: 'Frankie',
      slotId: null,
    };
    // TWO REASONS A GENERATED TILE IS DROPPED, worth telling apart: one is the
    // edge of the world and the other is the centre. A block centred on the
    // anchor always puts a base on Frankie, so the second number is never zero
    // and reads as normal rather than as a fault.
    const onMap = offsets.filter((offset) =>
      tileFitsOnMap(absoluteOf(anchor, offset), offset.spanX, offset.spanY),
    );
    const usable = onMap.filter((offset) => !tilesOverlap(frankie, offset));
    setDraft(
      new Map([
        [offsetKey(frankie), frankie],
        ...[...usable].sort(byRing).map(
          (offset, index) =>
            [
              offsetKey(offset),
              {
                ...offset,
                ordinal: index + 1,
                label: '',
                kind: 'base' as TileKind,
                colour: null,
                slotId: null,
              },
            ] as const,
        ),
      ]),
    );
    const offMap = offsets.length - onMap.length;
    const onCentre = onMap.length - usable.length;
    const notes = [
      offMap > 0 ? `${offMap} fell off the edge of the map` : '',
      onCentre > 0 ? `${onCentre} would have stood on Frankie` : '',
    ].filter(Boolean);
    setRefusal(notes.length === 0 ? null : `${usable.length} bases drawn — ${notes.join(', ')}.`);
  }

  /** A member dropped on the map from the list above it.
   *
   * THE SAME DECISION AS THE DROPDOWN, reached by pointing instead of
   * scrolling: the member is taken off wherever they were, put on this tile,
   * and pinned — choosing somebody by hand is a pin, or the next Fill would
   * quietly move them. Whoever stood on the tile before goes back to the list.
   */
  function dropMember(playerId: string, at: Coordinate) {
    const target = dropTarget(drawn, anchor, at);
    if (target.kind === 'refused') {
      setRefusal(target.reason);
      return;
    }
    if (target.kind === 'new' && draft.size + 1 > MAX_TILES) {
      setRefusal(`This formation already holds ${draft.size} tiles, the most one can.`);
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
  // Only assignments that still point at a tile. A stand-in id outlives its
  // tile when the tile is taken away again before a save, and counting it
  // would leave that member looking placed while standing nowhere.
  const liveSlotIds = new Set([
    ...slots.map((slot) => slot.slotId),
    ...drawn.flatMap((slot) => (slot.slotId === null ? [] : [slot.slotId])),
  ]);
  const placedIds = new Set(
    [...assignments].flatMap(([slotId, playerId]) => (liveSlotIds.has(slotId) ? [playerId] : [])),
  );
  const unplaced = members.filter((member) => !placedIds.has(member.playerId));
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
  const numbering = new Map(
    [...drawn]
      .filter(isMemberBase)
      .sort(byRing)
      .map((slot, index) => [offsetKey(slot), index + 1] as const),
  );

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

  const bases: GridBase[] = onScreen.map((slot) => {
    const at = absoluteOf(anchor, slot);
    // BY THE SLOT THE TILE CAME FROM, not by where it stands now. A dragged
    // base is somewhere its slot never was, and looking the member up by
    // position made their name vanish the instant it was put down — which
    // reads as "I have just deleted this person" rather than "I have moved
    // them".
    const assigned = slot.slotId === null ? undefined : assignments.get(slot.slotId);
    return {
      key: offsetKey(slot),
      at,
      selected: selection.has(offsetKey(slot)),
      spanX: slot.spanX,
      spanY: slot.spanY,
      structure: slot.kind === 'structure',
      colour: slot.colour,
      // Anything that is not a member's base is captioned like ground: it has
      // no number in the table, so a "?" would read as a missing person.
      caption: !isMemberBase(slot)
        ? slot.label
        : assigned === undefined
          ? String(numbering.get(offsetKey(slot)) ?? '?')
          : (byId.get(assigned)?.name ?? '?'),
      own: assigned !== undefined && assigned === ownPlayerId,
    };
  });

  const ourIds = new Set(members.map((member) => member.playerId));
  const sightings: GridSighting[] = (occupied.data ?? []).map((tile) => ({
    key: String(tile.gameUid),
    at: { x: tile.x, y: tile.y },
    name: tile.name,
    ours: tile.playerId !== null && ourIds.has(tile.playerId),
  }));

  return (
    <>
      <div className="hive-editor">
        <div className="hive-editor__map">
          {/* THE PEOPLE, WHERE THE GROUND IS. Placing a member used to mean
              finding their tile's row in the table below and scrolling a
              dropdown of eighty names; dragging them onto the square is the
              same decision made by pointing at it. The dropdown stays for
              keyboards and phones, which HTML drag and drop does not reach. */}
          <ul aria-label="Members to place" className="hive-palette">
            {[
              ...sortMembers(unplaced, order),
              ...sortMembers(
                members.filter((member) => placedIds.has(member.playerId)),
                order,
              ),
            ].map((member) => (
              <li
                className={
                  placedIds.has(member.playerId)
                    ? 'hive-palette__member hive-palette__member--placed'
                    : 'hive-palette__member'
                }
                draggable
                key={member.playerId}
                onDragStart={(event) => {
                  event.dataTransfer.setData(MEMBER_DRAG_TYPE, member.playerId);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                title={
                  placedIds.has(member.playerId)
                    ? `${memberLabel(member)} — placed; drop them somewhere else to move them`
                    : `${memberLabel(member)} — drag onto the map`
                }
              >
                {member.name ?? 'unnamed'}
              </li>
            ))}
          </ul>
          <TileGrid
            anchor={anchor}
            bases={bases}
            busy={layoutSave.isPending}
            canDropAt={(at) => dropTarget(drawn, anchor, at).kind !== 'refused'}
            canMoveTo={canMove}
            onDropMember={dropMember}
            onMove={move}
            onPick={pick}
            onPan={(byX, byY) => setCentre((from) => pannedCentre(from, byX, byY))}
            onRegion={tool === 'draw' ? undefined : sweep}
            onZoom={(direction, at) => {
              // RE-CENTRE ON THE TILE UNDER THE POINTER. Zooming about the
              // window's own centre slides whatever you were looking at away
              // from the cursor, which at four steps means hunting for it
              // again on every notch.
              setZoom(zoomStep(zoom, direction));
              setCentre(at);
            }}
            sightings={sightings}
            window={view}
          />
          <p className="subtle">
            Drag a name from the list above onto the map: on free ground it draws their base there,
            on a base it puts them on it. Click free ground to place a base, click a base to take it
            away. Each one is {BASE_SPAN}x{BASE_SPAN} tiles and the coordinate is the middle. Drag
            from empty ground to slide the map — or hold <kbd>ctrl</kbd>, which works while an area
            tool is on too. The wheel zooms. Shaded squares are where the map last SAW somebody — a
            base that was destroyed or lost its shield has been teleported somewhere random, so
            treat them as a hint and not as a wall.
          </p>
          <fieldset className="hive-zoom">
            <legend>Zoom</legend>
            {ZOOM_STEPS.map((step) => (
              <button
                aria-pressed={step === zoom}
                key={step}
                onClick={() => setZoom(step)}
                type="button"
              >
                {step * 2 + 1} tiles
              </button>
            ))}
          </fieldset>
        </div>

        <div className="hive-editor__controls">
          <fieldset>
            <legend>Anchor</legend>
            <p className="subtle">
              Every tile is stored as an offset from here, so moving the anchor moves the whole
              formation and cannot change its shape.
            </p>
            <CoordinateInput
              at={anchor}
              label="Anchor"
              onSubmit={(to) => {
                anchorMove.mutate(to);
                setCentre(to);
              }}
              submitLabel="Move formation"
            />
          </fieldset>

          <fieldset>
            <legend>Look at</legend>
            <CoordinateInput
              at={centre}
              label="Centre the view on"
              onSubmit={setCentre}
              submitLabel="Go there"
            />
          </fieldset>

          <fieldset className="hive-tools">
            <legend>What a drag does</legend>
            <p className="subtle">
              Clicking a tile places or removes one in every mode. This is only about the drag,
              because one gesture cannot mean two things: while an area tool is on, bases stay where
              they are.
            </p>
            <div className="hive-shapes">
              {(
                [
                  ['draw', 'Move a base', 'Drag a base to carry it somewhere else.'],
                  [
                    'mark',
                    'Fill an area',
                    'Drag out a rectangle and fill every free tile in it with a 1x1 marker, in the brush\u2019s colour and caption. Goes around whatever is already drawn.',
                  ],
                  [
                    'outline',
                    'Draw a boundary',
                    'Drag out a rectangle and mark only its EDGE. What a boundary needs, at a fraction of the tiles a fill would spend.',
                  ],
                  [
                    'erase',
                    'Erase an area',
                    'Drag out a rectangle and take its 1x1 markers back out. Bases are left alone.',
                  ],
                  [
                    'select',
                    'Select',
                    'Drag out a rectangle to pick out everything completely inside it, then drag any of them to move the whole group, or remove them together.',
                  ],
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  aria-pressed={tool === value}
                  key={value}
                  onClick={() => {
                    setTool(value);
                    // A selection that outlived its tool would still be
                    // carried by a drag, in a mode whose drag means something
                    // else entirely.
                    if (value !== 'select') {
                      setSelection(new Set());
                    }
                    setRefusal(null);
                  }}
                  title={hint}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            {tool === 'select' && (
              <div className="hive-selection">
                <p className="subtle">
                  {selection.size === 0
                    ? 'Nothing selected. Drag a box around the tiles you want.'
                    : `${selection.size} tile${selection.size === 1 ? '' : 's'} selected — drag any of them to move the group, or nudge it a tile at a time.`}
                </p>
                {selection.size > 0 && (
                  <div className="hive-shapes">
                    {/* A TILE AT A TIME, for the last step of lining a block up
                        against a boundary. A drag cannot reliably land on one
                        tile at this zoom, and the coordinate boxes move the
                        anchor rather than a selection. */}
                    {(
                      [
                        ['\u2190', -1, 0],
                        ['\u2192', 1, 0],
                        ['\u2191', 0, 1],
                        ['\u2193', 0, -1],
                      ] as const
                    ).map(([glyph, byX, byY]) => (
                      <button
                        aria-label={`Nudge the selection ${glyph}`}
                        key={glyph}
                        onClick={() => moveSelection(byX, byY)}
                        type="button"
                      >
                        {glyph}
                      </button>
                    ))}
                    <button onClick={() => setSelection(new Set())} type="button">
                      Deselect
                    </button>
                    <button className="hive-remove" onClick={deleteSelection} type="button">
                      Remove {selection.size} tile{selection.size === 1 ? '' : 's'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend>What a click puts down</legend>
            <p className="subtle">
              A member's base is {BASE_SPAN}x{BASE_SPAN}. A structure is ground that is spoken for —
              Frankie at {FRANKIE.spanX}x{FRANKIE.spanY}, an alliance building, or a 1x1 marker on a
              tile to keep clear. Nothing may overlap anything, whatever size each of them is.
            </p>
            <div className="hive-brush">
              <label>
                <span>Wide</span>
                <input
                  max={32}
                  min={1}
                  onChange={(event) =>
                    setBrush({ ...brush, spanX: clampSpan(event.target.value, brush.spanX) })
                  }
                  type="number"
                  value={brush.spanX}
                />
              </label>
              <label>
                <span>Tall</span>
                <input
                  max={32}
                  min={1}
                  onChange={(event) =>
                    setBrush({ ...brush, spanY: clampSpan(event.target.value, brush.spanY) })
                  }
                  type="number"
                  value={brush.spanY}
                />
              </label>
              <label>
                <span>Kind</span>
                <select
                  onChange={(event) => setBrush({ ...brush, kind: event.target.value as TileKind })}
                  value={brush.kind}
                >
                  <option value="base">Member base</option>
                  <option value="structure">Structure / marker</option>
                </select>
              </label>
            </div>
            <fieldset className="hive-swatches">
              <legend>Colour</legend>
              <button
                aria-pressed={brush.colour === null}
                className="hive-swatch"
                onClick={() => setBrush({ ...brush, colour: null })}
                type="button"
              >
                default
              </button>
              {TILE_COLOURS.map((colour) => (
                <button
                  aria-label={colour}
                  aria-pressed={brush.colour === colour}
                  className={`hive-swatch hive-swatch--${colour}`}
                  key={colour}
                  onClick={() => setBrush({ ...brush, colour })}
                  type="button"
                />
              ))}
            </fieldset>
          </fieldset>

          <fieldset>
            <legend>Things on the map</legend>
            <p className="subtle">
              The shapes this alliance draws more than once, kept as a list rather than retyped.
              Clicking one loads its size, kind and colour into the brush and captions the tile with
              its name — a copy, so tidying the list later never changes a formation already sent
              out.
            </p>
            {features.isError ? (
              <p className="error">Could not load the list of map features.</p>
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
                    aria-label={`Remove ${feature.name} from the list`}
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
                <span className="subtle">Nothing in the list yet.</span>
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
                  Add the brush ({brush.spanX}x{brush.spanY}
                  {brush.kind === 'structure' ? ', structure' : ''}
                  {brush.colour === null ? '' : `, ${brush.colour}`}) as
                </span>
                <input
                  maxLength={40}
                  onChange={(event) => setFeatureName(event.target.value)}
                  placeholder="Alliance HQ"
                  value={featureName}
                />
              </label>
              <button disabled={featureName.trim() === '' || featureAdd.isPending} type="submit">
                Add to list
              </button>
            </form>
          </fieldset>

          <fieldset>
            <legend>Saved shapes</legend>
            <p className="subtle">
              A shape is offsets from the anchor, so a saved one carries no map and nobody standing
              on it — the same hive fits any anchor on any server. Loading one replaces what is
              drawn but writes nothing: move the anchor until it sits where you want, then save.
            </p>
            {templates.isError ? <p className="error">Could not load the saved shapes.</p> : null}
            <div className="hive-features">
              {(templates.data ?? []).map((template) => (
                <span className="hive-feature" key={template.templateId}>
                  <button
                    className="hive-feature__load"
                    disabled={templateLoad.isPending}
                    onClick={() => templateLoad.mutate(template)}
                    title={template.note === '' ? undefined : template.note}
                    type="button"
                  >
                    {template.name} · {template.bases} base{template.bases === 1 ? '' : 's'}
                    {template.structures === 0 ? '' : ` + ${template.structures}`}
                  </button>
                  <button
                    aria-label={`Delete the saved shape ${template.name}`}
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
                <span className="subtle">Nothing saved yet.</span>
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
                  Save the {draft.size} tile{draft.size === 1 ? '' : 's'} drawn as
                </span>
                <input
                  maxLength={60}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="Bear rally"
                  value={templateName}
                />
              </label>
              {/* Saving under a name already used REPLACES that shape, which is
                  what an officer correcting three tiles means. Said out loud
                  because it is the one thing here that can lose work. */}
              <button
                disabled={draft.size === 0 || templateName.trim() === '' || templateSave.isPending}
                type="submit"
              >
                {(templates.data ?? []).some(
                  (template) =>
                    template.name.trim().toLowerCase() === templateName.trim().toLowerCase(),
                )
                  ? 'Replace saved shape'
                  : 'Save shape'}
              </button>
            </form>
          </fieldset>

          <fieldset>
            <legend>Start from a shape</legend>
            <p className="subtle">
              Packed on a {BASE_SPAN}-tile pitch, centred on the anchor. Replaces what is drawn.
            </p>
            <div className="hive-shapes">
              {[3, 5, 7, 9].map((side) => (
                <button key={side} onClick={() => generate('block', side, side)} type="button">
                  {side}x{side} block
                </button>
              ))}
              {[5, 7, 9].map((side) => (
                <button
                  key={`ring-${side}`}
                  onClick={() => generate('ring', side, side)}
                  type="button"
                >
                  {side}x{side} ring
                </button>
              ))}
              <button onClick={() => setDraft(new Map())} type="button">
                Clear
              </button>
            </div>
          </fieldset>

          <p className="hive-count">
            {draft.size} tile{draft.size === 1 ? '' : 's'} drawn · {members.length} member
            {members.length === 1 ? '' : 's'} on the roster
            {draft.size < members.length && draft.size > 0 && (
              <>
                {' '}
                — <strong>{members.length - draft.size} would have nowhere to stand</strong>
              </>
            )}
          </p>

          <div className="hive-actions">
            <button
              className="primary"
              disabled={!unsaved || layoutSave.isPending || assignmentSave.isPending}
              onClick={saveEverything}
              type="button"
            >
              {layoutSave.isPending || assignmentSave.isPending
                ? 'Saving…'
                : !unsaved
                  ? 'Saved'
                  : dirty && assignmentsDirty
                    ? 'Save the shape and the people'
                    : dirty
                      ? 'Save the shape'
                      : 'Save who goes where'}
            </button>
            <button disabled={!dirty} onClick={() => setDraft(saved)} type="button">
              Discard changes
            </button>
          </div>
        </div>
      </div>

      {refusal !== null && <p className="error">{refusal}</p>}

      <h3>Who goes where</h3>
      {dirty ? (
        <p className="empty">
          This list comes back once the shape is saved — it reads the saved tiles, and some of these
          are not saved yet. Until then, drag names from above the map onto the bases; Save keeps
          them where they were dropped.
        </p>
      ) : ordered.length === 0 ? (
        <p className="empty">
          No member bases yet. Place some {BASE_SPAN}x{BASE_SPAN} bases above and save them.
        </p>
      ) : (
        <>
          <div className="hive-assign">
            <label>
              <span>Fill in order of</span>
              <select
                onChange={(event) => setOrder(event.target.value as AssignOrder)}
                value={order}
              >
                {ORDERS.map((option) => (
                  <option key={option} value={option}>
                    {assignOrderLabel(option)}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => {
                const result = autoAssign(ordered, members, { order, pinned });
                setAssignments(result.assignments);
                setRefusal(
                  result.unplaced.length === 0
                    ? null
                    : `${result.unplaced.length} member${result.unplaced.length === 1 ? ' has' : 's have'} no tile: the formation is smaller than the roster.`,
                );
              }}
              type="button"
            >
              Fill the empty tiles
            </button>
            <button onClick={() => setAssignments(new Map())} type="button">
              Empty every tile
            </button>
          </div>
          {/* PINS IN GROUPS, because the reason to pin is almost never one
              person. "The leaders stay where I put them" is one decision about
              a dozen tiles, and it was a dozen checkbox clicks down a table
              that does not say who is senior. */}
          <div className="hive-assign hive-pins">
            <span className="subtle">
              {pinned.size} of {pinnableCount} filled tile{pinnableCount === 1 ? '' : 's'} pinned
            </span>
            <button
              disabled={pinnableCount === 0}
              onClick={() => pinWhere(() => true)}
              type="button"
            >
              Pin every filled tile
            </button>
            <button
              disabled={pinnableCount === 0}
              onClick={() => pinWhere((member) => (member.memberRank ?? 0) >= 4)}
              type="button"
            >
              Pin R4 and R5
            </button>
            <button disabled={pinned.size === 0} onClick={() => setPinned(new Map())} type="button">
              Unpin everything
            </button>
          </div>
          <p className="subtle">
            Filling runs from the inside out: the innermost ring against Frankie is handed out
            first, so whoever sorts highest above stands closest. Choosing somebody by hand pins
            them, so a later fill leaves them where you put them — place the few whose position
            matters and let everybody else fall in around them. Nothing here is written until you
            press <strong>Save</strong> above, which saves the shape and the people together.
          </p>
          {/* NAMED, NOT COUNTED. "6 members not placed" is the one number an
              officer cannot act on: the next thing they do is work out WHO,
              and the roster is eighty names long. */}
          {unplaced.length > 0 && (
            <details className="hive-unplaced">
              <summary>
                <strong>
                  {unplaced.length} member{unplaced.length === 1 ? '' : 's'} not placed
                </strong>{' '}
                — nobody has told them where to go
              </summary>
              <ul>
                {sortMembers(unplaced, order).map((member) => (
                  <li key={member.playerId}>{memberLabel(member)}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="hive-assign">
            <label>
              <span>Sort the list by</span>
              <select
                onChange={(event) => setTableSort(event.target.value as 'name' | 'tile')}
                value={tableSort}
              >
                <option value="name">Member name (A–Z)</option>
                <option value="tile">Tile order (innermost first)</option>
              </select>
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
                <th>Ring</th>
                <th>Teleport to</th>
                <th>Note</th>
                <th>Member</th>
                <th>
                  {/* THE HEADER IS WHERE PEOPLE LOOK FOR SELECT-ALL, whatever
                      buttons sit above the table. Indeterminate when some are
                      pinned, so the box reports the state rather than only
                      offering an action. */}
                  <input
                    aria-label={
                      pinned.size === pinnableCount && pinnableCount > 0
                        ? 'Unpin every tile'
                        : 'Pin every filled tile'
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
                  Pin
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
                          BlueStacks — so pasting into the teleport box is the
                          shortest honest path from this table to the map. */}
                      <button
                        className="linklike"
                        onClick={() => {
                          void navigator.clipboard?.writeText(
                            formatCoordinate({ x: slot.x, y: slot.y }),
                          );
                          setCopied(slot.slotId);
                        }}
                        title="Copy this coordinate"
                        type="button"
                      >
                        <code>{formatCoordinate({ x: slot.x, y: slot.y })}</code>
                        {copied === slot.slotId ? ' ✓' : ''}
                      </button>
                    </td>
                    <td>{slot.label}</td>
                    <td>
                      <select
                        onChange={(event) => {
                          const next = new Map(assignments);
                          const pins = new Map(pinned);
                          if (event.target.value === '') {
                            next.delete(slot.slotId);
                            pins.delete(slot.slotId);
                          } else {
                            // Removed from wherever they were: the save
                            // refuses one member on two tiles, and finding
                            // that out from a database error message is a
                            // worse way to learn it.
                            for (const [key, value] of next) {
                              if (value === event.target.value) {
                                next.delete(key);
                                pins.delete(key);
                              }
                            }
                            next.set(slot.slotId, event.target.value);
                            // Choosing somebody by hand IS a pin. Otherwise
                            // the next fill would quietly undo it.
                            pins.set(slot.slotId, event.target.value);
                          }
                          setAssignments(next);
                          setPinned(pins);
                        }}
                        value={chosen}
                      >
                        <option value="">— empty —</option>
                        {/* RANK AND POWER IN THE OPTION, because the inner
                            ring is picked by hand and "who are my R4s" is the
                            question being answered while the list is open.
                            A name alone made that a separate lookup. */}
                        {members.map((member) => (
                          <option key={member.playerId} value={member.playerId}>
                            {memberLabel(member)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label={`Pin tile ${slot.ordinal}`}
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
}: {
  at: Coordinate;
  label: string;
  onSubmit: (to: Coordinate) => void;
  submitLabel: string;
}) {
  const [x, setX] = useState(String(at.x));
  const [y, setY] = useState(String(at.y));
  const [seed, setSeed] = useState(at);
  if (seed !== at && (seed.x !== at.x || seed.y !== at.y)) {
    setSeed(at);
    setX(String(at.x));
    setY(String(at.y));
  }
  const parsed = { x: Number.parseInt(x, 10), y: Number.parseInt(y, 10) };
  const usable = tileFitsOnMap(parsed, BASE_SPAN, BASE_SPAN);
  return (
    <div className="hive-coordinate">
      <label>
        <span>{label} x</span>
        <input inputMode="numeric" onChange={(event) => setX(event.target.value)} value={x} />
      </label>
      <label>
        <span>y</span>
        <input inputMode="numeric" onChange={(event) => setY(event.target.value)} value={y} />
      </label>
      <button disabled={!usable} onClick={() => onSubmit(parsed)} type="button">
        {submitLabel}
      </button>
    </div>
  );
}
