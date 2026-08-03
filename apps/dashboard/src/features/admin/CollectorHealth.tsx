import { useQuery } from '@tanstack/react-query';
import { SortableTh } from '../../components/SortableTh';
import { TableSearch } from '../../components/TableSearch';
import { claimedStatusLabel, collectorBadgeClass, collectorState } from '../../lib/collectorHealth';
import { formatAge } from '../../lib/freshness';
import { supabase } from '../../lib/supabase';
import { useTableView } from '../../lib/useTableView';

/** The rows behind the badge in the title (FR-OPS-001).
 *
 * `SyncStatus` answers one question for everybody — is anything arriving —
 * out of the `sync_status` view, which is an aggregate over every collector.
 * That is the right amount of detail in a header and the wrong amount when
 * something has stopped: it cannot say WHICH collector went quiet, when, or
 * what it was doing at the time.
 *
 * Read-only. Nothing here is a control: the collector writes these tables
 * with the service key, and there is no cloud-side action that would change
 * them. Officer and above by policy (0006).
 */
interface CollectorRow {
  collector_id: string;
  name: string;
  status: string;
  version: string | null;
  last_heartbeat_at: string | null;
  last_packet_at: string | null;
  last_sync_at: string | null;
  outbox_depth: number | null;
}

interface RunRow {
  run_id: string;
  collector_id: string;
  workflow: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

async function fetchCollectors(): Promise<CollectorRow[]> {
  const { data, error } = await supabase
    .from('collectors')
    .select(
      'collector_id, name, status, version, last_heartbeat_at, last_packet_at, last_sync_at, outbox_depth',
    )
    .order('name');
  if (error) {
    throw new Error(error.message);
  }
  return data as CollectorRow[];
}

async function fetchRuns(): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from('workflow_runs')
    .select('run_id, collector_id, workflow, status, started_at, finished_at, error')
    .order('started_at', { ascending: false })
    .limit(50);
  if (error) {
    throw new Error(error.message);
  }
  return data as RunRow[];
}

const RUN_SEARCH = ['workflow', 'status'] as const;

export function CollectorHealth({ now }: { now?: Date }) {
  const current = now ?? new Date();
  // Polled on the same twenty seconds as the header badge, so the two
  // cannot disagree about whether anything is arriving.
  const collectors = useQuery({
    queryKey: ['collectors'],
    queryFn: fetchCollectors,
    refetchInterval: 20_000,
  });
  const runs = useQuery({ queryKey: ['workflow-runs'], queryFn: fetchRuns });

  const names = new Map((collectors.data ?? []).map((row) => [row.collector_id, row.name]));
  const runView = useTableView(runs.data ?? [], RUN_SEARCH, {
    key: 'started_at',
    direction: 'desc',
  });

  return (
    <>
      <h3>Collectors</h3>
      {collectors.isPending && <p className="empty">Loading…</p>}
      {collectors.error && (
        <p className="error">Could not load collectors: {collectors.error.message}</p>
      )}
      {collectors.data?.length === 0 && (
        // Not "everything is fine". No collector has ever registered, which
        // means nothing has ever been captured.
        <p className="empty">No collector has ever registered. Nothing is feeding this board.</p>
      )}
      {collectors.data && collectors.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="label" scope="col">
                  Collector
                </th>
                <th scope="col">Checking in</th>
                <th scope="col">Says</th>
                <th scope="col">Last packet</th>
                <th scope="col">Last sync</th>
                <th className="num" scope="col">
                  Outbox
                </th>
                <th scope="col">Version</th>
              </tr>
            </thead>
            <tbody>
              {collectors.data.map((row) => {
                const state = collectorState(row.last_heartbeat_at, current);
                return (
                  <tr key={row.collector_id}>
                    <td className="label">{row.name}</td>
                    <td>
                      <span className={collectorBadgeClass(state)}>
                        {state === 'never'
                          ? 'Never'
                          : state === 'live'
                            ? 'Live'
                            : // The age, not the word "stale": how long it has
                              // been quiet is the thing somebody acts on.
                              `Silent ${formatAge(row.last_heartbeat_at as string, current)}`}
                      </span>
                    </td>
                    <td>{claimedStatusLabel(row.status, state)}</td>
                    <td>
                      {row.last_packet_at === null ? '—' : formatAge(row.last_packet_at, current)}
                    </td>
                    <td>
                      {row.last_sync_at === null ? '—' : formatAge(row.last_sync_at, current)}
                    </td>
                    {/* A backed-up outbox is the shape of "capturing fine,
                        cannot reach Supabase", which the heartbeat alone
                        does not distinguish from healthy. */}
                    <td className="num">{row.outbox_depth ?? '—'}</td>
                    <td>{row.version ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h3>Recent runs</h3>
      {runs.isPending && <p className="empty">Loading…</p>}
      {runs.error && <p className="error">Could not load runs: {runs.error.message}</p>}
      {runs.data?.length === 0 && <p className="empty">No workflow has reported a run yet.</p>}
      {runs.data && runs.data.length > 0 && (
        <>
          <TableSearch
            label="Search runs"
            onChange={runView.setQuery}
            shown={runView.shown}
            total={runView.total}
            unit="runs"
            value={runView.query}
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortableTh
                    className="label"
                    onSort={runView.onSort}
                    sort={runView.sort}
                    sortKey="workflow"
                  >
                    Workflow
                  </SortableTh>
                  <th scope="col">Collector</th>
                  <SortableTh onSort={runView.onSort} sort={runView.sort} sortKey="status">
                    Status
                  </SortableTh>
                  <SortableTh onSort={runView.onSort} sort={runView.sort} sortKey="started_at">
                    Started
                  </SortableTh>
                  <th scope="col">Took</th>
                  <th scope="col">Error</th>
                </tr>
              </thead>
              <tbody>
                {runView.view.map((row) => (
                  <tr key={row.run_id}>
                    <td className="label">{row.workflow}</td>
                    <td>{names.get(row.collector_id) ?? '—'}</td>
                    <td>{row.status}</td>
                    <td title={row.started_at}>{formatAge(row.started_at, current)}</td>
                    {/* Blank means still running, which is not the same as
                        having finished instantly. */}
                    <td>
                      {row.finished_at === null
                        ? 'running'
                        : `${Math.round(
                            (new Date(row.finished_at).getTime() -
                              new Date(row.started_at).getTime()) /
                              1000,
                          )}s`}
                    </td>
                    <td>{row.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
