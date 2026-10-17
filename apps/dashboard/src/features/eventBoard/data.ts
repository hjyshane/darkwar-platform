// One event across its days, member by member (0290): Capital Clash and Server
// Clash. The database decides present, absent or not known for every member on
// every day (`event_board`, the same verdicts the Participation report tallies);
// this folds them into the page's two views.

import { supabase } from '../../lib/supabase';

/** One member on one event day, as `event_board` returns it. */
export interface BoardCell {
  event_day: string;
  round: number;
  player_id: string;
  game_uid: number;
  current_name: string;
  member_rank: number | null;
  /** True was there, false was not, null is not known (never "absent"). */
  attended: boolean | null;
  score: number | null;
  damage: number | null;
}

export async function fetchEventBoard(kind: string): Promise<BoardCell[]> {
  const { data, error } = await supabase.rpc('event_board', { p_kind: kind });
  if (error) {
    throw new Error(`event board query failed: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    event_day: row.event_day,
    round: Number(row.round),
    player_id: row.player_id,
    game_uid: Number(row.game_uid),
    current_name: row.current_name,
    member_rank: row.member_rank,
    attended: row.attended,
    score: row.score === null ? null : Number(row.score),
    damage: row.damage === null ? null : Number(row.damage),
  }));
}

/** One member across the events, oldest first, to match `days`. */
export interface MemberSeries {
  player_id: string;
  name: string;
  member_rank: number | null;
  marks: (boolean | null)[];
  scores: (number | null)[];
  damages: (number | null)[];
  present: number;
  absent: number;
  /** Events held on record, the denominator of "took part". */
  held: number;
  totalScore: number;
  bestScore: number | null;
  averageScore: number | null;
  /** The newest score against the one before it; null with fewer than two. */
  change: number | null;
  totalDamage: number;
}

/** One event across the alliance. */
export interface EventTotal {
  day: string;
  present: number;
  absent: number;
  unknown: number;
  totalScore: number;
  scored: number;
  averageScore: number | null;
  totalDamage: number;
  /** Share of the roster known to have taken part. A floor: not known is not absent. */
  turnout: number | null;
}

export interface BoardReport {
  days: string[];
  members: MemberSeries[];
  events: EventTotal[];
  hasScore: boolean;
  hasDamage: boolean;
}

/** Fold the grid into the page's two views. Pure, so it is tested alone. */
export function foldEventBoard(cells: readonly BoardCell[]): BoardReport {
  const days = [...new Set(cells.map((c) => c.event_day))].sort();
  const dayIndex = new Map(days.map((day, index) => [day, index] as const));

  const byMember = new Map<string, MemberSeries>();
  for (const cell of cells) {
    let member = byMember.get(cell.player_id);
    if (member === undefined) {
      member = {
        player_id: cell.player_id,
        name: cell.current_name,
        member_rank: cell.member_rank,
        marks: days.map(() => null),
        scores: days.map(() => null),
        damages: days.map(() => null),
        present: 0,
        absent: 0,
        held: days.length,
        totalScore: 0,
        bestScore: null,
        averageScore: null,
        change: null,
        totalDamage: 0,
      };
      byMember.set(cell.player_id, member);
    }
    const index = dayIndex.get(cell.event_day);
    if (index === undefined) continue;
    member.marks[index] = cell.attended;
    // A score on a day the member was ticked absent would contradict itself;
    // the database already withholds it, and so does the fold.
    if (cell.attended !== false) {
      if (cell.score !== null) member.scores[index] = cell.score;
      if (cell.damage !== null) member.damages[index] = cell.damage;
    }
  }

  const members: MemberSeries[] = [];
  for (const member of byMember.values()) {
    const scored = member.scores.filter((s): s is number => s !== null);
    const newest = [...scored].reverse();
    const totalScore = scored.reduce((sum, s) => sum + s, 0);
    members.push({
      ...member,
      present: member.marks.filter((m) => m === true).length,
      absent: member.marks.filter((m) => m === false).length,
      totalScore,
      bestScore: scored.length === 0 ? null : Math.max(...scored),
      averageScore: scored.length === 0 ? null : totalScore / scored.length,
      change: newest.length < 2 ? null : (newest[0] ?? 0) - (newest[1] ?? 0),
      totalDamage: member.damages.reduce<number>((sum, d) => sum + (d ?? 0), 0),
    });
  }

  const roster = members.length;
  const events: EventTotal[] = days.map((day, index) => {
    const marks = members.map((m) => m.marks[index] ?? null);
    const scores = members
      .map((m) => m.scores[index] ?? null)
      .filter((s): s is number => s !== null);
    const totalScore = scores.reduce((sum, s) => sum + s, 0);
    const present = marks.filter((m) => m === true).length;
    return {
      day,
      present,
      absent: marks.filter((m) => m === false).length,
      unknown: marks.filter((m) => m === null).length,
      totalScore,
      scored: scores.length,
      averageScore: scores.length === 0 ? null : totalScore / scores.length,
      totalDamage: members.reduce((sum, m) => sum + (m.damages[index] ?? 0), 0),
      turnout: roster === 0 ? null : present / roster,
    };
  });

  return {
    days,
    members,
    events,
    hasScore: cells.some((c) => c.score !== null),
    hasDamage: cells.some((c) => c.damage !== null),
  };
}

/** 64,059,759 -> "64.1M". The exact figure goes in a title. */
export function compactScore(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}G`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(value);
}

export type BoardSortKey = 'name' | 'present' | 'total' | 'average' | 'best' | 'change' | 'damage';

function sortValue(m: MemberSeries, key: BoardSortKey): number | string | null {
  switch (key) {
    case 'name':
      return m.name;
    case 'present':
      return m.present;
    case 'total':
      return m.bestScore === null ? null : m.totalScore;
    case 'average':
      return m.averageScore;
    case 'best':
      return m.bestScore;
    case 'change':
      return m.change;
    case 'damage':
      return m.totalDamage === 0 ? null : m.totalDamage;
  }
}

/** Sort a copy. A member with no value sorts last in both directions. */
export function sortMembers(
  members: readonly MemberSeries[],
  key: BoardSortKey,
  descending: boolean,
): MemberSeries[] {
  const sign = descending ? -1 : 1;
  return [...members].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x === null && y === null) return a.name.localeCompare(b.name);
    if (x === null) return 1;
    if (y === null) return -1;
    const order =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
    return order === 0 ? a.name.localeCompare(b.name) : order * sign;
  });
}
