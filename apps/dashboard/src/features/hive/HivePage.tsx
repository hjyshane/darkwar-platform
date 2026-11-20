import type { Coordinate } from '@dw/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StatTile } from '../../components/StatTile';
import { Select } from '../../components/ui/Select';
import { Tabs } from '../../components/ui/Tabs';
import {
  footprintOf,
  isMemberBase,
  memberNumbering,
  offsetKey,
  tileCaption,
} from '../../lib/hiveFormation';
import { isAllowed, usePermissions } from '../../lib/permissions';
import { HIVE, HIVE_NEW, type HiveTab } from '../../lib/route';
import { shareCoordinate } from '../../lib/shareCoordinate';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { replaceHash, useHash } from '../../lib/useHash';
import { useSession } from '../../lib/useSession';
import { FormationEditor } from './FormationEditor';
import { Stamp } from './HiveStamp';
import { MapKey, MapNav, rankTally } from './MapControls';
import { DeletedUnderYou, RecentlyDeleted } from './RecentlyDeleted';
import {
  type GridBase,
  TileGrid,
  centreKeeping,
  pannedCentre,
  windowAround,
  windowFitting,
  windowRadius,
  zoomedBy,
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
import { pickFormation, stillRestorable } from './hiveSafety';
import { clampMapSize, mapSizeProps, setMapPrefs, useMapPrefs } from './mapPrefs';
import { hiveStrip } from './strip';

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
  // ONE QUERY for live and deleted plans (officers get both; 0330), so a plan
  // deleted by somebody else moves from one list to the other at once — see
  // `pickFormation`.
  const allPlans = useFormations(null, mayPlan);
  const livePlans = (allPlans.data ?? []).filter((plan) => plan.deletedAt === null);
  const now = new Date();
  const deletedPlans = (allPlans.data ?? []).filter(
    (plan) => plan.deletedAt !== null && stillRestorable(plan.deletedAt, now),
  );
  // The server the live plan is on, so opening the tab lands on the ground
  // the alliance is actually moving to rather than on the lowest server id.
  const defaultServer =
    livePlans.find((formation) => formation.isActive)?.serverId ??
    livePlans[0]?.serverId ??
    servers?.[0] ??
    null;
  const serverId = chosenServer ?? defaultServer;
  const serverPlans = (allPlans.data ?? []).filter((plan) => plan.serverId === serverId);
  const formations = serverPlans.filter((plan) => plan.deletedAt === null);

  const [chosenFormation, setChosenFormation] = useState<string | null>(null);
  // The plan on screen, so it stays on screen when another is made live or
  // when somebody else deletes it — an officer's unsaved draft lives in the
  // editor for that plan. Members always follow the live plan.
  const [shownId, setShownId] = useState<string | null>(null);
  // The tab is in the address, so the sidebar and a link can open it. Members
  // never see tabs: the plan is all they have.
  const hash = useHash();
  const hashTab = HIVE.fromHash(hash);
  const tab = mayPlan ? hashTab : 'plan';
  // Its own page, reached by the "New formation" button. A member sent the
  // address sees the plan, like any other officer-only address here.
  const creating = mayPlan && hash === HIVE_NEW;
  const setTab = (next: HiveTab) => {
    replaceHash(HIVE.hash(next));
  };
  const { formation, deletedUnderUs } = pickFormation({
    plans: serverPlans,
    chosenId: chosenFormation,
    shownId: mayPlan ? shownId : null,
  });
  if (mayPlan && formation !== null && formation.formationId !== shownId) {
    setShownId(formation.formationId);
  }

  // Frozen while the plan on screen is deleted: the board view leaves deleted
  // plans out, and an empty refetch would wipe the draft drawn on it.
  const board = useBoard(formation?.formationId ?? null, deletedUnderUs);
  const members = useAssignableMembers();
  // Each member's in-game rank, for colouring the picture by rank. From the
  // roster (one row per member), joined here rather than onto the board view:
  // the board is the plan and its rows are written by the save; a rank is a
  // fact about the member that changes without anybody touching the plan.
  const ranks = new Map((members.data ?? []).map((member) => [member.playerId, member.memberRank]));

  if (allPlans.isPending) {
    return <p className="empty loading">Loading…</p>;
  }
  if (allPlans.error) {
    return <p className="error">Could not load formations: {(allPlans.error as Error).message}</p>;
  }

  /** To the new-formation page: a step in the history, so back returns. */
  const startNew = () => {
    window.location.hash = HIVE_NEW;
  };

  return (
    <section aria-labelledby="hive-heading" className="hive-screen">
      <div className="entity">
        <header className="entity-head">
          <span aria-hidden="true" className="entity-mark">
            HV
          </span>
          <div>
            <h2 id="hive-heading">{TERMS.hive}</h2>
            {creating ? (
              <p className="entity-meta">
                <span>New formation</span>
              </p>
            ) : (
              formation !== null && (
                <p className="entity-meta">
                  <span>{formation.name}</span>
                  <span>Server {formation.serverId}</span>
                </p>
              )
            )}
          </div>
        </header>
        {!creating && formation !== null && (
          <div className="strip">
            {hiveStrip(formation, board.data ?? [], {
              x: formation.anchorX,
              y: formation.anchorY,
            }).map((cell, index) => (
              <StatTile
                hero={index === 0}
                key={cell.label}
                label={cell.label}
                note={cell.note}
                value={cell.value}
              />
            ))}
          </div>
        )}
      </div>

      {/* THE NEW-FORMATION PAGE IN PLACE OF THE REST, not instead of the whole
          screen: the editor further down stays mounted (and hidden) under it,
          because it holds the unsaved draft of the plan that was open. */}
      {creating ? (
        <NewFormation
          initialServer={serverId}
          // Straight to drawing it, in place of this page in the history:
          // back from the editor goes to wherever "New formation" was pressed.
          onCreated={(created) => {
            setChosenServer(created.serverId);
            setChosenFormation(created.formationId);
            setShownId(null);
            replaceHash(HIVE.hash('shape'));
          }}
          plans={livePlans}
          servers={servers ?? []}
        />
      ) : formation === null ? (
        <>
          <p className="empty">
            No formation has been drawn yet.{' '}
            {mayPlan
              ? 'Start one, then draw its shape on the map and say who goes where.'
              : 'An officer draws one before a hive move; your tile will appear here when they do.'}
          </p>
          {mayPlan && (
            <p className="hive-edit-cta">
              <button className="primary" onClick={startNew} type="button">
                Start a new formation
              </button>
            </p>
          )}
        </>
      ) : (
        <>
          {deletedUnderUs && <DeletedUnderYou formation={formation} />}
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
                  setShownId(null);
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
                {/* The plan on screen, though deleted, so the picker does not
                    claim another plan is the one being looked at. */}
                {deletedUnderUs && (
                  <option value={formation.formationId}>{formation.name} · deleted</option>
                )}
              </Select>
            </label>
            {/* BESIDE THE PICKER, on every tab: making a formation is choosing
                one that does not exist yet. It used to be a fold-out on the
                drawing tab only, between the tabs and the map. */}
            {mayPlan && (
              <button onClick={startNew} type="button">
                New formation
              </button>
            )}
          </div>

          {/* THREE VIEWS, NOT ONE PAGE. The live plan, the drawing tools and
              the eighty-row assignment table used to stand one under another,
              so an officer reached the table by scrolling past two maps and
              every control, and back up again to save. Members never see the
              tabs: the plan is all they have. */}
          {mayPlan && (
            <Tabs
              label="Hive view"
              items={HIVE.tabs.map((candidate) => ({ id: candidate.id, label: candidate.label }))}
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
          {mayPlan && tab === 'plan' && (
            <p className="hive-edit-cta">
              <button onClick={() => setTab('shape')} type="button">
                Edit this layout
              </button>
              <button onClick={() => setTab('people')} type="button">
                Assign members
              </button>
              <span className="subtle">
                Draw the shape on the map, then say who goes where. To start a different layout,
                press New formation.
              </span>
            </p>
          )}
          {(!mayPlan || tab === 'plan') && (
            <Overview
              board={board.data ?? []}
              formation={formation}
              key={formation.formationId}
              mayPlan={mayPlan}
              // This officer deleted it: move on, unlike a delete by somebody
              // else, which keeps the plan on screen (`pickFormation`).
              onDeleted={() => {
                setChosenFormation(null);
                setShownId(null);
              }}
              ownPlayerId={session?.playerId ?? null}
              ranks={ranks}
            />
          )}
        </>
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
        <div hidden={creating || tab === 'plan'}>
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

      {/* LAST ON THE PAGE, on every tab: the Delete button is on the plan tab
          and the way back from it belongs on the screen the officer is on —
          but under the work, not between the tabs and the map. Collapsed, and
          absent when empty. */}
      {mayPlan && !creating && (
        <RecentlyDeleted
          plans={deletedPlans}
          onRestored={(restored) => {
            setChosenServer(restored.serverId);
            setChosenFormation(restored.formationId);
          }}
        />
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
        <code>{shareCoordinate(formation.serverId, { x: mine.x, y: mine.y })}</code>
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
  onDeleted,
  ownPlayerId,
  ranks,
}: {
  board: readonly BoardSlot[];
  formation: Formation;
  mayPlan: boolean;
  onDeleted: () => void;
  ownPlayerId: string | null;
  /** Player id to in-game rank (1-5), for colouring bases by rank. */
  ranks: ReadonlyMap<string, number | null>;
}) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const prefs = useMapPrefs();
  const byRank = prefs.colourBy === 'rank';
  const anchor = { x: formation.anchorX, y: formation.anchorY };
  // OPENS ON THE WHOLE FORMATION. Both are null until the member zooms or
  // drags; until then the window is whatever shows every tile, so nobody has
  // to pan to find where they stand. The read-only grid still zooms and pans —
  // a member checking their own square wants to get close to it.
  //
  // The zoom is a fraction (see `windowRadius`); the window is whole tiles.
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
  const view = windowAround(centre ?? home.centre, windowRadius(radius));
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
    // An empty base coloured by rank is an outline, not the paint it was drawn in.
    colour: byRank && slot.kind === 'base' && slot.playerId === null ? null : slot.colour,
    caption: tileCaption(slot, slot.playerName, numbering.get(offsetKey(slot))),
    // THE READER'S OWN TILE, on the grid every member sees rather than only
    // in the editor. The line above the picture already says the coordinate;
    // this is what lets somebody check it against the shape before they
    // teleport, which is the whole reason the picture is here.
    own: ownPlayerId !== null && slot.playerId === ownPlayerId,
    // Bases only: ground keeps its painted colour, so Frankie and the
    // boundary still read as ground among the ranks.
    ...(byRank && slot.kind === 'base'
      ? slot.playerId === null
        ? { vacant: true }
        : { rank: ranks.get(slot.playerId) ?? null }
      : {}),
  }));
  const sized = mapSizeProps(prefs.size);

  const stand = useMutation({
    mutationFn: () => makeActive(formation.formationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hive'] }),
  });
  const remove = useMutation({
    mutationFn: () => deleteFormation(formation.formationId),
    onSuccess: () => {
      onDeleted();
      return queryClient.invalidateQueries({ queryKey: ['hive'] });
    },
  });

  const text = handoutList(board, formation.serverId);
  const departed = board.filter((slot) => slot.departedName !== null);

  return (
    <>
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
      <div className={['hive-overview', sized.className].join(' ').trim()} style={sized.style}>
        <div className="hive-overview__map">
          <TileGrid
            anchor={anchor}
            bases={bases}
            // `centre` is null until somebody looks somewhere else, so the first
            // pan step has to start from the fitted centre rather than from
            // nothing — otherwise the view jumps to 0,0 on the first tile of the
            // drag.
            onPan={(byX, byY) => setCentre((from) => pannedCentre(from ?? home.centre, byX, byY))}
            onResize={(size) => setMapPrefs({ size: size === null ? null : clampMapSize(size) })}
            onZoom={(notches, at) => {
              const next = zoomedBy(radius, notches);
              setCentre(centreKeeping(view, windowRadius(next), at));
              setZoom(next);
            }}
            overlay={
              <>
                <MapKey colourBy={prefs.colourBy} tally={rankTally(bases)} />
                <MapNav
                  anchor={anchor}
                  fitLabel="Whole plan"
                  fitted={zoom === null && centre === null}
                  onFit={() => {
                    setZoom(null);
                    setCentre(null);
                  }}
                  onHome={() => setCentre(anchor)}
                  onZoom={setZoom}
                  sized={prefs.size !== null}
                  zoom={radius}
                />
              </>
            }
            window={view}
          />
          <p className="subtle">
            Drag the map to slide it. Hold <kbd>ctrl</kbd> and use the wheel, or pinch, to zoom; the
            house goes to the anchor and the frame shows the whole plan. Drag the corner handle to
            make the map bigger or smaller.
          </p>
        </div>

        <div className="hive-overview__list">
          {/* For members too: "who changed this, and when" is the question
              somebody asks before trusting a coordinate. */}
          <Stamp at={formation.editedAt} name={formation.editedByName} />
          <OverviewActions
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
          {/* Refusals are answers, not silence: these two used to fail with
              nothing on screen at all. */}
          {stand.error && <p className="error">{(stand.error as Error).message}</p>}
          {remove.error && <p className="error">{(remove.error as Error).message}</p>}
          {board.length > 0 && <pre className="hive-list">{text}</pre>}
          {!mayPlan && (
            <p className="subtle">
              Layouts are drawn by officers with hive access (R4/R5). Ask one to change yours.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function OverviewActions({
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
        {/* Neither applies to a plan that is already deleted: the notice at
            the top offers to restore it instead. */}
        {mayPlan && !formation.isActive && formation.deletedAt === null && (
          <button disabled={standing} onClick={onStand} type="button">
            Make this the live plan
          </button>
        )}
        {/* TWO PRESSES, following LeaveAllianceForm. Since 0330 a delete can
            be undone from "Recently deleted" for 30 days, but this button
            still sits next to one that only copies text, and the confirm says
            how long the way back stays open. */}
        {mayPlan && formation.deletedAt === null && (
          <button disabled={removing} onClick={onDelete} type="button">
            {removing
              ? 'Deleting…'
              : confirming
                ? `Delete ${formation.name}? It can be restored for 30 days.`
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

/** The new-formation page: which server, what it is called, and where its
 * anchor goes. Created empty; the next stop is drawing its shape. */
function NewFormation({
  servers,
  initialServer,
  plans,
  onCreated,
}: {
  servers: readonly number[];
  /** The server the hive screen was on, so the new plan lands beside it. */
  initialServer: number | null;
  /** The live plans, for the name suggested on each server. */
  plans: readonly Formation[];
  onCreated: (created: { formationId: string; serverId: number }) => void;
}) {
  const queryClient = useQueryClient();
  const [serverId, setServerId] = useState<number | null>(initialServer ?? servers[0] ?? null);
  const [name, setName] = useState('');
  const [x, setX] = useState('500');
  const [y, setY] = useState('500');
  const suggested = `Formation ${plans.filter((plan) => plan.serverId === serverId).length + 1}`;
  const create = useMutation({
    mutationFn: (on: number) =>
      createFormation({
        name: name.trim() === '' ? suggested : name.trim(),
        serverId: on,
        anchorX: Number.parseInt(x, 10),
        anchorY: Number.parseInt(y, 10),
      }).then((formationId) => ({ formationId, serverId: on })),
    onSuccess: (created) => {
      setName('');
      onCreated(created);
      void queryClient.invalidateQueries({ queryKey: ['hive'] });
    },
  });

  return (
    <div className="hive-new">
      <h3>Start a new formation</h3>
      <p className="subtle">
        It starts with nothing drawn. Next you draw its shape on the map, then say who goes where.
        The anchor is the square every tile is measured from; it can be moved later.
      </p>
      {serverId === null ? (
        <p className="empty">There is no server to put a formation on.</p>
      ) : (
        <form
          className="hive-coordinate"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(serverId);
          }}
        >
          <label>
            <span>Server</span>
            <Select
              onChange={(chosen) => setServerId(Number.parseInt(chosen, 10))}
              value={serverId}
            >
              {servers.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </Select>
          </label>
          <label>
            <span>Name</span>
            <input
              onChange={(event) => setName(event.target.value)}
              placeholder={suggested}
              value={name}
            />
          </label>
          <label>
            <span>Anchor x</span>
            <input inputMode="numeric" onChange={(event) => setX(event.target.value)} value={x} />
          </label>
          <label>
            <span>y</span>
            <input inputMode="numeric" onChange={(event) => setY(event.target.value)} value={y} />
          </label>
          <button disabled={create.isPending} type="submit">
            {create.isPending ? 'Creating…' : `Create on server ${serverId}`}
          </button>
          {/* In place of this page, not a new step: back from the hive is
              then wherever the officer was before they pressed New. */}
          <button onClick={() => replaceHash(HIVE.hash('plan'))} type="button">
            Cancel
          </button>
        </form>
      )}
      {create.error && <p className="error">{(create.error as Error).message}</p>}
    </div>
  );
}
