import { describe, expect, it } from 'vitest';
import type { Subject } from '../planner/data';
import { groupByTree } from './trees';

const research = (id: string, name: string, category: number | null): Subject => ({
  subject: id,
  name,
  nameKo: null,
  maxLevel: 10,
  category,
  gameSeason: null,
});

describe('groupByTree', () => {
  const tabs = [
    { tabId: 1003, name: 'New Home' },
    { tabId: 1001, name: 'Shelter Building' },
    { tabId: 1012, name: 'Unit Armor' },
  ];

  it('groups research by its tab, in the tab order of the game and the subjects in theirs', () => {
    const groups = groupByTree(
      [
        research('2', 'Bricklaying', 1001),
        research('1', 'Arable Land', 1003),
        research('3', 'Carpentry', 1001),
      ],
      tabs,
    );
    expect(groups.map((g) => [g.tabId, g.label, g.subjects.map((s) => s.name)])).toEqual([
      [1003, 'New Home', ['Arable Land']],
      [1001, 'Shelter Building', ['Bricklaying', 'Carpentry']],
    ]);
  });

  it('leaves out research of a tree our servers do not see, and one with no tree', () => {
    const groups = groupByTree(
      [research('1', 'Ours', 1003), research('2', 'Old screen', 7), research('3', 'Loose', null)],
      tabs,
    );
    expect(groups.flatMap((g) => g.subjects.map((s) => s.name))).toEqual(['Ours']);
  });

  it('is no groups at all without tabs, so the page falls back to one list', () => {
    expect(groupByTree([research('1', 'Ours', 1003)], [])).toEqual([]);
  });
});
