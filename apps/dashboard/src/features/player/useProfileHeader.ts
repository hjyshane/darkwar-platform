import { useQuery } from '@tanstack/react-query';
import type { BoardRow } from './composition';
import { fetchHistoryWindow, retentionWindowDays } from './deltaWindow';
import { type HeaderModel, type HeaderPlayer, buildHeaderModel } from './headerModel';
import type { PlayerArenaEntry } from './playerArena';
import { usePlayerLocation } from './playerLocation';
import { useServerRank } from './serverRank';
import { fetchFirstSeenInAlliance } from './tenure';

/** What the header needs from the page's own player fetch. */
export interface HeaderSource extends HeaderPlayer {
  /** The last known alliance; tenure checks the roster before trusting it. */
  allianceId: string | null;
  boardRows: readonly BoardRow[];
  arena: readonly PlayerArenaEntry[];
}

const TEN_MINUTES = 10 * 60_000;

/** The header's facts, gathered and turned into what it says.
 *
 * Four small queries beside the page's own, each behind its own gate, so one
 * that fails or is refused costs one cell and not the header: a fact still
 * loading, or not readable, is simply absent from the model — the rank is a
 * dash, the verdict loses its clause — and fills in when it arrives.
 *
 * Takes the id as well as the source because hooks cannot wait for the page's
 * fetch: the queries are keyed on the prop and the model is null until the
 * player row is there. */
export function useProfileHeader(
  playerId: string,
  source: HeaderSource | null,
  now?: Date,
): HeaderModel | null {
  const rank = useServerRank(playerId);
  const location = usePlayerLocation(playerId);
  const windowDays = retentionWindowDays(source?.isOwnAlliance ?? false);
  const history = useQuery({
    queryKey: ['player-history-window', playerId, windowDays],
    queryFn: () => fetchHistoryWindow(playerId, windowDays, now ?? new Date()),
    enabled: source !== null,
    staleTime: TEN_MINUTES,
  });
  const allianceId = source?.allianceId ?? null;
  const firstSeen = useQuery({
    queryKey: ['player-first-seen', playerId, allianceId],
    queryFn: () => fetchFirstSeenInAlliance(playerId, allianceId as string),
    enabled: allianceId !== null,
    staleTime: TEN_MINUTES,
  });

  if (source === null) return null;
  return buildHeaderModel({
    player: source,
    rank: rank.data ?? null,
    location: location.data ?? null,
    boardRows: source.boardRows,
    history: history.data ?? [],
    firstSeenInAlliance: firstSeen.data ?? null,
    arena: source.arena,
    now: now ?? new Date(),
  });
}
