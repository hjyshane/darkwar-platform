import { useMemo } from 'react';
import { ArrangedTable, type Column } from '../../components/ArrangedTable';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { TableSearch } from '../../components/TableSearch';
import { leagueLabel } from '../../lib/arenaLeague';
import { playerHash, serverHash } from '../../lib/route';
import type { ColumnSpec } from '../../lib/tableLayout';
import { TERMS } from '../../lib/terms';
import type { LineupHero } from '../../lib/troops';
import { useTableView } from '../../lib/useTableView';
import { LineupCell } from './LineupCell';
import { LineupLegend } from './LineupLegend';

export interface ArenaHeader {
  snapshot_id: string;
  week_start: string;
  captured_at: string;
  entry_count: number | null;
  /** Which board this is (0062). Null for captures taken before the field
   * was understood — those keep their data and say they do not know, rather
   * than being filed under Gold. */
  league: number | null;
}

export interface ArenaEntryRow {
  snapshot_id: string;
  /** Null when the entry has not been matched to a player row — the board
   * ranks players from servers we may not have swept. */
  player_id: string | null;
  rank: number;
  name: string | null;
  game_uid: number;
  server_id: number;
  /** As the arena response reported it — text, because the payload carries
   * no alliance id to resolve against public.alliances. */
  alliance_name: string | null;
  alliance_code: string | null;
  score: number | null;
  defense_power: number | null;
  /** The decoded defence lineup. Empty when the entry carried no `army` —
   * which is not the same as a lineup of nobody. */
  lineup: LineupHero[];
  /** "3 Shooter · 1 Fighter · 1 Rider", precomputed so it can be searched
   * on: useTableView matches top-level string fields, and a value derived
   * during render would not be one. */
  composition: string;
}

const numberFormat = new Intl.NumberFormat('ko-KR');

// A cross-server board is scanned by who is in it: "who from LovE made the
// top 100", or "how many of these are from 582".
const SEARCH_FIELDS = [
  'name',
  'game_uid',
  'alliance_name',
  'alliance_code',
  'server_id',
  'composition',
] as const;

/** This table's key in the shared column arrangement. */
export const TABLE_ID = 'arena';

/** Identity only, for the settings screen. */
export function arenaColumnSpecs(): ColumnSpec[] {
  return [
    { id: 'rank', label: TERMS.rank },
    { id: 'name', label: TERMS.name, fixed: true },
    { id: 'alliance', label: TERMS.alliance },
    { id: 'server', label: TERMS.server },
    { id: 'score', label: TERMS.score },
    { id: 'defense', label: TERMS.defensePower },
    { id: 'lineup', label: TERMS.lineup },
  ];
}

export function ArenaTable({
  header,
  entries,
  now,
}: {
  header: ArenaHeader;
  entries: ArenaEntryRow[];
  now?: Date;
}) {
  const { query, setQuery, sort, onSort, view, shown, total } = useTableView(
    entries,
    SEARCH_FIELDS,
    // ArenaPanel asks for rank asc.
    { key: 'rank', direction: 'asc' },
  );
  const weekLabel = new Date(header.week_start).toISOString().slice(0, 10);

  const columns = useMemo<Column<ArenaEntryRow>[]>(
    () => [
      {
        id: 'rank',
        label: TERMS.rank,
        sortKey: 'rank',
        numeric: true,
        cell: (entry) => entry.rank,
      },
      {
        id: 'name',
        label: TERMS.name,
        sortKey: 'name',
        className: 'label',
        fixed: true,
        // Same rule as the cross-server board: a link only where the entry
        // resolved to a player row.
        cell: (entry) =>
          entry.player_id === null ? (
            (entry.name ?? `UID ${entry.game_uid}`)
          ) : (
            <a href={playerHash(entry.player_id)}>{entry.name ?? `UID ${entry.game_uid}`}</a>
          ),
      },
      {
        id: 'alliance',
        label: TERMS.alliance,
        sortKey: 'alliance_code',
        // Tag first because that is what people say out loud; the full name is
        // there for the ones nobody knows by tag. Unallied stays an em dash, like
        // every other unknown in these tables.
        cell: (entry) => entry.alliance_code ?? entry.alliance_name ?? '—',
      },
      {
        id: 'server',
        label: TERMS.server,
        sortKey: 'server_id',
        numeric: true,
        cell: (entry) => <a href={serverHash(entry.server_id)}>{entry.server_id}</a>,
      },
      {
        id: 'score',
        label: TERMS.score,
        sortKey: 'score',
        numeric: true,
        cell: (entry) => (entry.score === null ? '—' : numberFormat.format(entry.score)),
      },
      {
        id: 'defense',
        label: TERMS.defensePower,
        sortKey: 'defense_power',
        numeric: true,
        cell: (entry) =>
          entry.defense_power === null ? '—' : numberFormat.format(entry.defense_power),
      },
      {
        // No sortKey: an ordering over compositions would be invented, and this
        // column is for scanning and searching.
        id: 'lineup',
        label: TERMS.lineup,
        cell: (entry) => <LineupCell heroes={entry.lineup} />,
      },
    ],
    [],
  );
  return (
    <>
      <p>
        <span>
          {leagueLabel(header.league)} · Week {weekLabel}
        </span>{' '}
        <FreshnessBadge capturedAt={header.captured_at} now={now} />
      </p>
      <TableSearch
        label="Search arena"
        unit="entries"
        onChange={setQuery}
        shown={shown}
        total={total}
        value={query}
      />
      <LineupLegend />
      <ArrangedTable
        columns={columns}
        onSort={onSort}
        rowKey={(entry) => entry.snapshot_id}
        rows={view}
        sort={sort}
        tableId={TABLE_ID}
      />
      {view.length === 0 && <p className="empty">No arena entry matches “{query}”.</p>}
    </>
  );
}
