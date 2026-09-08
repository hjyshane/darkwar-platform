import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  type AssignOrder,
  type AssignableMember,
  BASE_SPAN,
  CENTRE_SPAN,
  type Offset,
  absoluteOf,
  assignOrderLabel,
  autoAssign,
  blockOffsets,
  canPlace,
  centreFitsOnMap,
  coversTile,
  offsetKey,
  overlapsCentre,
  ringOffsets,
  ringOrder,
  sortSlots,
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
interface DraftSlot extends Offset {
  ordinal: number;
  label: string;
  playerId: string | null;
}

const ORDERS: readonly AssignOrder[] = ['power', 'hq', 'rank', 'name'];

function draftFromBoard(slots: readonly BoardSlot[]): Map<string, DraftSlot> {
  return new Map(
    slots.map((slot) => [
      offsetKey(slot),
      {
        dx: slot.dx,
        dy: slot.dy,
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
    if (other === undefined || other.ordinal !== slot.ordinal || other.label !== slot.label) {
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
      const wanted = [...draft.values()]
        .sort(ringOrder)
        .map((slot, index) => ({ ...slot, ordinal: index + 1 }));
      const summary = await saveLayout(formation.formationId, wanted);
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
    const hit = drawn.find((slot) => coversTile(absoluteOf(anchor, slot), tile));
    if (hit !== undefined) {
      const next = new Map(draft);
      next.delete(offsetKey(hit));
      setDraft(next);
      setRefusal(null);
      return;
    }
    const candidate: Offset = { dx: tile.x - anchor.x, dy: tile.y - anchor.y };
    if (!centreFitsOnMap(tile)) {
      setRefusal(
        `A base centred on ${formatCoordinate(tile)} would need tiles off the edge of the map — its ${BASE_SPAN}x${BASE_SPAN} footprint does not fit.`,
      );
      return;
    }
    if (overlapsCentre(candidate)) {
      setRefusal(
        `Frankie stands there. The centre is ${CENTRE_SPAN.x}x${CENTRE_SPAN.y} tiles, not ${BASE_SPAN}x${BASE_SPAN} — the shaded rectangle is the ground it needs.`,
      );
      return;
    }
    if (!canPlace(drawn, candidate)) {
      const clash = drawn.find(
        (slot) =>
          coversTile(absoluteOf(anchor, slot), tile) ||
          (Math.abs(slot.dx - candidate.dx) < BASE_SPAN &&
            Math.abs(slot.dy - candidate.dy) < BASE_SPAN),
      );
      setRefusal(
        clash === undefined
          ? 'That tile is taken.'
          : `A base there would share ground with the one at ${formatCoordinate(absoluteOf(anchor, clash))}. Centres need three tiles between them.`,
      );
      return;
    }
    const next = new Map(draft);
    // The ordinal here is a placeholder: `layoutSave` renumbers the whole
    // formation by reading order, and `numbering` above shows that rather
    // than this. Using `draft.size + 1` would repeat after a removal.
    next.set(offsetKey(candidate), {
      ...candidate,
      ordinal: draft.size + 1,
      label: '',
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
    const moving: Offset = { dx: from.x - anchor.x, dy: from.y - anchor.y };
    const landing: Offset = { dx: to.x - anchor.x, dy: to.y - anchor.y };
    if (!centreFitsOnMap(to) || overlapsCentre(landing)) {
      return false;
    }
    const others = drawn.filter((slot) => offsetKey(slot) !== offsetKey(moving));
    return canPlace(others, landing);
  }

  /** Put a dragged base down. The grid has already refused an invalid drop,
   * and this refuses it again — the two are cheap and the grid's answer is a
   * frame old by the time the pointer comes up. */
  function move(from: Coordinate, to: Coordinate) {
    const moving: Offset = { dx: from.x - anchor.x, dy: from.y - anchor.y };
    const landing: Offset = { dx: to.x - anchor.x, dy: to.y - anchor.y };
    const held = draft.get(offsetKey(moving));
    if (held === undefined || !canMove(from, to)) {
      return;
    }
    const next = new Map(draft);
    next.delete(offsetKey(moving));
    // The label rides along; the ordinal does not, because the save renumbers
    // by ring and a moved base may well have changed ring.
    next.set(offsetKey(landing), {
      ...landing,
      ordinal: held.ordinal,
      label: held.label,
      playerId: held.playerId,
    });
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
    // TWO REASONS A GENERATED TILE IS DROPPED, and they are worth telling
    // apart: one is the edge of the world and the other is Frankie. A block
    // centred on the anchor always puts a base on top of it, so the second
    // number is never zero and reads as normal rather than as a fault.
    const onMap = offsets.filter((offset) => centreFitsOnMap(absoluteOf(anchor, offset)));
    const usable = onMap.filter((offset) => !overlapsCentre(offset));
    setDraft(
      new Map(
        [...usable]
          .sort(ringOrder)
          .map((offset, index) => [
            offsetKey(offset),
            { ...offset, ordinal: index + 1, label: '', playerId: null },
          ]),
      ),
    );
    const offMap = offsets.length - onMap.length;
    const onFrankie = onMap.length - usable.length;
    const notes = [
      offMap > 0 ? `${offMap} fell off the edge of the map` : '',
      onFrankie > 0 ? `${onFrankie} would have stood on Frankie` : '',
    ].filter(Boolean);
    setRefusal(notes.length === 0 ? null : `${usable.length} tiles drawn — ${notes.join(', ')}.`);
  }

  const byId = new Map(members.map((member) => [member.playerId, member]));
  const placedIds = new Set(assignments.values());
  const unplaced = members.filter((member) => !placedIds.has(member.playerId));
  const ordered = sortSlots(slots);

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
    [...drawn].sort(ringOrder).map((slot, index) => [offsetKey(slot), index + 1] as const),
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
      caption:
        assigned === undefined
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
                      <code>{formatCoordinate({ x: slot.x, y: slot.y })}</code>
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
  const usable = centreFitsOnMap(parsed);
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
