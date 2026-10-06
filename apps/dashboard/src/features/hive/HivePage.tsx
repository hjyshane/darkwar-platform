import type { Coordinate } from '@dw/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/ui/Select';
import { Tabs } from '../../components/ui/Tabs';
import {
  footprintOf,
  formatTeleport,
  isMemberBase,
  memberNumbering,
  offsetKey,
  tileCaption,
} from '../../lib/hiveFormation';
import { isAllowed, usePermissions } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { useSession } from '../../lib/useSession';
import { FormationEditor } from './FormationEditor';
import {
  type GridBase,
  TileGrid,
  ZOOM_STEPS,
  pannedCentre,
  windowAround,
  windowFitting,
  zoomStep,
} from './TileGrid';
import {
  type BoardSlot,
  type Formation,
  createFormation,
  deleteFormation,
  handoutList,
  makeActive,
  useAssignableMembers,
  useBoard,
  useFormations,
} from './hiveFormations';

type HiveTab = 'plan' | 'shape' | 'people';

const HIVE_TABS: readonly { id: HiveTab; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'shape', label: 'Draw the shape' },
  { id: 'people', label: 'Who goes where' },
];

/** Where each member is told to put their base.
 *
 * THE PROBLEM IS NOT THAT PEOPLE WON'T LINE UP, IT IS THAT THEY CANNOT. A
 * hive move is announced in chat and then eighty people each choose a tile
 * that looks free, in a game that shows them a coordinate and not the nine
 * squares that coordinate stands for. The result is a formation nobody
 * intended and a second round of teleport items to fix it.
 *
 * So this screen has exactly one job for a member: show them one coordinate,
 * theirs, and let them get on with it. Everything else here is the officer's
 * side of producing that coordinate.
 */
