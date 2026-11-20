import { describe, expect, it } from 'vitest';
import {
  type NavChild,
  type NavContext,
  type NavItem,
  buildFooter,
  buildNav,
  paletteEntries,
} from '../src/lib/shellNav';

const base = (over: Partial<NavContext> = {}): NavContext => ({
  route: 'overview',
  allianceId: null,
  own: { alliance_id: 'a1', label: 'CBFW' },
  mayViewMembers: true,
  isAdmin: false,
  // An officer: the member menu, plus Alarms under the alliance (2026-11-19).
  isOfficer: true,
  seasonNames: {},
  ...over,
});

/** An admin: the same menu, and the Admin menu under it. */
const admin = (over: Partial<NavContext> = {}): NavContext =>
  base({ isAdmin: true, mayManageGiftCodes: true, ...over });

const item = (ctx: NavContext, group: string, label: string): NavItem | undefined =>
  buildNav(ctx)
    .find((entry) => entry.id === group)
    ?.items.find((entry) => entry.label === label);

/** A screen filed under an entry. The sidebar does not draw its tabs (the page
 * carries its own strip); they are kept on it, in `tabs`, for Ctrl+K. */
const filed = (
  ctx: NavContext,
  group: string,
  label: string,
  screen: string,
): NavChild | undefined =>
  item(ctx, group, label)?.children?.find((child) => child.label === screen);

describe('sidebar tabs: event guide', () => {
  const guideOf = (ctx: NavContext) => filed(ctx, 'watch', 'Guides', 'Event guide');

  it('files the guide under Guides as a screen, keeping its four tabs, each with its own address', () => {
    const guide = guideOf(base({ route: 'eventGuide' }));

    expect(guide).toMatchObject({ href: '#/event-guide', screen: true, current: true });
    expect(guide?.tabs?.map((tab) => [tab.label, tab.href])).toEqual([
      ['Now', '#/event-guide'],
      ['Alliance events', '#/event-guide/events'],
      ['Survival Preparedness', '#/event-guide/survival'],
      ['Alliance Duel', '#/event-guide/duel'],
    ]);
    // The same for a member and an admin: it is one menu.
    for (const ctx of [base({ isOfficer: false }), admin()]) {
      expect(guideOf(ctx)?.tabs?.map((tab) => tab.label)).toEqual(
        guide?.tabs?.map((tab) => tab.label),
      );
    }
  });

  it('marks the tab in the address, and the first when it names none', () => {
    const current = (tab?: 'duel') =>
      guideOf(base({ route: 'eventGuide', eventGuideTab: tab }))
        ?.tabs?.filter((entry) => entry.current)
        .map((entry) => entry.label);

    expect(current('duel')).toEqual(['Alliance Duel']);
    expect(current()).toEqual(['Now']);
  });

  it('marks no tab when another screen is open', () => {
    const guide = guideOf(base({ route: 'calendar' }));

    expect(guide?.current).toBe(false);
    expect(guide?.tabs?.some((tab) => tab.current)).toBe(false);
  });

  it('gives no other screen tabs', () => {
    expect(filed(base(), 'watch', 'Guides', 'Notices')).toMatchObject({ href: '#/notices' });
    expect(filed(base(), 'watch', 'Guides', 'Notices')?.tabs).toBeUndefined();
    expect(filed(base(), 'watch', 'Guides', 'Alliance guides')?.tabs).toBeUndefined();
    const calendar = filed(admin(), 'admin', 'Game data', 'Game calendar');
    expect(calendar).toMatchObject({ href: '#/calendar', screen: true });
    expect(calendar?.tabs).toBeUndefined();
    expect(filed(admin(), 'admin', 'Game data', 'Shop value')?.tabs).toBeUndefined();
  });

  it('lists a community account the tabs as children, without the one that is about our alliance', () => {
    const guide = item(
      base({ isCommunity: true, route: 'eventGuide', eventGuideTab: 'duel' }),
      'events',
      'Event guide',
    );

    expect(guide?.children?.map((child) => [child.label, child.href, child.current])).toEqual([
      ['Now', '#/event-guide', false],
      ['Survival Preparedness', '#/event-guide/survival', false],
      ['Alliance Duel', '#/event-guide/duel', true],
    ]);
    expect(item(base({ isCommunity: true }), 'events', 'Game calendar')?.children).toBeUndefined();
  });
});

