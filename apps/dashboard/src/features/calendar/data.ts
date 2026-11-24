// The server's in-game event calendar (0208) and what people and the game's
// own tables call each event (event_names, 0210).
//
// EVERY TIME HERE IS SERVER TIME (UTC−2). The game's day turns over at
// midnight server time, and that is the clock members plan against — an
// event that "ends Saturday" ends at Saturday's server midnight whatever the
// reader's own clock says.

import { type Translate, english } from '../../lib/i18n/core';
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
  /** A built-in category (0211) or one an admin added (0351); null when not filed. */
  category: string | null;
  activity_type: number | null;
  starts_at: string | null;
  ends_at: string | null;
  need_hq_level: number | null;
  sub_type: number | null;
  seen_at: string;
}

export type Bucket = 'live' | 'upcoming' | 'ended' | 'standing' | 'untimed';

/** An event that runs this long is part of the game, not an event on the
 * calendar — the login lists them with ends in 2044 and beyond. The default
 * for Settings › Site values › standing events (CALENDAR_STANDING_DAYS); every
 * helper below takes the setting's value as `standingMs`. */
export const STANDING_AFTER_MS = 180 * 24 * 60 * 60 * 1000;

/** Whether an event runs long enough to be part of the game. */
export function isStanding(event: CalendarEvent, standingMs: number = STANDING_AFTER_MS): boolean {
  return (
    event.starts_at !== null &&
    event.ends_at !== null &&
    Date.parse(event.ends_at) - Date.parse(event.starts_at) >= standingMs
  );
}

/** Which part of the list an event belongs in, as of `now`.
 *
 * `standing` before `live`: a permanent feature is technically running, but
 * listing it among this week's events buries the ones that end on Sunday. */
