// Which sidebar tabs a role sees, as an admin set them in Settings (0295).
//
// HIDING ONLY. A stored row removes a tab from the sidebar and puts a notice in front
// of its screen; it can never show a tab the code already withholds from the role, and
// the policies underneath decide what is readable regardless. No row means shown. An
// admin always sees everything, here and in the table.

import { useQuery } from '@tanstack/react-query';
import { APP_ROLES, type AppRole } from './permissions';
import { type Route, inEventsHub, isRankingRoute } from './route';
import { supabase } from './supabase';

export interface TabChoice {
  key: string;
  label: string;
}

/** The sidebar's screens, in the order it draws them. The key is the route name the
 * entry already has, except where one entry stands for several screens. */
export const TABS: readonly TabChoice[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'rankings', label: 'Rankings' },
  { key: 'migration', label: 'Migration' },
  { key: 'map', label: 'Map' },
  { key: 'alliance', label: 'Our alliance' },
  { key: 'members', label: 'Members' },
  { key: 'hive', label: 'Hive' },
  { key: 'events', label: 'Events (Black Gold, Frankie, Clash, Participation)' },
  { key: 'planner', label: 'Planner' },
  { key: 'giftCodes', label: 'Gift codes' },
  { key: 'calendar', label: 'Game calendar' },
  { key: 'eventGuide', label: 'Event guide' },
  { key: 'shopValue', label: 'Shop value' },
  { key: 'notices', label: 'Notices' },
  { key: 'guides', label: 'Guides' },
];

/** The roles an admin can hide a tab from: all but the admin, who always sees it. */
export const HIDEABLE_ROLES: readonly AppRole[] = APP_ROLES.filter((role) => role !== 'admin');

const KEYS = new Set(TABS.map((tab) => tab.key));

/** The tab a screen belongs to, or null when it belongs to none of the choices
 * (a player, a server, settings, the account page). */
export function tabKeyOf(route: Route): string | null {
  if (isRankingRoute(route)) return 'rankings';
  if (inEventsHub(route)) return 'events';
  if (route === 'notice') return 'notices';
  if (route === 'guide') return 'guides';
  return KEYS.has(route) ? route : null;
}

/** `tab|role` -> shown. Only what an admin stored. */
export type TabVisibility = ReadonlyMap<string, boolean>;

export const NO_TAB_RULES: TabVisibility = new Map();

const cell = (tab: string, role: string) => `${tab}|${role}`;

export function tabVisibilityFromRows(
  rows: ReadonlyArray<{ tab_key: string; role: string; visible: boolean }>,
): TabVisibility {
  return new Map(rows.map((row) => [cell(row.tab_key, row.role), row.visible]));
}

/** Whether `role` sees `tab`: always an admin, otherwise what was stored, else yes. */
export function isTabShown(rules: TabVisibility, tab: string, role: string | undefined): boolean {
  if (role === 'admin') return true;
  if (role === undefined) return true;
  return rules.get(cell(tab, role)) ?? true;
}

/** The stored answer for one cell, or undefined when none was stored. */
export function storedFor(rules: TabVisibility, tab: string, role: string): boolean | undefined {
  return rules.get(cell(tab, role));
}

export async function fetchTabVisibility(): Promise<TabVisibility> {
  const { data, error } = await supabase.from('tab_visibility').select('tab_key, role, visible');
  if (error) {
    // A database without the table yet shows every tab, as the code always did.
    if (error.code === '42501' || error.code === '42P01' || error.code === 'PGRST205') {
      return NO_TAB_RULES;
    }
    throw new Error(`tab visibility query failed: ${error.message}`);
  }
  return tabVisibilityFromRows(data ?? []);
}

export function useTabVisibility(): TabVisibility {
  const { data } = useQuery({
    queryKey: ['tab-visibility'],
    queryFn: fetchTabVisibility,
    staleTime: 5 * 60_000,
  });
  return data ?? NO_TAB_RULES;
}
