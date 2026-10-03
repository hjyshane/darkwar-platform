// The server's in-game event calendar (0208) and the names people give it.
//
// The game sends ids and times, never names. An event nobody has named yet
// shows by its id; officers and admins name it in place, and that name is
// what everyone sees from then on.

import { supabase } from '../../lib/supabase';

/** One row of `event_schedule_current`: one event on the newest calendar the
 * collector saw for that server. */
export interface CalendarEvent {
  server_id: number;
  activity_id: string;
  name: string | null;
  starts_at: string | null;
  ends_at: string | null;
  need_hq_level: number | null;
  sub_type: number | null;
  seen_at: string;
}

export type Bucket = 'live' | 'upcoming' | 'ended' | 'standing' | 'untimed';

/** An event that runs this long is part of the game, not an event on the
 * calendar — the login lists them with ends in 2044 and beyond. */
const STANDING_AFTER_MS = 180 * 24 * 60 * 60 * 1000;

/** Which part of the page an event belongs in, as of `now`.
 *
 * `standing` before `live`: a permanent feature is technically running, but
 * listing it among this week's events buries the ones that end on Sunday. */
export function bucketOf(event: CalendarEvent, now: Date): Bucket {
  if (event.starts_at === null || event.ends_at === null) {
    return 'untimed';
  }
  const start = Date.parse(event.starts_at);
  const end = Date.parse(event.ends_at);
  if (end - start >= STANDING_AFTER_MS) {
    return 'standing';
  }
  if (end <= now.getTime()) {
    return 'ended';
  }
  return start <= now.getTime() ? 'live' : 'upcoming';
}

/** Live events by soonest end, upcoming by soonest start; the rest by id. */
export function arrange(
  events: ReadonlyArray<CalendarEvent>,
  now: Date,
): Record<Bucket, CalendarEvent[]> {
  const out: Record<Bucket, CalendarEvent[]> = {
    live: [],
    upcoming: [],
    ended: [],
    standing: [],
    untimed: [],
  };
  for (const event of events) {
    out[bucketOf(event, now)].push(event);
  }
  const by = (field: 'starts_at' | 'ends_at') => (a: CalendarEvent, b: CalendarEvent) =>
    Date.parse(a[field] ?? '') - Date.parse(b[field] ?? '') ||
    a.activity_id.localeCompare(b.activity_id);
  out.live.sort(by('ends_at'));
  out.upcoming.sort(by('starts_at'));
  out.ended.sort(by('ends_at')).reverse();
  for (const key of ['standing', 'untimed'] as const) {
    out[key].sort((a, b) => Number(a.activity_id) - Number(b.activity_id));
  }
  return out;
}

/** "2d 4h", "5h 20m", "12m" — how long until `target`. */
export function until(target: string, now: Date): string {
  const minutes = Math.max(0, Math.round((Date.parse(target) - now.getTime()) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

/** The name to show: what people called it, or its id. */
export function labelOf(event: Pick<CalendarEvent, 'name' | 'activity_id'>): string {
  return event.name ?? `Event #${event.activity_id}`;
}

export async function fetchCalendar(): Promise<CalendarEvent[]> {
  const { data, error } = await supabase
    .from('event_schedule_current')
    .select('server_id, activity_id, name, starts_at, ends_at, need_hq_level, sub_type, seen_at');
  if (error) {
    if (error.code === '42501') {
      return [];
    }
    throw new Error(error.message);
  }
  return (data ?? []).filter(
    (row): row is CalendarEvent => row.activity_id !== null && row.server_id !== null,
  ) as CalendarEvent[];
}

/** Name an event, or clear the name with an empty string. */
export async function saveEventName(activityId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  const { error } =
    trimmed === ''
      ? await supabase.from('event_names').delete().eq('activity_id', activityId)
      : await supabase
          .from('event_names')
          .upsert({ activity_id: activityId, name: trimmed }, { onConflict: 'activity_id' });
  if (error) {
    throw new Error(
      error.code === '42501' ? 'Only officers and admins can name events.' : error.message,
    );
  }
}
