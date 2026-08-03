/** The arena's two boards.
 *
 * `user.get.arena.info` answers for either one and says which only through
 * a number (0062). The payload never contains the words "gold" or "silver",
 * so the mapping lives here and in the migration comment, in both cases
 * written down rather than re-derived.
 *
 * Gold is listed first because it is the higher board, not because it is
 * captured first — the collector happens to fetch it first, but that is a
 * routine and could change.
 */
export interface ArenaLeague {
  value: number;
  label: string;
  /** What makes the two boards visibly different, and the second signal
   * that confirmed which is which: Gold pools two servers, Silver is ours
   * alone. */
  scope: string;
}

export const ARENA_LEAGUES: readonly ArenaLeague[] = [
  { value: 1, label: 'Gold', scope: 'cross-server' },
  { value: 2, label: 'Silver', scope: 'own server' },
];

/** The label for a stored league number.
 *
 * A league we have no name for keeps its number instead of being folded
 * into Gold or hidden. The game may well have a third board, and the first
 * capture of one should read as "league 3", not as a bug (FR-UI-008).
 */
export function leagueLabel(league: number | null): string {
  if (league === null) {
    return 'Unknown league';
  }
  return ARENA_LEAGUES.find((entry) => entry.value === league)?.label ?? `League ${league}`;
}

export function leagueScope(league: number | null): string | null {
  if (league === null) {
    return null;
  }
  return ARENA_LEAGUES.find((entry) => entry.value === league)?.scope ?? null;
}

/** Boards in display order: known leagues by their rank, then anything
 * unrecognised, then the ones that never said.
 *
 * Ranked in two parts rather than one number. The single-number version
 * added the league to a near-MAX_SAFE_INTEGER sentinel, which overflowed
 * past the sentinel for "unknown" and put league 3 behind null — precisely
 * the case the sentinel existed to order.
 */
export function compareLeagues(left: number | null, right: number | null): number {
  const order = (league: number | null): [number, number] => {
    if (league === null) {
      return [2, 0];
    }
    const known = ARENA_LEAGUES.findIndex((entry) => entry.value === league);
    return known === -1 ? [1, league] : [0, known];
  };
  const [leftTier, leftRank] = order(left);
  const [rightTier, rightRank] = order(right);
  return leftTier === rightTier ? leftRank - rightRank : leftTier - rightTier;
}
