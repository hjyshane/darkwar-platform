// `sources`: where the event's currency or ammo comes from, with limits (0309).

import { isRecord, list, nullNum, nullStr, str } from './common';

export interface SourceRow {
  source: string;
  /** Free text: "5 per daily quest", "1 per 10 min". */
  rate: string;
  /** Most from this source, or null when uncapped. */
  cap: number | null;
}

export interface SourcesPayload {
  rows: SourceRow[];
  total_cap: number | null;
  note: string | null;
}

function parseRow(value: unknown): SourceRow | null {
  if (!isRecord(value)) return null;
  const source = str(value.source);
  if (source === null) return null;
  return {
    source,
    rate: typeof value.rate === 'string' ? value.rate : '',
    cap: nullNum(value.cap),
  };
}

export function parseSources(value: unknown): SourcesPayload | null {
  if (!isRecord(value)) return null;
  const rows = list(value.rows, parseRow);
  if (rows === null) return null;
  return { rows, total_cap: nullNum(value.total_cap), note: nullStr(value.note) };
}
