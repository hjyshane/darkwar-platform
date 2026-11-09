// Event guides (0310): which to list, in what order, and when each starts.
//
// Pure functions only. A guide with an `activity_id` takes its start from the
// game's own calendar (event_schedule_current, 0208); `starts_rule` is the
// fallback for a festival the game gives no id, and it is read in SERVER TIME
// (UTC−2), the clock the members read.

import type { LedTone } from '../../components/console/Led';
import type { ParsedSection } from './sections/index';
import { type ItemRef, itemRefKey } from './sections/itemRef';

export interface GuideRow {
  guide_id: string;
  activity_id: string | null;
  slug: string;
  title: string;
  title_ko: string | null;
  summary: string | null;
  summary_ko: string | null;
  starts_rule: unknown;
  published: boolean;
  post_id: string | null;
  updated_at: string;
}

/** How a guide with no activity id says when it starts. Every field optional:
 * an officer fills what they know. */
export interface StartsRule {
  /** Monday = 1 … Sunday = 7, as the Duel's `day`. */
  weekday?: number;
  /** `HH:MM`, server time. */
  time?: string;
  /** Free text: `577-584`. Shown, not computed with. */
  servers?: string;
  note?: string;
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseStartsRule(value: unknown): StartsRule {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const rule: StartsRule = {};
  if (
    typeof raw.weekday === 'number' &&
    Number.isInteger(raw.weekday) &&
    raw.weekday >= 1 &&
    raw.weekday <= 7
  ) {
    rule.weekday = raw.weekday;
  }
  if (typeof raw.time === 'string' && CLOCK.test(raw.time)) rule.time = raw.time;
  if (typeof raw.servers === 'string' && raw.servers.trim() !== '') rule.servers = raw.servers;
  if (typeof raw.note === 'string' && raw.note.trim() !== '') rule.note = raw.note;
  return rule;
}

/** The server runs two hours behind UTC, all year. */
const SERVER_OFFSET_MS = -2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The next server-time occurrence of the rule's weekday and time, at or
 * after `now`. Null unless the rule has both. */
export function nextRuleStart(rule: StartsRule, now: Date): Date | null {
  if (rule.weekday === undefined || rule.time === undefined) return null;
  const clock = CLOCK.exec(rule.time);
  if (clock === null) return null;
  // Shift into server wall time and do the arithmetic on UTC fields.
  const wall = new Date(now.getTime() + SERVER_OFFSET_MS);
  const sunday0 = wall.getUTCDay();
  const today = sunday0 === 0 ? 7 : sunday0;
  const ahead = (rule.weekday - today + 7) % 7;
  let candidate = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate() + ahead,
    Number(clock[1]),
    Number(clock[2]),
  );
  if (candidate < wall.getTime()) candidate += 7 * DAY_MS;
  return new Date(candidate - SERVER_OFFSET_MS);
}

export interface GuideStart {
  startsAt: string | null;
  endsAt: string | null;
  state: 'live' | 'upcoming' | 'ended' | 'unknown';
  /** Where the time came from: the game's calendar, the officer's rule, or
   * nowhere. */
  source: 'calendar' | 'rule' | 'none';
}

export interface ScheduleRow {
  activity_id: string;
  starts_at: string | null;
  ends_at: string | null;
}

const UNKNOWN: GuideStart = { startsAt: null, endsAt: null, state: 'unknown', source: 'none' };

/** When a guide's event starts. The calendar holds one row per server; a row
 * running now wins, then the soonest still ahead, then the latest that is
 * over. With no calendar row the officer's rule answers. With neither, the
 * start is unknown — which is not "now" and not "ended". */
