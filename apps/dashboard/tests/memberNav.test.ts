// The one menu (owner, 2026-11-18, widened 2026-11-19): the same six entries
// for a member, an officer and an admin, the admin's own group under them, and
// the admin's Tab visibility still hiding entries on top.
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

const SIX = ['Home', 'Guides', 'Calculator', 'Hive', 'Map', 'CBFW'];

const top = (ctx: NavContext) => buildNav(ctx).flatMap((g) => g.items.map((i) => i.label));
const children = (ctx: NavContext, label: string) =>
  buildNav(ctx)
    .flatMap((g) => g.items)
    .find((i) => i.label === label)
    ?.children?.map((c) => c.label) ?? [];

describe('the member menu', () => {
  it('is exactly Home, Guides, Calculator, Hive, Map and the alliance, in one group', () => {
    expect(top(member())).toEqual(SIX);
    expect(buildNav(member()).map((g) => [g.id, g.label])).toEqual([['watch', 'Menu']]);
  });

  it('files notices and both guides under Guides, and the alliance page and every event screen under the alliance', () => {
    expect(children(member(), 'Guides')).toEqual(['Notices', 'Alliance guides', 'Event guide']);
    // No Alarms: a member has no alarm to set. No Season 2: that is the admins'.
    expect(children(member(), 'CBFW')).toEqual([
      'Overview',
      'Black Gold',
      'Frankie',
      'Capital Clash',
      'Server Clash',
      'Participation',
      'Season 3',
    ]);
    // Each is a screen of its own, not a tab of the entry.
    const filed = buildNav(member())
      .flatMap((g) => g.items)
      .find((i) => i.label === 'CBFW')?.children;
    expect(filed?.every((c) => c.screen === true)).toBe(true);
    // Home, Calculator and Map have nothing under them; neither does Hive for
    // a reader who does not plan it.
    for (const label of ['Home', 'Calculator', 'Hive', 'Map']) {
      expect(
        buildNav(member())
          .flatMap((g) => g.items)
          .find((i) => i.label === label)?.children,
      ).toBeUndefined();
    }
    expect(children(member({ mayPlanHive: true }), 'Hive')).toEqual([
      'Plan',
      'Draw the shape',
      'Who goes where',
    ]);
  });

  it('marks the open screen, including one filed under an entry', () => {
    const items = buildNav(member({ route: 'blackMoney' })).flatMap((g) => g.items);
    expect(items.find((i) => i.label === 'CBFW')?.current).toBe(true);
    expect(items.find((i) => i.label === 'Home')?.current).toBe(false);
    expect(
      items
        .find((i) => i.label === 'CBFW')
        ?.children?.filter((c) => c.current)
        .map((c) => c.label),
    ).toEqual(['Black Gold']);
  });

  it('leaves out what an admin hid for members, and an empty entry altogether', () => {
    const hidden = new Set(['calculator', 'notices', 'guides', 'eventGuide']);
    const ctx = member({ tabShown: (tab) => !hidden.has(tab) });
    expect(top(ctx)).toEqual(['Home', 'Hive', 'Map', 'CBFW']);
  });

  it('gives an officer the member menu with Alarms under the alliance, and the Officer menu', () => {
    const officer = member({ isOfficer: true, mayManageGiftCodes: true });
    expect(buildNav(officer).map((g) => [g.id, g.label])).toEqual([
      ['watch', 'Menu'],
      ['officer', 'Officer menu'],
    ]);
    expect(buildNav(officer)[0]?.items.map((i) => i.label)).toEqual(SIX);
    // Members with its two rankings beneath it, and Gift codes: each needs its
    // capability, and not before the grid has answered.
    const extra = (ctx: NavContext) => buildNav(ctx)[1]?.items.map((i) => i.label) ?? [];
    expect(extra(officer)).toEqual(['Members', 'Gift codes']);
    expect(buildNav(officer)[1]?.items[0]?.href).toBe('#/members');
    expect(buildNav(officer)[1]?.items[0]?.children?.length).toBe(2);
    expect(extra(member({ isOfficer: true, mayManageGiftCodes: undefined }))).toEqual(['Members']);
    expect(
      extra(member({ isOfficer: true, mayViewMembers: false, mayManageGiftCodes: true })),
    ).toEqual(['Gift codes']);
    // With neither, the group is not drawn; a member never has it.
    expect(buildNav(member({ isOfficer: true, mayViewMembers: false })).map((g) => g.id)).toEqual([
      'watch',
    ]);
    expect(buildNav(member({ mayManageGiftCodes: true })).map((g) => g.id)).toEqual(['watch']);
    expect(children(officer, 'Guides')).toEqual(children(member(), 'Guides'));
    expect(children(officer, 'CBFW')).toEqual([
      'Overview',
      'Black Gold',
      'Frankie',
      'Capital Clash',
      'Server Clash',
      'Participation',
      'Alarms',
      'Season 3',
    ]);
  });

  it('gives an admin the same six, and the Admin menu under them', () => {
    const admin = member({ isAdmin: true, isOfficer: true, mayManageGiftCodes: true });
    expect(buildNav(admin).map((g) => [g.id, g.label])).toEqual([
      ['watch', 'Menu'],
      ['admin', 'Admin menu'],
    ]);
    expect(top(admin)).toEqual([...SIX, 'Servers', 'Roster', 'Game data']);
    expect(children(admin, 'CBFW')).toEqual([
      'Overview',
      'Black Gold',
      'Frankie',
      'Capital Clash',
      'Server Clash',
      'Participation',
      'Alarms',
      'Season 3',
      'Season 2',
    ]);
    expect(children(admin, 'Servers')).toEqual(['Server overview', 'Rankings', 'Migration']);
    expect(children(admin, 'Roster')).toEqual(['Members', 'Gift codes']);
    expect(children(admin, 'Game data')).toEqual(['Game calendar', 'Shop value']);
    // Each entry opens its first screen.
    const hrefs = buildNav(admin)
      .find((g) => g.id === 'admin')
      ?.items.map((i) => i.href);
    expect(hrefs).toEqual(['#/', '#/members', '#/calendar']);
  });

  it('does not give a community account the member menu or Home', () => {
    const labels = top(member({ isCommunity: true }));
    expect(labels).not.toContain('Home');
    expect(labels).toContain('Overview');
    expect(buildNav(member({ isCommunity: true })).map((g) => [g.id, g.label])).toEqual([
      ['watch', 'Watch'],
      ['alliance', 'Tools'],
      ['events', 'Events'],
    ]);
    expect(top(member({ isCommunity: true }))).toEqual([
      'Overview',
      'Rankings',
      'Migration',
      'Map',
      'Calculator',
      'Game calendar',
      'Event guide',
      'Shop value',
    ]);
  });
});
