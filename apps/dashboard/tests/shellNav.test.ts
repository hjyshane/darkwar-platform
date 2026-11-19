import { describe, expect, it } from 'vitest';
import { type Route, routeFromHash } from '../src/lib/route';
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
import { overridesFromRows } from '../src/lib/uiOverrides';

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

/** What is filed under an entry, found by its key. */
const under = (ctx: NavContext, key: string) =>
  buildNav(ctx)
    .flatMap((group) => group.items)
    .find((item) => item.key === key)?.children ?? [];

/** The Events screens, each filed under our alliance's entry (2026-11-19):
 * everything there but the alliance's own page. */
const eventsOf = (ctx: NavContext) =>
  under(ctx, 'own-alliance').filter((child) => child.key !== 'own-page');

describe('buildNav', () => {
  it('lists the groups in the order the sidebar draws them', () => {
    // One menu for everybody; an officer's or an admin's own group under it.
    const groups = (ctx: NavContext) => buildNav(ctx).map((group) => [group.id, group.label]);
    expect(groups(base({ isOfficer: false }))).toEqual([['watch', 'Menu']]);
    expect(groups(base())).toEqual([
      ['watch', 'Menu'],
      ['officer', 'Officer menu'],
    ]);
    expect(groups(admin())).toEqual([
      ['watch', 'Menu'],
      ['admin', 'Admin menu'],
    ]);
    // A community account keeps the grouped menu.
    expect(groups(base({ isCommunity: true }))).toEqual([
      ['watch', 'Watch'],
      ['alliance', 'Tools'],
      ['events', 'Events'],
    ]);
  });

  it('lists the entries of each group in order', () => {
    const six = ['Home', 'Guides', 'Calculator', 'Hive', 'Map', 'CBFW'];
    expect(labels(admin(), 'watch')).toEqual(six);
    expect(labels(base(), 'watch')).toEqual(six);
    expect(labels(admin(), 'admin')).toEqual(['Servers', 'Roster', 'Game data']);
    expect(under(admin(), 'admin-servers').map((child) => [child.label, child.href])).toEqual([
      ['Server overview', '#/'],
      ['Rankings', '#/rankings'],
      ['Migration', '#/migration'],
    ]);
    expect(under(admin(), 'admin-roster').map((child) => [child.label, child.href])).toEqual([
      ['Members', '#/members'],
      ['Gift codes', '#/gift-codes'],
    ]);
    expect(under(admin(), 'admin-game').map((child) => [child.label, child.href])).toEqual([
      ['Game calendar', '#/calendar'],
      ['Shop value', '#/shop-value'],
    ]);
    const community = base({ isCommunity: true });
    expect(labels(community, 'watch')).toEqual(['Overview', 'Rankings', 'Migration', 'Map']);
    expect(labels(community, 'alliance')).toEqual(['Calculator']);
    expect(labels(community, 'events')).toEqual(['Game calendar', 'Event guide', 'Shop value']);
  });

  it('keeps every address the old tabs had', () => {
    // An admin's two groups between them: Hive beside our alliance's entry,
    // the event screens under it, Members and the group-wide boards in the
    // Admin menu.
    const hrefs = hrefsOf(admin());
    for (const hash of [
      '#/',
      '#/home',
      '#/rankings',
      '#/cross-server',
      '#/migration',
      '#/map',
      '#/members',
      '#/members/running',
      '#/hive',
      '#/calculator',
      '#/gift-codes',
      '#/calendar',
      '#/shop-value',
      '#/black-gold',
      '#/frankie',
      '#/capital-clash',
      '#/server-clash',
      '#/participation',
      '#/alarms',
      '#/season',
      '#/season2',
      '#/alliance/a1',
    ]) {
      expect(hrefs).toContain(hash);
    }
    expect(hrefs).toContain('#/event-guide');
    expect(hrefs).toContain('#/notices');
    expect(hrefs).toContain('#/guides');
    // The bare Events address has no entry of its own any more: each screen
    // behind it is listed instead. It still opens.
    expect(hrefs).not.toContain('#/events');
    expect(routeFromHash('#/events')).toBe('events');
  });

  it('shows Migration and Season 2 to admins only, and Alarms to officers and admins', () => {
    const everyLabel = (ctx: NavContext) =>
      buildNav(ctx).flatMap((group) =>
        group.items.flatMap((item) => [item.label, ...(item.children ?? []).map((c) => c.label)]),
      );
    expect(everyLabel(base({ isOfficer: false }))).not.toContain('Migration');
    expect(everyLabel(base({ isOfficer: true }))).not.toContain('Migration');
    expect(under(admin(), 'admin-servers').map((child) => child.label)).toContain('Migration');
    const sub = (ctx: NavContext) => eventsOf(ctx).map((child) => child.label);
    expect(sub(base())).not.toContain('Season 2');
    expect(sub(base({ isAdmin: true }))).toContain('Season 2');
    expect(sub(base({ isOfficer: false }))).not.toContain('Alarms');
    expect(sub(base({ isOfficer: true }))).toContain('Alarms');
    expect(sub(base({ isOfficer: false, isAdmin: true }))).toContain('Alarms');
  });

  it('files Black Gold, Frankie, the clashes, Participation, Alarms and the seasons under the alliance, each a screen', () => {
    expect(eventsOf(admin()).map((child) => child.href)).toEqual([
      '#/black-gold',
      '#/frankie',
      '#/capital-clash',
      '#/server-clash',
      '#/participation',
      '#/alarms',
      '#/season',
      '#/season2',
    ]);
    expect(eventsOf(admin()).every((child) => child.screen === true)).toBe(true);
    // The alliance's own page comes first, before any of them.
    expect(under(admin(), 'own-alliance')[0]).toMatchObject({
      key: 'own-page',
      label: 'Overview',
      href: '#/alliance/a1',
      screen: true,
    });
    // There is no single Events screen holding them, and they are not
    // top-level entries either.
    expect(under(admin(), 'own-alliance').map((child) => child.label)).not.toContain('Events');
    const top = buildNav(admin()).flatMap((group) => group.items.map((item) => item.key));
    for (const hash of [
      '#/events',
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

  it('draws the event screens in the arrangement an admin set, and hides them together', () => {
    const overrides = overridesFromRows([
      { scope: 'events-hub', key: 'participation', kind: 'order', value: '0' },
      { scope: 'events-hub', key: 'frankie', kind: 'hidden', value: 'true' },
      { scope: 'events-hub', key: 'blackMoney', kind: 'label', value: 'Gold rush' },
    ]);
    expect(eventsOf(base({ overrides })).map((child) => [child.label, child.href])).toEqual([
      ['Participation', '#/participation'],
      ['Gold rush', '#/black-gold'],
      ['Capital Clash', '#/capital-clash'],
      ['Server Clash', '#/server-clash'],
      ['Alarms', '#/alarms'],
      ['Season 3', '#/season'],
    ]);
    // The bare `#/events` address opens the first as arranged.
    expect(
      eventsOf(base({ overrides, route: 'events' }))
        .filter((child) => child.current)
        .map((child) => child.label),
    ).toEqual(['Participation']);
    // One tab key, `events`, stands for all of them.
    const hidden = base({ tabShown: (tab) => tab !== 'events' });
    expect(under(hidden, 'own-alliance').map((child) => child.label)).toEqual(['Overview']);
  });

  it('waits for the permission grid before showing Members', () => {
    const roster = (ctx: NavContext) => under(ctx, 'admin-roster').map((child) => child.label);
    expect(roster(admin({ mayViewMembers: undefined }))).not.toContain('Members');
    expect(roster(admin({ mayViewMembers: false }))).not.toContain('Members');
    expect(roster(admin({ mayViewMembers: true }))).toContain('Members');
    // Gift codes the same way, on `giftcodes.manage`.
    expect(roster(admin({ mayManageGiftCodes: undefined }))).not.toContain('Gift codes');
    expect(roster(admin({ mayManageGiftCodes: false }))).not.toContain('Gift codes');
    expect(roster(admin({ mayManageGiftCodes: true }))).toContain('Gift codes');
    // An officer's Members waits on the same grid, in the Officer menu.
    expect(hrefsOf(base({ mayViewMembers: undefined }))).not.toContain('#/members');
    expect(hrefsOf(base({ mayViewMembers: false }))).not.toContain('#/members');
    expect(labels(base({ mayViewMembers: true }), 'officer')).toEqual(['Members']);
    // A member has no entry for it, whatever the grid says.
    expect(hrefsOf(base({ isOfficer: false, mayViewMembers: true }))).not.toContain('#/members');
  });

  it('names the alliance entry after our alliance, and plainly until it is known', () => {
    expect(labels(base(), 'watch').at(-1)).toBe('CBFW');
    // The event screens under it do not wait for the alliances table; the
    // alliance's own page does.
    expect(labels(base({ own: null }), 'watch').at(-1)).toBe('Alliance');
    expect(under(base({ own: null }), 'own-alliance').map((child) => child.key)).not.toContain(
      'own-page',
    );
    expect(under(base({ own: null }), 'own-alliance')[0]?.href).toBe('#/black-gold');
  });

  it('names the season entries from the seasons table', () => {
    const names = { '#/season': 'Season 4', '#/season2': 'Season 3' };
    const screens = eventsOf(base({ isAdmin: true, seasonNames: names })).map(
      (child) => child.label,
    );
    expect(screens).toEqual(expect.arrayContaining(['Season 4', 'Season 3']));
    expect(screens).not.toContain('Season 2');
  });

  it('marks one entry current: the screen you are on', () => {
    const current = (route: Route, ctx = base) =>
      buildNav(ctx({ route }))
        .flatMap((group) => group.items)
        .filter((item) => item.current)
        .map((item) => item.label);

    // Every event screen keeps our alliance's entry current.
    for (const route of [
      'blackMoney',
      'frankie',
      'capitalClash',
      'serverClash',
      'participation',
      'alarms',
      'season',
      'events',
    ] as const) {
      expect(current(route)).toEqual(['CBFW']);
      expect(current(route, admin)).toEqual(['CBFW']);
    }
    expect(current('season2', admin)).toEqual(['CBFW']);
    expect(current('home')).toEqual(['Home']);
    expect(current('hive')).toEqual(['Hive']);
    expect(current('calculator')).toEqual(['Calculator']);
    expect(current('map')).toEqual(['Map']);
    // Archived: it opens by address but nothing in the sidebar stands for it.
    expect(current('planner')).toEqual([]);
    expect(current('planner', admin)).toEqual([]);
    // The event guide, a notice and a guide are all under Guides.
    expect(current('eventGuide')).toEqual(['Guides']);
    expect(current('notice')).toEqual(['Guides']);
    expect(current('guide')).toEqual(['Guides']);
    // The Admin menu's screens: all three ranking boards stand under Servers.
    expect(current('overview', admin)).toEqual(['Servers']);
    expect(current('arena', admin)).toEqual(['Servers']);
    expect(current('crossRankings', admin)).toEqual(['Servers']);
    expect(current('migration', admin)).toEqual(['Servers']);
    expect(current('members', admin)).toEqual(['Roster']);
    expect(current('giftCodes', admin)).toEqual(['Roster']);
    expect(current('calendar', admin)).toEqual(['Game data']);
    expect(current('shopValue', admin)).toEqual(['Game data']);
    // An officer has Members, in the Officer menu.
    expect(current('members')).toEqual(['Members']);
    // Nobody else has an entry for the rest: the address opens, nothing is marked.
    for (const route of ['overview', 'arena', 'giftCodes', 'calendar'] as const) {
      expect(current(route)).toEqual([]);
    }
    // A player belongs to no group.
    expect(current('player')).toEqual([]);
    expect(current('player', admin)).toEqual([]);
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
    const at = (route: Route, ctx = base) =>
      breadcrumb(buildNav(ctx({ route })), buildFooter(route, true), route);

    expect(at('home')).toEqual(['Menu', 'Home']);
    expect(at('hive')).toEqual(['Menu', 'Hive']);
    // A screen filed under an entry is named after it.
    expect(
      breadcrumb(buildNav(base({ route: 'alliance', allianceId: 'a1' })), [], 'alliance'),
    ).toEqual(['Menu', 'CBFW', 'Overview']);
    expect(at('blackMoney')).toEqual(['Menu', 'CBFW', 'Black Gold']);
    expect(at('eventGuide')).toEqual(['Menu', 'Guides', 'Event guide']);
    expect(at('notice')).toEqual(['Menu', 'Guides', 'Notices']);
    // The admin's group.
    expect(at('rankings', admin)).toEqual(['Admin menu', 'Servers', 'Rankings']);
    expect(at('overview', admin)).toEqual(['Admin menu', 'Servers', 'Server overview']);
    expect(at('members', admin)).toEqual(['Admin menu', 'Roster', 'Members']);
    expect(at('shopValue', admin)).toEqual(['Admin menu', 'Game data', 'Shop value']);
    expect(at('hive', admin)).toEqual(['Menu', 'Hive']);
    expect(at('planner')).toEqual(['Planner']);
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
