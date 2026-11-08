import { describe, expect, it } from 'vitest';
import type { Route } from '../src/lib/route';
import type { Season } from '../src/lib/seasons';
import {
  type NavContext,
  breadcrumb,
  buildFooter,
  buildNav,
  humanUntil,
  nextUp,
  seasonLine,
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

const labels = (ctx: NavContext, group: string) =>
  buildNav(ctx)
    .find((entry) => entry.id === group)
    ?.items.map((item) => item.label) ?? [];

/** Every address the sidebar knows: entries, their children, and the tabs a
 * filed screen keeps for Ctrl+K. */
const hrefsOf = (ctx: NavContext) =>
  buildNav(ctx).flatMap((group) =>
    group.items.flatMap((item) => [
      item.href,
      ...(item.children ?? []).flatMap((c) => [c.href, ...(c.tabs ?? []).map((t) => t.href)]),
    ]),
  );

/** The Events screen, filed under our alliance's entry (2026-11-08). */
const eventsOf = (ctx: NavContext) =>
  buildNav(ctx)
    .flatMap((group) => group.items)
    .find((item) => item.key === 'own-alliance')
    ?.children?.find((child) => child.href === '#/events');

describe('buildNav', () => {
  it('lists the groups in the order the sidebar draws them', () => {
    expect(buildNav(base()).map((group) => group.id)).toEqual([
      'watch',
      'alliance',
      'events',
      'boards',
    ]);
  });

  it('keeps every address the old tabs had', () => {
    // Members, Hive and Events sit under our alliance's entry; the season,
    // Black Gold, Participation and Frankie pages are the Events screen's tabs.
    const hrefs = hrefsOf(base({ isAdmin: true, isOfficer: true }));
    for (const hash of [
      '#/',
      '#/rankings',
      '#/migration',
      '#/map',
      '#/members',
      '#/hive',
      '#/events',
      '#/black-gold',
      '#/frankie',
      '#/capital-clash',
      '#/server-clash',
      '#/participation',
      '#/season',
      '#/season2',
    ]) {
      expect(hrefs).toContain(hash);
    }
    expect(hrefs).toContain('#/event-guide');
    expect(hrefs).toContain('#/notices');
  });

  it('shows Migration to officers only and Season 2 to admins only', () => {
    expect(labels(base(), 'watch')).not.toContain('Migration');
    expect(labels(base({ isOfficer: true }), 'watch')).toContain('Migration');
    const sub = (ctx: NavContext) => eventsOf(ctx)?.tabs?.map((tab) => tab.label) ?? [];
    expect(sub(base())).not.toContain('Season 2');
    expect(sub(base({ isAdmin: true }))).toContain('Season 2');
  });

  it('gathers Black Gold, Frankie, the clashes, Participation and the seasons under Events', () => {
    const alliance = buildNav(base({ isAdmin: true })).find((group) => group.id === 'alliance');
    expect(eventsOf(base({ isAdmin: true }))?.tabs?.map((tab) => tab.href)).toEqual([
      '#/black-gold',
      '#/frankie',
      '#/capital-clash',
      '#/server-clash',
      '#/participation',
      '#/season',
      '#/season2',
    ]);
    // They are no longer top-level entries beside it.
    const top = alliance?.items.map((item) => item.href) ?? [];
    for (const hash of [
      '#/black-gold',
      '#/frankie',
      '#/capital-clash',
      '#/server-clash',
      '#/participation',
      '#/season',
    ]) {
      expect(top).not.toContain(hash);
    }
  });

  it('waits for the permission grid before showing Members', () => {
    const under = (ctx: NavContext) =>
      buildNav(ctx)
        .flatMap((group) => group.items)
        .find((item) => item.key === 'own-alliance')
        ?.children?.map((child) => child.label) ?? [];
    expect(under(base({ mayViewMembers: undefined }))).not.toContain('Members');
    expect(under(base({ mayViewMembers: false }))).not.toContain('Members');
    expect(under(base({ mayViewMembers: true }))).toContain('Members');
  });

  it('puts our own alliance first, under a plain name until it is known', () => {
    expect(labels(base(), 'alliance')[0]).toBe('CBFW');
    // The screens under it do not wait for the alliances table.
    expect(labels(base({ own: null }), 'alliance')[0]).toBe('Our alliance');
  });

  it('names the season entries from the seasons table', () => {
    const names = { '#/season': 'Season 4', '#/season2': 'Season 3' };
    const tabs = eventsOf(base({ isAdmin: true, seasonNames: names }))?.tabs?.map(
      (tab) => tab.label,
    );
    expect(tabs).toEqual(expect.arrayContaining(['Season 4', 'Season 3']));
  });

  it('marks one entry current: the screen you are on', () => {
    const current = (route: Route) =>
      buildNav(base({ route }))
        .flatMap((group) => group.items)
        .filter((item) => item.current)
        .map((item) => item.label);

    // Members, Hive and every page behind Events keep our alliance's entry current.
    for (const route of [
      'members',
      'hive',
      'blackMoney',
      'frankie',
      'participation',
      'season',
      'events',
    ] as const) {
      expect(current(route)).toEqual(['CBFW']);
    }
    expect(current('planner')).toEqual(['Planner']);
    expect(current('eventGuide')).toEqual(['Event guide']);
    // All three ranking boards stand under one entry.
    expect(current('arena')).toEqual(['Rankings']);
    expect(current('crossRankings')).toEqual(['Rankings']);
    // A single notice is still the notices board.
    expect(current('notice')).toEqual(['Notices']);
    // A player belongs to no group.
    expect(current('player')).toEqual([]);
  });

  it('marks our alliance current on its own page, and nothing on another', () => {
    const on = (allianceId: string) =>
      buildNav(base({ route: 'alliance', allianceId }))
        .flatMap((group) => group.items)
        .filter((item) => item.current)
        .map((item) => item.label);

    expect(on('a1')).toEqual(['CBFW']);
    expect(on('somebody-else')).toEqual([]);
  });
});

describe('buildFooter and breadcrumb', () => {
  it('offers Settings to admins only', () => {
    expect(buildFooter('overview', false).map((item) => item.label)).toEqual(['My account']);
    expect(buildFooter('overview', true).map((item) => item.label)).toEqual([
      'Settings',
      'My account',
    ]);
  });

  it('says the group and the screen, or just the screen when it has no group', () => {
    const at = (route: Route) => {
      const ctx = base({ route });
      return breadcrumb(buildNav(ctx), buildFooter(route, true), route);
    };

    // A screen filed under our alliance's entry is named after it.
    expect(at('hive')).toEqual(['Alliance', 'CBFW', 'Hive']);
    expect(
      breadcrumb(buildNav(base({ route: 'alliance', allianceId: 'a1' })), [], 'alliance'),
    ).toEqual(['Alliance', 'CBFW', 'Overview']);
    expect(at('planner')).toEqual(['Alliance', 'Planner']);
    expect(at('account')).toEqual(['My account']);
    expect(at('player')).toEqual(['Player']);
  });
});

describe('humanUntil', () => {
  it('is coarse on purpose', () => {
    expect(humanUntil(20_000)).toBe('under a minute');
    expect(humanUntil(28 * 60_000)).toBe('28 min');
    expect(humanUntil(2 * 3_600_000)).toBe('2 h');
    expect(humanUntil(2 * 3_600_000 + 10 * 60_000)).toBe('2 h 10 min');
    expect(humanUntil(3 * 86_400_000 + 5 * 3_600_000)).toBe('3 d');
  });
});

describe('seasonLine', () => {
  const season = (id: number, startsAt: string | null, endsAt: string | null): Season => ({
    id,
    name: `Season ${id}`,
    startsAt,
    endsAt,
    buildings: [],
  });
  const now = new Date('2026-10-08T20:00:00Z');

  it('counts down to the end of the season that is running', () => {
    expect(seasonLine([season(3, '2026-08-17T02:00:00Z', '2026-10-10T20:00:00Z')], now)).toBe(
      'Season 3 ends in 2 d',
    );
  });

  it('says so in the rest between two seasons, and when the next begins', () => {
    const rest = [
      season(3, '2026-08-17T02:00:00Z', '2026-10-05T02:00:00Z'),
      season(4, '2026-11-09T02:00:00Z', null),
    ];
    expect(seasonLine(rest, now)).toBe('Season 3 is over. Season 4 starts in 31 d');
  });

  it('is just the name while a season has no end, and null with nothing started', () => {
    expect(seasonLine([season(3, '2026-08-17T02:00:00Z', null)], now)).toBe('Season 3');
    expect(seasonLine([season(4, '2026-11-09T02:00:00Z', null)], now)).toBeNull();
  });
});

describe('nextUp', () => {
  const now = new Date('2026-10-08T12:00:00Z');

  it('is the soonest entry that has not started', () => {
    const next = nextUp(
      [
        { title: 'Past', startsAt: '2026-10-08T02:30:00Z' },
        { title: 'Later', startsAt: '2026-10-11T12:05:00Z' },
        { title: 'Frankie 2', startsAt: '2026-10-08T15:00:00Z' },
      ],
      now,
    );

    expect(next).toEqual({ title: 'Frankie 2', inMs: 3 * 3_600_000 });
  });

  it('is null when nothing is ahead', () => {
    expect(nextUp([{ title: 'Past', startsAt: '2026-10-08T02:30:00Z' }], now)).toBeNull();
    expect(nextUp([], now)).toBeNull();
  });
});
