// The hook half of the calendar's arrangement (categoryModel.ts says what it
// is): read from the settings registry, built once per change.

import { useMemo } from 'react';
import {
  CALENDAR_CATEGORIES,
  CALENDAR_DEFAULT_SHOWN,
  CALENDAR_HIDDEN_EVENTS,
  CALENDAR_STANDING_DAYS,
} from '../../lib/settings/registry';
import { useSiteSetting, useStoredSiteSettings } from '../../lib/settings/useSiteSetting';
import { type CalendarConfig, calendarConfig } from './categoryModel';

export * from './categoryModel';

/** The calendar as an admin arranged it. Before anybody saved the category
 * list, the older "shown at first" setting still decides what is shown. */
export function useCalendarConfig(): CalendarConfig {
  const stored = useStoredSiteSettings();
  const categories = useSiteSetting(CALENDAR_CATEGORIES);
  const legacyShown = useSiteSetting(CALENDAR_DEFAULT_SHOWN);
  const hidden = useSiteSetting(CALENDAR_HIDDEN_EVENTS);
  const standingDays = useSiteSetting(CALENDAR_STANDING_DAYS);
  const arranged = stored.data?.has(CALENDAR_CATEGORIES.key) === true;
  return useMemo(() => {
    const all = arranged
      ? categories
      : categories.map((category) => ({
          ...category,
          shownAtFirst: (legacyShown as readonly string[]).includes(category.key),
        }));
    return calendarConfig(all, hidden, standingDays);
  }, [arranged, categories, legacyShown, hidden, standingDays]);
}
