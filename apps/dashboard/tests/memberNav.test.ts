// The member menu (owner, 2026-11-18; design §2): six entries for a plain
// member, everything for officers and admins, and the admin's Tab visibility
// still hiding entries on top.
import { describe, expect, it } from 'vitest';
import { type NavContext, buildNav } from '../src/lib/shellNav';

const member = (over: Partial<NavContext> = {}): NavContext => ({
  route: 'home',
  allianceId: null,
  own: { alliance_id: 'a1', label: 'CBFW' },
  mayViewMembers: true,
  isAdmin: false,
  isOfficer: false,
  seasonNames: {},
  ...over,
});

const top = (ctx: NavContext) => buildNav(ctx).flatMap((g) => g.items.map((i) => i.label));
const children = (ctx: NavContext, label: string) =>
  buildNav(ctx)
    .flatMap((g) => g.items)
    .find((i) => i.label === label)
    ?.children?.map((c) => c.label) ?? [];

describe('the member menu', () => {
  it('is exactly Home, Guides, Calculator, Hive, Map and the alliance', () => {
    expect(top(member())).toEqual(['Home', 'Guides', 'Calculator', 'Hive', 'Map', 'CBFW']);
  });

  it('files notices and both guides under Guides, and roster, participation and Black Gold under the alliance', () => {
    expect(children(member(), 'Guides')).toEqual(['Notices', 'Alliance guides', 'Event guide']);
    expect(children(member(), 'CBFW')).toEqual(['Roster', 'Participation', 'Black Gold']);
  });

  it('marks the open screen, including one filed under an entry', () => {
    const items = buildNav(member({ route: 'blackMoney' })).flatMap((g) => g.items);
    expect(items.find((i) => i.label === 'CBFW')?.current).toBe(true);
    expect(items.find((i) => i.label === 'Home')?.current).toBe(false);
  });

  it('leaves out what an admin hid for members, and an empty entry altogether', () => {
    const hidden = new Set(['calculator', 'notices', 'guides', 'eventGuide']);
    const ctx = member({ tabShown: (tab) => !hidden.has(tab) });
    expect(top(ctx)).toEqual(['Home', 'Hive', 'Map', 'CBFW']);
  });

  it('keeps the full menu for officers and admins, with Home first', () => {
    for (const ctx of [member({ isOfficer: true }), member({ isAdmin: true, isOfficer: true })]) {
      const labels = top(ctx);
      expect(labels[0]).toBe('Home');
      expect(labels).toContain('Overview');
      expect(labels).toContain('Rankings');
      expect(labels.length).toBeGreaterThan(6);
    }
  });

  it('does not give a community account the member menu or Home', () => {
    const labels = top(member({ isCommunity: true }));
    expect(labels).not.toContain('Home');
    expect(labels).toContain('Overview');
  });
});