export function bucketOf(
  event: CalendarEvent,
  now: Date,
  standingMs: number = STANDING_AFTER_MS,
): Bucket {
  if (event.starts_at === null || event.ends_at === null) {
    return 'untimed';
  }
  const start = Date.parse(event.starts_at);
  const end = Date.parse(event.ends_at);
  if (end - start >= standingMs) {
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
  standingMs: number = STANDING_AFTER_MS,
): Record<Bucket, CalendarEvent[]> {
  const out: Record<Bucket, CalendarEvent[]> = {
    live: [],
    upcoming: [],
    ended: [],
    standing: [],
    untimed: [],
  };
  for (const event of events) {
    out[bucketOf(event, now, standingMs)].push(event);
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
export function until(target: string, now: Date, t: Translate = english): string {
  const minutes = Math.max(0, Math.round((Date.parse(target) - now.getTime()) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) {
    return t('{days}d {hours}h', { days, hours });
  }
  if (hours > 0) {
    return t('{hours}h {mins}m', { hours, mins });
  }
  return t('{mins}m', { mins });
}

/** The name to show: what the game or an officer called it, or its id. */
export function labelOf(
  event: Pick<CalendarEvent, 'name' | 'activity_id'>,
  t: Translate = english,
): string {
  return event.name ?? t('Event #{id}', { id: event.activity_id });
}

/** An event nobody has identified: the server lists the id, the game client's
 * tables have no name for it, and no officer has given it one. 40401 was one
 * on 2026-11-19 — a week-long entry the client itself has no row for. These
 * are kept off the calendar and listed apart: a bar reading "Event #40401"
 * tells a member nothing, and it took a lane from events that do. */
export function isUnidentified(event: Pick<CalendarEvent, 'name'>): boolean {
  return event.name === null;
}

/** The calendar's events and the unidentified ones, apart. The unidentified
 * are in id order: with no name there is nothing else to find one by. */
export function splitIdentified(events: ReadonlyArray<CalendarEvent>): {
  identified: CalendarEvent[];
  unidentified: CalendarEvent[];
} {
  const identified: CalendarEvent[] = [];
  const unidentified: CalendarEvent[] = [];
  for (const event of events) {
    (isUnidentified(event) ? unidentified : identified).push(event);
  }
  unidentified.sort((a, b) => Number(a.activity_id) - Number(b.activity_id));
  return { identified, unidentified };
}

/** What the card says an event is doing as of `now`. */
export function statusOf(
  event: CalendarEvent,
  now: Date,
  t: Translate = english,
  standingMs: number = STANDING_AFTER_MS,
): string {
  switch (bucketOf(event, now, standingMs)) {
    case 'live':
      return t('Running · ends in {time}', { time: until(event.ends_at ?? '', now, t) });
    case 'upcoming':
      return t('Starts in {time}', { time: until(event.starts_at ?? '', now, t) });
    case 'ended':
      return t('Ended');
    case 'standing':
      return t('Standing feature');
    default:
      return t('No dates');
  }
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
/** The category an event is drawn under: its own when that category exists
 * (`known`: every key an admin has, hidden ones included; the built-ins when
 * not given), else "Events", where an unfiled event has always gone. */
export function categoryOf(
  event: Pick<CalendarEvent, 'category'>,
  known: ReadonlySet<string> = BUILT_IN_KEYS,
): string {
  return event.category !== null && known.has(event.category) ? event.category : 'event';
}

const BUILT_IN_KEYS: ReadonlySet<string> = new Set(CATEGORIES);

export function inCategory(
  event: CalendarEvent,
  shown: ReadonlySet<string>,
  known?: ReadonlySet<string>,
): boolean {
  return shown.has(categoryOf(event, known));
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
  shown: ReadonlySet<string>;
  /** Every category key that exists (categoryOf). */
  known?: ReadonlySet<string>;
}

/** The list's filter: name contains the text (or the id does), the event runs
 * on the day, and it is in the category. */
export function search(events: ReadonlyArray<CalendarEvent>, query: Search): CalendarEvent[] {
  const text = query.text.trim().toLowerCase();
  return events.filter(
    (event) =>
      inCategory(event, query.shown, query.known) &&
      (text === '' ||
        labelOf(event).toLowerCase().includes(text) ||
        event.activity_id.includes(text)) &&
      (query.day === '' || runsOn(event, query.day)),
  );
}

/** For the month grid: which events start and which end on each server day.
 * Standing features are left off — a bar that never ends is not news. */
export function byServerDay(
  events: ReadonlyArray<CalendarEvent>,
  standingMs: number = STANDING_AFTER_MS,
): {
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
    if (isStanding(event, standingMs)) {
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

/** The game's own words for an event (0338): the line under its title and
 * its rules screen, as plain text. */
export interface EventText {
  summary: string | null;
  rules: string | null;
}

/** One event's text, read when its card opens. Null fields when the client
 * has no text for it, or the row does not exist (an unidentified event). */
export async function fetchEventText(activityId: string): Promise<EventText> {
  const { data, error } = await supabase
    .from('event_names')
    .select('summary, rules')
    .eq('activity_id', activityId)
    .maybeSingle();
  if (error) {
    // 42703: the dashboard shipped before 0338 was applied. The card still
    // has the dates to show; it says the text is not loaded rather than fail.
    if (error.code === '42703' || error.code === '42501') {
      return { summary: null, rules: null };
    }
    throw new Error(error.message);
  }
  return { summary: data?.summary ?? null, rules: data?.rules ?? null };
}

/** A category the dashboard knows, or null. 'shop' (0210) became 'premium'
 * in 0211; until that migration is applied the old value still arrives. */
export function knownCategory(value: string | null): string | null {
  if (value === 'shop') {
    return 'premium';
  }
  // Any well-formed key: whether it still exists is the admin's list's call,
  // made where the event is drawn (categoryOf).
  return value !== null && /^[a-z][a-z0-9_-]{0,39}$/.test(value) ? value : null;
}

/** Name an event and put it in a category. An empty name removes the row,
 * category with it. */
export async function saveEventName(
  activityId: string,
  name: string,
  category: string,
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
export function weekBars(
  events: ReadonlyArray<CalendarEvent>,
  week: string[],
  standingMs: number = STANDING_AFTER_MS,
): WeekBar[] {
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
    if (isStanding(event, standingMs)) {
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

/** One category's bars within a week: its own lanes, numbered from 0. */
export interface WeekGroup {
  category: string;
  bars: WeekBar[];
  lanes: number;
}

/** A week's bars grouped by category, in CATEGORIES order, each group packed
 * into its own lanes. Empty categories are left out. Nothing is cut: the
 * calendar has room for every lane, so no "+N more". */
export function groupedWeekBars(
  events: ReadonlyArray<CalendarEvent>,
  week: string[],
  order: readonly string[] = CATEGORIES,
  standingMs: number = STANDING_AFTER_MS,
): WeekGroup[] {
  const groups: WeekGroup[] = [];
  const known = new Set(order);
  for (const category of order) {
    const bars = weekBars(
      events.filter((event) => categoryOf(event, known) === category),
      week,
      standingMs,
    );
    if (bars.length > 0) {
      groups.push({
        category,
        bars,
        lanes: bars.reduce((most, bar) => Math.max(most, bar.lane + 1), 0),
      });
    }
  }
  return groups;
}

/** Survival Preparedness turns over every four hours from server midnight. */
export const PREP_BLOCK_HOURS = 4;

/** The six four-hour blocks of server day `day` (`YYYY-MM-DD`), as UTC
 * instants. Server midnight is 02:00 UTC (UTC−2). */
export function dayBlocks(day: string): { index: number; from: string; to: string }[] {
  const midnight = Date.parse(`${day}T02:00:00Z`);
  return Array.from({ length: 24 / PREP_BLOCK_HOURS }, (_, index) => ({
    index,
    from: new Date(midnight + index * PREP_BLOCK_HOURS * 3_600_000).toISOString(),
    to: new Date(midnight + (index + 1) * PREP_BLOCK_HOURS * 3_600_000).toISOString(),
  }));
}

/** Events that start or end inside [from, to) — what changes in that block.
 * An event running straight through the block is on the all-day list. */
export function changesIn(
  events: ReadonlyArray<CalendarEvent>,
  from: string,
  to: string,
  standingMs: number = STANDING_AFTER_MS,
): { event: CalendarEvent; edge: 'starts' | 'ends' }[] {
  const lo = Date.parse(from);
  const hi = Date.parse(to);
  const out: { event: CalendarEvent; edge: 'starts' | 'ends' }[] = [];
  for (const event of events) {
    if (event.starts_at === null || event.ends_at === null) {
      continue;
    }
    if (isStanding(event, standingMs)) {
      continue;
    }
    const start = Date.parse(event.starts_at);
    const end = Date.parse(event.ends_at);
    if (start >= lo && start < hi) {
      out.push({ event, edge: 'starts' });
    }
    if (end > lo && end <= hi) {
      out.push({ event, edge: 'ends' });
    }
  }
  return out.sort(
    (a, b) =>
      Date.parse((a.edge === 'starts' ? a.event.starts_at : a.event.ends_at) ?? '') -
      Date.parse((b.edge === 'starts' ? b.event.starts_at : b.event.ends_at) ?? ''),
  );
}

/** `YYYY-MM-DD` plus `days` days. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
