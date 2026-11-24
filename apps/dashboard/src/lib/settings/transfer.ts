// Site values out to a file and back (2026-11-24).
//
// For a copy before a big change, for moving a setup to a fresh install, and
// for reading what is set without opening every card. The file holds the
// registry values somebody changed and the server group; nothing else in
// Settings (per-alliance values, the permission grid) is in it.
//
// IMPORT NEVER WRITES BLIND. planImport() compares the file with what is
// stored and returns the changes it would make; the screen lists them and
// writes only after a click. A key the registry does not know is reported and
// skipped, and a value the registry cannot read is reported and skipped —
// never stored as the default under the admin's nose.

import { type AnySiteSetting, isDefault, stableJson } from './registry';

export const TRANSFER_FORMAT = 'dw-site-values';
export const TRANSFER_VERSION = 1;

export interface TransferFile {
  format: typeof TRANSFER_FORMAT;
  version: number;
  exportedAt: string;
  /** Registry key -> stored value. A key that is at its default is absent. */
  values: Record<string, unknown>;
  /** The tracked servers, ascending. */
  trackedServers: number[];
}

export function buildExport(
  settings: readonly AnySiteSetting[],
  stored: ReadonlyMap<string, { value: unknown }>,
  trackedServers: readonly number[],
  now: Date,
): TransferFile {
  const values: Record<string, unknown> = {};
  for (const setting of settings) {
    const row = stored.get(setting.key);
    if (row !== undefined) values[setting.key] = setting.parse(row.value);
  }
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    exportedAt: now.toISOString(),
    values,
    trackedServers: [...trackedServers].sort((a, b) => a - b),
  };
}

export type SettingChange =
  /** `value: null` resets to the default. */
  | { kind: 'setting'; setting: AnySiteSetting; from: unknown; to: unknown; value: unknown }
  | { kind: 'server'; serverId: number; tracked: boolean };

export interface ImportPlan {
  changes: SettingChange[];
  /** Keys in the file the registry does not know. */
  unknownKeys: string[];
  /** Keys whose value in the file the registry cannot read. */
  unreadable: string[];
}

export type ImportResult = { ok: true; plan: ImportPlan } | { ok: false; reason: string };

/** What importing `text` would change. Settings the file leaves out go back to
 * their defaults: the file is the whole picture, as Export writes it. */
export function planImport(
  text: string,
  settings: readonly AnySiteSetting[],
  stored: ReadonlyMap<string, { value: unknown }>,
  servers: ReadonlyArray<{ server_id: number; is_tracked: boolean }>,
): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'The file is not JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: 'The file is not a Site values export.' };
  }
  const file = parsed as Partial<TransferFile>;
  if (file.format !== TRANSFER_FORMAT) {
    return { ok: false, reason: 'The file is not a Site values export.' };
  }
  if (file.version !== TRANSFER_VERSION) {
    return {
      ok: false,
      reason: `The file is version ${String(file.version)}; this site reads ${TRANSFER_VERSION}.`,
    };
  }
  const values =
    typeof file.values === 'object' && file.values !== null && !Array.isArray(file.values)
      ? (file.values as Record<string, unknown>)
      : {};

  const known = new Map(settings.map((setting) => [setting.key, setting]));
  const unknownKeys = Object.keys(values).filter((key) => !known.has(key));
  const unreadable: string[] = [];
  const changes: SettingChange[] = [];

  for (const setting of settings) {
    const row = stored.get(setting.key);
    const current = row === undefined ? setting.defaultValue : setting.parse(row.value);
    if (!(setting.key in values)) {
      if (row !== undefined) {
        changes.push({
          kind: 'setting',
          setting,
          from: current,
          to: setting.defaultValue,
          value: null,
        });
      }
      continue;
    }
    const incoming = values[setting.key];
    const next = setting.parse(incoming);
    // The parser drops what it cannot read; if that changed the value, the
    // file says something this site would not store as written.
    if (stableJson(next) !== stableJson(incoming)) {
      unreadable.push(setting.key);
      continue;
    }
    if (stableJson(next) === stableJson(current)) continue;
    changes.push({
      kind: 'setting',
      setting,
      from: current,
      to: next,
      value: isDefault(setting, next) ? null : next,
    });
  }

  if (Array.isArray(file.trackedServers)) {
    const wanted = new Set(
      file.trackedServers.filter(
        (id): id is number => Number.isInteger(id) && id >= 1 && id <= 9999,
      ),
    );
    const byId = new Map(servers.map((row) => [row.server_id, row.is_tracked]));
    for (const [id, tracked] of byId) {
      if (tracked !== wanted.has(id))
        changes.push({ kind: 'server', serverId: id, tracked: wanted.has(id) });
    }
    for (const id of [...wanted].sort((a, b) => a - b)) {
      if (!byId.has(id)) changes.push({ kind: 'server', serverId: id, tracked: true });
    }
  }

  return { ok: true, plan: { changes, unknownKeys, unreadable } };
}
