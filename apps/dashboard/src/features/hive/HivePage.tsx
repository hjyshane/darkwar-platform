import { formatCoordinate } from '@dw/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { isAllowed, usePermissions } from '../../lib/permissions';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { useSession } from '../../lib/useSession';
import { FormationEditor } from './FormationEditor';
import { type GridBase, TileGrid, windowAround } from './TileGrid';
import {
  type BoardSlot,
  type Formation,
  createFormation,
  deleteFormation,
  makeActive,
  useAssignableMembers,
  useBoard,
  useFormations,
} from './hiveFormations';

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
              <select
                onChange={(event) => {
                  setChosenServer(Number.parseInt(event.target.value, 10));
                  setChosenFormation(null);
                }}
                value={serverId ?? ''}
              >
                {(servers ?? []).map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Formation</span>
              <select
                onChange={(event) => setChosenFormation(event.target.value)}
                value={formation.formationId}
              >
                {formations.map((candidate) => (
                  <option key={candidate.formationId} value={candidate.formationId}>
                    {candidate.name}
                    {candidate.isActive ? ' · live' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <Overview
            board={board.data ?? []}
            formation={formation}
            mayPlan={mayPlan}
            ownPlayerId={session?.playerId ?? null}
          />
        </>
      )}

      {mayPlan && serverId !== null && (
        <NewFormation
          onCreated={setChosenFormation}
          serverId={serverId}
          suggested={formations.length + 1}
        />
      )}

      {mayPlan && formation !== null && !board.isPending && (
        <FormationEditor
          formation={formation}
          members={members.data ?? []}
          ownPlayerId={session?.playerId ?? null}
          slots={board.data ?? []}
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
        <code>{formatCoordinate({ x: mine.x, y: mine.y })}</code>
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
  const view = windowAround(anchor, 14);
  const bases: GridBase[] = board.map((slot) => ({
    key: slot.slotId,
    at: { x: slot.x, y: slot.y },
    caption: slot.playerName ?? String(slot.ordinal),
    // THE READER'S OWN TILE, on the grid every member sees rather than only
    // in the editor. The line above the picture already says the coordinate;
    // this is what lets somebody check it against the shape before they
    // teleport, which is the whole reason the picture is here.
    own: ownPlayerId !== null && slot.playerId === ownPlayerId,
    stale: slot.stillAMember === false,
  }));

  const stand = useMutation({
    mutationFn: () => makeActive(formation.formationId, formation.serverId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hive'] }),
  });
  const remove = useMutation({
    mutationFn: () => deleteFormation(formation.formationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hive'] }),
  });

  const text = board
    .map(
      (slot) =>
        `${slot.ordinal}. ${slot.playerName ?? '(nobody)'} → ${formatCoordinate({ x: slot.x, y: slot.y })}${slot.label === '' ? '' : ` (${slot.label})`}`,
    )
    .join('\n');
  const departed = board.filter((slot) => slot.stillAMember === false);

  return (
    <>
      <p className="subtle">
        {formation.isActive ? 'Live plan' : 'Draft'} on server {formation.serverId}, anchored at{' '}
        <code>{formatCoordinate(anchor)}</code>. {board.length} tile
        {board.length === 1 ? '' : 's'}, {board.filter((slot) => slot.playerId !== null).length}{' '}
        filled.
      </p>

      {departed.length > 0 && (
        <p className="error">
          {departed.length} tile{departed.length === 1 ? ' is' : 's are'} assigned to somebody who
          is no longer on the roster ({departed.map((slot) => slot.playerName ?? '?').join(', ')}).
          Nobody is coming to stand there.
        </p>
      )}

      <TileGrid anchor={anchor} bases={bases} window={view} />

      <div className="hive-actions">
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
          }}
          type="button"
        >
          {copied ? 'Copied' : 'Copy the list'}
        </button>
        {mayPlan && !formation.isActive && (
          <button disabled={stand.isPending} onClick={() => stand.mutate()} type="button">
            Make this the live plan
          </button>
        )}
        {/* TWO PRESSES, following LeaveAllianceForm. Deleting takes the
            tiles and every assignment on them with it, there is no history
            to recover them from, and this button sits next to one that only
            copies text. */}
        {mayPlan && (
          <button
            disabled={remove.isPending}
            onClick={() => (confirming ? remove.mutate() : setConfirming(true))}
            type="button"
          >
            {remove.isPending
              ? 'Deleting…'
              : confirming
                ? `Really delete ${formation.name} and its ${board.length} tiles?`
                : 'Delete this formation'}
          </button>
        )}
        {confirming && !remove.isPending && (
          <button onClick={() => setConfirming(false)} type="button">
            Keep it
          </button>
        )}
      </div>

      {board.length > 0 && <pre className="hive-list">{text}</pre>}
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
