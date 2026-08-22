import { useMemo } from 'react';
import { ArrangedTable, type Column } from '../../components/ArrangedTable';
import { TableSearch } from '../../components/TableSearch';
import { allianceHash, serverHash } from '../../lib/route';
import type { ColumnSpec } from '../../lib/tableLayout';
import { TERMS } from '../../lib/terms';
import { useTableView } from '../../lib/useTableView';
import { type SeasonAllianceRow, allianceLabel, movement } from './boards';

const numberFormat = new Intl.NumberFormat('ko-KR');

// Server included for the same reason the cross-server board includes it:
// the season group spans four servers and "586" is a reasonable thing to type.
const SEARCH_FIELDS = ['name', 'abbr', 'server_id'] as const;

/** This table's key in the shared column arrangement. */
export const TABLE_ID = 'season-alliance-score';

export function seasonAllianceColumnSpecs(): ColumnSpec[] {
  return [
    { id: 'rank', label: TERMS.rank },
    { id: 'move', label: TERMS.movement },
    { id: 'name', label: TERMS.alliance, fixed: true },
    { id: 'server', label: TERMS.server },
    { id: 'score', label: TERMS.seasonScore },
    { id: 'power', label: TERMS.power },
  ];
}

function formatNumber(value: number | null): string {
  // FR-UI-008: unknown is unknown, never zero.
  return value === null ? '—' : numberFormat.format(value);
}

/** The arrow, with the number of places beside it.
 *
 * Not colour alone — an arrow glyph and a signed count, so the direction
 * survives a monochrome screen and a reader who cannot distinguish the two
 * colours. The title spells it out for a screen reader.
 */
function Movement({ row }: { row: SeasonAllianceRow }) {
  const moved = movement(row.rank, row.previousRank);
  if (moved === null) {
    return <span className="muted">—</span>;
  }
  if (moved.direction === 'flat') {
    return (
      <span className="muted" title="No change since the previous board">
        –
      </span>
    );
  }
  const up = moved.direction === 'up';
  return (
    <span
      className={up ? 'movement-up' : 'movement-down'}
      title={`${up ? 'Up' : 'Down'} ${moved.places} ${moved.places === 1 ? 'place' : 'places'} since the previous board`}
    >
      {up ? '▲' : '▼'} {moved.places}
    </span>
  );
}

export function SeasonAllianceTable({ rows }: { rows: SeasonAllianceRow[] }) {
  const { query, setQuery, sort, onSort, view, shown, total } = useTableView(rows, SEARCH_FIELDS, {
    key: 'rank',
    direction: 'asc',
  });

  const columns = useMemo<Column<SeasonAllianceRow>[]>(
    () => [
      {
        id: 'rank',
        label: TERMS.rank,
        sortKey: 'rank',
        numeric: true,
        cell: (row) => row.rank ?? '—',
      },
      {
        id: 'move',
        label: TERMS.movement,
        // Sorted on the previous position rather than on the delta: the delta
        // is derived, and sorting a table by a number it does not show is a
        // reliable way to look broken.
        sortKey: 'previousRank',
        numeric: true,
        cell: (row) => <Movement row={row} />,
      },
      {
        id: 'name',
        label: TERMS.alliance,
        sortKey: 'name',
        className: 'label',
        fixed: true,
        // Linked where sync resolved the alliance, which on a real board is
        // every row — ensure_alliance() creates the identity row even for the
        // untracked season servers. Kept as a branch anyway: alliance_id is
        // nullable, and a link to a page that would 404 is worse than text.
        cell: (row) => {
          const label = allianceLabel(row.name, row.abbr) ?? `#${row.externalId.slice(0, 8)}`;
          return row.allianceId === null ? (
            label
          ) : (
            <a href={allianceHash(row.allianceId)}>{label}</a>
          );
        },
      },
      {
        id: 'server',
        label: TERMS.server,
        sortKey: 'server_id',
        numeric: true,
        cell: (row) => <a href={serverHash(row.server_id)}>{row.server_id}</a>,
      },
      {
        id: 'score',
        label: TERMS.seasonScore,
        sortKey: 'score',
        numeric: true,
        cell: (row) => formatNumber(row.score),
      },
      {
        id: 'power',
        label: TERMS.power,
        sortKey: 'power',
        numeric: true,
        cell: (row) => formatNumber(row.power),
      },
    ],
    [],
  );

  if (rows.length === 0) {
    return <p className="empty">No season alliance board captured yet.</p>;
  }
  return (
    <>
      <TableSearch
        label="Search alliances"
        unit="alliances"
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
      {view.length === 0 && <p className="empty">No alliance matches “{query}”.</p>}
    </>
  );
}
