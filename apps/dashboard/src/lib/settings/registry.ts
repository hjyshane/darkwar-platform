// The settings registry (2026-11-24): values an admin changes in Settings that
// used to be constants in the code.
//
// Each entry says what the value is, how it is edited and what it is when
// nobody has set it. Settings › Shared › Site values draws a form from these
// entries — there is no hand-made screen per value — and every reader gets
// the same parsed value from `useSiteSetting`. Adding a value is one entry
// here plus the line in the screen that reads it; no migration, because
// app_settings already takes any key from an admin (0032).
//
// THE DEFAULT IS THE OLD CONSTANT, and it stays in the code. A value nobody
// has saved, one that cannot be read, or a database that does not answer all
// give the default: a broken setting must not take a screen down.
//
// SCOPE. These are the install's values, the same for every alliance — game
// facts and site-wide choices. Per-alliance values keep their own path
// (alliance_settings, save_alliance_setting), and so does anything that feeds
// a score: a scoring change is a new scoring_version (CLAUDE.md), not a value
// edited in place.
//
// The ruby's dollar value is read by the shop view too (0348,
// ruby_dollar_rate()), with the same bounds, so the $ column and the value
// ratio beside it move together.

import {
  type CalendarCategoryDef,
  DEFAULT_CATEGORIES,
  parseCalendarCategories,
  parseHiddenEvents,
} from '../../features/calendar/categoryModel';
import {
  DEFAULT_CATEGORY_BY_TYPE,
  DOLLARS_PER_RUBY,
  PACK_CATEGORIES,
} from '../../features/shopValue/data';
import { LANGUAGES, type Language } from '../i18n/core';

export interface Choice {
  value: string;
  label: string;
}

export type FieldSpec =
  /** A number between two bounds. */
  | { kind: 'number'; min: number; max: number; step: number; unit?: string }
  /** One option from a fixed list. Stored as the option's value. */
  | { kind: 'select'; options: readonly Choice[] }
  /** Any number of options from a fixed list. Stored as an array. */
  | { kind: 'choices'; options: readonly Choice[] }
  /** A table from a code to one of a fixed list. Stored as an object. */
  | { kind: 'map'; keyLabel: string; keyPattern: RegExp; options: readonly Choice[] }
  /** A value with an editor of its own in Settings (SiteValuesSetting picks
   * it by name): one whose options come from the database, or whose shape a
   * generic field cannot draw. */
  | { kind: 'custom'; editor: CustomEditor };

export type CustomEditor = 'calendar-categories' | 'calendar-hidden-events' | 'event-kinds';

export interface SiteSetting<T> {
  /** The app_settings key. Never reuse one: history is kept by key. */
  key: string;
  label: string;
  /** One or two sentences: what it changes, and where. */
  help: string;
  /** The screen it shows up on, for the link next to it. */
  usedOn: { label: string; href: string };
  field: FieldSpec;
  defaultValue: T;
  /** The stored value as the reader uses it; the default when unreadable. */
  parse: (raw: unknown) => T;
  /** Cached queries a change makes stale: figures the database computes from
   * this value, which the screen would otherwise show until they expire. */
  alsoRefresh?: readonly (readonly unknown[])[];
}

// biome-ignore lint/suspicious/noExplicitAny: a list of settings of different value types
export type AnySiteSetting = SiteSetting<any>;

export function numberSetting(
  spec: Omit<SiteSetting<number>, 'parse' | 'field'> & {
    min: number;
    max: number;
    step: number;
    unit?: string;
  },
): SiteSetting<number> {
  const { min, max, step, unit, ...rest } = spec;
  return {
    ...rest,
    field: { kind: 'number', min, max, step, ...(unit === undefined ? {} : { unit }) },
    parse: (raw) =>
      typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max
        ? raw
        : spec.defaultValue,
  };
}

export function selectSetting<V extends string>(
  spec: Omit<SiteSetting<V>, 'parse' | 'field'> & { options: readonly Choice[] },
): SiteSetting<V> {
  const { options, ...rest } = spec;
  return {
    ...rest,
    field: { kind: 'select', options },
    parse: (raw) =>
      typeof raw === 'string' && options.some((option) => option.value === raw)
        ? (raw as V)
        : spec.defaultValue,
  };
}

