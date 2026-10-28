import { describe, expect, test } from 'vitest';
import { type NavContext, buildNav } from './shellNav';

const base: NavContext = {
  route: 'overview',
  allianceId: null,
  own: null,
  mayViewMembers: true,
  isAdmin: false,
  isOfficer: true,
  seasonNames: {},
};

const labels = (ctx: NavContext) => buildNav(ctx).flatMap((g) => g.items.map((i) => i.label));

describe('buildNav tab visibility (0295)', () => {
  test('without rules every tab the role is entitled to is drawn', () => {
    expect(labels(base)).toContain('Migration');
    expect(labels(base)).toContain('Map');
    expect(labels(base)).toContain('Notices');
  });

  test('a hidden tab leaves the sidebar, the rest stay', () => {
    const shown = labels({ ...base, tabShown: (tab) => tab !== 'migration' && tab !== 'notices' });
    expect(shown).not.toContain('Migration');
    expect(shown).not.toContain('Notices');
    expect(shown).toContain('Rankings');
    expect(shown).toContain('Guides');
  });

  test('a rule never shows what the role gate withholds', () => {
    const member = { ...base, isOfficer: false, tabShown: () => true };
    expect(labels(member)).not.toContain('Migration');
  });
});