export function guideStart(
  guide: GuideRow,
  schedule: readonly ScheduleRow[],
  now: Date,
): GuideStart {
  const at = now.getTime();
  const rows =
    guide.activity_id === null
      ? []
      : schedule.filter((row) => row.activity_id === guide.activity_id && row.starts_at !== null);
  const startOf = (row: ScheduleRow) => Date.parse(row.starts_at as string);
  const endOf = (row: ScheduleRow) =>
    row.ends_at === null ? Number.POSITIVE_INFINITY : Date.parse(row.ends_at);
  const from = (row: ScheduleRow, state: GuideStart['state']): GuideStart => ({
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    state,
    source: 'calendar',
  });

  const live = rows.filter((row) => startOf(row) <= at && at < endOf(row));
  if (live[0] !== undefined) return from(live[0], 'live');
  const ahead = rows.filter((row) => startOf(row) > at).sort((a, b) => startOf(a) - startOf(b));
  if (ahead[0] !== undefined) return from(ahead[0], 'upcoming');
  const over = rows.sort((a, b) => startOf(b) - startOf(a));
  if (over[0] !== undefined) return from(over[0], 'ended');

  const next = nextRuleStart(parseStartsRule(guide.starts_rule), now);
  if (next !== null) {
    return { startsAt: next.toISOString(), endsAt: null, state: 'upcoming', source: 'rule' };
  }
  return UNKNOWN;
}

export interface GuideEntry {
  guide: GuideRow;
  start: GuideStart;
}

const STATE_ORDER: Record<GuideStart['state'], number> = {
  live: 0,
  upcoming: 1,
  ended: 2,
  unknown: 3,
};

/** The picker's list: what is on, what is coming (soonest first), what is
 * over (latest first), then what has no start. Unpublished guides only for a
 * reader who may write them. */
export function orderGuides(
  guides: readonly GuideRow[],
  schedule: readonly ScheduleRow[],
  now: Date,
  includeDrafts: boolean,
): GuideEntry[] {
  const when = (entry: GuideEntry) =>
    entry.start.startsAt === null ? 0 : Date.parse(entry.start.startsAt);
  return guides
    .filter((guide) => guide.published || includeDrafts)
    .map((guide) => ({ guide, start: guideStart(guide, schedule, now) }))
    .sort((a, b) => {
      const byState = STATE_ORDER[a.start.state] - STATE_ORDER[b.start.state];
      if (byState !== 0) return byState;
      const byTime = a.start.state === 'ended' ? when(b) - when(a) : when(a) - when(b);
      return byTime !== 0 ? byTime : a.guide.title.localeCompare(b.guide.title);
    });
}

/** Every distinct item a guide's sections name, so the page asks the
 * catalogue for those ids and no others. */
export function refsIn(sections: readonly ParsedSection[]): ItemRef[] {
  const seen = new Map<string, ItemRef>();
  const add = (ref: ItemRef | null | undefined) => {
    if (ref) seen.set(itemRefKey(ref), ref);
  };
  for (const section of sections) {
    switch (section.kind) {
      case 'rewards':
        for (const item of section.payload.items) add(item.item_ref);
        break;
      case 'stages':
        for (const group of section.payload.groups) {
          for (const stage of group.stages) for (const drop of stage.drops) add(drop.item_ref);
        }
        for (const drop of section.payload.totals) add(drop.item_ref);
        break;
      case 'point_table':
        for (const row of section.payload.rows) add(row.item_ref);
        break;
      case 'prep':
        for (const item of section.payload.items) add(item.item_ref);
        break;
      default:
        break;
    }
  }
  return [...seen.values()];
}

const HOUR_MS = 60 * 60 * 1000;

/** How fresh the viewer's stock reading is, as an LED. No reading at all is
 * its own state: the prep cells then show the rule and no figure. */
export function stockLed(capturedAt: string | null, now: Date): { tone: LedTone; text: string } {
  const read = capturedAt === null ? Number.NaN : Date.parse(capturedAt);
  if (Number.isNaN(read)) return { tone: 'neutral', text: 'NO LINKED ACCOUNT' };
  const age = Math.max(0, now.getTime() - read);
  if (age < DAY_MS) {
    return { tone: 'ok', text: `STOCK READ ${Math.max(1, Math.floor(age / HOUR_MS))}h` };
  }
  const days = Math.floor(age / DAY_MS);
  return { tone: days < 7 ? 'warn' : 'bad', text: `STOCK READ ${days}d` };
}

/** A title as an address: what `event_guides.slug` accepts. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return slug === '' ? 'guide' : slug;
}
