import { useMemo } from 'react';
import { ArrangedTable, type Column } from '../../components/ArrangedTable';
import { Pager } from '../../components/Pager';
import { TableSearch } from '../../components/TableSearch';
import { BarCell } from '../../components/ui/BarCell';
import { RankMedal } from '../../components/ui/RankMedal';
import { GameIcon, useIcons } from '../../lib/gameIcons';
import { heroName, petName, useHeroCatalogue, usePetCatalogue } from '../../lib/heroes';
import { allianceHash, playerHash, serverHash } from '../../lib/route';
import type { SortState } from '../../lib/tableControls';
import type { ColumnSpec } from '../../lib/tableLayout';
import { TERMS } from '../../lib/terms';
import { useTableView } from '../../lib/useTableView';
import type { Board, BoardRow } from './boards';

const numberFormat = new Intl.NumberFormat('ko-KR');

// Server included: "580" is a reasonable thing to type when the board spans
// eight of them.
const SEARCH_FIELDS = ['name', 'game_uid', 'server_id'] as const;

/** This table's key in the shared column arrangement. */
/** Rows per page. The whole group's players is thousands of rows; drawing them
 * all is what made the screen slow. */
const PAGE_SIZE = 50;

export const TABLE_ID = 'cross-rankings';

/** Identity only, for the settings screen.
 *
 * The last two columns are named generically here because their real labels come
 * from the BOARD — "Power", "Kills", "Best hero" — and one arrangement covers
 * every board this table draws. */
export function crossRankingColumnSpecs(): ColumnSpec[] {
  return [
    { id: 'rank', label: TERMS.rank },
    { id: 'name', label: TERMS.name, fixed: true },
    { id: 'server', label: TERMS.server },
    { id: 'alliance', label: TERMS.alliance },
    { id: 'value', label: 'Value (varies by board)' },
    { id: 'unit', label: 'Hero or pet (boards that have one)' },
  ];
}

function formatNumber(value: number | null): string {
  // FR-UI-008: unknown is unknown, never zero.
  return value === null ? '—' : numberFormat.format(value);
}

/** Controls for a table whose paging, search and sort live in the database. */
export interface RemoteControls {
  query: string;
  onQuery: (query: string) => void;
  sort: readonly SortState[];
  onSort: (key: string, additive?: boolean) => void;
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  /** Rows matching the search and server filter, across all pages. */
  total: number;
  /** Rows in the whole ranking before any filter. */
  overall: number;
  /** The largest figure on the board, so bars on every page share one scale. */
  maxValue: number;
}