describe('sidebar tabs: rankings', () => {
  it('keeps the boards on the admin’s Rankings, and Arena only for a reader who may see it', () => {
    const labelsFor = (mayViewArena: boolean | undefined) =>
      filed(admin({ route: 'rankings', mayViewArena }), 'admin', 'Servers', 'Rankings')?.tabs?.map(
        (tab) => tab.label,
      );

    expect(labelsFor(true)).toEqual(['Alliance Ranking', 'Player Ranking', 'Arena']);
    expect(labelsFor(false)).toEqual(['Alliance Ranking', 'Player Ranking']);
    // Not before it is known: an entry that arrives and is taken away is worse.
    expect(labelsFor(undefined)).toEqual(['Alliance Ranking', 'Player Ranking']);
    // An officer has no Rankings entry at all.
    expect(
      item(base({ route: 'rankings', mayViewArena: true }), 'admin', 'Servers'),
    ).toBeUndefined();
    expect(
      item(base({ route: 'rankings', mayViewArena: true }), 'watch', 'Rankings'),
    ).toBeUndefined();
  });

  it('marks the board that is open', () => {
    const ctx = admin({ route: 'crossRankings', mayViewArena: true });
    const rankings = filed(ctx, 'admin', 'Servers', 'Rankings');

    expect(item(ctx, 'admin', 'Servers')?.current).toBe(true);
    expect(rankings?.current).toBe(true);
    expect(rankings?.tabs?.filter((tab) => tab.current).map((tab) => tab.label)).toEqual([
      'Player Ranking',
    ]);
    expect(rankings?.tabs?.map((tab) => tab.href)).toEqual([
      '#/rankings',
      '#/cross-server',
      '#/arena',
    ]);
  });

  it('lists a community account the boards as children of Rankings', () => {
    const rankings = (mayViewArena: boolean | undefined) =>
      item(base({ isCommunity: true, route: 'crossRankings', mayViewArena }), 'watch', 'Rankings');

    expect(rankings(true)?.current).toBe(true);
    expect(rankings(true)?.children?.map((child) => [child.label, child.current])).toEqual([
      ['Alliance Ranking', false],
      ['Player Ranking', true],
      ['Arena', false],
    ]);
    expect(rankings(undefined)?.children?.map((child) => child.label)).toEqual([
      'Alliance Ranking',
      'Player Ranking',
    ]);
  });
});

describe('sidebar tabs: settings', () => {
  const settings = (route: 'admin' | 'overview', group: 'catalogue' | null) =>
    buildFooter(route, true, group).find((entry) => entry.label === 'Settings');

  it('lists the five groups, Access first', () => {
    expect(settings('admin', null)?.children?.map((child) => child.label)).toEqual([
      'Access',
      'Alliance',
      'Display',
      'Operations',
      'Shared',
    ]);
    expect(settings('admin', null)?.children?.[0]?.href).toBe('#/admin/access');
  });

  it('marks the group in the address, and Access for the bare address', () => {
    const open = (group: 'catalogue' | null) =>
      settings('admin', group)
        ?.children?.filter((child) => child.current)
        .map((child) => child.label);

    expect(open('catalogue')).toEqual(['Shared']);
    expect(open(null)).toEqual(['Access']);
  });

  it('marks no group when another screen is open, and is absent for a non-admin', () => {
    expect(settings('overview', null)?.children?.some((child) => child.current)).toBe(false);
    expect(buildFooter('admin', false).some((entry) => entry.label === 'Settings')).toBe(false);
  });
});

describe('palette entries', () => {
  it('lists each tab after its screen as "Entry › Screen › Tab", with the entry\'s icon and the tab\'s address', () => {
    const entries = paletteEntries(
      buildNav(base({ route: 'eventGuide', eventGuideTab: 'duel' })).flatMap(
        (group) => group.items,
      ),
    );
    const screen = entries.find((entry) => entry.label === 'Guides › Event guide');
    const duel = entries.find((entry) => entry.label === 'Guides › Event guide › Alliance Duel');

    expect(screen).toMatchObject({ href: '#/event-guide', icon: 'guides', current: true });
    expect(duel).toMatchObject({ href: '#/event-guide/duel', icon: 'guides', current: true });
    expect(entries.findIndex((entry) => entry.label === 'Guides')).toBeLessThan(
      entries.findIndex((entry) => entry === screen),
    );
    expect(entries.findIndex((entry) => entry === screen)).toBeLessThan(
      entries.findIndex((entry) => entry === duel),
    );
    // Only the open tab is marked.
    expect(
      entries.find((entry) => entry.label === 'Guides › Event guide › Alliance events')?.current,
    ).toBe(false);
  });

  it('lists an entry’s own tabs as "Screen › Tab"', () => {
    const entries = paletteEntries(
      buildNav(base({ route: 'hive', mayPlanHive: true, tabs: { hive: 'shape' } })).flatMap(
        (group) => group.items,
      ),
    );

    expect(entries.find((entry) => entry.label === 'Hive › Draw the shape')).toMatchObject({
      href: '#/hive/shape',
      icon: 'hive',
      current: true,
    });
  });

  it('leaves a screen without tabs as it is', () => {
    // A member: an officer's Hive carries the Merchant tester beneath it.
    const items = buildNav(base({ isOfficer: false })).flatMap((group) => group.items);
    const entries = paletteEntries(items);

    for (const label of ['Home', 'Hive', 'Map']) {
      const entry = items.find((candidate) => candidate.label === label);
      expect(entry).toBeDefined();
      expect(entries.find((candidate) => candidate.label === label)).toBe(entry);
      expect(entries.filter((candidate) => candidate.label.startsWith(`${label} ›`))).toEqual([]);
    }
  });

  it('gives every row its own key, though a first tab shares its screen address', () => {
    const entries = paletteEntries(
      buildNav(admin({ mayViewArena: true, mayPlanHive: true })).flatMap((group) => group.items),
    );

    // Rankings and its first board, Members and its first ranking, the event
    // guide and Now: each pair shares an address.
    expect(entries.filter((entry) => entry.href === '#/rankings').length).toBeGreaterThan(1);
    expect(entries.filter((entry) => entry.href === '#/members').length).toBeGreaterThan(1);
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length);
  });
});
