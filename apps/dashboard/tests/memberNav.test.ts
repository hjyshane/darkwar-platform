// The one menu (owner, 2026-11-18, widened 2026-11-19, regrouped 2026-11-24):
// the same five entries for a member, an officer and an admin (Home, the
// alliance, Tools, Guides, Map), the admin's own group under them, and the
// admin's Tab visibility still hiding entries on top.
//
// Changed on 2026-11-24: there were six until then. Hive was an entry of its
// own and is now a screen under the alliance, right after Overview (the
// Merchant tester after it); Calculator is called Tools; "Event guide" is
// "Game guide"; and the event screens under the alliance are two captioned
// runs, Events and then Seasons.
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

const FIVE = ['Home', 'CBFW', 'Tools', 'Guides', 'Map'];

const top = (ctx: NavContext) => buildNav(ctx).flatMap((g) => g.items.map((i) => i.label));
const children = (ctx: NavContext, label: string) =>
  buildNav(ctx)
    .flatMap((g) => g.items)
    .find((i) => i.label === label)
    ?.children?.map((c) => c.label) ?? [];
/** The screens under the alliance entry, whole. */
const allianceScreens = (ctx: NavContext) =>
  buildNav(ctx)
    .flatMap((g) => g.items)
    .find((i) => i.label === 'CBFW')?.children ?? [];
/** The captions drawn under the alliance entry, each with the screen it opens. */
const headings = (ctx: NavContext) =>
  allianceScreens(ctx)
    .filter((c) => c.heading !== undefined)
    .map((c) => [c.heading, c.label]);

describe('the member menu', () => {
  it('is exactly Home, the alliance, Tools, Guides and Map, in one group', () => {
    expect(top(member())).toEqual(FIVE);
    expect(buildNav(member()).map((g) => [g.id, g.label])).toEqual([['watch', 'Menu']]);
  });

  it('files notices and both guides under Guides, and the alliance page, Hive and every event screen under the alliance', () => {
    expect(children(member(), 'Guides')).toEqual(['Notices', 'Alliance guides', 'Game guide']);
    // No Alarms: a member has no alarm to set. No Season 2: that is the admins'.
    // No Merchant tester: that is the officers'.
    expect(children(member(), 'CBFW')).toEqual([
      'Overview',
      'Hive',
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
    // Two captioned runs: the events, then the seasons.
    expect(headings(member())).toEqual([
      ['Events', 'Black Gold'],
      ['Seasons', 'Season 3'],
    ]);
    // Tools (Calculator until 2026-11-24) carries the calculator's three pages
    // and the planner (2026-11-20).
    expect(children(member(), 'Tools')).toEqual([
      'Upgrade cost',
      'Resource wait time',
      'Virus resistance',
      'Planner',
    ]);
    // Home and Map have nothing under them.
    for (const label of ['Home', 'Map']) {
      const entry = buildNav(member())
        .flatMap((g) => g.items)
        .find((i) => i.label === label);
      expect(entry).toBeDefined();
      expect(entry?.children).toBeUndefined();
    }
    // Hive is a screen under the alliance, not an entry. It has no tabs for a
    // reader who does not plan it; a planner's three steps are its tabs, which
    // the sidebar does not draw.
    const hive = (ctx: NavContext) => allianceScreens(ctx).find((c) => c.label === 'Hive');
    expect(hive(member())).toMatchObject({ href: '#/hive', screen: true });
    expect(hive(member())?.tabs).toBeUndefined();
    expect(hive(member({ mayPlanHive: true }))?.tabs?.map((t) => t.label)).toEqual([
      'Plan',
      'Draw the shape',
      'Who goes where',
    ]);
    expect(children(member({ mayPlanHive: true }), 'CBFW')).toEqual(children(member(), 'CBFW'));
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
    expect(top(ctx)).toEqual(['Home', 'CBFW', 'Map']);
  });

  it('gives an officer the member menu with the Merchant tester and Alarms under the alliance, and the Officer menu', () => {
    const officer = member({ isOfficer: true, mayManageGiftCodes: true });
    expect(buildNav(officer).map((g) => [g.id, g.label])).toEqual([
      ['watch', 'Menu'],
      ['officer', 'Officer menu'],
    ]);
    expect(buildNav(officer)[0]?.items.map((i) => i.label)).toEqual(FIVE);
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
      'Hive',
      'Merchant tester',
      'Black Gold',
      'Frankie',
      'Capital Clash',
      'Server Clash',
      'Participation',
      'Alarms',
      'Season 3',
    ]);
    expect(headings(officer)).toEqual([
      ['Events', 'Black Gold'],
      ['Seasons', 'Season 3'],
    ]);
  });

  it('gives an admin the same five, and the Admin menu under them', () => {
    const admin = member({ isAdmin: true, isOfficer: true, mayManageGiftCodes: true });
    expect(buildNav(admin).map((g) => [g.id, g.label])).toEqual([
      ['watch', 'Menu'],
      ['admin', 'Admin menu'],
    ]);
    expect(top(admin)).toEqual([...FIVE, 'Servers', 'Roster', 'Game data']);
    expect(children(admin, 'CBFW')).toEqual([
      'Overview',
      'Hive',
      'Merchant tester',
      'Black Gold',
      'Frankie',
      'Capital Clash',
      'Server Clash',
      'Participation',
      'Alarms',
      'Season 3',
      'Season 2',
    ]);
    // One caption for both seasons: on the first of them only.
    expect(headings(admin)).toEqual([
      ['Events', 'Black Gold'],
      ['Seasons', 'Season 3'],
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
      'Game guide',
      'Shop value',
    ]);
  });
});
