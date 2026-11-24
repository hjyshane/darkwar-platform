// What settings_history (0347) rows mean on screen: which setting, what it
// changed from and to, and whether the change can be undone from here.

import { SITE_SETTINGS } from './registry';

export type HistorySource =
  | 'app_settings'
  | 'alliance_settings'
  | 'tab_visibility'
  | 'ui_overrides'
  | 'role_permissions'
  | 'servers';

export interface HistoryRow {
  history_id: number;
  source: string;
  alliance_id: string | null;
  item: string;
  old_value: unknown;
  new_value: unknown;
  changed_by: string | null;
  changed_at: string;
}

export const SOURCE_LABELS: Record<HistorySource, string> = {
  app_settings: 'Setting',
  alliance_settings: 'Alliance setting',
  tab_visibility: 'Tab visibility',
  ui_overrides: 'Names and order',
  role_permissions: 'Permission',
  servers: 'Server group',
};

/** The name a person would use for the changed thing. */
export function describeItem(row: Pick<HistoryRow, 'source' | 'item'>): string {
  if (row.source === 'app_settings' || row.source === 'alliance_settings') {
    return SITE_SETTINGS.find((setting) => setting.key === row.item)?.label ?? row.item;
  }
  if (row.source === 'servers') return `Server ${row.item}`;
  // tab:role, scope:key:kind, role:capability: already readable.
  return row.item.split(':').join(' · ');
}

/** A value short enough for one table cell. */
export function shortValue(value: unknown, max = 80): string {
  if (value === null || value === undefined) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Whether Undo is offered for a row. Only the install's settings: they are
 * written by an admin straight to the table, the same way Undo writes. An
 * alliance's own setting, the permission grid and the rest are written
 * through their own screens and rules, which Undo would bypass. */
export function canUndo(row: Pick<HistoryRow, 'source' | 'item'>): boolean {
  // Not the alliance pin: changing it copies grids and settings between
  // alliances, which Our alliances does with care and a plain write does not.
  return row.source === 'app_settings' && row.item !== 'own_alliance';
}
