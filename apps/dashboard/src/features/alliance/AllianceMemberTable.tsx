import { useMemo } from 'react';
import { ArrangedTable, type Column } from '../../components/ArrangedTable';
import { TableSearch } from '../../components/TableSearch';
import { playerHash } from '../../lib/route';
import type { ColumnSpec } from '../../lib/tableLayout';
import { TERMS } from '../../lib/terms';
import { useTableView } from '../../lib/useTableView';

export interface AllianceMemberRow {
  playerId: string | null;
  name: string | null;
  gameUid: number;
  power: number | null;
  hqLevel: number | null;
}

const numberFormat = new Intl.NumberFormat('ko-KR');
const SEARCH_FIELDS = ['name', 'gameUid'] as const;

/** This table's key in the shared column arrangement. */
export const TABLE_ID = 'alliance-members';

/** Identity only, for the settings screen. */
export function allianceMemberColumnSpecs(): ColumnSpec[] {
  return [
    { id: 'name', label: TERMS.name, fixed: true },
    { id: 'hq', label: TERMS.hq },
    { id: 'power', label: TERMS.power },
  ];
}

/** Who a roster capture has actually put in this alliance.
 *
 * Its own component rather than markup inside `AlliancePage` because sorting and
 * the column arrangement are both hooks, and the page renders this list only on
 * one of its three tabs — a hook inside that condition would run on some renders
 * and not others.
 */
export function AllianceMemberTable({ members }: { members: readonly AllianceMemberRow[] }) {
  // `power` descending is the order the query already returned. Stating it means
  // the header says what the rows are doing, rather than showing an unsorted
  // arrow over an order the reader can plainly see (see useTableView).
  const { query, setQuery, sort, onSort, view, shown, total } = useTableView(
    members,
    SEARCH_FIELDS,
    { key: 'power', direction: 'desc' },
  );

  const columns = useMemo<Column<AllianceMemberRow>[]>(
    () => [
      {
        id: 'name',
        label: TERMS.name,
        sortKey: 'name',
        className: 'label',
        fixed: true,
        // No link when the uid never resolved to a player row. They are in the
        // alliance and belong in the count; there is simply no page to send
        // anybody to.
        cell: (row) =>
          row.playerId === null ? (
            `UID ${row.gameUid}`
          ) : (
            <a href={playerHash(row.playerId)}>{row.name ?? `UID ${row.gameUid}`}</a>
          ),
      },
      {
        id: 'hq',
        label: TERMS.hq,
        sortKey: 'hqLevel',
        numeric: true,
        cell: (row) => row.hqLevel ?? '—',
      },
      {
        id: 'power',
        label: TERMS.power,
        sortKey: 'power',
        numeric: true,
        cell: (row) => (row.power === null ? '—' : numberFormat.format(row.power)),
      },
    ],
    [],
  );

  return (
    <>
      <TableSearch
        label="Search members"
        onChange={setQuery}
        shown={shown}
        total={total}
        unit="members"
        value={query}
      />
      <ArrangedTable
        columns={columns}
        onSort={onSort}
        rowKey={(row) => row.playerId ?? `uid:${row.gameUid}`}
        rows={view}
        sort={sort}
        tableId={TABLE_ID}
      />
      {view.length === 0 && <p className="empty">No member matches “{query}”.</p>}
    </>
  );
}
