import { formatCoordinate } from '@dw/ui';
import { useState } from 'react';
import { StatTile } from '../../components/StatTile';
import { formatLastOnline } from '../../lib/freshness';
import { serverHash } from '../../lib/route';
import { TERMS } from '../../lib/terms';
import { MapCanvas } from '../map/MapCanvas';
import { shieldLeft } from '../map/atlas';
import { type LocationState, shieldStateOf, stateOf, usePlayerLocation } from './playerLocation';

/** Where this player was last seen on the map.
 *
 * THREE ANSWERS, NOT TWO. A coordinate, a stale coordinate, and nothing —
 * and the middle one is the whole reason this is a component rather than a
 * string. The map is only swept where somebody points the collector, so a
 * player on a server nobody visited this week has a real position we simply
 * have not looked at. Printing that old coordinate as if it were current
 * would send somebody marching at an empty square.
 */
function label(state: LocationState): string {
  switch (state.kind) {
    case 'known':
      return formatCoordinate(state.at);
    case 'stale':
      // The figure still shows, because "was at 491,444" beats silence when
      // you are deciding where to look. The note beneath it does the dating.
      return formatCoordinate(state.at);
    default:
      return '—';
  }
}

export function PlayerLocationTile({
  playerId,
  now,
  onToggleMap,
  mapOpen,
}: {
  playerId: string;
  now?: Date;
  /** Absent when there is no map to open, which keeps the tile a tile. */
  onToggleMap?: () => void;
  mapOpen?: boolean;
}) {
  const { data, isPending } = usePlayerLocation(playerId);
  const at = now ?? new Date();
  const state = stateOf(data ?? null, at);
  const hasPlace = state.kind !== 'unknown';

  return (
    <StatTile
      label={TERMS.location}
      // The tile itself says which of the three answers this is, so a reader
      // scanning the row of figures cannot mistake a week-old sighting for
      // where somebody is standing now.
      note={
        isPending
          ? undefined
          : state.kind === 'unknown'
            ? 'not scanned'
            : state.kind === 'stale'
              ? 'stale'
              : `server ${state.at.serverId}`
      }
      value={
        isPending ? (
          '…'
        ) : hasPlace && onToggleMap ? (
          // The coordinate IS the control. A separate "show map" button would
          // be a second thing to find; the number is what somebody is already
          // looking at when they want to see where it is.
          <button
            aria-expanded={mapOpen === true}
            className="linklike"
            onClick={onToggleMap}
            type="button"
          >
            {label(state)}
          </button>
        ) : (
          label(state)
        )
      }
    />
  );
}

/** Whether this player's base is shielded, as the last sweep saw it.
 *
 * The same sighting as the location tile, so it carries the same caveat: a
 * shield can be raised or extended after the sweep. A "down" that is older
 * than a few hours is therefore shown as "May be up", not as a fact. */
export function PlayerShieldTile({ playerId, now }: { playerId: string; now?: Date }) {
  const { data, isPending } = usePlayerLocation(playerId);
  const at = now ?? new Date();
  const state = shieldStateOf(data ?? null, at);

  let value: string;
  let note: string | undefined;
  switch (state.kind) {
    case 'up':
      value = shieldLeft(state.endsAt, at) ?? '<1m';
      note = 'left, as of last sweep';
      break;
    case 'down':
      value = 'Down';
      note = state.since === null ? 'never shielded' : 'as of last sweep';
      break;
    case 'maybe':
      value = 'May be up';
      note = 'last sweep is old';
      break;
    default:
      value = '—';
      note = isPending ? undefined : 'not scanned';
  }
  return <StatTile label={TERMS.shield} note={note} value={isPending ? '…' : value} />;
}

/** The sentence under the tiles, when there is something to explain.
 *
 * Kept out of the tile because a tile that grows a paragraph stops being a
 * tile, and because this needs a link to the server page.
 */
export function PlayerLocationNote({ playerId, now }: { playerId: string; now?: Date }) {
  const { data } = usePlayerLocation(playerId);
  const at = now ?? new Date();
  const state = stateOf(data ?? null, at);

  if (state.kind === 'known') {
    return (
      <p className="subtle">
        Last seen at {formatCoordinate(state.at)} on{' '}
        <a href={serverHash(state.at.serverId)}>server {state.at.serverId}</a>. A position is only
        as recent as the last sweep over that ground.
      </p>
    );
  }
  if (state.kind === 'stale') {
    return (
      <p className="subtle">
        Last seen at {formatCoordinate(state.at)} on{' '}
        <a href={serverHash(state.at.serverId)}>server {state.at.serverId}</a>,{' '}
        {formatLastOnline('offline', state.at.capturedAt, at)} — treat it as where they{' '}
        <em>were</em>. Bases do move.
      </p>
    );
  }
  return (
    <p className="subtle">
      Location unknown: nobody has swept this player's ground. The map is only read where the
      collector is pointed, so a server has to be visited before anyone on it has a position.
    </p>
  );
}

/** The map itself, under the tiles, once somebody asks for it.
 *
 * Not rendered until it is opened: the picture is a whole image download, and
 * most visits to a player page are not about where they are.
 */
export function PlayerLocationMap({ playerId, now }: { playerId: string; now?: Date }) {
  const { data } = usePlayerLocation(playerId);
  const at = now ?? new Date();
  const state = stateOf(data ?? null, at);

  if (state.kind === 'unknown') {
    return null;
  }
  return (
    <MapCanvas
      caption={
        state.kind === 'stale'
          ? `Where they were ${formatLastOnline('offline', state.at.capturedAt, at)}, on server ${state.at.serverId}.`
          : `Server ${state.at.serverId}, as of the last sweep over that ground.`
      }
      markers={[
        {
          at: state.at,
          label: formatCoordinate(state.at),
          faded: state.kind === 'stale',
        },
      ]}
    />
  );
}

/** Whether this player has a place to show at all — so the page knows
 * whether to offer the toggle. */
export function usePlayerHasLocation(playerId: string, now?: Date): boolean {
  const { data } = usePlayerLocation(playerId);
  return stateOf(data ?? null, now ?? new Date()).kind !== 'unknown';
}

// The map needs its own state, but it belongs to the page rather than to any
// one of these components: the coordinate that opens it and the picture that
// opens are siblings.
export function useMapDisclosure() {
  const [open, setOpen] = useState(false);
  return { open, toggle: () => setOpen((was) => !was) };
}
