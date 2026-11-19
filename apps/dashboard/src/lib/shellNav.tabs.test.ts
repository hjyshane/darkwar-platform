import { describe, expect, test } from 'vitest';
import { type NavContext, type NavItem, breadcrumb, buildNav, paletteEntries } from './shellNav';

// An officer: since 2026-11-19 that is the member menu, plus Alarms under the
// alliance. The screens the menu leaves out are the admin's (`admin` below).
const base: NavContext = {
  route: 'overview',
  allianceId: null,
  own: null,
  mayViewMembers: true,
  isAdmin: false,
  isOfficer: true,
  seasonNames: {},
};

const admin: NavContext = { ...base, isAdmin: true };

const OWN = { alliance_id: '22222222-2222-4222-8222-222222222201', label: 'CBFW' };

/** The screens behind Events, as an officer is offered them. */
const EVENT_SCREENS = [
  'Black Gold',
  'Frankie',
  'Capital Clash',
  'Server Clash',
  'Participation',
  'Alarms',
  'Season 3',
];

const labels = (ctx: NavContext) => buildNav(ctx).flatMap((g) => g.items.map((i) => i.label));
const item = (ctx: NavContext, label: string): NavItem | undefined =>
  buildNav(ctx)
    .flatMap((g) => g.items)
    .find((i) => i.label === label);
const childLabels = (ctx: NavContext, label: string) =>
  (item(ctx, label)?.children ?? []).map((c) => c.label);
const child = (ctx: NavContext, label: string, under: string) =>
  item(ctx, label)?.children?.find((c) => c.label === under);

describe('buildNav tab visibility (0295)', () => {
  test('without rules every tab the role is entitled to is drawn', () => {
    expect(childLabels(admin, 'Servers')).toContain('Migration');
    expect(labels(admin)).toContain('Map');
    expect(childLabels(admin, 'Guides')).toContain('Notices');
    // The officer's menu has the same two, and no Migration to hide.
    expect(labels(base)).toContain('Map');
    expect(childLabels(base, 'Guides')).toContain('Notices');
  });

  test('a hidden tab leaves the sidebar, the rest stay', () => {
    const hidden: NavContext = {
      ...admin,
      tabShown: (tab) => tab !== 'migration' && tab !== 'notices',
    };
    expect(childLabels(hidden, 'Servers')).toEqual(['Server overview', 'Rankings']);
    expect(childLabels(hidden, 'Guides')).toEqual(['Alliance guides', 'Event guide']);
    expect(labels(hidden)).toContain('Guides');
    // Guides opens its first screen, which is no longer Notices.
    expect(item(hidden, 'Guides')?.href).toBe('#/guides');
  });

  test('a rule never shows what the role gate withholds', () => {
    // The Admin menu is the admin's: showing every tab does not hand an officer
    // Migration, or any other screen in it. The officer's own group holds
    // Members and nothing of the admin's.
    const officer = { ...base, tabShown: () => true };
    expect(buildNav(officer).map((g) => g.id)).toEqual(['watch', 'officer']);
    expect(buildNav(officer)[1]?.items.map((i) => i.label)).toEqual(['Members']);
    expect(labels(officer)).not.toContain('Servers');
    expect(buildNav(officer).flatMap((g) => g.items.flatMap((i) => i.children ?? []))).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Migration' })]),
    );
  });
});