export function CrossRankingTable({
  rows,
  board,
  remote,
}: {
  rows: BoardRow[];
  board: Board;
  /** When set, `rows` is already one page and the table only displays it. */
  remote?: RemoteControls;
}) {
  // Both catalogues are fetched unconditionally rather than per board: they
  // are two small tables behind a shared query key, and branching here would
  // mean a hook that runs on some boards and not others.
  const { data: heroes } = useHeroCatalogue();
  const { data: heroIcons } = useIcons('hero');
  const { data: petIcons } = useIcons('pet');
  const { data: pets } = usePetCatalogue();
  const local = useTableView(rows, SEARCH_FIELDS, { key: 'rank', direction: 'asc' }, PAGE_SIZE);
  const query = remote ? remote.query : local.query;
  const setQuery = remote ? remote.onQuery : local.setQuery;
  const sort = remote ? remote.sort : local.sort;
  const onSort = remote ? remote.onSort : local.onSort;
  const pageRows = remote ? rows : local.pageRows;
  const page = remote ? remote.page : local.page;
  const pageCount = remote ? remote.pageCount : local.pageCount;
  const setPage = remote ? remote.onPage : local.setPage;
  const shown = remote ? remote.total : local.shown;
  const total = remote ? remote.overall : local.total;
  const noMatch = remote ? remote.total === 0 && query.trim() !== '' : local.view.length === 0;

  const localMax = useMemo(() => Math.max(0, ...rows.map((row) => row.value ?? 0)), [rows]);
  const maxValue = remote ? remote.maxValue : localMax;
  const withAlliance = remote !== undefined;

  // Declared above the early return: a hook cannot be skipped, and this list is
  // built by one.
  const columns = useMemo<Column<BoardRow>[]>(() => {
    // Annotated before the filter: an array literal holding a `null` loses the
    // contextual type, and every `cell` parameter silently becomes `any`.
    const declared: (Column<BoardRow> | null)[] = [
      {
        id: 'rank',
        label: TERMS.rank,
        sortKey: 'rank',
        numeric: true,
        cell: (row) => <RankMedal rank={row.rank} />,
      },
      {
        id: 'name',
        label: TERMS.name,
        sortKey: 'name',
        className: 'label',
        // Pinned left on a phone and the only thing telling one row from
        // another, so it cannot be hidden.
        fixed: true,
        // Linked where we have matched the board's entry to a player row.
        // Unlinked otherwise — a board can rank somebody from a server nobody
        // has swept, and a link to a page that would 404 is worse than plain
        // text.
        cell: (row) => (
          <>
            {row.playerId === null ? (
              (row.name ?? `UID ${row.game_uid}`)
            ) : (
              <a href={playerHash(row.playerId)}>{row.name ?? `UID ${row.game_uid}`}</a>
            )}
            {row.source === 'roster' && (
              <span
                className="row-source"
                title="Not on the in-game ranking: listed by an alliance roster"
              >
                roster
              </span>
            )}
          </>
        ),
      },
      {
        id: 'server',
        label: TERMS.server,
        sortKey: 'server_id',
        numeric: true,
        cell: (row) => <a href={serverHash(row.server_id)}>{row.server_id}</a>,
      },
      // Only the boards the database pages carry it; the component boards
      // return no alliance and would show a column of dashes.
      withAlliance
        ? {
            id: 'alliance',
            label: TERMS.alliance,
            sortKey: 'alliance',
            className: 'label',
            cell: (row: BoardRow) =>
              row.alliance ? (
                <a href={allianceHash(row.alliance.id)} title={row.alliance.name ?? undefined}>
                  {row.alliance.code ? `[${row.alliance.code}] ` : ''}
                  {row.alliance.name ?? ''}
                </a>
              ) : (
                '—'
              ),
          }
        : null,
      {
        id: 'value',
        label: board.valueLabel,
        sortKey: 'value',
        numeric: true,
        cell: (row) => (
          <span className="figure-bar">
            {formatNumber(row.value)}
            <BarCell lead={row.rank === 1} max={maxValue} value={row.value} />
          </span>
        ),
      },
      // The id becomes a name where a catalogue has one, and stays the id where
      // nobody has typed it — the same fallback the arena board uses, so a gap
      // in the catalogue looks the same everywhere.
      board.unitLabel
        ? {
            id: 'unit',
            label: board.unitLabel,
            sortKey: 'unit_id',
            className: 'label',
            cellTitle: (row: BoardRow) => (row.unit_id === null ? undefined : `#${row.unit_id}`),
            cell: (row: BoardRow) =>
              row.unit_id === null ? (
                '—'
              ) : board.unitKind === 'pet' ? (
                <>
                  <GameIcon size={22} src={petIcons?.get(String(row.unit_id))} />
                  {petName(pets, row.unit_id)}
                </>
              ) : (
                <>
                  <GameIcon size={22} src={heroIcons?.get(String(row.unit_id))} />
                  {heroName(heroes, row.unit_id)}
                </>
              ),
          }
        : null,
    ];
    return declared.filter((column): column is Column<BoardRow> => column !== null);
  }, [board, heroes, pets, heroIcons, petIcons, maxValue, withAlliance]);

  if (remote ? remote.overall === 0 : rows.length === 0) {
    return <p className="empty">No ranking data yet.</p>;
  }
  return (
    <>
      <TableSearch
        label="Search players"
        unit="players"
        onChange={setQuery}
        shown={shown}
        total={total}
        value={query}
      />
      <ArrangedTable
        columns={columns}
        onSort={onSort}
        rowKey={(row) => row.id}
        rows={pageRows}
        sort={sort}
        tableId={TABLE_ID}
      />
      <Pager onGo={setPage} page={page} pageCount={pageCount} />
      {noMatch && <p className="empty">No player matches “{query}”.</p>}
    </>
  );
}
