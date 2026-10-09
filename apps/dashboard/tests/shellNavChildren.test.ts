import { describe, expect, it } from 'vitest';
import {
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
  isOfficer: false,
  seasonNames: {},
  ...over,
});

const item = (ctx: NavContext, group: string, label: string): NavItem | undefined =>
  buildNav(ctx)
    .find((entry) => entry.id === group)
    ?.items.find((entry) => entry.label === label);

describe('sidebar tabs: event guide', () => {
  it('lists the four tabs, each with its own address', () => {
    const guide = item(base({ route: 'eventGuide' }), 'events', 'Event guide');

    expect(guide?.children?.map((child) => [child.label, child.href])).toEqual([
      ['Alliance events', '#/event-guide'],
      ['Survival Preparedness', '#/event-guide/survival'],
      ['Alliance Duel', '#/event-guide/duel'],
      ['Duel scores', '#/event-guide/scores'],
    ]);
  });

  it('marks the tab in the address, and the first when it names none', () => {
    const current = (tab?: 'duel') =>
      item(base({ route: 'eventGuide', eventGuideTab: tab }), 'events', 'Event guide')
        ?.children?.filter((child) => child.current)
        .map((child) => child.label);

    expect(current('duel')).toEqual(['Alliance Duel']);
    expect(current()).toEqual(['Alliance events']);
  });

  it('marks no tab when another screen is open', () => {
    const guide = item(base({ route: 'calendar' }), 'events', 'Event guide');

    expect(guide?.current).toBe(false);
    expect(guide?.children?.some((child) => child.current)).toBe(false);
  });

  it('gives no other screen tabs', () => {
    const calendar = item(base(), 'events', 'Game calendar');
    expect(calendar?.children).toBeUndefined();
  });
});

describe('sidebar tabs: rankings', () => {
  it('lists the boards, and Arena only to a reader who may see it', () => {
    const labelsFor = (mayViewArena: boolean | undefined) =>
      item(base({ route: 'rankings', mayViewArena }), 'watch', 'Rankings')?.children?.map(
        (child) => child.label,
      );

    expect(labelsFor(true)).toEqual(['Alliance Ranking', 'Player Ranking', 'Arena']);
    expect(labelsFor(false)).toEqual(['Alliance Ranking', 'Player Ranking']);
    // Not before it is known: an entry that arrives and is taken away is worse.
    expect(labelsFor(undefined)).toEqual(['Alliance Ranking', 'Player Ranking']);
  });

  it('marks the board that is open', () => {
    const rankings = item(
      base({ route: 'crossRankings', mayViewArena: true }),
      'watch',
      'Rankings',
    );

    expect(rankings?.current).toBe(true);
    expect(rankings?.children?.filter((child) => child.current).map((c) => c.label)).toEqual([
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
  it('lists each tab after its screen as "Screen › Tab", with the screen\'s icon and the tab\'s address', () => {
    const entries = paletteEntries(
      buildNav(base({ route: 'eventGuide', eventGuideTab: 'duel' })).flatMap(
        (group) => group.items,
      ),
    );
    const duel = entries.find((entry) => entry.label === 'Event guide › Alliance Duel');

    expect(duel).toMatchObject({ href: '#/event-guide/duel', icon: 'guide', current: true });
    expect(entries.findIndex((entry) => entry.label === 'Event guide')).toBeLessThan(
      entries.findIndex((entry) => entry === duel),
    );
  });

  it('leaves a screen without tabs as it is', () => {
    const items = buildNav(base()).flatMap((group) => group.items);
    const entries = paletteEntries(items);

    expect(entries.find((entry) => entry.label === 'Game calendar')).toBe(
      items.find((entry) => entry.label === 'Game calendar'),
    );
  });

  it('gives every row its own key, though a first tab shares its screen address', () => {
    const entries = paletteEntries(
      buildNav(base({ mayViewArena: true })).flatMap((group) => group.items),
    );

    expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length);
  });
});
