// The hook half of the calendar's arrangement (categoryModel.ts says what it
// is): read from the settings registry, built once per change.

import { useMemo } from 'react';
import { useEditMode } from '../../lib/editMode';
import {
  CALENDAR_CATEGORIES,
  CALENDAR_HIDDEN_EVENTS,
  CALENDAR_STANDING_DAYS,
} from '../../lib/settings/registry';
import { useSiteSetting } from '../../lib/settings/useSiteSetting';
import { type CalendarConfig, calendarConfig } from './categoryModel';

export * from './categoryModel';

/** The calendar as an admin arranged it. In edit mode every category counts as
 * visible, so each view draws a hidden category's events for the admin to look
 * at and refile, instead of dropping them or filing them under Events. */
export function useCalendarConfig(): CalendarConfig {
  const categories = useSiteSetting(CALENDAR_CATEGORIES);
  const hidden = useSiteSetting(CALENDAR_HIDDEN_EVENTS);
  const standingDays = useSiteSetting(CALENDAR_STANDING_DAYS);
  const { editing } = useEditMode();
  return useMemo(
    () => calendarConfig(categories, hidden, standingDays, editing),
    [categories, hidden, standingDays, editing],
  );
}
