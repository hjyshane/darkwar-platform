import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
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
 * what is coming, and what ended in the last day.
 *
 * Not hidden ones: an officer hid them on the Alarms tab. Not the calendar's
 * (0325 keys those `cal:`): they are `captured` too, and would push the
 * alliance's picks out of the 30 rows. A captured row with no key at all
 * predates keys and is a pick, so it stays.
 */
async function fetchCapturedTimes(): Promise<CapturedTime[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('schedule_events')
    .select('schedule_event_id, title, starts_at, ends_at')
    .eq('source', 'captured')
    .eq('hidden', false)
    .or('source_key.is.null,source_key.not.like.cal:*')
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

/** `enabled` false for a reader outside the alliance (0282): these are OUR
 * alliance's times, and the database returns them nothing anyway. */
export function useCapturedTimes(enabled = true) {
  return useQuery({
    queryKey: ['event-guide', 'captured-times'],
    enabled,
    queryFn: fetchCapturedTimes,
    staleTime: 5 * 60 * 1000,
  });
}
