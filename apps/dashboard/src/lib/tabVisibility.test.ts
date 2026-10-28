import { describe, expect, test } from 'vitest';
import { TABS, isTabShown, tabKeyOf, tabVisibilityFromRows } from './tabVisibility';

const rules = tabVisibilityFromRows([
  { tab_key: 'migration', role: 'officer', visible: false },
  { tab_key: 'migration', role: 'member', visible: false },
  { tab_key: 'hive', role: 'member', visible: true },
]);

describe('isTabShown', () => {
  test('a stored no hides the tab from that role only', () => {
    expect(isTabShown(rules, 'migration', 'officer')).toBe(false);
    expect(isTabShown(rules, 'migration', 'community')).toBe(true);
  });

  test('no row means shown', () => {
    expect(isTabShown(rules, 'planner', 'member')).toBe(true);
    expect(isTabShown(rules, 'hive', 'member')).toBe(true);
  });

  test('an admin always sees every tab, even against a stored no', () => {
    const odd = tabVisibilityFromRows([{ tab_key: 'migration', role: 'admin', visible: false }]);
    expect(isTabShown(odd, 'migration', 'admin')).toBe(true);
  });

  test('before the role is known nothing is taken away', () => {
    expect(isTabShown(rules, 'migration', undefined)).toBe(true);
  });
});

describe('tabKeyOf', () => {
  test('a screen maps to the entry that stands for it', () => {
    expect(tabKeyOf('migration')).toBe('migration');
    expect(tabKeyOf('blackMoney')).toBe('events');
    expect(tabKeyOf('notice')).toBe('notices');
    expect(tabKeyOf('guide')).toBe('guides');
  });

  test('settings, players and servers belong to none', () => {
    expect(tabKeyOf('admin')).toBeNull();
    expect(tabKeyOf('player')).toBeNull();
    expect(tabKeyOf('server')).toBeNull();
  });

  test('every choice is a key the table accepts', () => {
    for (const tab of TABS) expect(tab.key).toMatch(/^[A-Za-z0-9-]{1,40}$/);
  });
});
