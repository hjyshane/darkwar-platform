import { SortableTh } from '../../components/SortableTh';
import { TableSearch } from '../../components/TableSearch';
import { heroName, petName, useHeroCatalogue, usePetCatalogue } from '../../lib/heroes';
import { playerHash, serverHash } from '../../lib/route';
import { TERMS } from '../../lib/terms';
import { useTableView } from '../../lib/useTableView';
import type { Board, BoardRow } from './boards';

const numberFormat = new Intl.NumberFormat('ko-KR');

// Server included: "580" is a reasonable thing to type when the board spans
// eight of them.
const SEARCH_FIELDS = ['name', 'game_uid', 'server_id'] as const;

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
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="rank">
                {TERMS.rank}
              </SortableTh>
              <SortableTh className="label" onSort={onSort} sort={sort} sortKey="name">
                {TERMS.name}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="server_id">
                {TERMS.server}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="value">
                {board.valueLabel}
              </SortableTh>
              {board.unitLabel && (
                <SortableTh numeric onSort={onSort} sort={sort} sortKey="unit_id">
                  {board.unitLabel}
                </SortableTh>
              )}
            </tr>
          </thead>
          <tbody>
            {view.map((row) => (
              <tr key={row.id}>
                <td className="num">{row.rank ?? '—'}</td>
                <td className="label">
                  {/* Linked where we have matched the board's entry to a
                      player row. Unlinked otherwise — a board can rank
                      someone from a server nobody has swept, and a link to
                      a page that would 404 is worse than plain text. */}
                  {row.playerId === null ? (
                    (row.name ?? `UID ${row.game_uid}`)
                  ) : (
                    <a href={playerHash(row.playerId)}>{row.name ?? `UID ${row.game_uid}`}</a>
                  )}
                </td>
                <td className="num">
                  <a href={serverHash(row.server_id)}>{row.server_id}</a>
                </td>
                <td className="num">{formatNumber(row.value)}</td>
                {/* The id becomes a name where a catalogue has one, and
                    stays the id where nobody has typed it — the same
                    fallback the arena board uses, so a gap in the catalogue
                    looks the same everywhere. */}
                {board.unitLabel && (
                  <td
                    className="label"
                    title={row.unit_id === null ? undefined : `#${row.unit_id}`}
                  >
                    {row.unit_id === null
                      ? '—'
                      : board.unitKind === 'pet'
                        ? petName(pets, row.unit_id)
                        : heroName(heroes, row.unit_id)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.length === 0 && <p className="empty">No player matches “{query}”.</p>}
    </>
  );
}
