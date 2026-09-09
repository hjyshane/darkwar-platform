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
  canPlace,
  footprintOf,
  freeTilesIn,
  offsetKey,
  ringOffsets,
  ringOrderAround,
  sortSlots,
  tileFitsOnMap,
  tileInsideBox,
  tilesOverlap,
} from '../../lib/hiveFormation';
import { type Coordinate, formatCoordinate } from '../../lib/mapProjection';
import {
  type GridBase,
  type GridSighting,
  TileGrid,
  ZOOM_STEPS,
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

/** A tile in the draft, before it has ever been saved and has an id.
 *
 * IT CARRIES ITS MEMBER, which a saved slot does by having an id an
 * assignment points at. A draft tile has no id — it is identified by where it
 * is — so moving one would otherwise leave the member behind on ground that
 * no longer exists. Dragging a base means "move this person", and the name
 * has to travel with the square both on screen and through the save. */
interface DraftSlot extends SizedOffset {
  ordinal: number;
  label: string;
  kind: TileKind;
  colour: TileColour | null;
  playerId: string | null;
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

/** What a drag does. Clicking a tile places or removes one in every mode. */
type Tool = 'draw' | 'mark' | 'erase';

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
        playerId: slot.playerId,
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
        playerId: null,
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
  const [order, setOrder] = useState<AssignOrder>('power');
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
    setPinned(new Map());
  }

  const anchor: Coordinate = { x: formation.anchorX, y: formation.anchorY };
  const view = windowAround(centre, zoom);
  const drawn = [...draft.values()];
  const structures = drawn.filter((slot) => slot.kind === 'structure');
  const byRing = ringOrderAround(structures);
  const dirty = !sameLayout(draft, saved);

  /** The draft in the order it will be numbered.
   *
   * ONE ORDERING, USED BY BOTH THINGS THAT WRITE THE DRAFT OUT. The ordinal
   * drives who is handed a tile first, so a shape saved as a template has to
   * be numbered by the same rule the formation is — otherwise loading a saved
   * shape back would quietly reorder the fill, and the innermost ring would
   * stop being the one that gets the strongest members.
   *
   * Structures come after bases: ground is never handed to anybody.
   */
  function orderedDraft(): (LayoutTile & { playerId: string | null })[] {
    return [...draft.values()]
      .sort((a, b) => (a.kind === b.kind ? byRing(a, b) : a.kind === 'base' ? -1 : 1))
      .map((slot, index) => ({
        dx: slot.dx,
        dy: slot.dy,
        ordinal: index + 1,
        label: slot.label,
        span_x: slot.spanX,
        span_y: slot.spanY,
        kind: slot.kind,
        colour: slot.colour,
        playerId: slot.playerId,
      }));
  }

  /** The same list with the members stripped off — what actually goes on the
   * wire, to the layout call and to a saved shape alike. A template that
   * remembered who stood where would be a stale roster in a new place. */
  function layoutForSave(): LayoutTile[] {
    return orderedDraft().map(({ playerId: _ignored, ...tile }) => tile);
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
   * The draft carries each member with their square, so once the layout lands
   * the board is read back and everybody is put on the tile they were drawn
   * on. `assign_hive_formation_slots` replaces the whole map in one
   * transaction, which is what makes re-applying safe rather than eighty
   * updates that can half-fail.
   *
   * A member whose tile was deleted outright has nowhere to go back to, and
   * is reported rather than quietly dropped.
   */
  const layoutSave = useMutation({
    mutationFn: async () => {
      const wanted = orderedDraft();
      const summary = await saveLayout(formation.formationId, layoutForSave());
      const carried = new Map(
        wanted.flatMap((slot) =>
          slot.playerId === null ? [] : [[offsetKey(slot), slot.playerId] as const],
        ),
      );
      const saved = await fetchBoard(formation.formationId);
      await saveAssignments(
        formation.formationId,
        saved.map((slot) => ({
          slot_id: slot.slotId,
          player_id: carried.get(offsetKey(slot)) ?? null,
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
      playerId: null,
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

    const free = freeTilesIn(box, anchor, drawn);
    if (free.length === 0) {
      setRefusal(`Every one of those ${boxArea(box)} tiles is already spoken for.`);
      return;
    }
    // THE CEILING IS THE BOARD QUERY'S, not a view about hive size. Past 500
    // tiles `fetchBoard` returns fewer rows without saying so, and the
    // formation would read as complete while missing whatever fell off the
    // end. A sweep is the first gesture here that can add hundreds at once.
    if (draft.size + free.length > MAX_TILES) {
      setRefusal(
        `That area needs ${free.length} markers and only ${MAX_TILES - draft.size} will fit — a formation stops being readable past ${MAX_TILES} tiles.`,
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
        playerId: null,
      });
    }
    setDraft(next);
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
    const landing: SizedOffset = {
      dx: to.x - anchor.x,
      dy: to.y - anchor.y,
      spanX: held.spanX,
      spanY: held.spanY,
    };
    const next = new Map(draft);
    next.delete(offsetKey(moving));
    // Everything but the position rides along; the ordinal is renumbered by
    // the save anyway, and a moved base may well have changed ring.
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
      playerId: null,
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
                playerId: null,
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

  const byId = new Map(members.map((member) => [member.playerId, member]));
  const placedIds = new Set(assignments.values());
  const unplaced = members.filter((member) => !placedIds.has(member.playerId));
  // Structures hold ground rather than people, so they are not in the
  // assignment table at all — the database refuses a player on one anyway.
  const ordered = sortSlots(
    slots.filter((slot) => slot.kind === 'base'),
    structures,
  );

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
      .filter((slot) => slot.kind === 'base')
      .sort(byRing)
      .map((slot, index) => [offsetKey(slot), index + 1] as const),
  );

  const bases: GridBase[] = drawn.map((slot) => {
    const at = absoluteOf(anchor, slot);
    const savedSlot = slots.find((row) => row.dx === slot.dx && row.dy === slot.dy);
    // FROM THE DRAFT FIRST. A tile that has been dragged has no saved slot to
    // look up any more, and falling back to the number made the member's name
    // vanish the instant the base was picked up — which reads as "I have just
    // deleted this person" rather than "I have moved them".
    const assigned =
      slot.playerId ??
      (savedSlot === undefined ? undefined : assignments.get(savedSlot.slotId)) ??
      undefined;
    return {
      key: offsetKey(slot),
      at,
      spanX: slot.spanX,
      spanY: slot.spanY,
      structure: slot.kind === 'structure',
      colour: slot.colour,
      caption:
        slot.kind === 'structure'
          ? slot.label
          : assigned === undefined
            ? String(numbering.get(offsetKey(slot)) ?? '?')
            : (byId.get(assigned)?.name ?? '?'),
      own: assigned !== undefined && assigned === ownPlayerId,
      stale: savedSlot?.stillAMember === false,
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
          <TileGrid
            anchor={anchor}
            bases={bases}
            busy={layoutSave.isPending}
            canMoveTo={canMove}
            onMove={move}
            onPick={pick}
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
            Click free ground to place a base, click a base to take it away. Each one is {BASE_SPAN}
            x{BASE_SPAN} tiles and the coordinate is the middle. Shaded squares are where the map
            last SAW somebody — a base that was destroyed or lost its shield has been teleported
            somewhere random, so treat them as a hint and not as a wall.
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
                    'Mark an area',
                    'Drag out a rectangle and fill every free tile in it with a 1x1 marker, in the brush\u2019s colour and caption. Goes around whatever is already drawn.',
                  ],
                  [
                    'erase',
                    'Erase an area',
                    'Drag out a rectangle and take its 1x1 markers back out. Bases are left alone.',
                  ],
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  aria-pressed={tool === value}
                  key={value}
                  onClick={() => {
                    setTool(value);
                    setRefusal(null);
                  }}
                  title={hint}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
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
              disabled={!dirty || layoutSave.isPending}
              onClick={() => layoutSave.mutate()}
              type="button"
            >
              {layoutSave.isPending ? 'Saving…' : 'Save the shape'}
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
          Save the shape first. A tile has no identity until it is saved, so there is nothing to
          assign anybody to yet — and assigning eighty people to ground that is about to move is how
          a plan goes out wrong.
        </p>
      ) : slots.length === 0 ? (
        <p className="empty">Draw some tiles above and save them.</p>
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
            <button
              disabled={assignmentSave.isPending}
              onClick={() => assignmentSave.mutate()}
              type="button"
            >
              {assignmentSave.isPending ? 'Saving…' : 'Save who goes where'}
            </button>
          </div>
          <p className="subtle">
            Filling runs from the inside out: the innermost ring against Frankie is handed out
            first, so whoever sorts highest above stands closest. A pinned tile keeps its member
            when you fill the rest — place the few whose position matters, pin them, and let
            everybody else fall in around them.
            {unplaced.length > 0 && (
              <>
                {' '}
                <strong>
                  {unplaced.length} member{unplaced.length === 1 ? '' : 's'} not placed.
                </strong>
              </>
            )}
          </p>
          <table className="table hive-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Teleport to</th>
                <th>Note</th>
                <th>Member</th>
                <th>Pin</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((slot) => {
                const chosen = assignments.get(slot.slotId) ?? '';
                return (
                  <tr key={slot.slotId}>
                    <td>{slot.ordinal}</td>
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
                        {members.map((member) => (
                          <option key={member.playerId} value={member.playerId}>
                            {member.name ?? 'unnamed'}
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
