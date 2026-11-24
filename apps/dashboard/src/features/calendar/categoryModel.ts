// The game calendar's categories and hidden events, as an admin arranged them
// (Settings › Shared › Site values, 2026-11-24).
//
// The six built-in categories (0211) are always there: events written before
// any of this point at them, and the officers' Edit form files into them. An
// admin may rename, reorder or hide any category, mark which are shown before
// a reader picks, and add new ones (0349 lets event_names hold their keys). A
// category added and then removed leaves its events in "Events", where an
// event with no category has always gone.
//
// Hidden events are a list of activity ids: gone from every view for every
// reader, still listed to an admin in edit mode so they can come back.

import type { Translate } from '../../lib/i18n/core';
import { CATEGORIES, CATEGORY_LABELS, type Category, DEFAULT_SHOWN } from './data';

export interface CalendarCategoryDef {
  /** The key event_names.category holds: a built-in, or a slug an admin made. */
  key: string;
  /** What an admin called it; null for a built-in keeps its translated name. */
  label: string | null;
  /** Hidden: not offered as a filter, and its events are not drawn. */
  hidden: boolean;
  /** Shown before the reader picks their own filters. */
  shownAtFirst: boolean;
}

export const CATEGORY_KEY = /^[a-z][a-z0-9_-]{0,39}$/;
const BUILT_IN: ReadonlySet<string> = new Set(CATEGORIES);
/** At most this many in the list, the built-ins included. The editor stops
 * adding at the limit, so nothing an admin added is dropped on save. */
export const MAX_CATEGORIES = 30;
const MAX_LABEL = 40;

export const DEFAULT_CATEGORIES: readonly CalendarCategoryDef[] = CATEGORIES.map((key) => ({
  key,
  label: null,
  hidden: false,
  shownAtFirst: DEFAULT_SHOWN.has(key),
}));

export function isBuiltIn(key: string): boolean {
  return BUILT_IN.has(key);
}

/** The stored list, checked: unknown shapes are dropped, duplicates and bad
 * keys skipped, and any built-in missing from it is put back at the end, so
 * an event filed under it can never lose its category. Past the limit only
 * added categories are dropped, never a built-in with its name and flags. */
export function parseCalendarCategories(raw: unknown): readonly CalendarCategoryDef[] {
  if (!Array.isArray(raw)) return DEFAULT_CATEGORIES;
  const out: CalendarCategoryDef[] = [];
  const seen = new Set<string>();
  let room = MAX_CATEGORIES - DEFAULT_CATEGORIES.length;
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { key, label, hidden, shownAtFirst } = entry as Record<string, unknown>;
    if (typeof key !== 'string' || !CATEGORY_KEY.test(key) || seen.has(key)) continue;
    const name = typeof label === 'string' ? label.trim().slice(0, MAX_LABEL) : '';
    if (!isBuiltIn(key)) {
      if (name === '' || room === 0) continue;
      room -= 1;
    }
    seen.add(key);
    out.push({
      key,
      label: name === '' ? null : name,
      hidden: hidden === true,
      shownAtFirst: shownAtFirst === true,
    });
  }
  for (const builtIn of DEFAULT_CATEGORIES) {
    if (!seen.has(builtIn.key)) out.push(builtIn);
  }
  return out;
}

/** Activity ids to hide: digits only, each once. */
export function parseHiddenEvents(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(raw.filter((id): id is string => typeof id === 'string' && /^\d{1,12}$/.test(id))),
  ];
}

/** A fresh key for a category an admin is adding, from its name. */
export function newCategoryKey(label: string, taken: ReadonlySet<string>): string {
  const base =
    `c-${label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}`.slice(0, 32) || 'c';
  let key = base === 'c-' ? 'c' : base;
  for (let n = 2; taken.has(key) || !CATEGORY_KEY.test(key); n += 1) key = `${base}-${n}`;
  return key;
}

export interface CalendarConfig {
  /** Every category, in the admin's order. */
  all: readonly CalendarCategoryDef[];
  /** The categories readers are offered, in order; every one in edit mode. */
  visible: readonly CalendarCategoryDef[];
  /** Keys of the visible categories. */
  visibleKeys: ReadonlySet<string>;
  /** Every key an event can be filed under (hidden ones included). */
  knownKeys: ReadonlySet<string>;
  hiddenEvents: ReadonlySet<string>;
  /** Shown before the reader picks. */
  shownAtFirst: readonly string[];
  /** An event at least this long is part of the game, not an event. */
  standingMs: number;
  label: (key: string, t: Translate) => string;
  /** The colour class: a built-in's own, or one of four for added ones. */
  className: (key: string) => string;
}

/** Build the config from what is stored. Pure, for tests and the page. */
export function calendarConfig(
  all: readonly CalendarCategoryDef[],
  hidden: readonly string[],
  standingDays: number,
  editing = false,
): CalendarConfig {
  const offered = all.filter((category) => !category.hidden);
  const visible = editing ? all : offered;
  const byKey = new Map(all.map((category) => [category.key, category]));
  const custom = all.filter((category) => !isBuiltIn(category.key)).map((c) => c.key);
  return {
    all,
    visible,
    visibleKeys: new Set(visible.map((category) => category.key)),
    knownKeys: new Set(all.map((category) => category.key)),
    hiddenEvents: new Set(hidden),
    shownAtFirst: offered.filter((category) => category.shownAtFirst).map((c) => c.key),
    standingMs: standingDays * 24 * 60 * 60 * 1000,
    label: (key, t) => {
      const def = byKey.get(key);
      if (def?.label) return def.label;
      return isBuiltIn(key) ? t(CATEGORY_LABELS[key as Category]) : key;
    },
    className: (key) =>
      isBuiltIn(key)
        ? `calendar-cat-${key}`
        : `calendar-cat-custom-${Math.max(0, custom.indexOf(key)) % 4}`,
  };
}
