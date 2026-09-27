import { useMemo } from 'react';
import { ArrangedTable, type Column } from '../../components/ArrangedTable';
import { TableSearch } from '../../components/TableSearch';
import { playerHash } from '../../lib/route';
import type { ColumnSpec } from '../../lib/tableLayout';
import { TERMS } from '../../lib/terms';
import { useTableView } from '../../lib/useTableView';
import type { BattleMember, MemberMisses } from './data';

const numberFormat = new Intl.NumberFormat('ko-KR');

const SEARCH_FIELDS = ['name', 'game_uid'] as const;

/** This table's key in the shared column arrangement. */
export const TABLE_ID = 'black-money-members';
/** The opposing side's table: the same figures, none of our list's columns. */
export const OPPONENT_TABLE_ID = 'black-money-opponents';

export function blackMoneyColumnSpecs(): ColumnSpec[] {
  return [
    { id: 'name', label: TERMS.name, fixed: true },
    { id: 'slot', label: TERMS.blackMoneySlot },
    { id: 'played', label: TERMS.blackMoneyPlayed },
    { id: 'starterMisses', label: TERMS.blackMoneyStarterMisses },
    { id: 'subMisses', label: TERMS.blackMoneySubMisses },
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

/** Columns about our signup list and our tally — meaningless for the other side. */
const OURS_ONLY = new Set(['slot', 'played', 'starterMisses', 'subMisses']);

/** A miss count out of the reported battles it could have happened in. A
 * member never listed in that role since the tally began reads as a dash,
 * not a zero: no chance to miss is not a clean record. */
function missCell(misses: number | null, battles: number | undefined) {
  if (misses === null || battles === undefined || battles === 0) return '—';
  const text = `${misses} / ${battles}`;
  return misses > 0 ? <span className="behind-mark">{text}</span> : text;
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
type Row = BattleMember & {
  slotOrder: number;
  playedOrder: number;
  /** Null when the member has no reported battle since the tally began. */
  starterMisses: number | null;
  subMisses: number | null;
  tally: MemberMisses | null;
};

export function BattleMembersTable({
  members,
  side = 'ours',
  misses,
}: {
  members: BattleMember[];
  /** The alliance's miss tally, keyed by game uid. Ours only. */
  misses?: ReadonlyMap<number, MemberMisses>;
  /** 'theirs' drops Slot and Played: our signup list says nothing about
   * another alliance, and everyone in their half of the report played. */
  side?: 'ours' | 'theirs';
}) {
  const rows = useMemo<Row[]>(
    () =>
      members.map((m) => ({
        ...m,
        slotOrder: m.slot === 'starter' ? 0 : m.slot === 'substitute' ? 1 : 2,
        playedOrder: m.played === true ? 0 : m.played === false ? 1 : 2,
        starterMisses: misses?.get(m.game_uid)?.starter_misses ?? null,
        subMisses: misses?.get(m.game_uid)?.substitute_misses ?? null,
        tally: misses?.get(m.game_uid) ?? null,
      })),
    [members, misses],
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
      {
        id: 'starterMisses',
        label: TERMS.blackMoneyStarterMisses,
        sortKey: 'starterMisses',
        numeric: true,
        // "1 / 2": missed one of the two reported battles they started on.
        cell: (row) => missCell(row.starterMisses, row.tally?.starter_battles),
      },
      {
        id: 'subMisses',
        label: TERMS.blackMoneySubMisses,
        sortKey: 'subMisses',
        numeric: true,
        cell: (row) => missCell(row.subMisses, row.tally?.substitute_battles),
      },
      part('score', TERMS.score, 'score'),
      part('kill', TERMS.blackMoneyKill, 'kill_score'),
      part('occupy', TERMS.blackMoneyOccupy, 'occupy_score'),
      part('firstOccupy', TERMS.blackMoneyFirstOccupy, 'first_occupy_score'),
      part('collect', TERMS.blackMoneyCollect, 'collect_score'),
      part('escort', TERMS.blackMoneyEscort, 'escort_score'),
    ];
  }, []);
  const shownColumns = useMemo(
    () => (side === 'ours' ? columns : columns.filter((c) => !OURS_ONLY.has(c.id))),
    [columns, side],
  );

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
        columns={shownColumns}
        onSort={onSort}
        rowKey={(row) => String(row.game_uid)}
        rows={view}
        sort={sort}
        tableId={side === 'ours' ? TABLE_ID : OPPONENT_TABLE_ID}
      />
      {view.length === 0 && <p className="empty">No member matches “{query}”.</p>}
    </>
  );
}