describe('buildNav hierarchy (2026-11-19)', () => {
  const withOwn: NavContext = { ...base, own: OWN };
  const adminOwn: NavContext = { ...withOwn, isAdmin: true };

  const ownPage = (ctx: NavContext) => child(ctx, 'CBFW', 'Overview');

  test("the alliance page is the entry's Overview, its views kept as tabs", () => {
    expect(childLabels(withOwn, 'CBFW')).toEqual(['Overview', ...EVENT_SCREENS]);
    expect(item(withOwn, 'CBFW')?.href).toBe(`#/alliance/${OWN.alliance_id}`);
    expect(ownPage(withOwn)?.href).toBe(`#/alliance/${OWN.alliance_id}`);
    // Every view but past names (whether there are any is a fact about the
    // data), in the page's order: the page's own Overview tab first. Moves is
    // the admins'.
    expect(ownPage(withOwn)?.tabs?.map((t) => t.label)).toEqual([
      'Overview',
      'Members',
      'Ranking',
      'Activity',
      'Against the server',
    ]);
    expect(ownPage(adminOwn)?.tabs?.map((t) => t.label)).toEqual([
      'Overview',
      'Members',
      'Moves',
      'Ranking',
      'Activity',
      'Against the server',
    ]);
    // Every view is written out in its address, Members included.
    expect(ownPage(withOwn)?.tabs?.find((t) => t.label === 'Activity')?.href).toBe(
      `#/alliance/${OWN.alliance_id}/activity`,
    );
    expect(ownPage(withOwn)?.tabs?.find((t) => t.label === 'Members')?.href).toBe(
      `#/alliance/${OWN.alliance_id}/members`,
    );
    // Power and towers is no longer a view of its own.
    expect(ownPage(adminOwn)?.tabs?.map((t) => t.label)).not.toContain('Power and towers');
    // The landing screen is the admin's "Server overview" and nothing more; an
    // officer's menu has no entry called Overview.
    expect(labels(withOwn)).not.toContain('Overview');
    expect(child(adminOwn, 'Servers', 'Server overview')).toMatchObject({
      href: '#/',
      screen: true,
    });
    expect(child(adminOwn, 'Servers', 'Server overview')?.tabs).toBeUndefined();
  });

  test('the entry and its Overview are current on our own alliance page, with the view marked', () => {
    const onActivity: NavContext = {
      ...adminOwn,
      route: 'alliance',
      allianceId: OWN.alliance_id,
      tabs: { alliance: 'activity' },
    };
    expect(item(onActivity, 'CBFW')?.current).toBe(true);
    expect(ownPage(onActivity)?.current).toBe(true);
    expect(
      ownPage(onActivity)
        ?.tabs?.filter((t) => t.current)
        .map((t) => t.label),
    ).toEqual(['Activity']);
    // The landing screen is not the alliance's Overview.
    expect(item(onActivity, 'Servers')?.current).toBe(false);
    expect(child(onActivity, 'Servers', 'Server overview')?.current).toBe(false);
    // The bare address names no view: our own page opens on Overview.
    const bare: NavContext = { ...onActivity, tabs: {} };
    expect(
      ownPage(bare)
        ?.tabs?.filter((t) => t.current)
        .map((t) => t.label),
    ).toEqual(['Overview']);
    // Somebody else's alliance page is not ours.
    const other = { ...onActivity, allianceId: 'not-ours' };
    expect(item(other, 'CBFW')?.current).toBe(false);
    expect(ownPage(other)?.current).toBe(false);
    expect(ownPage(other)?.tabs?.some((t) => t.current)).toBe(false);
  });

  test('Hive is beside the alliance entry, Members is in the officer’s own group, and no single Events entry is left', () => {
    expect(labels(withOwn)).toEqual([
      'Home',
      'Guides',
      'Calculator',
      'Hive',
      'Map',
      'CBFW',
      'Members',
    ]);
    // Members is the Officer menu's, not the Menu's.
    expect(buildNav(withOwn)[0]?.items.map((i) => i.label)).not.toContain('Members');
    expect(labels(withOwn)).not.toContain('Events');
    // Neither is filed under the alliance any more: it holds its page and the
    // event screens, each on its own.
    for (const gone of ['Members', 'Hive', 'Events']) {
      expect(childLabels(withOwn, 'CBFW')).not.toContain(gone);
      expect(childLabels(adminOwn, 'CBFW')).not.toContain(gone);
    }
    // Members is in the admin's Roster.
    expect(childLabels(adminOwn, 'Roster')).toContain('Members');
    expect(child(adminOwn, 'Roster', 'Members')?.href).toBe('#/members');
    // The planner is archived (2026-11-12).
    expect(labels(adminOwn)).not.toContain('Planner');
  });

  test('each entry opens the first screen the reader may see', () => {
    expect(item(withOwn, 'CBFW')?.href).toBe(`#/alliance/${OWN.alliance_id}`);
    // Without the page (hidden), the first of the event screens.
    const noPage = { ...withOwn, tabShown: (tab: string) => tab !== 'alliance' };
    expect(item(noPage, 'CBFW')?.href).toBe('#/black-gold');
    // The roster no longer changes what the alliance entry holds.
    const noRoster = { ...withOwn, mayViewMembers: false };
    expect(childLabels(noRoster, 'CBFW')).toEqual(['Overview', ...EVENT_SCREENS]);
    // It decides the admin's Roster: Members needs `members.view`, and not
    // before the grid has answered, either.
    const codes: NavContext = { ...adminOwn, mayManageGiftCodes: true };
    expect(childLabels(codes, 'Roster')).toEqual(['Members', 'Gift codes']);
    expect(item(codes, 'Roster')?.href).toBe('#/members');
    expect(childLabels({ ...codes, mayViewMembers: false }, 'Roster')).toEqual(['Gift codes']);
    expect(item({ ...codes, mayViewMembers: false }, 'Roster')?.href).toBe('#/gift-codes');
    expect(childLabels({ ...codes, mayViewMembers: undefined }, 'Roster')).not.toContain('Members');
    // With neither, Roster is not drawn rather than left empty.
    expect(labels({ ...adminOwn, mayViewMembers: false })).not.toContain('Roster');
  });

  test('the entry is drawn before the alliance is known, under a plain name', () => {
    // The page's address is the uuid, so it waits; the event screens do not.
    expect(labels(base)).not.toContain('CBFW');
    expect(childLabels(base, 'Alliance')).toEqual(EVENT_SCREENS);
    expect(item(base, 'Alliance')?.href).toBe('#/black-gold');
  });

  test('the entry is current on any screen under it', () => {
    for (const route of [
      'events',
      'blackMoney',
      'frankie',
      'capitalClash',
      'serverClash',
      'participation',
      'alarms',
      'season',
    ] as const) {
      expect(item({ ...withOwn, route }, 'CBFW')?.current).toBe(true);
    }
    // The bare `#/events` address opens the first of them.
    expect(
      childLabels({ ...withOwn, route: 'events' }, 'CBFW').filter(
        (label) => child({ ...withOwn, route: 'events' }, 'CBFW', label)?.current,
      ),
    ).toEqual(['Black Gold']);
    // Hive has its own entry; Members is not under the alliance at all.
    expect(item({ ...withOwn, route: 'hive' }, 'CBFW')?.current).toBe(false);
    expect(item({ ...withOwn, route: 'hive' }, 'Hive')?.current).toBe(true);
    expect(item({ ...adminOwn, route: 'members' }, 'CBFW')?.current).toBe(false);
    expect(item({ ...adminOwn, route: 'members' }, 'Roster')?.current).toBe(true);
    expect(item({ ...withOwn, route: 'planner' }, 'CBFW')?.current).toBe(false);
    expect(item({ ...withOwn, route: 'overview' }, 'CBFW')?.current).toBe(false);
  });

  test('an admin can still hide each screen (0295)', () => {
    const noHive = { ...withOwn, tabShown: (tab: string) => tab !== 'hive' };
    expect(labels(noHive)).toEqual(['Home', 'Guides', 'Calculator', 'Map', 'CBFW', 'Members']);
    expect(childLabels(noHive, 'CBFW')).toEqual(['Overview', ...EVENT_SCREENS]);
    // "Our alliance" hides the page.
    const noPage = { ...withOwn, tabShown: (tab: string) => tab !== 'alliance' };
    expect(childLabels(noPage, 'CBFW')).toEqual(EVENT_SCREENS);
    // "Events" hides every event screen together.
    const noEvents = { ...withOwn, tabShown: (tab: string) => tab !== 'events' };
    expect(childLabels(noEvents, 'CBFW')).toEqual(['Overview']);
    // Members leaves the admin's Roster.
    const noMembers = {
      ...adminOwn,
      mayManageGiftCodes: true,
      tabShown: (tab: string) => tab !== 'members',
    };
    expect(childLabels(noMembers, 'Roster')).toEqual(['Gift codes']);
    // Hiding every screen removes the entry rather than leaving it empty.
    const none = {
      ...withOwn,
      tabShown: (tab: string) => !['alliance', 'events'].includes(tab),
    };
    expect(labels(none)).not.toContain('CBFW');
    expect(labels(none)).not.toContain('Alliance');
  });

  test('a community account gets neither the entry nor the page', () => {
    const community = { ...withOwn, isCommunity: true };
    expect(labels(community)).not.toContain('CBFW');
    expect(labels(community)).toContain('Calculator');
  });

  test('the top bar names the filed screen', () => {
    const onHive: NavContext = { ...withOwn, route: 'hive' };
    expect(breadcrumb(buildNav(onHive), [], 'hive')).toEqual(['Menu', 'Hive']);
    const onPage: NavContext = { ...withOwn, route: 'alliance', allianceId: OWN.alliance_id };
    expect(breadcrumb(buildNav(onPage), [], 'alliance')).toEqual(['Menu', 'CBFW', 'Overview']);
    const onGold: NavContext = { ...withOwn, route: 'blackMoney' };
    expect(breadcrumb(buildNav(onGold), [], 'blackMoney')).toEqual(['Menu', 'CBFW', 'Black Gold']);
    // A screen's own tabs are not named: the page shows them.
    const onDuel: NavContext = { ...withOwn, route: 'eventGuide', eventGuideTab: 'duel' };
    expect(breadcrumb(buildNav(onDuel), [], 'eventGuide')).toEqual([
      'Menu',
      'Guides',
      'Event guide',
    ]);
    const onArena: NavContext = { ...adminOwn, route: 'arena', mayViewArena: true };
    expect(breadcrumb(buildNav(onArena), [], 'arena')).toEqual([
      'Admin menu',
      'Servers',
      'Rankings',
    ]);
  });

  test('Ctrl+K still finds the event screens, the hive steps and each screen’s tabs', () => {
    const planner = { ...adminOwn, mayPlanHive: true };
    const found = paletteEntries(buildNav(planner).flatMap((g) => g.items)).map((e) => e.label);
    expect(found).toContain('CBFW › Black Gold');
    expect(found).toContain('CBFW › Season 2');
    expect(found).toContain('Hive › Draw the shape');
    expect(found).toContain('Roster › Members › This ranking · weekly');
    expect(found).toContain('CBFW › Overview › Activity');
    expect(found).toContain('CBFW › Overview › Moves');
    expect(found).toContain('Guides › Event guide › Alliance Duel');
    expect(found).toContain('Servers › Rankings › Player Ranking');
    expect(found).not.toContain('CBFW › Overview › Power and towers');
    // Not a planner: the hive has no tabs to find. Not an admin: no Season 2,
    // no Moves, and nothing from the Admin menu.
    const reader = paletteEntries(buildNav(withOwn).flatMap((g) => g.items)).map((e) => e.label);
    expect(reader).toContain('CBFW › Black Gold');
    expect(reader).toContain('CBFW › Overview › Activity');
    expect(reader).not.toContain('Hive › Draw the shape');
    expect(reader).not.toContain('CBFW › Season 2');
    expect(reader).not.toContain('CBFW › Overview › Moves');
    expect(reader).not.toContain('Roster › Members › This ranking · weekly');
  });
});
