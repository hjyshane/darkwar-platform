import { getActiveAlliance } from '../../lib/activeAlliance';
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
  /** Whether its battle report has been captured yet. Every member receives
   * it (alliance mail); without it, "played" is unknown. */
  report_seen: boolean | null;
}

/** One person in one battle, from `black_money_battle_members` (0181). */
export interface BattleMember {
  game_uid: number;
  player_id: string | null;
  name: string | null;
  /** Null when they played without being on the signup list. */
  slot: 'starter' | 'substitute' | null;
  /** Null while the battle's report is not yet captured. */
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

/** One opposing player in one battle, from `black_money_battle_opponents` (0182). */
export interface BattleOpponent {
  game_uid: number;
  player_id: string | null;
  name: string | null;
  server_id: number | null;
  opponent_abbr: string | null;
  score: number | null;
  kill_score: number | null;
  occupy_score: number | null;
  first_occupy_score: number | null;
  collect_score: number | null;
  escort_score: number | null;
}

/** The other side of one battle, from the same report ours comes from. */
export async function fetchBattleOpponents(
  battle: Pick<Battle, 'alliance_external_id' | 'battle_ended_at' | 'team_index'>,
): Promise<BattleOpponent[]> {
  const { data, error } = await supabase
    .from('black_money_battle_opponents')
    .select(
      'game_uid, player_id, name, server_id, opponent_abbr, score, kill_score, occupy_score, first_occupy_score, collect_score, escort_score',
    )
    .eq('alliance_external_id', battle.alliance_external_id)
    .eq('battle_ended_at', battle.battle_ended_at)
    .eq('team_index', battle.team_index)
    .order('score', { ascending: false, nullsFirst: false })
    .limit(1000);
  if (error) {
    throw new Error(`opponents query failed: ${error.message}`);
  }
  return (data ?? []) as BattleOpponent[];
}

/** An opposing player in the member table's shape: never on our list, and
 * in the report, so present. */
export function opponentAsMember(o: BattleOpponent): BattleMember {
  return {
    game_uid: o.game_uid,
    player_id: o.player_id,
    name: o.name,
    slot: null,
    played: true,
    score: o.score,
    kill_score: o.kill_score,
    occupy_score: o.occupy_score,
    first_occupy_score: o.first_occupy_score,
    collect_score: o.collect_score,
    escort_score: o.escort_score,
  };
}

/** How often one member was listed and did not play, since the 2026-09-27
 * event (0183). Only battles with a captured report count either way. */
export interface MemberMisses {
  game_uid: number;
  starter_misses: number;
  substitute_misses: number;
  starter_battles: number;
  substitute_battles: number;
}

/** The whole alliance's tally, one row per person — well under 1,000. */
export async function fetchMemberMisses(allianceExternalId: string): Promise<MemberMisses[]> {
  const { data, error } = await supabase
    .from('black_money_member_misses')
    .select('game_uid, starter_misses, substitute_misses, starter_battles, substitute_battles')
    .eq('alliance_external_id', allianceExternalId)
    .limit(1000);
  if (error) {
    throw new Error(`misses query failed: ${error.message}`);
  }
  return (data ?? []) as MemberMisses[];
}

/** Every battle, newest first. ~2 per event since 2026-04 — far under 1,000. */
export async function fetchBattles(): Promise<Battle[]> {
  let query = supabase
    .from('black_money_battles')
    .select(
      'alliance_external_id, battle_ended_at, team_index, state, score, user_num, max_user_num, enemy_name, enemy_abbr, enemy_score, enemy_user_num, signup_read_at, starters, substitutes, players_scored, report_seen',
    );
  // The alliance being viewed. A CLIENT filter, not a boundary: the battle
  // tables are member-readable across our alliances (0178), and scoping them
  // in RLS would also hide the enemy rows the opponents view reads from the
  // same table. A battle the collector could not tie to an alliance stays in,
  // because there is no way to say whose it is.
  const viewed = getActiveAlliance();
  if (viewed !== null) {
    query = query.or(`alliance_id.eq.${viewed},alliance_id.is.null`);
  }
  const { data, error } = await query.order('battle_ended_at', { ascending: false }).limit(1000);
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
