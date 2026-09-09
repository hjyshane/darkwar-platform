import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  type AssignOrder,
  type AssignableMember,
  BASE_SPAN,
  FRANKIE,
  type Offset,
  type SizedOffset,
  TILE_COLOURS,
  type TileColour,
  type TileKind,
  absoluteOf,
  assignOrderLabel,
  autoAssign,
  blockOffsets,
  canPlace,
  footprintOf,
  offsetKey,
  ringOffsets,
  ringOrderAround,
  sortSlots,
  tileFitsOnMap,
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
  fetchBoard,
  saveAssignments,
  saveLayout,
  updateFormation,
  useOccupiedTiles,
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
}

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
  });
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
      // Structures are numbered too, but after the bases: the ordinal drives
      // who gets handed a tile first, and ground is never handed to anybody.
      const wanted = [...draft.values()]
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
      const summary = await saveLayout(
        formation.formationId,
        wanted.map(({ playerId: _ignored, ...tile }) => tile),
      );
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
      label: '',
      kind: brush.kind,
      colour: brush.colour,
      playerId: null,
    });
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
            <div className="hive-shapes">
              {[
                {
                  label: `Base ${BASE_SPAN}x${BASE_SPAN}`,
                  spanX: BASE_SPAN,
                  spanY: BASE_SPAN,
                  kind: 'base' as TileKind,
                  colour: null,
                },
                {
                  label: `Frankie ${FRANKIE.spanX}x${FRANKIE.spanY}`,
                  spanX: FRANKIE.spanX,
                  spanY: FRANKIE.spanY,
                  kind: 'structure' as TileKind,
                  colour: 'amber' as TileColour,
                },
                {
                  label: 'Marker 1x1',
                  spanX: 1,
                  spanY: 1,
                  kind: 'structure' as TileKind,
                  colour: 'red' as TileColour,
                },
              ].map((preset) => (
                <button
                  key={preset.label}
                  onClick={() =>
                    setBrush({
                      spanX: preset.spanX,
                      spanY: preset.spanY,
                      kind: preset.kind,
                      colour: preset.colour,
                    })
                  }
                  type="button"
                >
                  {preset.label}
                </button>
              ))}
            </div>
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
