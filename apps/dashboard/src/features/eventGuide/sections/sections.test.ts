import { describe, expect, it } from 'vitest';
import {
  HALLOWEEN_NOTES,
  HALLOWEEN_POINT_TABLES,
  HALLOWEEN_PREP,
  HALLOWEEN_REWARDS,
  HALLOWEEN_SOURCES,
  HALLOWEEN_STAGES,
} from './fixtures';
import { parseSection, parseSections } from './index';
import { parseNotes } from './notes';
import { parsePointTable } from './pointTable';
import { parsePrep } from './prep';
import { parseRewards } from './rewards';
import { parseSources } from './sources';
import { parseStages } from './stages';

describe('each kind parses its Halloween fixture to itself', () => {
  it('rewards', () => {
    expect(parseRewards(HALLOWEEN_REWARDS)).toEqual(HALLOWEEN_REWARDS);
  });
  it('stages', () => {
    expect(parseStages(HALLOWEEN_STAGES)).toEqual(HALLOWEEN_STAGES);
  });
  it('point_table', () => {
    for (const table of HALLOWEEN_POINT_TABLES) {
      expect(parsePointTable(table)).toEqual(table);
    }
  });
  it('prep', () => {
    expect(parsePrep(HALLOWEEN_PREP)).toEqual(HALLOWEEN_PREP);
  });
  it('sources', () => {
    expect(parseSources(HALLOWEEN_SOURCES)).toEqual(HALLOWEEN_SOURCES);
  });
  it('notes', () => {
    expect(parseNotes(HALLOWEEN_NOTES)).toEqual(HALLOWEEN_NOTES);
  });
});

describe('a payload that is not the shape is null, never half an object', () => {
  it('a row whose points are not a number sinks the table', () => {
    expect(parsePointTable({ day: 2, rows: [{ action: 'x', points: 'many' }] })).toBeNull();
  });
  it('groups that are not a list sink the stages', () => {
    expect(parseStages({ groups: 'nope', totals: [] })).toBeNull();
  });
  it('a prep item with no item_ref is refused', () => {
    expect(parsePrep({ items: [{ unit: 1, cap: 3 }] })).toBeNull();
  });
  it('notes need text', () => {
    expect(parseNotes({ text_ko: '사탕' })).toBeNull();
  });
  it('a kind outside the six is null', () => {
    expect(parseSection('prose', { text: 'x' })).toBeNull();
  });
  it('the client importer writes a point_table with day null and score ids', () => {
    const parsed = parsePointTable({
      day: null,
      theme: 'Training Day',
      rows: [{ score_id: '1000020101', action: 'Defeat monsters', points: 300, per: 1 }],
    });
    expect(parsed?.rows[0]?.score_id).toBe('1000020101');
    expect(parsed?.day).toBeNull();
  });
});

describe('parseSection and parseSections', () => {
  it('tags the payload with its kind', () => {
    const section = parseSection('point_table', HALLOWEEN_POINT_TABLES[1]);
    expect(section?.kind).toBe('point_table');
    if (section?.kind === 'point_table') expect(section.payload.day).toBe(2);
  });
  it('drops rows that do not parse and keeps the rest in sort order', () => {
    const rows = [
      {
        section_id: 's2',
        guide_id: 'g',
        kind: 'notes',
        title: null,
        sort_order: 2,
        source: 'officer' as const,
        payload: HALLOWEEN_NOTES,
      },
      {
        section_id: 'bad',
        guide_id: 'g',
        kind: 'stages',
        title: null,
        sort_order: 1,
        source: 'officer' as const,
        payload: { groups: 5 },
      },
      {
        section_id: 's1',
        guide_id: 'g',
        kind: 'rewards',
        title: 'Rewards',
        sort_order: 0,
        source: 'officer' as const,
        payload: HALLOWEEN_REWARDS,
      },
    ];
    expect(parseSections(rows).map((s) => s.section_id)).toEqual(['s1', 's2']);
  });
});
