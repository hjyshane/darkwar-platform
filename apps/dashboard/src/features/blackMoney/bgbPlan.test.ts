import { describe, expect, it } from 'vitest';
import {
  type Assignment,
  PLAN_OBJECTIVES,
  byObjective,
  countsOf,
  draftFrom,
  handout,
  isUnsaved,
  payloadOf,
} from './bgbPlan';

const starters = [
  { playerId: 'p1', name: 'Ann', power: 9 },
  { playerId: 'p2', name: 'Ben', power: 8 },
  { playerId: 'p3', name: 'Cara', power: 7 },
];
const saved: Assignment[] = [
  { playerId: 'p2', playerName: 'Ben', objectiveKey: 'factory', role: 'carry', ordinal: 1 },
  { playerId: 'p1', playerName: 'Ann', objectiveKey: 'mil-a', role: '', ordinal: 0 },
  { playerId: 'gone', playerName: 'Dan', objectiveKey: 'oil-1', role: '', ordinal: 2 },
];

describe('Black Gold plan drafts', () => {
  it('offers every objective the database accepts, once', () => {
    const ids = PLAN_OBJECTIVES.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(14);
    expect(ids).toContain('roam');
  });

  it('keeps current starters and names the ones who no longer qualify', () => {
    const { draft, dropped } = draftFrom(saved, starters);
    expect([...draft.keys()].sort()).toEqual(['p1', 'p2']);
    expect(dropped).toEqual(['Dan']);
  });

  it('sends one row per placed starter, in the starters order, role trimmed', () => {
    const draft = new Map([
      ['p3', { objectiveKey: 'roam', role: '  scout  ' }],
      ['p1', { objectiveKey: 'mil-a', role: '' }],
    ]);
    expect(payloadOf(draft, starters)).toEqual([
      { objective_key: 'mil-a', player_id: 'p1', role: '', ordinal: 0 },
      { objective_key: 'roam', player_id: 'p3', role: 'scout', ordinal: 2 },
    ]);
  });

  it('counts players per objective', () => {
    expect(countsOf(saved).get('factory')).toBe(1);
    expect(countsOf([]).size).toBe(0);
  });

  it('groups by objective in map order and writes a chat handout', () => {
    const groups = byObjective(saved);
    expect(groups.map((g) => g.objectiveKey)).toEqual(['mil-a', 'oil-1', 'factory']);
    expect(handout('Plan A', saved)).toBe(
      'Plan A\nMilitary Base A: Ann\nOil Refinery 1: Dan\nRare Earth Factory: Ben (carry)',
    );
  });

  it('knows when the draft differs from what is saved', () => {
    const base = draftFrom(saved, starters).draft;
    expect(isUnsaved(new Map(base), base)).toBe(false);
    const moved = new Map(base);
    moved.set('p1', { objectiveKey: 'mil-b', role: '' });
    expect(isUnsaved(moved, base)).toBe(true);
    const fewer = new Map(base);
    fewer.delete('p2');
    expect(isUnsaved(fewer, base)).toBe(true);
  });
});
