import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { DuelReading, MemberName } from './extras';
import type { CalendarSlot, ScoreSource, Theme } from './guide';

export interface EventGuide {
  themes: Theme[];
  scores: ScoreSource[];
  calendar: CalendarSlot[];
}

/** The three guide tables (0248). Small and slow-changing: about 10 themes, 130
 * scoring rows and 42 calendar cells, far under PostgREST's 1,000. */
async function fetchGuide(): Promise<EventGuide> {
  const [themes, scores, calendar] = await Promise.all([
    supabase
      .from('game_event_themes')
      .select('activity_id, event_id, day, name, name_ko, min_day_score, min_week_score'),
    supabase
      .from('game_event_scores')
      .select('activity_id, event_id, score_id, action, per_value, points, sort_order'),
    supabase.from('game_event_calendar').select('activity_id, day, slot, event_id'),
  ]);
  for (const result of [themes, scores, calendar]) {
    if (result.error) {
      throw new Error(`event guide query failed: ${result.error.message}`);
    }
  }
  return {
    themes: themes.data ?? [],
    scores: scores.data ?? [],
    calendar: calendar.data ?? [],
  };
}

export function useEventGuide() {
  return useQuery({
    queryKey: ['event-guide'],
    queryFn: fetchGuide,
    staleTime: 60 * 60 * 1000,
  });
}

export interface CapturedTime {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
}

/** The siege, Frankie and Black Gold times the game told the collector (0249):
 * what is coming, and what ended in the last day. */
async function fetchCapturedTimes(): Promise<CapturedTime[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('schedule_events')
    .select('schedule_event_id, title, starts_at, ends_at')
    .eq('source', 'captured')
    .gte('starts_at', since)
    .order('starts_at')
    .limit(30);
  if (error) {
    throw new Error(`captured times query failed: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    id: row.schedule_event_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  }));
}

export function useCapturedTimes() {
  return useQuery({
    queryKey: ['event-guide', 'captured-times'],
    queryFn: fetchCapturedTimes,
    staleTime: 5 * 60 * 1000,
  });
}

export interface DuelBoardData {
  members: MemberName[];
  readings: DuelReading[];
}

/** The newest Duel readings of the people on the roster. Two reads: who is a
 * member (`member_roster`, which is the roster and nobody who left) and what the
 * board last said for each (`player_contributions`, with when). A reader the
 * gate turns away gets an empty board, not an error page. */
async function fetchDuelBoard(): Promise<DuelBoardData> {
  const [members, readings] = await Promise.all([
    supabase.from('member_roster').select('player_id, current_name').limit(100),
    supabase
      .from('player_contributions')
      .select(
        'player_id, duel_daily_score, duel_daily_updated_at, duel_weekly_score, duel_weekly_updated_at',
      )
      .limit(1000),
  ]);
  for (const result of [members, readings]) {
    if (result.error) {
      if (result.error.code === '42501') return { members: [], readings: [] };
      throw new Error(`duel board query failed: ${result.error.message}`);
    }
  }
  return {
    members: (members.data ?? []) as MemberName[],
    readings: (readings.data ?? []) as DuelReading[],
  };
}

export function useDuelBoard() {
  return useQuery({
    queryKey: ['event-guide', 'duel-board'],
    queryFn: fetchDuelBoard,
    staleTime: 5 * 60 * 1000,
  });
}
