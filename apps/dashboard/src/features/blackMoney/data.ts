import { supabase } from '../../lib/supabase';
import { SERVER_ZONE, zonedDayKey, zonedTime } from '../../lib/timezone';

/** One team's battle in one event, from `black_money_battles` (0181). */
export interface Battle {
  alliance_external_id: string;
  battle_ended_at: string;
  /** 1 is team A, 2 is team B — the game's own `teamIndex`. */
  team_index: number;
  /** 2 win, 3 loss (0178: agrees with the scores on every captured entry). */
  state: number | null;
  score: number | null;
  user_num: number | null;
  max_user_num: number | null;
  enemy_name: string | null;
  enemy_abbr: string | null;
  enemy_score: number | null;
  enemy_user_num: number | null;
  /** The signup reading this battle is read against; null before 2026-09-14. */
  signup_read_at: string | null;
  starters: number | null;
  substitutes: number | null;
  players_scored: number | null;
  /** Whether a battle report was captured — without one, "played" is unknown. */
  report_seen: boolean | null;
}

/** One person in one battle, from `black_money_battle_members` (0181). */
export interface BattleMember {
  game_uid: number;
  player_id: string | null;
  name: string | null;
  /** Null when they played without being on the signup list. */
  slot: 'starter' | 'substitute' | null;
  /** Null when no report was captured for the battle. */
  played: boolean | null;
  score: number | null;
  kill_score: number | null;
  occupy_score: number | null;
  first_occupy_score: number | null;
  collect_score: number | null;
  escort_score: number | null;
}

/** Both teams of one fortnightly event, keyed by its day on the game's clock. */
export interface BlackMoneyEvent {
  /** YYYY-MM-DD in server time. Both teams fight on the same server day. */
  day: string;
  teams: Battle[];
}

export function teamLabel(teamIndex: number): string {
  return teamIndex === 1 ? 'Team A' : teamIndex === 2 ? 'Team B' : `Team ${teamIndex}`;
}

export type Outcome = 'win' | 'loss' | 'unknown';

export function outcome(battle: Pick<Battle, 'state'>): Outcome {
  return battle.state === 2 ? 'win' : battle.state === 3 ? 'loss' : 'unknown';
}

/** When the battle ended, on the game's clock (UTC−2), as the game shows it. */
export function serverClock(iso: string): string {
  return `${zonedTime(iso, SERVER_ZONE)} server`;
}

/** Group battles into events: the two teams of one event share a server day.
 * Newest event first, team A before team B within it. */
export function groupEvents(battles: Battle[]): BlackMoneyEvent[] {
  const byDay = new Map<string, Battle[]>();
  for (const battle of battles) {
    const day = zonedDayKey(battle.battle_ended_at, SERVER_ZONE);
    byDay.set(day, [...(byDay.get(day) ?? []), battle]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, teams]) => ({
      day,
      teams: [...teams].sort((a, b) => a.team_index - b.team_index),
    }));
}

/** Everyone on the list who did not enter, when a report says who entered. */
export function noShows(members: BattleMember[]): BattleMember[] {
  return members.filter((m) => m.slot !== null && m.played === false);
}

export function battleKey(battle: Pick<Battle, 'battle_ended_at' | 'team_index'>): string {
  return `${battle.battle_ended_at}|${battle.team_index}`;
}

/** Every battle, newest first. ~2 per event since 2026-04 — far under 1,000. */
export async function fetchBattles(): Promise<Battle[]> {
  const { data, error } = await supabase
    .from('black_money_battles')
    .select(
      'alliance_external_id, battle_ended_at, team_index, state, score, user_num, max_user_num, enemy_name, enemy_abbr, enemy_score, enemy_user_num, signup_read_at, starters, substitutes, players_scored, report_seen',
    )
    .order('battle_ended_at', { ascending: false })
    .limit(1000);
  if (error) {
    throw new Error(`battles query failed: ${error.message}`);
  }
  return (data ?? []) as Battle[];
}

/** One battle's people. One row per person, so a page is at most ~90 rows. */
export async function fetchBattleMembers(
  battle: Pick<Battle, 'alliance_external_id' | 'battle_ended_at' | 'team_index'>,
): Promise<BattleMember[]> {
  const { data, error } = await supabase
    .from('black_money_battle_members')
    .select(
      'game_uid, player_id, name, slot, played, score, kill_score, occupy_score, first_occupy_score, collect_score, escort_score',
    )
    .eq('alliance_external_id', battle.alliance_external_id)
    .eq('battle_ended_at', battle.battle_ended_at)
    .eq('team_index', battle.team_index)
    .order('score', { ascending: false, nullsFirst: false })
    .limit(1000);
  if (error) {
    throw new Error(`battle members query failed: ${error.message}`);
  }
  return (data ?? []) as BattleMember[];
}
