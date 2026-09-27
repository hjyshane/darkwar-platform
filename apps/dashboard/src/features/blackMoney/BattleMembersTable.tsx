import { useMemo } from 'react';
import { ArrangedTable, type Column } from '../../components/ArrangedTable';
import { TableSearch } from '../../components/TableSearch';
import { playerHash } from '../../lib/route';
import type { ColumnSpec } from '../../lib/tableLayout';
import { TERMS } from '../../lib/terms';
import { useTableView } from '../../lib/useTableView';
import type { BattleMember } from './data';

const numberFormat = new Intl.NumberFormat('ko-KR');

const SEARCH_FIELDS = ['name', 'game_uid'] as const;

/** This table's key in the shared column arrangement. */
export const TABLE_ID = 'black-money-members';

export function blackMoneyColumnSpecs(): ColumnSpec[] {
  return [
    { id: 'name', label: TERMS.name, fixed: true },
    { id: 'slot', label: TERMS.blackMoneySlot },
    { id: 'played', label: TERMS.blackMoneyPlayed },
    { id: 'score', label: TERMS.score },
    { id: 'kill', label: TERMS.blackMoneyKill },
    { id: 'occupy', label: TERMS.blackMoneyOccupy },
    { id: 'firstOccupy', label: TERMS.blackMoneyFirstOccupy },
    { id: 'collect', label: TERMS.blackMoneyCollect },
    { id: 'escort', label: TERMS.blackMoneyEscort },
  ];
}

function formatNumber(value: number | null): string {
  // FR-UI-008: unknown is unknown, never zero.
  return value === null ? '—' : numberFormat.format(value);
}

function slotLabel(slot: BattleMember['slot']): string {
  return slot === 'starter' ? 'Starter' : slot === 'substitute' ? 'Substitute' : 'Not listed';
}

function playedLabel(played: boolean | null): string {
  return played === null ? '—' : played ? 'Played' : 'Did not play';
}

/** Numeric sort keys for the two text columns, so sorting groups them in the
 * order a reader scans: starters, then substitutes, then unlisted; played
 * before absent before unknown. */
type Row = BattleMember & { slotOrder: number; playedOrder: number };

export function BattleMembersTable({ members }: { members: BattleMember[] }) {
  const rows = useMemo<Row[]>(
    () =>
      members.map((m) => ({
        ...m,
        slotOrder: m.slot === 'starter' ? 0 : m.slot === 'substitute' ? 1 : 2,
        playedOrder: m.played === true ? 0 : m.played === false ? 1 : 2,
      })),
    [members],
  );
  const { query, setQuery, sort, onSort, view, shown, total } = useTableView(rows, SEARCH_FIELDS, {
    key: 'score',
    direction: 'desc',
  });

  const columns = useMemo<Column<Row>[]>(() => {
    const part = (id: string, label: string, key: keyof BattleMember & string): Column<Row> => ({
      id,
      label,
      sortKey: key,
      numeric: true,
      cell: (row) => formatNumber(row[key] as number | null),
    });
    return [
      {
        id: 'name',
        label: TERMS.name,
        sortKey: 'name',
        className: 'label',
        fixed: true,
        cell: (row) =>
          row.player_id === null ? (
            (row.name ?? `UID ${row.game_uid}`)
          ) : (
            <a href={playerHash(row.player_id)}>{row.name ?? `UID ${row.game_uid}`}</a>
          ),
      },
      {
        id: 'slot',
        label: TERMS.blackMoneySlot,
        sortKey: 'slotOrder',
        className: 'label',
        cell: (row) => slotLabel(row.slot),
      },
      {
        id: 'played',
        label: TERMS.blackMoneyPlayed,
        sortKey: 'playedOrder',
        className: 'label',
        cell: (row) =>
          row.played === false ? (
            <span className="behind-mark">{playedLabel(row.played)}</span>
          ) : (
            playedLabel(row.played)
          ),
      },
      part('score', TERMS.score, 'score'),
      part('kill', TERMS.blackMoneyKill, 'kill_score'),
      part('occupy', TERMS.blackMoneyOccupy, 'occupy_score'),
      part('firstOccupy', TERMS.blackMoneyFirstOccupy, 'first_occupy_score'),
      part('collect', TERMS.blackMoneyCollect, 'collect_score'),
      part('escort', TERMS.blackMoneyEscort, 'escort_score'),
    ];
  }, []);

  if (rows.length === 0) {
    return <p className="empty">Nobody is on the list or in a report for this battle.</p>;
  }
  return (
    <>
      <TableSearch
        label="Search members"
        unit="members"
        onChange={setQuery}
        shown={shown}
        total={total}
        value={query}
      />
      <ArrangedTable
        columns={columns}
        onSort={onSort}
        rowKey={(row) => String(row.game_uid)}
        rows={view}
        sort={sort}
        tableId={TABLE_ID}
      />
      {view.length === 0 && <p className="empty">No member matches “{query}”.</p>}
    </>
  );
}
