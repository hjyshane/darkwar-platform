// The server's in-game event calendar (0208) and what people and the game's
// own tables call each event (event_names, 0210).
//
// EVERY TIME HERE IS SERVER TIME (UTC−2). The game's day turns over at
// midnight server time, and that is the clock members plan against — an
// event that "ends Saturday" ends at Saturday's server midnight whatever the
// reader's own clock says.

import { supabase } from '../../lib/supabase';
import { SERVER_ZONE, zonedDayKey, zonedTime } from '../../lib/timezone';

/** The calendar's categories (0211), in the order they are listed. */
export const CATEGORIES = ['major', 'recurring', 'season', 'event', 'pass', 'premium'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  major: 'Major events',
  recurring: 'Recurring',
  season: 'Season',
  event: 'Events',
  pass: 'Event passes',
  premium: 'Premium',
};

/** Shown until the reader picks: everything that is played, nothing to buy. */
export const DEFAULT_SHOWN: ReadonlySet<Category> = new Set([
  'major',
  'recurring',
  'season',
  'event',
]);

/** One row of `event_schedule_current`: one event on the newest calendar the
 * collector saw for that server. */
export interface CalendarEvent {
  server_id: number;
  activity_id: string;
  name: string | null;
  category: Category | null;
  activity_type: number | null;
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

/** Which part of the list an event belongs in, as of `now`.
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

/** The name to show: what the game or an officer called it, or its id. */
export function labelOf(event: Pick<CalendarEvent, 'name' | 'activity_id'>): string {
  return event.name ?? `Event #${event.activity_id}`;
}

/** `2026-10-03` — the server-time day an instant falls on. */
export function serverDay(iso: string): string {
  return zonedDayKey(iso, SERVER_ZONE);
}

/** `Oct 3 · 12:00`, in server time — with the year when it is not this one,
 * so a standing feature ending in 2044 does not read as next April. */
export function serverWhen(iso: string | null, now: Date = new Date()): string {
  if (iso === null) {
    return '—';
  }
  const [year, month, day] = serverDay(iso).split('-').map(Number);
  const name = new Date(Date.UTC(2000, (month ?? 1) - 1, 1)).toLocaleString('en', {
    month: 'short',
    timeZone: 'UTC',
  });
  const thisYear = Number(serverDay(now.toISOString()).slice(0, 4));
  const yearPart = year === thisYear ? '' : `, ${year}`;
  return `${name} ${day}${yearPart} · ${zonedTime(iso, SERVER_ZONE)}`;
}

/** The last server day an event runs on. An end at exactly midnight belongs
 * to the day before: the event is over by the time that day starts. */
export function lastServerDay(endsAt: string): string {
  return serverDay(new Date(Date.parse(endsAt) - 1).toISOString());
}

/** Unclassified events count as events: most of the calendar is play. */
export function categoryOf(event: Pick<CalendarEvent, 'category'>): Category {
  return event.category ?? 'event';
}

export function inCategory(event: CalendarEvent, shown: ReadonlySet<Category>): boolean {
  return shown.has(categoryOf(event));
}

/** activity_panel.type of Season Celebration, the finale: it starts the
 * moment the season proper ends. */
const SEASON_FINALE_TYPE = 131;
/** Season Pass and Season Weekly Pass: still claimable after the season. */
const SEASON_PASS_TYPES: ReadonlySet<number> = new Set([45, 46]);

/** When the season proper ends: the earliest start of its finale on this
 * calendar, or null when no finale is listed. */
export function seasonEnd(events: ReadonlyArray<CalendarEvent>): string | null {
  let end: string | null = null;
  for (const event of events) {
    if (event.activity_type === SEASON_FINALE_TYPE && event.starts_at !== null) {
      if (end === null || Date.parse(event.starts_at) < Date.parse(end)) {
        end = event.starts_at;
      }
    }
  }
  return end;
}

/** Season events end with the season. The server lists some past it — Arctic
 * Ice Pit runs to 10-20 though the season ends 10-12 — and they are gone in
 * the game when the finale starts. So a season event that started before the
 * finale is cut off at the finale's start. The finale's own events and the
 * season passes keep their dates. */
export function endWithSeason(events: ReadonlyArray<CalendarEvent>): CalendarEvent[] {
  const end = seasonEnd(events);
  if (end === null) {
    return [...events];
  }
  const cut = Date.parse(end);
  return events.map((event) =>
    categoryOf(event) === 'season' &&
    !SEASON_PASS_TYPES.has(event.activity_type ?? -1) &&
    event.starts_at !== null &&
    event.ends_at !== null &&
    Date.parse(event.starts_at) < cut &&
    Date.parse(event.ends_at) > cut
      ? { ...event, ends_at: end }
      : event,
  );
}

/** Whether the event runs at some point during server day `day`. */
export function runsOn(event: CalendarEvent, day: string): boolean {
  if (event.starts_at === null || event.ends_at === null) {
    return false;
  }
  return serverDay(event.starts_at) <= day && day <= lastServerDay(event.ends_at);
}

export interface Search {
  text: string;
  /** `YYYY-MM-DD` server day, or '' for any. */
  day: string;
  shown: ReadonlySet<Category>;
}

/** The list's filter: name contains the text (or the id does), the event runs
 * on the day, and it is in the category. */
export function search(events: ReadonlyArray<CalendarEvent>, query: Search): CalendarEvent[] {
  const text = query.text.trim().toLowerCase();
  return events.filter(
    (event) =>
      inCategory(event, query.shown) &&
      (text === '' ||
        labelOf(event).toLowerCase().includes(text) ||
        event.activity_id.includes(text)) &&
      (query.day === '' || runsOn(event, query.day)),
  );
}

/** For the month grid: which events start and which end on each server day.
 * Standing features are left off — a bar that never ends is not news. */
export function byServerDay(events: ReadonlyArray<CalendarEvent>): {
  starts: Map<string, CalendarEvent[]>;
  ends: Map<string, CalendarEvent[]>;
} {
  const starts = new Map<string, CalendarEvent[]>();
  const ends = new Map<string, CalendarEvent[]>();
  const push = (map: Map<string, CalendarEvent[]>, key: string, event: CalendarEvent) => {
    map.set(key, [...(map.get(key) ?? []), event]);
  };
  for (const event of events) {
    if (event.starts_at === null || event.ends_at === null) {
      continue;
    }
    if (Date.parse(event.ends_at) - Date.parse(event.starts_at) >= STANDING_AFTER_MS) {
      continue;
    }
    push(starts, serverDay(event.starts_at), event);
    push(ends, lastServerDay(event.ends_at), event);
  }
  return { starts, ends };
}

export async function fetchCalendar(): Promise<CalendarEvent[]> {
  const { data, error } = await supabase
    .from('event_schedule_current')
    .select(
      'server_id, activity_id, name, category, activity_type, starts_at, ends_at, need_hq_level, sub_type, seen_at',
    );
  if (error) {
    if (error.code === '42501') {
      return [];
    }
    throw new Error(error.message);
  }
  return (data ?? [])
    .filter((row) => row.activity_id !== null && row.server_id !== null)
    .map((row) => ({ ...row, category: knownCategory(row.category) })) as CalendarEvent[];
}

/** A category the dashboard knows, or null. 'shop' (0210) became 'premium'
 * in 0211; until that migration is applied the old value still arrives. */
export function knownCategory(value: string | null): Category | null {
  if (value === 'shop') {
    return 'premium';
  }
  return (CATEGORIES as ReadonlyArray<string>).includes(value ?? '') ? (value as Category) : null;
}

/** Name an event and put it in a category. An empty name removes the row,
 * category with it. */
export async function saveEventName(
  activityId: string,
  name: string,
  category: Category,
): Promise<void> {
  const trimmed = name.trim();
  const { error } =
    trimmed === ''
      ? await supabase.from('event_names').delete().eq('activity_id', activityId)
      : await supabase
          .from('event_names')
          .upsert(
            { activity_id: activityId, name: trimmed, category },
            { onConflict: 'activity_id' },
          );
  if (error) {
    throw new Error(
      error.code === '42501' ? 'Only officers and admins can name events.' : error.message,
    );
  }
}

/** One event's bar within one week of the month grid. Columns are 0..6,
 * Monday first; `lane` is the row it is drawn on so bars never overlap. */
export interface WeekBar {
  event: CalendarEvent;
  start: number;
  end: number;
  lane: number;
  /** The event really starts / ends inside this week (round that end). */
  startsHere: boolean;
  endsHere: boolean;
}

/** Lay out one week: every event that runs on any of its seven server days,
 * clipped to the week, packed into the fewest lanes. Major fights first, so
 * they are never behind "+N more"; then longer bars, then earlier ones, so a
 * week-long event takes the top lane and short ones fill the gaps under it. Standing features are left off — a bar across every
 * week is not news. */
export function weekBars(events: ReadonlyArray<CalendarEvent>, week: string[]): WeekBar[] {
  const first = week[0];
  const last = week[week.length - 1];
  if (first === undefined || last === undefined) {
    return [];
  }
  const spans: Omit<WeekBar, 'lane'>[] = [];
  for (const event of events) {
    if (event.starts_at === null || event.ends_at === null) {
      continue;
    }
    if (Date.parse(event.ends_at) - Date.parse(event.starts_at) >= STANDING_AFTER_MS) {
      continue;
    }
    const from = serverDay(event.starts_at);
    const to = lastServerDay(event.ends_at);
    if (to < first || from > last) {
      continue;
    }
    const start = from < first ? 0 : week.indexOf(from);
    const end = to > last ? week.length - 1 : week.indexOf(to);
    if (start < 0 || end < 0 || end < start) {
      continue;
    }
    spans.push({ event, start, end, startsHere: from >= first, endsHere: to <= last });
  }
  const major = (span: Omit<WeekBar, 'lane'>) => (categoryOf(span.event) === 'major' ? 1 : 0);
  spans.sort(
    (a, b) =>
      major(b) - major(a) ||
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start ||
      a.event.activity_id.localeCompare(b.event.activity_id),
  );
  const lanes: number[] = []; // last column taken in each lane
  return spans.map((span) => {
    let lane = lanes.findIndex((taken) => taken < span.start);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(span.end);
    } else {
      lanes[lane] = span.end;
    }
    return { ...span, lane };
  });
}
