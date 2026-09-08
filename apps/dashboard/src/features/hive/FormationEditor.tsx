import { type Coordinate, formatCoordinate } from '@dw/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  type AssignOrder,
  type AssignableMember,
  BASE_SPAN,
  type Offset,
  absoluteOf,
  assignOrderLabel,
  autoAssign,
  blockOffsets,
  canPlace,
  centreFitsOnMap,
  coversTile,
  offsetKey,
  readingOrder,
  ringOffsets,
  sortSlots,
} from '../../lib/hiveFormation';
import { type GridBase, type GridSighting, TileGrid, windowAround } from './TileGrid';
import {
  type BoardSlot,
  type Formation,
  saveAssignments,
  saveLayout,
  updateFormation,
  useOccupiedTiles,
} from './hiveFormations';

/** A tile in the draft, before it has ever been saved and has an id. */
interface DraftSlot extends Offset {
  ordinal: number;
  label: string;
}

const ORDERS: readonly AssignOrder[] = ['power', 'hq', 'rank', 'name'];

/** How far either side of the centre the window reaches, in tiles.
 *
 * The middle value shows a nine-wide hive with room around it, which is what
 * this is used at; the wide one is for finding somewhere to put it, and the
 * close one for the last tile of an awkward corner.
 */
const ZOOMS = [8, 14, 22, 34] as const;

function draftFromBoard(slots: readonly BoardSlot[]): Map<string, DraftSlot> {
  return new Map(
    slots.map((slot) => [
      offsetKey(slot),
      { dx: slot.dx, dy: slot.dy, ordinal: slot.ordinal, label: slot.label },
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

  const layoutSave = useMutation({
    mutationFn: () =>
      saveLayout(
        formation.formationId,
        [...draft.values()]
          .sort(readingOrder)
          .map((slot, index) => ({ ...slot, ordinal: index + 1 })),
      ),
    onSuccess: (summary) => {
      setRefusal(
        summary.unassigned === 0
          ? null
          : `Saved. ${summary.unassigned} member${summary.unassigned === 1 ? '' : 's'} lost a tile, because the tile they were on is gone.`,
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
    next.set(offsetKey(candidate), { ...candidate, ordinal: draft.size + 1, label: '' });
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
    const usable = offsets.filter((offset) => centreFitsOnMap(absoluteOf(anchor, offset)));
    setDraft(
      new Map(
        [...usable]
          .sort(readingOrder)
          .map((offset, index) => [
            offsetKey(offset),
            { ...offset, ordinal: index + 1, label: '' },
          ]),
      ),
    );
    setRefusal(
      usable.length === offsets.length
        ? null
        : `${offsets.length - usable.length} tiles were dropped: they fell off the edge of the map from this anchor.`,
    );
  }

  const byId = new Map(members.map((member) => [member.playerId, member]));
  const placedIds = new Set(assignments.values());
  const unplaced = members.filter((member) => !placedIds.has(member.playerId));
  const ordered = sortSlots(slots);

  // NUMBERED BY READING ORDER, WHICH IS WHAT THE SAVE WRITES. The draft holds
  // whatever ordinal a tile was given when it was placed, and after a few
  // removals those repeat — two tiles both captioned "10" is how this was
  // found. The saved numbering is the reading order (north row first, west to
  // east), so showing anything else here would be a number that changes the
  // moment it is saved.
  //
  // The column itself can still hold a planner's own numbering; nothing in
  // this editor offers a way to type one yet, so nothing pretends to.
  const numbering = new Map(
    [...drawn].sort(readingOrder).map((slot, index) => [offsetKey(slot), index + 1] as const),
  );

  const bases: GridBase[] = drawn.map((slot) => {
    const at = absoluteOf(anchor, slot);
    const savedSlot = slots.find((row) => row.dx === slot.dx && row.dy === slot.dy);
    const assigned = savedSlot === undefined ? undefined : assignments.get(savedSlot.slotId);
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
            onPick={pick}
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
            {ZOOMS.map((step) => (
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
            A pinned tile keeps its member when you fill the rest — place the few whose position
            matters, pin them, and let everybody else fall in around them.
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