export function choicesSetting<V extends string>(
  spec: Omit<SiteSetting<readonly V[]>, 'parse' | 'field'> & { options: readonly Choice[] },
): SiteSetting<readonly V[]> {
  const { options, ...rest } = spec;
  return {
    ...rest,
    field: { kind: 'choices', options },
    parse: (raw) => {
      if (!Array.isArray(raw) || !raw.every((entry) => typeof entry === 'string')) {
        return spec.defaultValue;
      }
      // Unknown entries are dropped, not fatal: an option removed from the
      // code should not throw away the rest of the admin's choice. Kept in
      // the options' order, so the same choice always reads the same.
      const picked = new Set(raw);
      return options
        .filter((option) => picked.has(option.value))
        .map((option) => option.value as V);
    },
  };
}

export function customSetting<T>(
  spec: Omit<SiteSetting<T>, 'field'> & { editor: CustomEditor },
): SiteSetting<T> {
  const { editor, ...rest } = spec;
  return { ...rest, field: { kind: 'custom', editor } };
}

export function mapSetting(
  spec: Omit<SiteSetting<Readonly<Record<string, string>>>, 'parse' | 'field'> & {
    keyLabel: string;
    keyPattern: RegExp;
    options: readonly Choice[];
  },
): SiteSetting<Readonly<Record<string, string>>> {
  const { keyLabel, keyPattern, options, ...rest } = spec;
  const known = new Set(options.map((option) => option.value));
  return {
    ...rest,
    field: { kind: 'map', keyLabel, keyPattern, options },
    parse: (raw) => {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return spec.defaultValue;
      }
      const out: Record<string, string> = {};
      for (const [code, value] of Object.entries(raw)) {
        if (keyPattern.test(code) && typeof value === 'string' && known.has(value)) {
          out[code] = value;
        }
      }
      return out;
    },
  };
}

// --------------------------------------------------------------------- entries

export const RUBY_DOLLAR_RATE = numberSetting({
  key: 'site.ruby_dollar_rate',
  label: 'Dollars per ruby',
  help: 'What one ruby is worth in US dollars: every $ figure and value ratio on Shop value. Change it when the store prices of ruby packs change.',
  usedOn: { label: 'Shop value', href: '#/shop-value' },
  defaultValue: DOLLARS_PER_RUBY,
  // The same bounds as ruby_dollar_rate() in the database (0348).
  min: 0.0001,
  max: 1,
  step: 0.0001,
  unit: '$',
  // shop_pack_value multiplies by it (0348).
  alsoRefresh: [['shop-packs']],
});

export const PACK_CATEGORY_BY_TYPE = mapSetting({
  key: 'site.pack_category_by_type',
  label: 'Pack categories',
  help: "Which shop category each of the game's pack types is filed under on Shop value. A type that is not listed is Other.",
  usedOn: { label: 'Shop value', href: '#/shop-value' },
  defaultValue: DEFAULT_CATEGORY_BY_TYPE,
  keyLabel: 'Pack type',
  keyPattern: /^\d{1,6}$/,
  options: PACK_CATEGORIES.filter((category) => category.key !== 'other').map((category) => ({
    value: category.key,
    label: category.label,
  })),
});

export const DEFAULT_LANGUAGE = selectSetting<Language>({
  key: 'site.default_language',
  label: 'Default language',
  help: "The language for a reader who has not picked one and whose browser asks for none of the site's languages. A reader's own pick, from the top bar, always wins.",
  usedOn: { label: 'Home', href: '#/home' },
  defaultValue: 'en',
  options: LANGUAGES.map((language) => ({ value: language.code, label: language.name })),
});

// -------------------------------------------- judgement calls on member screens
// (owner, 2026-11-24): each was a constant, each default is the old value.

export const LOW_PARTICIPATION_PERCENT = numberSetting({
  key: 'site.low_participation_percent',
  label: 'Low participation mark (%)',
  help: 'A member who took part in less than this share of the events or days counted is marked. The same line on Participation, Frankie, Capital Clash and Server Clash.',
  usedOn: { label: 'Participation', href: '#/participation' },
  defaultValue: 50,
  min: 0,
  max: 100,
  step: 5,
  unit: '%',
});

export const BOARD_HOT_SCORE = numberSetting({
  key: 'site.board_hot_score',
  label: '"hot" mark on the boards',
  help: 'A notice or guide is marked hot when its recent views plus three per comment reach this. Higher means fewer marks.',
  usedOn: { label: 'Notices', href: '#/notices' },
  defaultValue: 5,
  min: 1,
  max: 1000,
  step: 1,
});

