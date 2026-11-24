// Reading and writing the registry's values (registry.ts).
//
// One query for all of them: they are few and small, every screen that reads
// one is likely to read another, and Settings shows them together.

import type { Json } from '@dw/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '../supabase';
import { type AnySiteSetting, SITE_SETTINGS, type SiteSetting } from './registry';

export interface StoredSetting {
  value: unknown;
  updatedAt: string;
  updatedBy: string | null;
}

export const SITE_SETTINGS_KEY = ['app_settings', 'site'] as const;

async function fetchSiteSettings(): Promise<ReadonlyMap<string, StoredSetting>> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value, updated_at, updated_by')
    .in(
      'key',
      SITE_SETTINGS.map((setting) => setting.key),
    );
  if (error) throw new Error(`settings query failed: ${error.message}`);
  return new Map(
    (data ?? []).map((row) => [
      row.key,
      { value: row.value, updatedAt: row.updated_at, updatedBy: row.updated_by },
    ]),
  );
}

/** Every stored registry value, by key. Absent keys are unset. */
export function useStoredSiteSettings() {
  return useQuery({
    queryKey: SITE_SETTINGS_KEY,
    queryFn: fetchSiteSettings,
    staleTime: 5 * 60_000,
  });
}

/** A registry value as a screen uses it: the stored value when there is a
 * readable one, the default otherwise — including while the query runs and
 * when it fails. Never undefined. */
export function useSiteSetting<T>(setting: SiteSetting<T>): T {
  const { data } = useStoredSiteSettings();
  const stored = data?.get(setting.key);
  // The same object until the stored value changes, so a reader can put it in
  // a memo's dependencies without recomputing on every render.
  return useMemo(
    () => (stored === undefined ? setting.defaultValue : setting.parse(stored.value)),
    [stored, setting],
  );
}

/** Save a value, or `null` to go back to the default (the row is deleted, so
 * a later change of the default in the code reaches this site too). */
export async function saveSiteSetting(key: string, value: unknown): Promise<void> {
  if (value === null) {
    const { error } = await supabase.from('app_settings').delete().eq('key', key);
    if (error) throw new Error(error.message);
    return;
  }
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from('app_settings').upsert({
    key,
    // The parsed shape is what was validated; Json is wider than any of them.
    value: value as Json,
    updated_by: auth.user?.id ?? null,
  });
  if (error) throw new Error(error.message);
}

/** `saveSiteSetting` with the caches that read the value refreshed after. */
export function useSaveSiteSetting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ setting, value }: { setting: AnySiteSetting; value: unknown }) =>
      saveSiteSetting(setting.key, value),
    onSettled: async (_data, _error, { setting }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: SITE_SETTINGS_KEY }),
        client.invalidateQueries({ queryKey: ['settings-history'] }),
        ...(setting.alsoRefresh ?? []).map((queryKey) => client.invalidateQueries({ queryKey })),
      ]);
    },
  });
}
