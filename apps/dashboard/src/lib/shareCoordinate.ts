import type { Coordinate } from '@dw/ui';

/** A coordinate as the game writes it when a player shares a place:
 * `#580[X:512 Y:300]`.
 *
 * THE SERVER PREFIX IS WHAT MAKES IT TAPPABLE. Game chat turns this exact form
 * into a link that jumps the reader's map there; `[X:512 Y:300]` alone stays
 * plain text (operator, 2026-11-11). So anything a member copies or an officer
 * pastes goes through here, and only an on-screen hint that nobody copies may
 * leave the server out.
 *
 * `serverId` is the server whose MAP the place is on, not the home server of
 * whoever stands there: a hive on 580 is pasted as #580 even for a member who
 * migrated in from 583.
 *
 * The x/y are passed through untouched. Converting a stored tile to the square
 * the game names (season sites are one off on both axes, 0315) is the caller's
 * job, because it differs by kind of object. */
export function shareCoordinate(serverId: number, at: Coordinate): string {
  return `#${serverId}[X:${at.x} Y:${at.y}]`;
}
