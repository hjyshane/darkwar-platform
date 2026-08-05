import { useIsFetching, useQueryClient } from '@tanstack/react-query';

/**
 * Refetch whatever this screen is showing.
 *
 * The board already updates itself — Realtime invalidates the queries a
 * change touches (DataChangeSubscriber). But a collector that is running
 * normally still leaves a screen minutes behind: the capture ring closes a
 * file every 60s and the ingest poll follows, so nothing arrives between
 * those beats however long you look at it. Waiting without knowing whether
 * you are waiting for data or for a broken pipe is the part worth fixing.
 *
 * One button in the header rather than one per panel: `invalidateQueries`
 * with no filter refetches every active query, which is exactly "reload
 * this page's data" and stays right when a panel is added.
 *
 * It disables itself while anything is in flight — not for correctness,
 * react-query dedupes — but because a button that looks idle during a slow
 * refetch invites a second click and reads as broken.
 */
export function RefreshButton() {
  const queryClient = useQueryClient();
  const fetching = useIsFetching();
  return (
    <button
      className="refresh"
      disabled={fetching > 0}
      onClick={() => void queryClient.invalidateQueries()}
      title="Refetch this screen's data"
      type="button"
    >
      {fetching > 0 ? 'Refreshing…' : 'Refresh'}
    </button>
  );
}
