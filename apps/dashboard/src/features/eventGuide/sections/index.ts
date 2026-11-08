// The six section kinds of an event guide (0309), and the one entry point
// that turns an `event_guide_sections` row into a typed section.

import { isSectionKind } from './common';
import { type NotesPayload, parseNotes } from './notes';
import { type PointTablePayload, parsePointTable } from './pointTable';
import { type PrepPayload, parsePrep } from './prep';
import { type RewardsPayload, parseRewards } from './rewards';
import { type SourcesPayload, parseSources } from './sources';
import { type StagesPayload, parseStages } from './stages';

export { SECTION_KINDS, type SectionKind } from './common';
export type { NotesPayload } from './notes';
export type { PointRow, PointTablePayload } from './pointTable';
export type { PrepItem, PrepPayload } from './prep';
export type { RewardItem, RewardsPayload } from './rewards';
export type { SourceRow, SourcesPayload } from './sources';
export type { Drop, Stage, StageGroup, StagesPayload } from './stages';

export type SectionPayload =
  | { kind: 'rewards'; payload: RewardsPayload }
  | { kind: 'stages'; payload: StagesPayload }
  | { kind: 'point_table'; payload: PointTablePayload }
  | { kind: 'prep'; payload: PrepPayload }
  | { kind: 'sources'; payload: SourcesPayload }
  | { kind: 'notes'; payload: NotesPayload };

export function parseSection(kind: string, payload: unknown): SectionPayload | null {
  if (!isSectionKind(kind)) return null;
  switch (kind) {
    case 'rewards': {
      const parsed = parseRewards(payload);
      return parsed === null ? null : { kind, payload: parsed };
    }
    case 'stages': {
      const parsed = parseStages(payload);
      return parsed === null ? null : { kind, payload: parsed };
    }
    case 'point_table': {
      const parsed = parsePointTable(payload);
      return parsed === null ? null : { kind, payload: parsed };
    }
    case 'prep': {
      const parsed = parsePrep(payload);
      return parsed === null ? null : { kind, payload: parsed };
    }
    case 'sources': {
      const parsed = parseSources(payload);
      return parsed === null ? null : { kind, payload: parsed };
    }
    case 'notes': {
      const parsed = parseNotes(payload);
      return parsed === null ? null : { kind, payload: parsed };
    }
  }
}

/** An `event_guide_sections` row as the page reads it. */
export interface GuideSection {
  section_id: string;
  guide_id: string;
  kind: string;
  title: string | null;
  sort_order: number;
  source: 'client' | 'officer';
  payload: unknown;
}

export type ParsedSection = Omit<GuideSection, 'kind' | 'payload'> & SectionPayload;

/** Rows in sort order, each with its payload typed. A row whose payload does
 * not parse is dropped: a broken section must not take the guide down with it,
 * and the editor is where it gets fixed. */
export function parseSections(rows: readonly GuideSection[]): ParsedSection[] {
  const out: ParsedSection[] = [];
  for (const row of [...rows].sort((a, b) => a.sort_order - b.sort_order)) {
    const parsed = parseSection(row.kind, row.payload);
    if (parsed === null) continue;
    const { kind: _kind, payload: _payload, ...rest } = row;
    out.push({ ...rest, ...parsed });
  }
  return out;
}