export const BLACK_GOLD_TREND_BATTLES = numberSetting({
  key: 'site.black_gold_trend_battles',
  label: 'Black Gold trend length',
  help: "How many of a member's latest Black Gold battles their trend line draws.",
  usedOn: { label: 'Black Gold', href: '#/black-gold' },
  defaultValue: 8,
  min: 2,
  max: 50,
  step: 1,
});

export const ALLIANCE_OVERVIEW_DAYS = numberSetting({
  key: 'site.alliance_overview_days',
  label: 'Alliance overview: days looked back',
  help: "How far back the alliance page's Overview reads the duel board and the alliance's events.",
  usedOn: { label: 'Alliance page', href: '#/' },
  defaultValue: 14,
  min: 1,
  max: 90,
  step: 1,
  unit: 'days',
});

const EVENT_KIND = /^[a-z][a-z0-9_]{0,59}$/;

export const ALLIANCE_OVERVIEW_ALWAYS_LISTED = customSetting<readonly string[]>({
  key: 'site.alliance_overview_always_listed',
  label: 'Alliance overview: events always listed',
  help: 'Events the Overview names even when none was held in the window, so "none" is an answer. Every other event shows only when it was held.',
  usedOn: { label: 'Alliance page', href: '#/' },
  defaultValue: ['frankie', 'capital_clash', 'server_clash'],
  editor: 'event-kinds',
  parse: (raw) =>
    Array.isArray(raw) && raw.every((kind) => typeof kind === 'string')
      ? [...new Set(raw.filter((kind) => EVENT_KIND.test(kind)))]
      : ['frankie', 'capital_clash', 'server_clash'],
});

export const GAME_GUIDE_UPCOMING_TIMES = numberSetting({
  key: 'site.game_guide_upcoming_times',
  label: 'Game guide: upcoming times listed',
  help: "How many of an event's next start times the Game guide lists.",
  usedOn: { label: 'Game guide', href: '#/event-guide' },
  defaultValue: 4,
  min: 1,
  max: 20,
  step: 1,
});

// ------------------------------------------------------------- game calendar

export const CALENDAR_STANDING_DAYS = numberSetting({
  key: 'site.calendar_standing_days',
  label: 'Game calendar: standing events',
  help: 'An event that runs at least this many days is part of the game, not an event: it is listed apart instead of drawn on the calendar.',
  usedOn: { label: 'Game calendar', href: '#/calendar' },
  defaultValue: 180,
  min: 7,
  max: 3650,
  step: 1,
  unit: 'days',
});

export const CALENDAR_CATEGORIES = customSetting<readonly CalendarCategoryDef[]>({
  key: 'site.calendar_categories',
  label: 'Game calendar: categories',
  help: 'The categories events are filed under: their names, their order, which are shown before a reader picks, which are hidden, and new ones. Officers file each event from the calendar.',
  usedOn: { label: 'Game calendar', href: '#/calendar' },
  defaultValue: DEFAULT_CATEGORIES,
  editor: 'calendar-categories',
  parse: parseCalendarCategories,
});

export const CALENDAR_HIDDEN_EVENTS = customSetting<readonly string[]>({
  key: 'site.calendar_hidden_events',
  label: 'Game calendar: hidden events',
  help: 'Events nobody is shown on the calendar. Hide one from the calendar in edit mode; bring it back here or there.',
  usedOn: { label: 'Game calendar', href: '#/calendar' },
  defaultValue: [],
  editor: 'calendar-hidden-events',
  parse: parseHiddenEvents,
});

/** Every entry, in the order Settings draws them. */
export const SITE_SETTINGS: readonly AnySiteSetting[] = [
  DEFAULT_LANGUAGE,
  RUBY_DOLLAR_RATE,
  PACK_CATEGORY_BY_TYPE,
  CALENDAR_CATEGORIES,
  CALENDAR_HIDDEN_EVENTS,
  CALENDAR_STANDING_DAYS,
  LOW_PARTICIPATION_PERCENT,
  BOARD_HOT_SCORE,
  BLACK_GOLD_TREND_BATTLES,
  ALLIANCE_OVERVIEW_DAYS,
  ALLIANCE_OVERVIEW_ALWAYS_LISTED,
  GAME_GUIDE_UPCOMING_TIMES,
];

/** Whether a stored value is the default, compared as the reader sees it. */
export function isDefault<T>(setting: SiteSetting<T>, value: T): boolean {
  return stableJson(value) === stableJson(setting.defaultValue);
}

/** JSON with object keys sorted, so two equal maps compare equal. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : inner,
  );
}