export function HivePage() {
  const { data: session } = useSession();
  const { data: permissions } = usePermissions();
  const mayPlan = isAllowed(permissions?.grants, session?.role, 'hive.plan');

  const { data: servers } = useQuery({
    queryKey: ['hive', 'servers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('servers').select('server_id').order('server_id');
      if (error) {
        // A refusal is an answer. The picker disappears and the formations
        // that exist are still listed by the server they name.
        return [] as number[];
      }
      return (data ?? []).map((row) => row.server_id);
    },
    staleTime: 60 * 60_000,
  });

  const [chosenServer, setChosenServer] = useState<number | null>(null);
  const allFormations = useFormations(null);
  // The server the live plan is on, so opening the tab lands on the ground
  // the alliance is actually moving to rather than on the lowest server id.
  const defaultServer =
    allFormations.data?.find((formation) => formation.isActive)?.serverId ??
    allFormations.data?.[0]?.serverId ??
    servers?.[0] ??
    null;
  const serverId = chosenServer ?? defaultServer;
  const formations = (allFormations.data ?? []).filter(
    (formation) => formation.serverId === serverId,
  );

  const [chosenFormation, setChosenFormation] = useState<string | null>(null);
  const [tab, setTab] = useState<HiveTab>('plan');
  const active = formations.find((formation) => formation.isActive) ?? formations[0] ?? null;
  const formation =
    formations.find((candidate) => candidate.formationId === chosenFormation) ?? active;

  const board = useBoard(formation?.formationId ?? null);
  const members = useAssignableMembers();

  if (allFormations.isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (allFormations.error) {
    return (
      <p className="error">Could not load formations: {(allFormations.error as Error).message}</p>
    );
  }

  return (
    <section aria-labelledby="hive-heading">
      <h2 id="hive-heading">{TERMS.hive}</h2>

      {formation === null ? (
        <p className="empty">
          No formation has been drawn yet.{' '}
          {mayPlan
            ? 'Pick a server and start one below.'
            : 'An officer draws one before a hive move; your tile will appear here when they do.'}
        </p>
      ) : (
        <>
          <MyTile
            board={board.data ?? []}
            formation={formation}
            playerId={session?.playerId ?? null}
          />
          <div className="hive-picker">
            <label>
              <span>Server</span>
              <Select
                onChange={(chosen) => {
                  setChosenServer(Number.parseInt(chosen, 10));
                  setChosenFormation(null);
                }}
                value={serverId ?? ''}
              >
                {(servers ?? []).map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              <span>Formation</span>
              <Select
                onChange={(chosen) => setChosenFormation(chosen)}
                value={formation.formationId}
              >
                {formations.map((candidate) => (
                  <option key={candidate.formationId} value={candidate.formationId}>
                    {candidate.name}
                    {candidate.isActive ? ' · live' : ''}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          {/* THREE VIEWS, NOT ONE PAGE. The live plan, the drawing tools and
              the eighty-row assignment table used to stand one under another,
              so an officer reached the table by scrolling past two maps and
              every control, and back up again to save. Members never see the
              tabs: the plan is all they have. */}
          {mayPlan && (
            <Tabs
              label="Hive view"
              items={HIVE_TABS.map((candidate) => ({ id: candidate.id, label: candidate.label }))}
              value={tab}
              onChange={setTab}
            />
          )}

          {/* Keyed by the formation so switching plans starts the view over.
              The grid's centre and zoom are component state; without the key
              a pan on one formation left the view parked on that ground when
              the picker (or a promotion) swapped the formation underneath,
              and the new plan appeared to have no bases until you dragged
              back to wherever its anchor was. */}
          {(!mayPlan || tab === 'plan') && (
            <Overview
              board={board.data ?? []}
              formation={formation}
              key={formation.formationId}
              mayPlan={mayPlan}
              ownPlayerId={session?.playerId ?? null}
            />
          )}
        </>
      )}

      {mayPlan && serverId !== null && (formation === null || tab === 'shape') && (
        <NewFormation
          onCreated={setChosenFormation}
          serverId={serverId}
          suggested={formations.length + 1}
        />
      )}

      {/* Keyed for the same reason as Overview — and here the unkeyed version
          only LOOKED right: switching formations usually unmounted the editor
          through the `board.isPending` gate below, but a board already in the
          query cache skips the pending state, and the editor then kept the
          previous formation's centre, zoom, tool and selection.

          HIDDEN, NOT UNMOUNTED, on the plan tab: the editor holds the unsaved
          draft, and looking at the live plan for a moment must not throw away
          twenty minutes of drawing. */}
      {mayPlan && formation !== null && !board.isPending && (
        <div hidden={tab === 'plan'}>
          <FormationEditor
            formation={formation}
            key={formation.formationId}
            members={members.data ?? []}
            ownPlayerId={session?.playerId ?? null}
            slots={board.data ?? []}
            half={tab === 'people' ? 'people' : 'shape'}
          />
        </div>
      )}
    </section>
  );
}

/** The one line a member came for.
 *
 * FIRST ON THE SCREEN AND BEFORE ANY TABLE. Eighty people do not need the
 * formation; they need their own square, once, without scrolling a list
 * looking for their name. When the plan on screen is not the live one this
 * says so, because reading a coordinate off a draft is exactly the mistake
 * the screen exists to prevent.
 */
function MyTile({
  board,
  formation,
  playerId,
}: {
  board: readonly BoardSlot[];
  formation: Formation;
  playerId: string | null;
}) {
  if (playerId === null) {
    return (
      <p className="subtle">
        This account is not linked to a character yet, so it cannot say which tile is yours. Link it
        from <a href="#/account">My account</a> and it will.
      </p>
    );
  }
  const mine = board.find((slot) => slot.playerId === playerId);
  if (mine === undefined) {
    return (
      <p className="empty">
        You have no tile in <strong>{formation.name}</strong> yet.
      </p>
    );
  }
  return (
    <p className="hive-mine">
      <span>Your tile in {formation.name}</span>
      <strong>
        <code>{formatTeleport({ x: mine.x, y: mine.y })}</code>
      </strong>
      {mine.label !== '' && <span>{mine.label}</span>}
      {!formation.isActive && (
        <span className="hive-mine__draft">
          This plan is not live yet — wait for the officer to say so before you teleport.
        </span>
      )}
    </p>
  );
}

/** The formation as a picture and as a list, for everybody.
 *
 * The list is the half that gets pasted into chat, so it is plain text and
 * ordered the way the shape reads — north row first, west to east. Somebody
 * checking the paste against the picture has to be able to follow both with
 * one finger.
 */
function Overview({
  board,
  formation,
  mayPlan,
  ownPlayerId,
}: {
  board: readonly BoardSlot[];
  formation: Formation;
  mayPlan: boolean;
  ownPlayerId: string | null;
}) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const anchor = { x: formation.anchorX, y: formation.anchorY };
  // OPENS ON THE WHOLE FORMATION. Both are null until the member zooms or
  // drags; until then the window is whatever shows every tile, so nobody has
  // to pan to find where they stand. The read-only grid still zooms and pans —
  // a member checking their own square wants to get close to it.
  const [zoom, setZoom] = useState<number | null>(null);
  const [centre, setCentre] = useState<Coordinate | null>(null);
  // Fitted to the MEMBERS' BASES, not to every tile: a boundary drawn round a
  // wide area would otherwise zoom the picture out until the names it exists
  // to show were too small to print. Everything drawn, when nobody is placed.
  const fitted = (tiles: readonly BoardSlot[]) =>
    windowFitting(
      tiles.map((slot) => footprintOf({ x: slot.x, y: slot.y }, slot.spanX, slot.spanY)),
    );
  const home = fitted(board.filter(isMemberBase)) ??
    fitted(board) ?? { centre: anchor, radius: 14 };
  const radius = zoom ?? home.radius;
  const view = windowAround(centre ?? home.centre, radius);
  // The editor's numbering, so the "7" an officer calls out is the "7" here.
  const numbering = memberNumbering(board);
  const bases: GridBase[] = board.map((slot) => ({
    key: slot.slotId,
    at: { x: slot.x, y: slot.y },
    // Drawn as what it is. Frankie was a 3x3 base numbered "1" here, and a
    // boundary marker a numbered base, because none of this was passed.
    spanX: slot.spanX,
    spanY: slot.spanY,
    structure: slot.kind === 'structure',
    colour: slot.colour,
    caption: tileCaption(slot, slot.playerName, numbering.get(offsetKey(slot))),
    // THE READER'S OWN TILE, on the grid every member sees rather than only
    // in the editor. The line above the picture already says the coordinate;
    // this is what lets somebody check it against the shape before they
    // teleport, which is the whole reason the picture is here.
    own: ownPlayerId !== null && slot.playerId === ownPlayerId,
  }));

  const stand = useMutation({
    mutationFn: () => makeActive(formation.formationId, formation.serverId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hive'] }),
  });
  const remove = useMutation({
    mutationFn: () => deleteFormation(formation.formationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hive'] }),
  });

  const text = handoutList(board);
  const departed = board.filter((slot) => slot.departedName !== null);

  return (
    <>
      <p className="subtle">
        {formation.isActive ? 'Live plan' : 'Draft'} on server {formation.serverId}, anchored at{' '}
        <code>{formatTeleport(anchor)}</code>. {board.length} tile
        {board.length === 1 ? '' : 's'}, {board.filter((slot) => slot.playerId !== null).length}{' '}
        filled.
      </p>

      {departed.length > 0 && (
        <p className="subtle">
          {departed.length} tile{departed.length === 1 ? ' is' : 's are'} empty again because the
          member left the alliance ({departed.map((slot) => slot.departedName).join(', ')}).
        </p>
      )}

      {/* THE LIST BESIDE THE MAP when there is room for both. Stacked, the
          list sits a map's height below the picture it describes, and checking
          one against the other means scrolling between them; side by side it
          is one glance. A narrow window keeps the stack — the list under the
          map is still the right order for a phone. */}
      <div className="hive-overview">
        <div className="hive-overview__map">
          <TileGrid
            anchor={anchor}
            bases={bases}
            // `centre` is null until somebody looks somewhere else, so the first
            // pan step has to start from the fitted centre rather than from
            // nothing — otherwise the view jumps to 0,0 on the first tile of the
            // drag.
            onPan={(byX, byY) => setCentre((from) => pannedCentre(from ?? home.centre, byX, byY))}
            onZoom={(direction, at) => {
              setZoom(zoomStep(radius, direction));
              setCentre(at);
            }}
            window={view}
          />
          <p className="subtle">
            Drag the map to slide it. Hold <kbd>ctrl</kbd> and use the wheel to zoom.
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
            <button
              aria-pressed={zoom === null && centre === null}
              onClick={() => {
                setZoom(null);
                setCentre(null);
              }}
              type="button"
            >
              Whole plan
            </button>
          </fieldset>
        </div>

        <div className="hive-overview__list">
          <OverviewActions
            board={board}
            confirming={confirming}
            copied={copied}
            formation={formation}
            mayPlan={mayPlan}
            onCancel={() => setConfirming(false)}
            onCopy={() => {
              void navigator.clipboard?.writeText(text);
              setCopied(true);
            }}
            onDelete={() => (confirming ? remove.mutate() : setConfirming(true))}
            onStand={() => stand.mutate()}
            removing={remove.isPending}
            standing={stand.isPending}
          />
          {board.length > 0 && <pre className="hive-list">{text}</pre>}
        </div>
      </div>
    </>
  );
}

function OverviewActions({
  board,
  confirming,
  copied,
  formation,
  mayPlan,
  onCancel,
  onCopy,
  onDelete,
  onStand,
  removing,
  standing,
}: {
  board: readonly BoardSlot[];
  confirming: boolean;
  copied: boolean;
  formation: Formation;
  mayPlan: boolean;
  onCancel: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onStand: () => void;
  removing: boolean;
  standing: boolean;
}) {
  return (
    <>
      <div className="hive-actions">
        <button onClick={onCopy} type="button">
          {copied ? 'Copied' : 'Copy the list'}
        </button>
        {mayPlan && !formation.isActive && (
          <button disabled={standing} onClick={onStand} type="button">
            Make this the live plan
          </button>
        )}
        {/* TWO PRESSES, following LeaveAllianceForm. Deleting takes the
            tiles and every assignment on them with it, there is no history
            to recover them from, and this button sits next to one that only
            copies text. */}
        {mayPlan && (
          <button disabled={removing} onClick={onDelete} type="button">
            {removing
              ? 'Deleting…'
              : confirming
                ? `Really delete ${formation.name} and its ${board.length} tiles?`
                : 'Delete this formation'}
          </button>
        )}
        {confirming && !removing && (
          <button onClick={onCancel} type="button">
            Keep it
          </button>
        )}
      </div>
    </>
  );
}

function NewFormation({
  onCreated,
  serverId,
  suggested,
}: {
  onCreated: (formationId: string) => void;
  serverId: number;
  suggested: number;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [x, setX] = useState('500');
  const [y, setY] = useState('500');
  const create = useMutation({
    mutationFn: () =>
      createFormation({
        name: name.trim() === '' ? `Formation ${suggested}` : name.trim(),
        serverId,
        anchorX: Number.parseInt(x, 10),
        anchorY: Number.parseInt(y, 10),
      }),
    onSuccess: (formationId) => {
      setName('');
      onCreated(formationId);
      void queryClient.invalidateQueries({ queryKey: ['hive'] });
    },
  });

  return (
    <details className="hive-new">
      <summary>Start a new formation</summary>
      <div className="hive-coordinate">
        <label>
          <span>Name</span>
          <input onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label>
          <span>Anchor x</span>
          <input inputMode="numeric" onChange={(event) => setX(event.target.value)} value={x} />
        </label>
        <label>
          <span>y</span>
          <input inputMode="numeric" onChange={(event) => setY(event.target.value)} value={y} />
        </label>
        <button disabled={create.isPending} onClick={() => create.mutate()} type="button">
          {create.isPending ? 'Creating…' : `Create on server ${serverId}`}
        </button>
      </div>
      {create.error && <p className="error">{(create.error as Error).message}</p>}
    </details>
  );
}
