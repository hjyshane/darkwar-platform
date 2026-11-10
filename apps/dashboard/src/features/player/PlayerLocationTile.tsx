import { formatCoordinate } from '@dw/ui';
import { useState } from 'react';
import { formatLastOnline } from '../../lib/freshness';
import { serverHash } from '../../lib/route';
import { MapCanvas } from '../map/MapCanvas';
import { stateOf, usePlayerLocation } from './playerLocation';

/** The sentence beside the opened map, when there is something to explain.
 *
 * THREE ANSWERS, NOT TWO: a coordinate, a stale coordinate, and nothing. The
 * map is only swept where somebody points the collector, so a player on a
 * server nobody visited this week has a real position we have not looked at,
 * and an old coordinate printed as current would send somebody marching at an
 * empty square. The header cell dates it; this says why.
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

/** The map itself, under the cells, once somebody asks for it.
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
