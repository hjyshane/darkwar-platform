import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { SortableTh } from '../../components/SortableTh';
import { TableSearch } from '../../components/TableSearch';
import { formatAge } from '../../lib/freshness';
import { supabase } from '../../lib/supabase';
import { useTableView } from '../../lib/useTableView';

/** Commands the collector met and had no parser for (FR-COL-008, FR-OPS-004).
 *
 * This is the queue every future parser comes out of — the event, season and
 * battle-report protocols will all appear here first. A single login capture
 * produced 132 distinct commands, so the list is only useful sorted and
 * searchable; unsorted it is a wall.
 *
 * What is stored is the SHAPE, never the values: `discovery.py` walks the
 * payload into a key→type skeleton before it leaves the machine, which is
 * why a table full of captured traffic is safe to read in a browser. The
 * skeleton is also what a reviewer actually needs — whether a command
 * deserves a parser is a question about its fields, not its numbers.
 *
 * Read-only, and `review_status` is deliberately not shown. Nothing writes
 * that column: the collector never sets it (`discovery_row()` omits it) and
 * no policy grants an UPDATE, so every row reads 'new' and always will. A
 * column that cannot change is not a state to display. Verdicts live in
 * `docs/runbooks/capture-sweep.md`, which is where CLAUDE.md puts them and
 * where the evidence sits next to them.
 */
interface ObservationRow {
  schema_observation_id: string;
  source_command: string;
  fingerprint: string;
  sample: unknown;
  seen_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

async function fetchObservations(): Promise<ObservationRow[]> {
  const { data, error } = await supabase
    .from('schema_observations')
    .select(
      'schema_observation_id, source_command, fingerprint, sample, seen_count, first_seen_at, last_seen_at',
    )
    .order('seen_count', { ascending: false })
    .limit(500);
  if (error) {
    throw new Error(error.message);
  }
  return data as ObservationRow[];
}

/** How many shapes the screen shows before it needs asking. Ten, because the
 * list is sorted by how often each was seen and the tail is things seen once. */
const COLLAPSED_ROWS = 10;

const SEARCH_FIELDS = ['source_command'] as const;

export function DiscoveryInbox({ now }: { now?: Date }) {
  const current = now ?? new Date();
  const { data, error, isPending } = useQuery({
    queryKey: ['schema-observations'],
    queryFn: fetchObservations,
  });

  // The query already ordered by seen_count; saying so means the header
  // arrow matches the order on screen instead of reading "unsorted".
  const view = useTableView(data ?? [], SEARCH_FIELDS, {
    key: 'seen_count',
    direction: 'desc',
  });

  // Folded to the first ten. The query takes up to 500 rows, sorted by how often
  // each shape was seen, and the tail is a long list of things seen once — real
  // but not what anybody opened this screen to read. Search still runs over all
  // of them, so a command you know the name of is one keystroke away whether or
  // not the list is expanded.
  const [expanded, setExpanded] = useState(false);

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the inbox: {error.message}</p>;
  }
  if (data === undefined || data.length === 0) {
    // Not "nothing to do": either no capture has run, or every command in
    // the ones that did already has a parser. Both are worth distinguishing
    // from an inbox that failed to load.
    return (
      <p className="empty">
        Nothing unrecognized has been recorded. Either no capture has run yet, or every command seen
        so far already has a parser.
      </p>
    );
  }

  const shown = expanded ? view.view : view.view.slice(0, COLLAPSED_ROWS);
  const hidden = view.view.length - shown.length;

  return (
    <>
      <p>
        Each row is one command shape the collector could not parse. The sample is a key→type
        skeleton — no captured values are stored. Verdicts belong in{' '}
        <code>docs/runbooks/capture-sweep.md</code>.
      </p>
      <TableSearch
        label="Search commands"
        onChange={view.setQuery}
        shown={view.shown}
        total={view.total}
        unit="command shapes"
        value={view.query}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortableTh
                className="label"
                onSort={view.onSort}
                sort={view.sort}
                sortKey="source_command"
              >
                Command
              </SortableTh>
              <SortableTh numeric onSort={view.onSort} sort={view.sort} sortKey="seen_count">
                Seen
              </SortableTh>
              <SortableTh onSort={view.onSort} sort={view.sort} sortKey="first_seen_at">
                First
              </SortableTh>
              <SortableTh onSort={view.onSort} sort={view.sort} sortKey="last_seen_at">
                Last
              </SortableTh>
              <th scope="col">Shape</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.schema_observation_id}>
                <td className="label">
                  <code>{row.source_command}</code>
                </td>
                <td className="num">{row.seen_count}</td>
                <td title={row.first_seen_at}>{formatAge(row.first_seen_at, current)}</td>
                <td title={row.last_seen_at}>{formatAge(row.last_seen_at, current)}</td>
                <td>
                  {/* Collapsed by default. Some skeletons are four levels
                      deep, and 500 of them expanded is not a table. */}
                  <details>
                    <summary>{row.fingerprint.slice(0, 8)}</summary>
                    <pre className="shape">{JSON.stringify(row.sample, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Only when something is folded away. A button reading "show 0 more" is
          worse than no button — the count is the reason to press it. */}
      {(hidden > 0 || expanded) && (
        <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)} type="button">
          {expanded
            ? `Show only the top ${COLLAPSED_ROWS}`
            : `Show ${hidden} more command shape${hidden === 1 ? '' : 's'}`}
        </button>
      )}
    </>
  );
}
