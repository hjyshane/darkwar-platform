// Frankie (Bio-Mutant): each member's damage per event, and the trend (0277).
//
// The report is a GRID: every current member against every event that has any
// damage on record. A null cell is a member with no damage on that event --
// they did not hit the boss or were not on the board -- and for Frankie that
// is an absence, the one event where a blank counts against somebody.

import { supabase } from '../../lib/supabase';

/** One member on one event, as `boss_damage_by_event` returns it. */
export interface BossCell {
  event_day: string;
  player_id: string;
  game_uid: number;
  current_name: string;
  member_rank: number | null;
  damage: number | null;
  rank: number | null;
  /** `captured` off the game's board, `typed` by an officer; null for no row. */
  source: 'captured' | 'typed' | null;
}

export async function fetchBossDamage(): Promise<BossCell[]> {
  const { data, error } = await supabase.rpc('boss_damage_by_event');
  if (error) {
    throw new Error(`boss damage query failed: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    event_day: row.event_day,
    player_id: row.player_id,
    game_uid: Number(row.game_uid),
    current_name: row.current_name,
    member_rank: row.member_rank,
    damage: row.damage === null ? null : Number(row.damage),
    rank: row.rank,
    source: row.source === 'captured' || row.source === 'typed' ? row.source : null,
  }));
}

/** One member across the events, oldest first, to match `days`. */
export interface MemberSeries {
  player_id: string;
  name: string;
  member_rank: number | null;
  /** Damage per event; null where they have none. */
  damages: (number | null)[];
  attended: number;
  held: number;
  total: number;
  best: number | null;
  /** Mean over the events they hit the boss on; null with none. */
  average: number | null;
  /** The newest hit against the one before it; null with fewer than two. */
  change: number | null;
}

/** One event across the alliance. */
export interface EventTotal {
  day: string;
  participants: number;
  total: number;
  average: number | null;
  /** Share of the current roster that hit the boss. */
  turnout: number | null;
}

export interface BossReport {
  days: string[];
  members: MemberSeries[];
  events: EventTotal[];
}

/** Fold the grid into the page's two views. Pure, so it is tested alone. */
export function foldBossDamage(cells: readonly BossCell[]): BossReport {
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
        damages: days.map(() => null),
        attended: 0,
        held: days.length,
        total: 0,
        best: null,
        average: null,
        change: null,
      };
      byMember.set(cell.player_id, member);
    }
    const index = dayIndex.get(cell.event_day);
    if (index !== undefined && cell.damage !== null) {
      member.damages[index] = cell.damage;
    }
  }

  const members: MemberSeries[] = [];
  for (const member of byMember.values()) {
    const hit = member.damages.filter((d): d is number => d !== null);
    const total = hit.reduce((sum, d) => sum + d, 0);
    const newest = [...hit].reverse();
    members.push({
      ...member,
      attended: hit.length,
      total,
      best: hit.length === 0 ? null : Math.max(...hit),
      average: hit.length === 0 ? null : total / hit.length,
      change: newest.length < 2 ? null : (newest[0] ?? 0) - (newest[1] ?? 0),
    });
  }

  const roster = members.length;
  const events: EventTotal[] = days.map((day, index) => {
    const values = members
      .map((m) => m.damages[index] ?? null)
      .filter((d): d is number => d !== null);
    const total = values.reduce((sum, d) => sum + d, 0);
    return {
      day,
      participants: values.length,
      total,
      average: values.length === 0 ? null : total / values.length,
      turnout: roster === 0 ? null : values.length / roster,
    };
  });

  return { days, members, events };
}

/** 64,059,759,378 -> "64.1B". The exact figure goes in a title. */
export function compactDamage(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(value);
}

export type FrankieSortKey = 'name' | 'attended' | 'total' | 'average' | 'best' | 'change';

function sortValue(m: MemberSeries, key: FrankieSortKey): number | string | null {
  switch (key) {
    case 'name':
      return m.name;
    case 'attended':
      return m.attended;
    case 'total':
      return m.total;
    case 'average':
      return m.average;
    case 'best':
      return m.best;
    case 'change':
      return m.change;
  }
}

/** Sort a copy. A member with no value sorts last in both directions. */
export function sortMembers(
  members: readonly MemberSeries[],
  key: FrankieSortKey,
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
