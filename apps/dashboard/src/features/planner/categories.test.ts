import { describe, expect, it } from 'vitest';
import { categoryOf, isNotUpgradable } from './categories';

const MAX = new Map([
  ['100', 30],
  ['200', 1],
  ['300', 0],
]);

describe('isNotUpgradable', () => {
  it('hides buildings whose highest level is 0 or 1', () => {
    expect(isNotUpgradable({ subject_id: '200', name: 'Arena' }, MAX)).toBe(true);
    expect(isNotUpgradable({ subject_id: '300', name: 'Road' }, MAX)).toBe(true);
  });
  it('keeps a building that climbs', () => {
    expect(isNotUpgradable({ subject_id: '100', name: 'HQ' }, MAX)).toBe(false);
  });
  it('keeps a building the catalogue does not know', () => {
    expect(isNotUpgradable({ subject_id: '999', name: 'New' }, MAX)).toBe(false);
  });
  it('hides the Formations by id and the Smelting Plant by name', () => {
    expect(isNotUpgradable({ subject_id: '427000', name: null }, MAX)).toBe(true);
    expect(isNotUpgradable({ subject_id: '55', name: 'Smelting Plant' }, MAX)).toBe(true);
  });
});

describe('categoryOf', () => {
  const season = new Set(['857000']);
  it('puts research in research and season buildings in season', () => {
    expect(categoryOf({ kind: 'research', subject_id: '857000' }, season)).toBe('research');
    expect(categoryOf({ kind: 'building', subject_id: '857000' }, season)).toBe('season');
    expect(categoryOf({ kind: 'building', subject_id: '100' }, season)).toBe('building');
  });
});
