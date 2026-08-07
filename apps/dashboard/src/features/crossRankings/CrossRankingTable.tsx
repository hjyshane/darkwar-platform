import { useMemo } from 'react';
import { ArrangedTable, type Column } from '../../components/ArrangedTable';
import { TableSearch } from '../../components/TableSearch';
import { heroName, petName, useHeroCatalogue, usePetCatalogue } from '../../lib/heroes';
import { playerHash, serverHash } from '../../lib/route';
import type { ColumnSpec } from '../../lib/tableLayout';
import { TERMS } from '../../lib/terms';
import { useTableView } from '../../lib/useTableView';
import type { Board, BoardRow } from './boards';

const numberFormat = new Intl.NumberFormat('ko-KR');

// Server included: "580" is a reasonable thing to type when the board spans
// eight of them.
const SEARCH_FIELDS = ['name', 'game_uid', 'server_id'] as const;

/** This table's key in the shared column arrangement. */
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
    { id: 'value', label: 'Value (varies by board)' },
    { id: 'unit', label: 'Hero or pet (boards that have one)' },
  ];
}

function formatNumber(value: number | null): string {
  // FR-UI-008: unknown is unknown, never zero.
  return value === null ? '—' : numberFormat.format(value);
}

export function CrossRankingTable({ rows, board }: { rows: BoardRow[]; board: Board }) {
  // Both catalogues are fetched unconditionally rather than per board: they
  // are two small tables behind a shared query key, and branching here would
  // mean a hook that runs on some boards and not others.
  const { data: heroes } = useHeroCatalogue();
  const { data: pets } = usePetCatalogue();
  const { query, setQuery, sort, onSort, view, shown, total } = useTableView(rows, SEARCH_FIELDS, {
    key: 'rank',
    direction: 'asc',
  });

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
        cell: (row) => row.rank ?? '—',
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
        cell: (row) =>
          row.playerId === null ? (
            (row.name ?? `UID ${row.game_uid}`)
          ) : (
            <a href={playerHash(row.playerId)}>{row.name ?? `UID ${row.game_uid}`}</a>
          ),
      },
      {
        id: 'server',
        label: TERMS.server,
        sortKey: 'server_id',
        numeric: true,
        cell: (row) => <a href={serverHash(row.server_id)}>{row.server_id}</a>,
      },
      {
        id: 'value',
        label: board.valueLabel,
        sortKey: 'value',
        numeric: true,
        cell: (row) => formatNumber(row.value),
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
              row.unit_id === null
                ? '—'
                : board.unitKind === 'pet'
                  ? petName(pets, row.unit_id)
                  : heroName(heroes, row.unit_id),
          }
        : null,
    ];
    return declared.filter((column): column is Column<BoardRow> => column !== null);
  }, [board, heroes, pets]);

  if (rows.length === 0) {
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
        rows={view}
        sort={sort}
        tableId={TABLE_ID}
      />
      {view.length === 0 && <p className="empty">No player matches “{query}”.</p>}
    </>
  );
}
